package dev.ziran.android

import android.app.Application
import dev.ziran.android.data.AppController
import dev.ziran.android.persistence.AppStore

/**
 * The controller outlives every Activity.
 *
 * Rotating, leaving the task and reopening, and a deep link that lands while the
 * app is running all reuse this one controller, so the socket and the restored
 * session are not rebuilt by an Activity lifecycle event.
 */
class ZiranApplication : Application() {

    lateinit var controller: AppController
        private set

    override fun onCreate() {
        super.onCreate()
        // Keystore-backed credentials, DataStore caches, one controller.
        val store = AppStore(this)
        controller = AppController(store, this)
        controller.start()
    }
}
