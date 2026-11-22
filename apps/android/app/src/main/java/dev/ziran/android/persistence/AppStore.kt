package dev.ziran.android.persistence

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dev.ziran.android.protocol.PairedCredential
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray

private val Context.prefs: DataStore<Preferences> by preferencesDataStore(name = "ziran_prefs")

/**
 * Scoped persistence. Everything is keyed by serverId and sessionId:
 * drafts, pending sends, reading positions and caches. Tokens additionally go
 * through SecretVault. Mirrors cache.ts and credentials.ts in stillness.
 */
class AppStore(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        fun serverKey(serverId: String, name: String) = "server:$serverId:$name"
        fun sessionKey(serverId: String, sessionId: String, name: String) = "session:$serverId:$sessionId:$name"
    }

    private fun stringKey(name: String) = stringPreferencesKey(name)
    private fun boolKey(name: String) = booleanPreferencesKey(name)
    private fun intKey(name: String) = intPreferencesKey(name)

    fun dataStore(): DataStore<Preferences> = context.prefs

    suspend fun saveCredential(credential: PairedCredential) {
        context.prefs.edit { prefs ->
            prefs[stringKey(serverKey(credential.serverId, "baseUrl"))] = credential.baseUrl
            prefs[stringKey(serverKey(credential.serverId, "serverId"))] = credential.serverId
            prefs[stringKey(serverKey(credential.serverId, "deviceId"))] = credential.device.deviceId
            prefs[stringKey(serverKey(credential.serverId, "deviceName"))] = credential.device.name
            prefs[stringKey(serverKey(credential.serverId, "savedAt"))] = credential.savedAt.toString()
        }
        SecretVault.put(context, serverKey(credential.serverId, "token"), credential.token)
    }

    fun loadCredentialFromPrefs(prefs: Preferences, serverId: String): PairedCredential? {
        val baseUrl = prefs[stringKey(serverKey(serverId, "baseUrl"))] ?: return null
        val deviceId = prefs[stringKey(serverKey(serverId, "deviceId"))] ?: ""
        val deviceName = prefs[stringKey(serverKey(serverId, "deviceName"))] ?: ""
        val savedAt = prefs[stringKey(serverKey(serverId, "savedAt"))]?.toLongOrNull() ?: 0L
        val token = SecretVault.get(context, serverKey(serverId, "token")) ?: return null
        return PairedCredential(
            baseUrl = baseUrl,
            token = token,
            device = dev.ziran.android.protocol.DeviceInfo(deviceId, deviceName, savedAt, null),
            serverId = serverId,
            savedAt = savedAt,
        )
    }

    suspend fun listServerIds(): List<String> {
        val prefs = context.prefs.data.first()
        return prefs.asMap().keys.mapNotNull { key ->
            val name = key.name
            if (name.startsWith("server:") && name.endsWith(":baseUrl")) {
                name.removePrefix("server:").removeSuffix(":baseUrl")
            } else null
        }
    }

    suspend fun setLastSession(serverId: String, sessionId: String?) {
        context.prefs.edit { prefs ->
            val key = stringKey(serverKey(serverId, "lastSession"))
            if (sessionId != null) prefs[key] = sessionId else prefs.remove(key)
        }
    }

    suspend fun getLastSession(serverId: String): String? =
        context.prefs.data.first()[stringKey(serverKey(serverId, "lastSession"))]

    suspend fun saveDraft(serverId: String, sessionId: String, text: String) {
        context.prefs.edit { prefs ->
            val key = stringKey(sessionKey(serverId, sessionId, "draft"))
            if (text.isNotEmpty()) prefs[key] = text else prefs.remove(key)
        }
    }

    suspend fun loadDraft(serverId: String, sessionId: String): String =
        context.prefs.data.first()[stringKey(sessionKey(serverId, sessionId, "draft"))] ?: ""

    suspend fun savePending(serverId: String, sessionId: String, operationId: String, text: String, state: String, createdAtMs: Long) {
        context.prefs.edit { prefs ->
            prefs[stringKey(sessionKey(serverId, sessionId, "pendingOp"))] = operationId
            prefs[stringKey(sessionKey(serverId, sessionId, "pendingText"))] = text
            prefs[stringKey(sessionKey(serverId, sessionId, "pendingState"))] = state
            prefs[stringKey(sessionKey(serverId, sessionId, "pendingAt"))] = createdAtMs.toString()
        }
    }

    suspend fun loadPending(serverId: String, sessionId: String): PendingRecord? {
        val prefs = context.prefs.data.first()
        val op = prefs[stringKey(sessionKey(serverId, sessionId, "pendingOp"))] ?: return null
        return PendingRecord(
            operationId = op,
            text = prefs[stringKey(sessionKey(serverId, sessionId, "pendingText"))] ?: "",
            state = prefs[stringKey(sessionKey(serverId, sessionId, "pendingState"))] ?: "staged",
            createdAtMs = prefs[stringKey(sessionKey(serverId, sessionId, "pendingAt"))]?.toLongOrNull() ?: 0,
        )
    }

    suspend fun clearPending(serverId: String, sessionId: String) {
        context.prefs.edit { prefs ->
            prefs.remove(stringKey(sessionKey(serverId, sessionId, "pendingOp")))
            prefs.remove(stringKey(sessionKey(serverId, sessionId, "pendingText")))
            prefs.remove(stringKey(sessionKey(serverId, sessionId, "pendingState")))
            prefs.remove(stringKey(sessionKey(serverId, sessionId, "pendingAt")))
        }
    }

    // -- soft-interrupt queue, scoped exactly like drafts --------------------

    /**
     * Queue text is stored per session, and an index of sessions that hold
     * queue is kept on the server. A message queued in thread A must survive a
     * process kill and must never drain into thread B.
     */
    suspend fun saveQueue(serverId: String, sessionId: String, texts: List<String>) {
        context.prefs.edit { prefs ->
            val key = stringKey(sessionKey(serverId, sessionId, "queue"))
            if (texts.isEmpty()) {
                prefs.remove(key)
                val index = readIndex(prefs[stringKey(serverKey(serverId, "queuedSessions"))])
                    .filterNot { it == sessionId }
                val indexKey = stringKey(serverKey(serverId, "queuedSessions"))
                if (index.isEmpty()) prefs.remove(indexKey) else prefs[indexKey] = encodeList(index)
            } else {
                prefs[key] = encodeList(texts)
                val index = readIndex(prefs[stringKey(serverKey(serverId, "queuedSessions"))])
                if (sessionId !in index) {
                    prefs[stringKey(serverKey(serverId, "queuedSessions"))] = encodeList(index + sessionId)
                }
            }
        }
    }

    suspend fun loadQueue(serverId: String, sessionId: String): List<String> =
        readIndex(context.prefs.data.first()[stringKey(sessionKey(serverId, sessionId, "queue"))])

    suspend fun queuedSessionIds(serverId: String): List<String> =
        readIndex(context.prefs.data.first()[stringKey(serverKey(serverId, "queuedSessions"))])

    private fun encodeList(items: List<String>): String =
        JsonArray(items.map { JsonPrimitive(it) }).toString()

    private fun readIndex(raw: String?): List<String> {
        if (raw.isNullOrEmpty()) return emptyList()
        return runCatching {
            Json.parseToJsonElement(raw).jsonArray.mapNotNull { element -> (element as? JsonPrimitive)?.content }
        }.getOrDefault(emptyList())
    }

    suspend fun saveSessionListCache(serverId: String, rawJson: String) {
        context.prefs.edit { it[stringKey(serverKey(serverId, "sessionList"))] = rawJson }
    }

    suspend fun loadSessionListCache(serverId: String): String? =
        context.prefs.data.first()[stringKey(serverKey(serverId, "sessionList"))]

    suspend fun saveSnapshotCache(serverId: String, sessionId: String, rawJson: String) {
        if (rawJson.length > 3_000_000) return
        context.prefs.edit { it[stringKey(sessionKey(serverId, sessionId, "snapshot"))] = rawJson }
    }

    suspend fun loadSnapshotCache(serverId: String, sessionId: String): String? =
        context.prefs.data.first()[stringKey(sessionKey(serverId, sessionId, "snapshot"))]

    suspend fun setNotificationsAsked(value: Boolean) {
        context.prefs.edit { it[boolKey("ui:notificationsAsked")] = value }
    }

    suspend fun notificationsAsked(): Boolean =
        context.prefs.data.first()[boolKey("ui:notificationsAsked")] ?: false

    // Preferences: scene, theme, model choice.
    suspend fun setScene(sceneKey: String) {
        context.prefs.edit { it[stringKey("ui:scene")] = sceneKey }
    }
    suspend fun getScene(): String = context.prefs.data.first()[stringKey("ui:scene")] ?: "peaks"

    suspend fun setThemeMode(mode: String) {
        context.prefs.edit { it[stringKey("ui:theme")] = mode }
    }
    suspend fun getThemeMode(): String = context.prefs.data.first()[stringKey("ui:theme")] ?: "system"

    suspend fun removeServer(serverId: String) {
        context.prefs.edit { prefs ->
            val prefix = "server:$serverId:"
            val sessPrefix = "session:$serverId:"
            prefs.asMap().keys.toList().forEach { key ->
                if (key.name.startsWith(prefix) || key.name.startsWith(sessPrefix)) {
                    prefs.remove(key)
                }
            }
        }
        SecretVault.delete(context, serverKey(serverId, "token"))
    }

    suspend fun setSteerDefault(mode: String) {
        context.prefs.edit { it[stringKey("ui:steerDefault")] = mode }
    }
    suspend fun getSteerDefault(): String = context.prefs.data.first()[stringKey("ui:steerDefault")] ?: "steer"

    suspend fun setThreadsSort(sort: String) {
        context.prefs.edit { it[stringKey("ui:threadsSort")] = sort }
    }
    suspend fun getThreadsSort(): String = context.prefs.data.first()[stringKey("ui:threadsSort")] ?: "recent"

    suspend fun setDefaultModel(model: String, provider: String, apiMethod: String) {
        context.prefs.edit {
            it[stringKey("ui:defaultModel")] = model
            it[stringKey("ui:defaultProvider")] = provider
            it[stringKey("ui:defaultApiMethod")] = apiMethod
        }
    }
    suspend fun getDefaultModel(): Triple<String?, String?, String?> {
        val prefs = context.prefs.data.first()
        return Triple(
            prefs[stringKey("ui:defaultModel")],
            prefs[stringKey("ui:defaultProvider")],
            prefs[stringKey("ui:defaultApiMethod")],
        )
    }

    suspend fun setDefaultEffort(effort: String) {
        context.prefs.edit { it[stringKey("ui:defaultEffort")] = effort }
    }
    suspend fun getDefaultEffort(): String? = context.prefs.data.first()[stringKey("ui:defaultEffort")]

    suspend fun setNotifyWaiting(enabled: Boolean) {
        context.prefs.edit { it[boolKey("ui:notifyWaiting")] = enabled }
    }
    suspend fun getNotifyWaiting(): Boolean = context.prefs.data.first()[boolKey("ui:notifyWaiting")] ?: true

    suspend fun setNotifyDone(enabled: Boolean) {
        context.prefs.edit { it[boolKey("ui:notifyDone")] = enabled }
    }
    suspend fun getNotifyDone(): Boolean = context.prefs.data.first()[boolKey("ui:notifyDone")] ?: true

    suspend fun setNotifyOnlyClosed(enabled: Boolean) {
        context.prefs.edit { it[boolKey("ui:notifyOnlyClosed")] = enabled }
    }
    suspend fun getNotifyOnlyClosed(): Boolean = context.prefs.data.first()[boolKey("ui:notifyOnlyClosed")] ?: true
}

data class PendingRecord(val operationId: String, val text: String, val state: String, val createdAtMs: Long)
