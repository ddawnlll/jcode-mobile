package dev.ziran.android.ui

import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppController
import dev.ziran.android.design.InkRippleHost
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.ReducedFadeScale
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.rememberAnimatedPalette
import dev.ziran.android.design.rememberAnimatorScale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Hand-rolled back stack. State lives in the controller, not the screens. */
/** Back kind: Model & Scenes roll up and away (700 ms); Thread slides right with 22% parallax (420 ms). */
internal fun backKindFor(screen: Screen): NavKind = when (screen) {
    Screen.Model, Screen.Scenes -> NavKind.Roll
    else -> NavKind.Slide
}

sealed interface Screen {
    object Start : Screen
    object Threads : Screen
    data class Thread(val sessionId: String) : Screen
    object Plan : Screen
    object Model : Screen
    object Scenes : Screen
}

/**
 * Application host. Day and night ease smoothly over 600 ms. Every touch leaves
 * a radial ink ripple. Paper grain sits cleanly over all content.
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
    onSystemBarsChanged: (statusBarDarkIcons: Boolean, navBarDarkIcons: Boolean) -> Unit = { _, _ -> },
    onRequestNotifications: () -> Unit = {},
) {
    val state by controller.state.collectAsState()
    val dark = isSystemInDarkTheme()
    val isNight = when (state.themeMode) {
        "day" -> false
        "night" -> true
        else -> dark
    }

    val durationScale = rememberAnimatorScale()
    val reduced = durationScale <= 0.01f
    val palette = rememberAnimatedPalette(isNight = isNight, reducedMotion = reduced)

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
    var navJob by remember { mutableStateOf<Job?>(null) }
    var lastTap by remember { mutableStateOf(Offset.Unspecified) }
    var gestureActive by remember { mutableStateOf(false) }

    val containerSize = LocalWindowInfo.current.containerSize
    val widthPx = containerSize.width.toFloat().coerceAtLeast(1f)
    val heightPx = containerSize.height.toFloat().coerceAtLeast(1f)

    // Forward navigation: pick the board transition for the pair of screens.
    val go: (Screen, NavKind, Offset) -> Unit = { next, kind, origin ->
        val from = stack.last()
        if (from != next) {
            navJob?.cancel()
            stack = stack + next
            transition = NavTransition(kind, from, next, origin)
            navJob = scope.launch {
                try {
                    runNavTransition(navProgress, kind, durationScale, reduced)
                    transition = null
                } catch (_: CancellationException) {
                    // Superseded by a newer transition.
                }
            }
        }
    }

    val back: () -> Unit = back@{
        if (stack.size <= 1) return@back
        navJob?.cancel()
        val from = stack.last()
        val to = stack[stack.size - 2]
        val kind = backKindFor(from)
        stack = stack.dropLast(1)
        transition = NavTransition(kind, from, to)
        navJob = scope.launch {
            try {
                runNavTransition(navProgress, kind, durationScale, reduced)
                transition = null
            } catch (_: CancellationException) {
                // Superseded.
            }
        }
    }

    // Predictive back for every screen above the root. Dragging from the left edge
    // shrinks the screen to 90%, rounds corners to 30 dp, reveals beneath page with
    // -40 dp parallax, and shows the floating back chip. Past 1/3 commits (300 ms);
    // short of 1/3 settles back cleanly (320 ms). Instant back key runs Slide/Roll.
    PredictiveBackHandler(enabled = stack.size > 1) { progress ->
        val from = stack.last()
        val to = stack.getOrNull(stack.size - 2) ?: return@PredictiveBackHandler
        navJob?.cancel()
        gestureActive = true
        var last = -1f
        var lastY = heightPx * 0.5f
        var cancelled = false
        try {
            progress.collect { event ->
                val p = event.progress.coerceIn(0f, 1f)
                last = p
                lastY = if (event.touchY > 0f) event.touchY else lastY
                transition = NavTransition(
                    kind = NavKind.Slide,
                    from = from,
                    to = to,
                    predictive = true,
                    touchY = lastY,
                )
                navProgress.snapTo(p)
            }
        } catch (_: CancellationException) {
            cancelled = true
        } finally {
            gestureActive = false
        }

        if (last < 0f && !cancelled) {
            // Instant system back button (no gesture progress frames): use normal Back transition.
            val kind = backKindFor(from)
            stack = stack.dropLast(1)
            transition = NavTransition(kind, from, to)
            try {
                runNavTransition(navProgress, kind, durationScale, reduced)
            } catch (_: CancellationException) {
            } finally {
                transition = null
            }
            return@PredictiveBackHandler
        }

        val commit = !cancelled
        try {
            if (commit) {
                transition = NavTransition(
                    kind = NavKind.Slide,
                    from = from,
                    to = to,
                    predictive = true,
                    touchY = lastY,
                    predictiveCommitting = true,
                    commitStartProgress = last.coerceIn(0f, 1f),
                )
                navProgress.snapTo(0f)
                if (reduced) {
                    withContext(ReducedFadeScale) {
                        navProgress.animateTo(1f, tween(WuDurations.ReducedFade, easing = LinearEasing))
                    }
                } else {
                    navProgress.animateTo(1f, tween(WuDurations.PredictiveCommit, easing = LinearEasing))
                }
                stack = stack.dropLast(1)
            } else {
                if (reduced) {
                    withContext(ReducedFadeScale) {
                        navProgress.animateTo(0f, tween(WuDurations.ReducedFade, easing = WuEasing.Default))
                    }
                } else {
                    navProgress.animateTo(0f, tween(WuDurations.PredictiveSettle, easing = WuEasing.Default))
                }
            }
        } catch (_: CancellationException) {
        } finally {
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
                    controller.scope().launch { controller.pairFromLink(route.server, route.code) }
                }
                is DeepLinks.Route.Session -> {
                    stack = listOf(Screen.Threads, Screen.Thread(route.sessionId))
                    controller.scope().launch { controller.openSession(route.sessionId) }
                }
                DeepLinks.Route.Unknown -> {
                    stack = listOf(Screen.Start)
                    controller.reportPairingLinkError()
                }
            }
        }
    }

    // Pairing success lands on Threads with an ink drop spreading from the Pair seal.
    var sawStart by remember { mutableStateOf(false) }
    LaunchedEffect(state.phase) {
        if (state.phase == "unpaired" || state.phase == "pairing") {
            sawStart = true
        }
        if (state.phase == "ready" && stack.lastOrNull() == Screen.Start) {
            if (sawStart) {
                // Let the 3rd pairing dot stamp (550 ms) settle for 350 ms before the ink drop.
                if (!reduced) kotlinx.coroutines.delay(350L)
                val origin = lastTap.takeIf { it != Offset.Unspecified }
                    ?: Offset(widthPx * 0.86f, heightPx * 0.90f)
                navJob?.cancel()
                stack = listOf(Screen.Threads)
                transition = NavTransition(NavKind.InkDrop, Screen.Start, Screen.Threads, origin)
                navJob = scope.launch {
                    try {
                        runNavTransition(navProgress, NavKind.InkDrop, durationScale, reduced)
                        transition = null
                    } catch (_: CancellationException) {
                    }
                }
            } else {
                // Returning cold-launch already paired: go straight to Threads without Start flash.
                stack = listOf(Screen.Threads)
            }
        }
    }

    // Restore the last session once after initial ready load (cold relaunch only).
    var autoOpened by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(state.activeSessionId) {
        val id = state.activeSessionId
        if (state.phase == "ready" && id != null && autoOpened != id &&
            stack == listOf(Screen.Threads) && !sawStart
        ) {
            autoOpened = id
            stack = listOf(Screen.Threads, Screen.Thread(id))
        }
    }

    val screen = stack.last()
    LaunchedEffect(isNight, screen, state.scene) {
        val navDark = !isNight
        val paintingRes = when (screen) {
            Screen.Start -> dev.ziran.android.design.sceneByKey("butterfly").drawableRes
            Screen.Threads -> dev.ziran.android.design.sceneByKey("quiet_river").drawableRes
            is Screen.Thread -> dev.ziran.android.design.sceneByKey(state.scene).drawableRes
            Screen.Plan -> dev.ziran.android.design.FlockScene.drawableRes
            Screen.Scenes -> dev.ziran.android.design.sceneByKey(state.scene).drawableRes
            Screen.Model -> null
        }
        val statusDark = if (paintingRes != null) {
            val lum = dev.ziran.android.design.BitmapCache.topBandLuminance(context.resources, paintingRes, isNight)
            dev.ziran.android.design.statusBarUsesDarkIcons(lum)
        } else {
            !isNight
        }
        onSystemBarsChanged(statusDark, navDark)
    }
    LaunchedEffect(screen) {
        focusManager.clearFocus()
        keyboard?.hide()
    }

    val painted = transition

    Box(Modifier.fillMaxSize().background(palette.paper)) {
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
                palette = palette,
                reducedMotion = reduced,
            ) { target ->
                when (target) {
                    Screen.Start -> StartScreen(
                        palette = palette,
                        sceneKey = "butterfly",
                        serverValue = state.pairServer,
                        codeValue = state.pairCode,
                        error = state.pairingError,
                        pairingStage = state.pairingStage,
                        healthProbe = state.healthProbe,
                        pasteNonce = state.pairPasteNonce,
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
                        sceneKey = "pavilion",
                        onOpen = { id ->
                            go(Screen.Thread(id), NavKind.InkDrop, lastTap)
                            scope.launch { controller.openSession(id) }
                        },
                        onScenes = { go(Screen.Scenes, NavKind.Unroll, Offset.Unspecified) },
                        onArchive = { id -> scope.launch { controller.archiveSession(id) } },
                        onRestore = { id -> scope.launch { controller.restoreSession(id) } },
                        onRename = { id, title -> scope.launch { controller.renameSession(id, title) } },
                        onRefresh = { scope.launch { controller.refreshSessions() } },
                        onCreateThread = { title -> scope.launch { controller.createSession(null, title) } },
                        reducedMotion = reduced,
                    )
                    is Screen.Thread -> ThreadScreen(
                        palette = palette,
                        state = state,
                        sceneKey = state.scene,
                        onBack = back,
                        onPlan = {
                            go(Screen.Plan, NavKind.InkDrop, lastTap)
                            scope.launch { controller.refreshPlan() }
                        },
                        onModel = {
                            go(Screen.Model, NavKind.Unroll, Offset.Unspecified)
                            scope.launch { controller.refreshModels() }
                        },
                        onScenes = { go(Screen.Scenes, NavKind.Unroll, Offset.Unspecified) },
                        onTextChange = controller::setComposerText,
                        onSend = { text -> scope.launch { controller.sendText(text) } },
                        onSendWithMode = { text, mode -> scope.launch { controller.sendText(text, steerModeOverride = mode) } },
                        onSteerModeChange = controller::setActiveSteerMode,
                        onStop = { scope.launch { controller.stop() } },
                        onPermission = { decision -> scope.launch { controller.respondPermission(decision) } },
                        reducedMotion = reduced,
                    )
                    Screen.Plan -> {
                        val coordinatorId = controller.coordinatorSessionId(state)
                        val coordinatorName = state.agents
                            ?.firstOrNull { it.sessionId == coordinatorId }
                            ?.label
                            ?: state.snapshot?.session?.agentLabel
                            ?: "heron"
                        PlanScreen(
                            palette = palette,
                            state = state,
                            coordinatorName = coordinatorName,
                            onBack = back,
                            onSend = { text -> scope.launch { controller.sendText(text, targetSessionId = coordinatorId) } },
                            reducedMotion = reduced,
                        )
                    }
                    Screen.Model -> ModelScreen(
                        palette = palette,
                        state = state,
                        sceneKey = "riders",
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
        // Tiled 256 dp paper grain sits above screens (non-interactive, z-index: 5).
        GrainOverlay(nightFactor = palette.nightFactor)
        if (state.notificationsPrompt) {
            NotificationReasonBar(
                palette = palette,
                onAllow = onRequestNotifications,
                onDismiss = { controller.notificationsHandled(false) },
                modifier = Modifier.align(androidx.compose.ui.Alignment.BottomCenter),
            )
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
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(palette.paper2)
            .padding(horizontal = 20.dp, vertical = 14.dp),
    ) {
        Text(
            "Turn notices",
            style = TextStyle(
                fontFamily = WuFonts.Garamond,
                fontSize = 16.sp,
                color = palette.ink,
            ),
        )
        Text(
            "A local notice when a turn finishes or an approval is needed while Ziran is in the background. Nothing is sent from a server.",
            style = TextStyle(
                fontFamily = WuFonts.Garamond,
                fontSize = 13.sp,
                lineHeight = 19.sp,
                color = palette.ink3,
            ),
            modifier = Modifier.padding(top = 2.dp),
        )
        Row(Modifier.padding(top = 8.dp)) {
            Text(
                "not now",
                style = TextStyle(
                    fontFamily = WuFonts.Mono,
                    fontSize = 12.sp,
                    color = palette.ink3,
                    textDecoration = TextDecoration.Underline,
                ),
                modifier = Modifier
                    .padding(end = 18.dp)
                    .semantics { role = Role.Button; contentDescription = "Not now" }
                    .clickable { onDismiss() },
            )
            Text(
                "allow",
                style = TextStyle(
                    fontFamily = WuFonts.Mono,
                    fontSize = 12.sp,
                    color = palette.seal,
                    textDecoration = TextDecoration.Underline,
                ),
                modifier = Modifier
                    .semantics { role = Role.Button; contentDescription = "Allow notifications" }
                    .clickable { onAllow() },
            )
        }
    }
}
