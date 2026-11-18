package dev.ziran.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppController
import dev.ziran.android.data.AppState
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuFonts
import dev.ziran.android.persistence.AppStore
import kotlinx.coroutines.launch

/**
 * Live application host. One controller survives screen unmounts. Navigation
 * is a hand-rolled back stack; transitions arrive with the motion step.
 * Day and night resolve from the saved theme mode and system darkness.
 */
@Composable
fun ZiranApp(controller: AppController, deepLink: String? = null) {
    val state by controller.state.collectAsState()
    val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
    val palette = when (state.themeMode) {
        "day" -> Palette.Day
        "night" -> Palette.Night
        else -> if (systemDark) Palette.Night else Palette.Day
    }
    val scope = rememberCoroutineScope()
    var stack by remember { mutableStateOf(listOf<Screen>(Screen.Start)) }
    val current = stack.last()
    val go = { next: Screen -> stack = stack + next }
    val back = { if (stack.size > 1) stack = stack.dropLast(1) }

    when (val screen = current) {
        Screen.Start -> StartScreen(
            palette = palette,
            sceneKey = state.scene,
            serverValue = "https://studio-vps:7646",
            codeValue = "",
            error = state.pairingError,
            onPair = { scope.launch { controller.pair("https://studio-vps:7646", "", "ziran-android") } },
            reducedMotion = isReducedMotion(),
        )
        Screen.Threads -> ThreadsScreen(
            palette = palette,
            sessions = state.sessions,
            serverName = state.serverName ?: "studio-vps",
            sceneKey = state.scene,
            onOpen = {
                scope.launch { controller.openSession(it) }
                go(Screen.Thread(it))
            },
            reducedMotion = isReducedMotion(),
        )
        is Screen.Thread -> ThreadScreen(
            palette = palette,
            state = state,
            sceneKey = state.scene,
            onBack = back,
            onModel = { go(Screen.Model) },
            onScenes = { go(Screen.Scenes) },
            onTextChange = controller::setComposerText,
            onSend = { scope.launch { controller.send() } },
            onStop = { scope.launch { controller.stop() } },
            onPermission = { decision -> scope.launch { controller.respondPermission(decision) } },
            reducedMotion = isReducedMotion(),
        )
        Screen.Model -> ModelScreen(
            palette = palette,
            state = state,
            sceneKey = state.scene,
            onBack = back,
            onSelectModel = { model -> scope.launch { controller.selectModel(model.model, model.provider, model.apiMethod) } },
            onSetEffort = { effort -> scope.launch { controller.setReasoning(effort) } },
            reducedMotion = isReducedMotion(),
        )
        Screen.Scenes -> ScenesScreen(
            palette = palette,
            selectedScene = state.scene,
            themeMode = state.themeMode,
            sceneKey = state.scene,
            onBack = back,
            onSelectScene = { key -> scope.launch { AppStoreHolder.store.setScene(key) } },
            onSelectTheme = { mode -> scope.launch { AppStoreHolder.store.setThemeMode(mode) } },
            reducedMotion = isReducedMotion(),
        )
    }
    // Auto-navigate to threads once pairing completes.
    if (state.phase == "ready" && current == Screen.Start) stack = listOf(Screen.Threads)
}

@Composable
private fun isReducedMotion(): Boolean {
    val scale = dev.ziran.android.design.rememberAnimatorScale()
    return scale <= 0.01f
}

object AppStoreHolder {
    lateinit var store: AppStore
}
