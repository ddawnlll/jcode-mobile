package dev.ziran.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import dev.ziran.android.data.AppController
import dev.ziran.android.persistence.AppStore
import dev.ziran.android.ui.AppStoreHolder
import dev.ziran.android.ui.ZiranApp

class MainActivity : ComponentActivity() {
    private lateinit var controller: AppController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = AppStore(applicationContext)
        AppStoreHolder.store = store
        controller = AppController(store)
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
