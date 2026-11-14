package dev.jcode.stillness.native

import android.content.Context

/**
 * Typed native settings.
 *
 * Every key is validated and persisted in SharedPreferences, and every value is
 * read back by the component that owns the behavior (notifications, WorkManager,
 * haptics, clipboard privacy). The bridge must never report a toggle as on
 * while the underlying behavior ignores it.
 */
object NativeSettings {
    const val PREFS = "jcode_native_settings"

    const val KEY_NOTIFICATIONS_ENABLED = "notificationsEnabled"
    const val KEY_BACKGROUND_SYNC_ENABLED = "backgroundSyncEnabled"
    const val KEY_BACKGROUND_SYNC_INTERVAL = "backgroundSyncIntervalMinutes"
    const val KEY_NOTIFICATION_PREVIEWS = "notificationPreviews"
    const val KEY_HAPTICS_ENABLED = "hapticsEnabled"
    const val KEY_MOTION = "motion"
    const val KEY_PRIVACY_CLIPBOARD_REDACT = "privacyClipboardRedact"

    // Non-secret operational state read by the sync worker.
    const val KEY_SYNC_BASE_URL = "syncBaseUrl"
    const val KEY_SYNC_LAST_RUN_AT = "syncLastRunAt"
    const val KEY_SYNC_LAST_STATUS = "syncLastStatus"
    const val KEY_SYNC_LAST_ERROR = "syncLastError"
    const val KEY_SYNC_LAST_HTTP = "syncLastHttpStatus"
    const val KEY_SYNC_LAST_BASE_URL = "syncLastCheckedBaseUrl"
    const val KEY_SYNC_LAST_PROTOCOL = "syncLastProtocol"

    const val MOTION_FULL = "full"
    const val MOTION_REDUCED = "reduced"

    const val MIN_SYNC_MINUTES = 15
    const val MAX_SYNC_MINUTES = 1440

    enum class ValueType { BOOLEAN, INT, STRING }

    private data class Spec(
        val key: String,
        val type: ValueType,
        val default: Any,
        val label: String,
        val description: String,
    )

    private val specs: List<Spec> = listOf(
        Spec(
            KEY_NOTIFICATIONS_ENABLED,
            ValueType.BOOLEAN,
            true,
            "Notifications",
            "Post local notifications when a turn finishes, fails, or needs approval.",
        ),
        Spec(
            KEY_BACKGROUND_SYNC_ENABLED,
            ValueType.BOOLEAN,
            false,
            "Background sync",
            "Periodic WorkManager health probe (minimum 15 minutes, battery aware).",
        ),
        Spec(
            KEY_BACKGROUND_SYNC_INTERVAL,
            ValueType.INT,
            30,
            "Background sync interval",
            "Minutes between bounded health probes, clamped to 15-1440.",
        ),
        Spec(
            KEY_NOTIFICATION_PREVIEWS,
            ValueType.BOOLEAN,
            true,
            "Notification previews",
            "Show reply text in notifications. Off shows a generic body.",
        ),
        Spec(
            KEY_HAPTICS_ENABLED,
            ValueType.BOOLEAN,
            true,
            "Haptics",
            "Allow the webview to request light, medium, heavy, success, or error feedback.",
        ),
        Spec(
            KEY_MOTION,
            ValueType.STRING,
            MOTION_FULL,
            "Motion",
            "full or reduced. Consumed by the client UI.",
        ),
        Spec(
            KEY_PRIVACY_CLIPBOARD_REDACT,
            ValueType.BOOLEAN,
            true,
            "Redact sensitive clipboard reads",
            "Refuse to return clipboard content flagged as sensitive by the platform.",
        ),
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun definitions(): List<Map<String, Any?>> = specs.map {
        mapOf(
            "key" to it.key,
            "type" to it.type.name.lowercase(),
            "default" to it.default,
            "label" to it.label,
            "description" to it.description,
        )
    }

    fun has(key: String): Boolean = specs.any { it.key == key }

    fun keys(): List<String> = specs.map { it.key }

    fun getBoolean(context: Context, key: String): Boolean =
        prefs(context).getBoolean(key, defaultFor(key) as? Boolean ?: false)

    fun getInt(context: Context, key: String): Int =
        prefs(context).getInt(key, defaultFor(key) as? Int ?: 0)

    fun getString(context: Context, key: String): String? {
        val fallback = defaultFor(key) as? String
        return prefs(context).getString(key, fallback)
    }

    private fun defaultFor(key: String): Any? = specs.firstOrNull { it.key == key }?.default

    /**
     * Read a typed snapshot. Unknown keys raise [IllegalArgumentException] so a
     * typo cannot silently produce an empty settings screen.
     */
    fun snapshot(context: Context, requested: List<String>?): Map<String, Any?> {
        val keys = when {
            requested == null || requested.isEmpty() -> specs.map { it.key }
            else -> requested
        }
        val unknown = keys.filterNot(::has)
        require(unknown.isEmpty()) { "unknown settings: ${unknown.joinToString(", ")}" }
        val values = LinkedHashMap<String, Any?>()
        for (key in keys) {
            values[key] = when (specs.first { it.key == key }.type) {
                ValueType.BOOLEAN -> getBoolean(context, key)
                ValueType.INT -> getInt(context, key)
                ValueType.STRING -> getString(context, key)
            }
        }
        return values
    }

    fun settingsMetadata(): Map<String, Any?> = mapOf(
        "definitions" to definitions(),
        "syncMinMinutes" to MIN_SYNC_MINUTES,
        "syncMaxMinutes" to MAX_SYNC_MINUTES,
    )

    /**
     * Validate and persist. The returned snapshot is the authoritative stored
     * value, so the caller renders what actually took effect.
     */
    fun set(context: Context, values: Map<String, Any?>): Map<String, Any?> {
        val unknown = values.keys.filterNot(::has)
        require(unknown.isEmpty()) { "unknown settings: ${unknown.joinToString(", ")}" }
        val editor = prefs(context).edit()
        for ((key, raw) in values) {
            val spec = specs.first { it.key == key }
            when (spec.type) {
                ValueType.BOOLEAN -> {
                    val typed = raw as? Boolean
                        ?: throw IllegalArgumentException("$key expects a boolean")
                    editor.putBoolean(key, typed)
                }
                ValueType.INT -> {
                    val number = when (raw) {
                        is Int -> raw
                        is Number -> raw.toInt()
                        else -> throw IllegalArgumentException("$key expects an integer")
                    }
                    val clamped = if (key == KEY_BACKGROUND_SYNC_INTERVAL) {
                        number.coerceIn(MIN_SYNC_MINUTES, MAX_SYNC_MINUTES)
                    } else {
                        number
                    }
                    editor.putInt(key, clamped)
                }
                ValueType.STRING -> {
                    val text = raw as? String
                        ?: throw IllegalArgumentException("$key expects a string")
                    if (key == KEY_MOTION && text != MOTION_FULL && text != MOTION_REDUCED) {
                        throw IllegalArgumentException("motion must be full or reduced")
                    }
                    editor.putString(key, text)
                }
            }
        }
        editor.apply()
        return snapshot(context, values.keys.toList())
    }

    fun setOperational(context: Context, key: String, value: Any?) {
        val editor = prefs(context).edit()
        when (value) {
            null -> editor.remove(key)
            is Boolean -> editor.putBoolean(key, value)
            is Int -> editor.putInt(key, value)
            is Long -> editor.putLong(key, value)
            else -> editor.putString(key, value.toString())
        }
        editor.apply()
    }

    fun operationalLong(context: Context, key: String): Long? {
        val prefs = prefs(context)
        if (!prefs.contains(key)) return null
        return prefs.getLong(key, 0L)
    }

    fun operationalInt(context: Context, key: String): Int? {
        val prefs = prefs(context)
        if (!prefs.contains(key)) return null
        return prefs.getInt(key, 0)
    }

    fun operationalString(context: Context, key: String): String? =
        prefs(context).getString(key, null)
}
