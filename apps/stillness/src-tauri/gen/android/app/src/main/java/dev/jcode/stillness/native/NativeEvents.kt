package dev.jcode.stillness.native

import android.app.Activity
import android.util.Log

/**
 * Fan-out for bridge events.
 *
 * Events are delivered through the Tauri plugin channel registered by
 * `addPluginListener`. When no JavaScript listener is attached yet the event is
 * dropped on purpose: every event that matters for startup (deep links, inbound
 * shares, lock state) also has a `consume`/`status` command the client calls
 * after it is ready, so nothing is silently invented or lost.
 */
object NativeEvents {
    private const val TAG = "JCodeNativeEvents"

    @Volatile
    private var plugin: NativeBridgePlugin? = null

    @Volatile
    var activity: Activity? = null

    fun attach(target: NativeBridgePlugin, host: Activity) {
        plugin = target
        activity = host
    }

    fun detach(target: NativeBridgePlugin) {
        if (plugin === target) plugin = null
        if (activity === target.activityOrNull()) activity = null
    }

    fun emit(event: String, payload: Any) {
        val target = plugin ?: return
        try {
            if (target.hasListener(event)) {
                target.triggerObject(event, payload)
            }
        } catch (error: Throwable) {
            // A failing observer must not break the platform action that
            // produced the event.
            Log.w(TAG, "could not deliver native event $event", error)
        }
    }
}
