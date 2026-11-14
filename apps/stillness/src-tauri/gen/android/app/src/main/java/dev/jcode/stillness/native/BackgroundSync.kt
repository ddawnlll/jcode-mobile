package dev.jcode.stillness.native

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Bounded background reconciliation with WorkManager.
 *
 * The worker performs one short `GET /health` against the adapter and records
 * the result. It never keeps a socket open, never polls in a loop, and never
 * runs a foreground service. WorkManager owns Doze and battery windows, and the
 * period is clamped to the platform minimum of 15 minutes.
 *
 * The probe is unauthenticated because `/health` is unauthenticated by contract.
 * Session reconciliation needs the authenticated WebSocket and therefore stays
 * a foreground activity; claiming otherwise would be a fake background feature.
 */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val context = applicationContext
        NativeSettings.setOperational(context, KEY_SYNC_QUEUED, 0)
        if (!NativeSettings.getBoolean(context, NativeSettings.KEY_BACKGROUND_SYNC_ENABLED)) {
            NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_STATUS, "skipped")
            NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_ERROR, "disabled")
            return Result.success()
        }
        val baseUrl = NativeSettings.operationalString(context, NativeSettings.KEY_SYNC_BASE_URL)
        val startedAt = System.currentTimeMillis() / 1000L
        NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_RUN_AT, startedAt)
        NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_BASE_URL, baseUrl)
        if (baseUrl.isNullOrBlank()) {
            NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_STATUS, "not_configured")
            NativeSettings.setOperational(
                context,
                NativeSettings.KEY_SYNC_LAST_ERROR,
                "no adapter base URL is configured",
            )
            NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_HTTP, null)
            return Result.success()
        }
        var connection: HttpURLConnection? = null
        try {
            val url = URL(baseUrl.trimEnd('/') + "/health")
            connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
            }
            val code = connection.responseCode
            NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_HTTP, code)
            if (code !in 200..299) {
                NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_STATUS, "http_error")
                NativeSettings.setOperational(
                    context,
                    NativeSettings.KEY_SYNC_LAST_ERROR,
                    "adapter returned HTTP $code",
                )
                return Result.success()
            }
            val body = connection.inputStream.use { stream ->
                val buffer = ByteArray(8 * 1024)
                val out = StringBuilder()
                var total = 0
                while (total < MAX_BODY_BYTES) {
                    val read = stream.read(buffer)
                    if (read <= 0) break
                    total += read
                    out.append(String(buffer, 0, read, Charsets.UTF_8))
                }
                out.toString()
            }
            val payload = JSONObject(body)
            val connected = payload.optBoolean("jcode_connected", false)
            val protocol = payload.optString("protocol", "")
            NativeSettings.setOperational(
                context,
                NativeSettings.KEY_SYNC_LAST_STATUS,
                if (connected) "connected" else "adapter_only",
            )
            NativeSettings.setOperational(
                context,
                NativeSettings.KEY_SYNC_LAST_ERROR,
                if (connected) null else "adapter is up but the daemon is not connected",
            )
            NativeSettings.setOperational(
                context,
                NativeSettings.KEY_SYNC_LAST_PROTOCOL,
                if (protocol.isBlank()) null else protocol,
            )
            return Result.success()
        } catch (error: Exception) {
            NativeSettings.setOperational(context, NativeSettings.KEY_SYNC_LAST_STATUS, "unreachable")
            NativeSettings.setOperational(
                context,
                NativeSettings.KEY_SYNC_LAST_ERROR,
                error.message ?: error.javaClass.simpleName,
            )
            Log.w(TAG, "background sync probe failed", error)
            return Result.success()
        } finally {
            connection?.disconnect()
        }
    }

    private companion object {
        const val TAG = "JCodeSyncWorker"
        const val CONNECT_TIMEOUT_MS = 8_000
        const val READ_TIMEOUT_MS = 8_000
        const val MAX_BODY_BYTES = 64 * 1024
        const val KEY_SYNC_QUEUED = "syncQueued"
    }
}

object BackgroundSync {
    const val UNIQUE_PERIODIC = "jcode-background-sync"
    const val UNIQUE_ONE_SHOT = "jcode-background-sync-now"
    private const val KEY_SYNC_QUEUED = "syncQueued"
    private const val KEY_SYNC_LAST_PROTOCOL = "syncLastProtocol"

    data class BackgroundSyncStatusData(
        val enabled: Boolean,
        val intervalMinutes: Int,
        val lastRunAt: Long?,
        val lastStatus: String?,
        val lastError: String?,
        val lastHttpStatus: Int?,
        val lastCheckedBaseUrl: String?,
        val lastProtocol: String?,
        val worker: String,
        val queued: Boolean,
    )

    fun status(context: Context): BackgroundSyncStatusData {
        val enabled = NativeSettings.getBoolean(
            context,
            NativeSettings.KEY_BACKGROUND_SYNC_ENABLED,
        )
        return BackgroundSyncStatusData(
            enabled = enabled,
            intervalMinutes = NativeSettings.getInt(
                context,
                NativeSettings.KEY_BACKGROUND_SYNC_INTERVAL,
            ).coerceIn(NativeSettings.MIN_SYNC_MINUTES, NativeSettings.MAX_SYNC_MINUTES),
            lastRunAt = NativeSettings.operationalLong(
                context,
                NativeSettings.KEY_SYNC_LAST_RUN_AT,
            ),
            lastStatus = NativeSettings.operationalString(
                context,
                NativeSettings.KEY_SYNC_LAST_STATUS,
            ),
            lastError = NativeSettings.operationalString(
                context,
                NativeSettings.KEY_SYNC_LAST_ERROR,
            ),
            lastHttpStatus = NativeSettings.operationalInt(
                context,
                NativeSettings.KEY_SYNC_LAST_HTTP,
            ),
            lastCheckedBaseUrl = NativeSettings.operationalString(
                context,
                NativeSettings.KEY_SYNC_LAST_BASE_URL,
            ),
            lastProtocol = NativeSettings.operationalString(context, KEY_SYNC_LAST_PROTOCOL),
            worker = if (enabled) "periodic_work" else "none",
            queued = NativeSettings.operationalInt(context, KEY_SYNC_QUEUED) == 1,
        )
    }

    fun set(
        context: Context,
        enabled: Boolean,
        intervalMinutes: Int?,
        baseUrl: String?,
    ): BackgroundSyncStatusData {
        val requested = (intervalMinutes ?: NativeSettings.getInt(
            context,
            NativeSettings.KEY_BACKGROUND_SYNC_INTERVAL,
        )).coerceIn(NativeSettings.MIN_SYNC_MINUTES, NativeSettings.MAX_SYNC_MINUTES)
        val normalizedBase = baseUrl?.let { normalizeBaseUrl(it) }
        NativeSettings.set(
            context,
            mapOf(
                NativeSettings.KEY_BACKGROUND_SYNC_ENABLED to enabled,
                NativeSettings.KEY_BACKGROUND_SYNC_INTERVAL to requested,
            ),
        )
        if (normalizedBase != null) {
            NativeSettings.setOperational(
                context,
                NativeSettings.KEY_SYNC_BASE_URL,
                normalizedBase,
            )
        }
        val manager = WorkManager.getInstance(context.applicationContext)
        if (enabled) {
            val request = PeriodicWorkRequest.Builder(
                SyncWorker::class.java,
                requested.toLong(),
                TimeUnit.MINUTES,
            )
                .setConstraints(
                    Constraints.Builder()
                        .setRequiresBatteryNotLow(true)
                        .build(),
                )
                .build()
            manager.enqueueUniquePeriodicWork(
                UNIQUE_PERIODIC,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        } else {
            manager.cancelUniqueWork(UNIQUE_PERIODIC)
        }
        NativeEvents.emit("backgroundSyncChanged", status(context))
        return status(context)
    }

    fun runNow(context: Context): BackgroundSyncStatusData {
        require(
            NativeSettings.getBoolean(context, NativeSettings.KEY_BACKGROUND_SYNC_ENABLED),
        ) { "background sync is disabled" }
        val request = OneTimeWorkRequest.Builder(SyncWorker::class.java)
            .setConstraints(
                Constraints.Builder()
                    .setRequiresBatteryNotLow(true)
                    .build(),
            )
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(UNIQUE_ONE_SHOT, ExistingWorkPolicy.REPLACE, request)
        NativeSettings.setOperational(context, KEY_SYNC_QUEUED, 1)
        return status(context)
    }

    private fun normalizeBaseUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        require(trimmed.isNotEmpty()) { "adapter base URL must not be blank" }
        val url = URL(trimmed)
        require(url.protocol == "http" || url.protocol == "https") {
            "adapter base URL must be http or https"
        }
        require(!url.host.isNullOrBlank()) { "adapter base URL must include a host" }
        return trimmed
    }
}
