package dev.ziran.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.background
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import dev.ziran.android.data.AppController
import dev.ziran.android.design.InkRippleHost
import dev.ziran.android.design.Palette
import dev.ziran.android.design.rememberAnimatorScale
import kotlinx.coroutines.launch

/** Hand-rolled back stack. State lives in the controller, not the screens. */
sealed interface Screen {
    object Start : Screen
    object Threads : Screen
    data class Thread(val sessionId: String) : Screen
    object Model : Screen
    object Scenes : Screen
}

/**
 * Application host. Day and night resolve from the saved theme mode and system
 * darkness. Every touch gets an ink ripple. Navigation never cancels a turn:
 * leaving a thread only changes which screen is painted.
 */
@Composable
fun ZiranApp(controller: AppController, deepLink: String? = null) {
    val state by controller.state.collectAsState()
    val dark = isSystemInDarkTheme()
    val palette = when (state.themeMode) {
        "day" -> Palette.Day
        "night" -> Palette.Night
        else -> if (dark) Palette.Night else Palette.Day
    }
    val durationScale = rememberAnimatorScale()
    val reduced = durationScale <= 0.01f
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val paste: () -> Unit = {
        val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
        val text = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
        if (text != null) controller.applyPairingLink(text)
    }
    var stack by remember { mutableStateOf(listOf<Screen>(Screen.Start)) }
    val go: (Screen) -> Unit = { next -> stack = stack + next }
    val back: () -> Unit = { if (stack.size > 1) stack = stack.dropLast(1) }
    var handledDeepLink by remember { mutableStateOf<String?>(null) }

    // Deep link: pair prefills and starts pairing; session opens the thread.
    LaunchedEffect(deepLink) {
        if (deepLink != null && deepLink != handledDeepLink) {
            handledDeepLink = deepLink
            when (val route = DeepLinks.parse(deepLink)) {
                is DeepLinks.Route.Pair -> {
                    stack = listOf(Screen.Start)
                    controller.pair(route.server, route.code, "ziran-android")
                }
                is DeepLinks.Route.Session -> {
                    stack = listOf(Screen.Threads, Screen.Thread(route.sessionId))
                    controller.openSession(route.sessionId)
                }
                DeepLinks.Route.Unknown -> Unit
            }
        }
    }

    // First load and successful pairing land on Threads.
    LaunchedEffect(state.phase) {
        if (state.phase == "ready" && stack.lastOrNull() == Screen.Start) {
            stack = listOf(Screen.Threads)
        }
    }

    // The controller restores the last session after the list loads. Follow it
    // once, into the exact thread. Going back to the list stays on the list.
    var autoOpened by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(state.activeSessionId) {
        val id = state.activeSessionId
        if (state.phase == "ready" && id != null && autoOpened != id &&
            stack == listOf(Screen.Threads)
        ) {
            autoOpened = id
            stack = listOf(Screen.Threads, Screen.Thread(id))
        }
    }

    val screen = stack.last()
    // A screen change drops focus and the IME: no field should keep a caret
    // across navigation, and the keyboard must not linger on a read-only view.
    LaunchedEffect(screen) {
        focusManager.clearFocus()
        keyboard?.hide()
    }
    Box(Modifier.fillMaxSize().background(palette.paper)) {
        InkRippleHost(ink = palette.ink, durationScale = durationScale, reducedMotion = reduced) {
            when (screen) {
                Screen.Start -> StartScreen(
                    palette = palette,
                    sceneKey = state.scene,
                    serverValue = state.pairServer,
                    codeValue = state.pairCode,
                    error = state.pairingError,
                    onServerChange = controller::setPairServer,
                    onCodeChange = controller::setPairCode,
                    onPair = { scope.launch { controller.pairFromFields() } },
                    onPaste = paste,
                    reducedMotion = reduced,
                )
                Screen.Threads -> ThreadsScreen(
                    palette = palette,
                    sessions = state.sessions,
                    serverName = state.serverName ?: "studio-vps",
                    sceneKey = state.scene,
                    onOpen = { id ->
                        go(Screen.Thread(id))
                        scope.launch { controller.openSession(id) }
                    },
                    onScenes = { go(Screen.Scenes) },
                    onArchive = { id -> scope.launch { controller.archiveSession(id) } },
                    onRestore = { id -> scope.launch { controller.restoreSession(id) } },
                    onRename = { id, title -> scope.launch { controller.renameSession(id, title) } },
                    onRefresh = { scope.launch { controller.refreshSessions() } },
                    reducedMotion = reduced,
                )
                is Screen.Thread -> ThreadScreen(
                    palette = palette,
                    state = state,
                    sceneKey = state.scene,
                    onBack = back,
                    onModel = { go(Screen.Model) },
                    onScenes = { go(Screen.Scenes) },
                    onTextChange = controller::setComposerText,
                    onSend = { text -> scope.launch { controller.sendText(text) } },
                    onStop = { scope.launch { controller.stop() } },
                    onPermission = { decision -> scope.launch { controller.respondPermission(decision) } },
                    imePadding = Modifier.imePadding(),
                    reducedMotion = reduced,
                )
                Screen.Model -> ModelScreen(
                    palette = palette,
                    state = state,
                    sceneKey = state.scene,
                    onBack = back,
                    onSelectModel = { model -> scope.launch { controller.selectModel(model.model, model.provider, model.apiMethod) } },
                    onSetEffort = { effort -> scope.launch { controller.setReasoning(effort) } },
                    reducedMotion = reduced,
                )
                Screen.Scenes -> ScenesScreen(
                    palette = palette,
                    selectedScene = state.scene,
                    themeMode = state.themeMode,
                    onBack = back,
                    onSelectScene = { key -> scope.launch { controller.setScene(key) } },
                    onSelectTheme = { mode -> scope.launch { controller.setThemeMode(mode) } },
                    reducedMotion = reduced,
                )
            }
        }
    }
}
