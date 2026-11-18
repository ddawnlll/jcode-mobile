package dev.ziran.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dev.ziran.android.data.AppController
import dev.ziran.android.persistence.AppStore
import dev.ziran.android.ui.ZiranApp

class MainActivity : ComponentActivity() {
    private lateinit var controller: AppController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge to edge so WindowInsets.ime reaches Compose and the composer can
        // ride the keyboard instead of hiding behind it.
        enableEdgeToEdge()
        // Keystore-backed credentials, DataStore caches, and the one controller
        // that survives screen changes. Nothing here owns a turn.
        val store = AppStore(applicationContext)
        controller = AppController(store, applicationContext)
        controller.start()
        setContent {
            ZiranApp(controller = controller, deepLink = intent.data?.toString())
        }
    }

    override fun onDestroy() {
        controller.close()
        super.onDestroy()
    }
}
