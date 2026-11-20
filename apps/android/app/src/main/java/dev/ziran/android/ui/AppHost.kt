package dev.ziran.android.ui

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import dev.ziran.android.data.AppController
import dev.ziran.android.design.InkRippleHost
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.rememberAnimatorScale
import kotlinx.coroutines.CancellationException
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
 * darkness. Every touch gets an ink ripple.
 *
 * Navigation never cancels a turn: leaving a thread only changes which screen is
 * painted. System back is handled here through PredictiveBackHandler for every
 * screen above the root, so the Activity is never finished from a child screen.
 */
@Composable
fun ZiranApp(
    controller: AppController,
    deepLink: String? = null,
    deepLinkNonce: Int = 0,
    onRequestNotifications: () -> Unit = {},
) {
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
    var transition by remember { mutableStateOf<NavTransition?>(null) }
    val navProgress = remember { Animatable(1f) }
    var lastTap by remember { mutableStateOf(Offset.Unspecified) }
    var gestureActive by remember { mutableStateOf(false) }

    // Forward navigation: pick the board transition for the pair of screens.
    val go: (Screen, NavKind) -> Unit = { next, kind ->
        val from = stack.last()
        stack = stack + next
        transition = NavTransition(kind, from, next, lastTap)
        scope.launch {
            runNavTransition(navProgress, kind, durationScale, reduced)
            if (navProgress.value >= 0.999f) transition = null
        }
    }

    // Back: 420 ms slide with the 22 percent parallax on the page beneath.
    val back: () -> Unit = back@{
        if (stack.size <= 1) return@back
        val from = stack.last()
        val to = stack[stack.size - 2]
        stack = stack.dropLast(1)
        transition = NavTransition(NavKind.Slide, from, to)
        scope.launch {
            runNavTransition(navProgress, NavKind.Slide, durationScale, reduced)
            if (navProgress.value >= 0.999f) transition = null
        }
    }

    // Predictive back for every screen above the root. The gesture drives the
    // same offsets as the button; releasing past one third commits, otherwise
    // it settles back in 320 ms.
    PredictiveBackHandler(enabled = stack.size > 1) { progress ->
        val from = stack.last()
        val to = stack.getOrNull(stack.size - 2) ?: return@PredictiveBackHandler
        transition = NavTransition(NavKind.Slide, from, to, predictive = true)
        gestureActive = true
        var last = 0f
        try {
            progress.collect { event ->
                last = event.progress
                navProgress.snapTo(event.progress.coerceIn(0f, 1f))
            }
        } catch (_: CancellationException) {
            // The user let go short of the threshold.
        }
        gestureActive = false
        if (MotionMath.shouldCommitBack(last)) {
            navProgress.animateTo(1f, tween(120, easing = WuEasing.Default))
            stack = stack.dropLast(1)
            transition = null
        } else {
            navProgress.animateTo(0f, tween(WuDurations.PredictiveSettle, easing = WuEasing.Default))
            transition = null
        }
    }

    var handledDeepLink by remember { mutableStateOf<String?>(null) }

    // Deep link: pair prefills and starts pairing; session opens the thread.
    LaunchedEffect(deepLink, deepLinkNonce) {
        if (deepLink != null && (deepLink != handledDeepLink || deepLinkNonce > 0)) {
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

    val widthPx = androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.width.toFloat()
    val painted = transition

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        if (state.notificationsPrompt) {
            NotificationReasonBar(
                palette = palette,
                onAllow = onRequestNotifications,
                onDismiss = { controller.notificationsHandled(false) },
            )
        }
        InkRippleHost(
            ink = palette.ink,
            durationScale = durationScale,
            reducedMotion = reduced,
            onTapOrigin = { origin -> if (!gestureActive) lastTap = origin },
        ) {
            ScreenTransition(
                current = screen,
                transition = painted,
                progress = navProgress.value,
                widthPx = widthPx,
            ) { target ->
                when (target) {
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
                            go(Screen.Thread(id), NavKind.InkDrop)
                            scope.launch { controller.openSession(id) }
                        },
                        onScenes = { go(Screen.Scenes, NavKind.Unroll) },
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
                        onModel = { go(Screen.Model, NavKind.Unroll) },
                        onScenes = { go(Screen.Scenes, NavKind.Unroll) },
                        onTextChange = controller::setComposerText,
                        onSend = { text -> scope.launch { controller.sendText(text) } },
                        onStop = { scope.launch { controller.stop() } },
                        onPermission = { decision -> scope.launch { controller.respondPermission(decision) } },
                        modifier = Modifier.imePadding(),
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
}

/**
 * The reason for POST_NOTIFICATIONS, on screen, before the system dialog.
 * Turn-done and approval notices are local only; nothing claims remote push.
 */
@Composable
private fun NotificationReasonBar(
    palette: Palette,
    onAllow: () -> Unit,
    onDismiss: () -> Unit,
) {
    androidx.compose.foundation.layout.Column(
        Modifier
            .fillMaxWidth()
            .background(palette.paper2)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        androidx.compose.material3.Text(
            "Turn notices",
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = dev.ziran.android.design.WuFonts.Garamond,
                fontSize = 16.sp,
                color = palette.ink,
            ),
        )
        androidx.compose.material3.Text(
            "A local notice when a turn finishes or an approval is needed while Ziran is in the background. Nothing is sent from a server.",
            style = androidx.compose.ui.text.TextStyle(
                fontFamily = dev.ziran.android.design.WuFonts.Garamond,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                color = palette.ink3,
            ),
            modifier = Modifier.padding(top = 2.dp),
        )
        androidx.compose.foundation.layout.Row(Modifier.padding(top = 8.dp)) {
            androidx.compose.material3.Text(
                "not now",
                style = androidx.compose.ui.text.TextStyle(
                    fontFamily = dev.ziran.android.design.WuFonts.Mono,
                    fontSize = 12.sp,
                    color = palette.ink3,
                    textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                ),
                modifier = Modifier
                    .padding(end = 18.dp)
                    .semantics { role = androidx.compose.ui.semantics.Role.Button; contentDescription = "Not now" }
                    .clickable { onDismiss() },
            )
            androidx.compose.material3.Text(
                "allow",
                style = androidx.compose.ui.text.TextStyle(
                    fontFamily = dev.ziran.android.design.WuFonts.Mono,
                    fontSize = 12.sp,
                    color = palette.seal,
                    textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                ),
                modifier = Modifier
                    .semantics { role = androidx.compose.ui.semantics.Role.Button; contentDescription = "Allow notifications" }
                    .clickable { onAllow() },
            )
        }
    }
}
