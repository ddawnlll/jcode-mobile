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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

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

    // Preferences: scene, theme, model choice.
    suspend fun setScene(sceneKey: String) {
        context.prefs.edit { it[stringKey("ui:scene")] = sceneKey }
    }
    suspend fun getScene(): String = context.prefs.data.first()[stringKey("ui:scene")] ?: "peaks"

    suspend fun setThemeMode(mode: String) {
        context.prefs.edit { it[stringKey("ui:theme")] = mode }
    }
    suspend fun getThemeMode(): String = context.prefs.data.first()[stringKey("ui:theme")] ?: "system"
}

data class PendingRecord(val operationId: String, val text: String, val state: String, val createdAtMs: Long)
