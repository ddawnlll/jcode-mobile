package dev.ziran.android.ui

import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.BrailleSpinnerText
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.Seal
import dev.ziran.android.design.SealButton
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.rememberAnimatorScale
import dev.ziran.android.design.wuClickable
import dev.ziran.android.design.wuRise
import dev.ziran.android.protocol.SessionSummary
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * Threads screen: Sessions.dc.html + Flow.dc.html gestures.
 * - Pavilion header (280 dp), clickable server chip -> Scenes.
 * - Swipe left past 110 dp -> slide off (260 ms), collapse gap (450 ms), undo bar (4.6 s).
 * - Long press -> row lifts (scale 1.025, 10 dp corners, soft shadow), 140 ms -> action sheet (420 ms).
 * - Pull down at top -> ink ring fills, spins while refreshing, settles (450 ms).
 */
@Composable
fun ThreadsScreen(
    palette: Palette,
    sessions: List<SessionSummary>,
    serverName: String = "studio-vps",
    sceneKey: String = "pavilion",
    onOpen: (String) -> Unit = {},
    onScenes: () -> Unit = {},
    onArchive: (String) -> Unit = {},
    onRestore: (String) -> Unit = {},
    onRename: (String, String) -> Unit = { _, _ -> },
    onRefresh: () -> Unit = {},
    onCreateThread: (String) -> Unit = {},
    reducedMotion: Boolean = false,
) {
    val view = LocalView.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val animatorScale = rememberAnimatorScale()

    var liftedSessionId by remember { mutableStateOf<String?>(null) }
    var sheetFor by remember { mutableStateOf<SessionSummary?>(null) }
    var undoFor by remember { mutableStateOf<SessionSummary?>(null) }
    var undoTimerJob by remember { mutableStateOf<Job?>(null) }

    // Tracks rows currently collapsing or archived so AnimatedVisibility closes/reopens the gap smoothly.
    val hiddenIds = remember { mutableStateMapOf<String, Boolean>() }
    // Reset slide offsets when a row is restored via Undo.
    val restoreNonce = remember { mutableStateMapOf<String, Int>() }

    // Pull-to-refresh state in dp (matching board's 70 px threshold, 0.45 drag ratio).
    var pullDp by remember { mutableFloatStateOf(0f) }
    var pullPhase by remember { mutableStateOf("idle") }

    val activeCount by remember(sessions) {
        derivedStateOf {
            sessions.count { !it.archived && hiddenIds[it.sessionId] != true }
        }
    }

    fun triggerArchive(session: SessionSummary, fromSheet: Boolean = false) {
        scope.launch {
            val scale = animatorScale.coerceAtLeast(0.1f)
            if (fromSheet && !reducedMotion) {
                delay((250f * scale).toLong())
            }
            hiddenIds[session.sessionId] = true
            onArchive(session.sessionId)
            if (!reducedMotion) delay((40f * scale).toLong())
            undoFor = session
            undoTimerJob?.cancel()
            undoTimerJob = scope.launch {
                val holdMs = if (reducedMotion) WuDurations.UndoBar.toLong() else (WuDurations.UndoBar * scale).toLong()
                delay(holdMs)
                if (undoFor?.sessionId == session.sessionId) undoFor = null
            }
        }
    }

    fun dismissSheet() {
        sheetFor = null
        liftedSessionId = null
    }

    val nestedScroll = remember(listState, reducedMotion) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (pullPhase == "drag" && available.y < 0f && pullDp > 0f) {
                    val deltaDp = with(density) { available.y.toDp().value }
                    pullDp = (pullDp + deltaDp).coerceAtLeast(0f)
                    if (pullDp <= 0.5f) pullPhase = "idle"
                    return Offset(0f, available.y)
                }
                return Offset.Zero
            }

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                val atTop = listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset == 0
                if (source == NestedScrollSource.UserInput && atTop && available.y > 0f && pullPhase != "refresh") {
                    val deltaDp = with(density) { available.y.toDp().value }
                    pullDp = (pullDp + deltaDp).coerceAtMost(180f)
                    pullPhase = "drag"
                    return Offset(0f, available.y)
                }
                return Offset.Zero
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                if (pullPhase == "drag") {
                    if (pullDp > 70f) {
                        view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                        pullPhase = "refresh"
                        pullDp = 56f
                        onRefresh()
                    } else {
                        pullPhase = "settle"
                        pullDp = 0f
                    }
                }
                return Velocity.Zero
            }
        }
    }

    val listShiftTargetDp = MotionMath.pullListY(pullDp, pullPhase)
    val animListShiftDp by animateFloatAsState(
        targetValue = listShiftTargetDp,
        animationSpec = tween(
            durationMillis = if (pullPhase == "drag") 1 else WuDurations.PullSettle,
            easing = WuEasing.Default,
        ),
        label = "pull-list-shift",
    )

    LaunchedEffect(pullPhase) {
        val scale = animatorScale.coerceAtLeast(0.1f)
        if (pullPhase == "refresh") {
            delay(if (reducedMotion) 250L else (1300f * scale).toLong())
            pullPhase = "settle"
            pullDp = 0f
            delay(if (reducedMotion) 120L else (WuDurations.PullSettle * scale).toLong())
            pullPhase = "idle"
        } else if (pullPhase == "settle") {
            pullDp = 0f
            delay(if (reducedMotion) 120L else (WuDurations.PullSettle * scale).toLong())
            pullPhase = "idle"
        }
    }

    var newThreadText by remember { mutableStateOf("") }
    var sendStamp by remember { mutableIntStateOf(0) }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 280, reducedMotion = reducedMotion)

        // Top-right clickable server status chip -> Scenes & theme.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(top = 54.dp, end = 16.dp)
                .height(40.dp)
                .wuClickable(reducedMotion = reducedMotion, onClick = onScenes)
                .padding(horizontal = 4.dp)
                .semantics { role = Role.Button; contentDescription = "Server $serverName · scenes and theme" },
        ) {
            Box(Modifier.size(6.dp).background(palette.green, CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(
                serverName,
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink2),
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
        ) {
            Spacer(Modifier.height(226.dp))
            Column(Modifier.padding(horizontal = 22.dp)) {
                Text(
                    "Threads",
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 28.sp,
                        lineHeight = 34.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.ink,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "~/src · $activeCount sessions",
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                    modifier = Modifier.padding(top = 2.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 22.dp)
                    .padding(top = 8.dp)
                    .nestedScroll(nestedScroll),
            ) {
                PullInkRing(
                    palette = palette,
                    pullDp = pullDp,
                    phase = pullPhase,
                    reducedMotion = reducedMotion,
                    modifier = Modifier.align(Alignment.TopCenter),
                )

                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(bottom = 16.dp),
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            translationY = with(density) { animListShiftDp.dp.toPx() }
                        },
                ) {
                    itemsIndexed(sessions, key = { _, s -> s.sessionId }) { index, session ->
                        val rowVisible = !session.archived && hiddenIds[session.sessionId] != true
                        androidx.compose.animation.AnimatedVisibility(
                            visible = rowVisible,
                            enter = expandVertically(
                                animationSpec = tween(
                                    if (reducedMotion) WuDurations.ReducedFade else WuDurations.SwipeCollapse,
                                    easing = WuEasing.Default,
                                ),
                            ) + fadeIn(tween(if (reducedMotion) WuDurations.ReducedFade else 300, easing = WuEasing.Default)),
                            exit = shrinkVertically(
                                animationSpec = tween(
                                    if (reducedMotion) WuDurations.ReducedFade else WuDurations.SwipeCollapse,
                                    easing = WuEasing.Default,
                                ),
                            ) + fadeOut(tween(if (reducedMotion) WuDurations.ReducedFade else 300, easing = WuEasing.Default)),
                        ) {
                            ThreadRow(
                                session = session,
                                index = index,
                                palette = palette,
                                lifted = liftedSessionId == session.sessionId,
                                restoreKey = restoreNonce[session.sessionId] ?: 0,
                                reducedMotion = reducedMotion,
                                onOpen = { onOpen(session.sessionId) },
                                onLongPress = {
                                    view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                                    liftedSessionId = session.sessionId
                                    scope.launch {
                                        val scale = animatorScale.coerceAtLeast(0.1f)
                                        if (!reducedMotion) delay((WuDurations.LongPressSheetDelay * scale).toLong())
                                        sheetFor = session
                                    }
                                },
                                onArchive = { triggerArchive(session) },
                            )
                        }
                    }
                }
            }

            Composer(
                palette = palette,
                placeholder = "begin a new thread…",
                value = newThreadText,
                stampTrigger = sendStamp,
                reducedMotion = reducedMotion,
                onValueChange = { newThreadText = it },
                onSend = {
                    val trimmed = newThreadText.trim()
                    sendStamp += 1
                    if (trimmed.isNotEmpty()) {
                        onCreateThread(trimmed)
                        newThreadText = ""
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 16.dp, top = 4.dp, bottom = 22.dp),
            )
        }

        // Undo bar, rises from below for 4.6 s.
        UndoBar(
            visible = undoFor != null,
            title = undoFor?.displayTitle ?: "",
            palette = palette,
            reducedMotion = reducedMotion,
            onUndo = {
                undoTimerJob?.cancel()
                undoFor?.let { s ->
                    hiddenIds.remove(s.sessionId)
                    restoreNonce[s.sessionId] = (restoreNonce[s.sessionId] ?: 0) + 1
                    onRestore(s.sessionId)
                }
                undoFor = null
            },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 100.dp),
        )

        // Action sheet (animated slide + dimming scrim + drag-to-dismiss + back handler).
        var lastSheetSession by remember { mutableStateOf<SessionSummary?>(null) }
        if (sheetFor != null) lastSheetSession = sheetFor
        SheetHost(
            visible = sheetFor != null,
            palette = palette,
            reducedMotion = reducedMotion,
            onDismiss = { dismissSheet() },
        ) {
            lastSheetSession?.let { session ->
                SheetActions(
                    session = session,
                    palette = palette,
                    reducedMotion = reducedMotion,
                    onPin = { dismissSheet() },
                    onRename = {
                        dismissSheet()
                        onRename(session.sessionId, session.displayTitle)
                    },
                    onOpen = {
                        dismissSheet()
                        onOpen(session.sessionId)
                    },
                    onArchive = {
                        dismissSheet()
                        triggerArchive(session, fromSheet = true)
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ThreadRow(
    session: SessionSummary,
    index: Int,
    palette: Palette,
    lifted: Boolean,
    restoreKey: Int,
    reducedMotion: Boolean,
    onOpen: () -> Unit,
    onLongPress: () -> Unit,
    onArchive: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val density = LocalDensity.current
    val dxAnim = remember(session.sessionId, restoreKey) { Animatable(0f) }
    var isSwiping by remember(session.sessionId, restoreKey) { mutableStateOf(false) }

    val thresholdPx = with(density) { MotionMath.ArchiveThresholdPx.dp.toPx() }
    val offscreenPx = with(density) { MotionMath.ArchiveOffscreenPx.dp.toPx() }
    val washFadePx = with(density) { 90.dp.toPx() }

    val liftScale by animateFloatAsState(
        targetValue = if (lifted && !reducedMotion) 1.025f else 1f,
        animationSpec = tween(WuDurations.SwipeReturn, easing = WuEasing.Default),
        label = "row-lift-scale",
    )
    val liftRadius by animateDpAsState(
        targetValue = if (lifted) 10.dp else 0.dp,
        animationSpec = tween(300, easing = WuEasing.Default),
        label = "row-lift-radius",
    )
    val liftShadow by animateFloatAsState(
        targetValue = if (lifted) with(density) { 10.dp.toPx() } else 0f,
        animationSpec = tween(300, easing = WuEasing.Default),
        label = "row-lift-shadow",
    )

    val isResting = session.status == "resting"
    val rowAlpha = if (isResting) 0.6f else 1f
    val washAlpha = (abs(dxAnim.value) / washFadePx).coerceIn(0f, 1f)

    Box(
        Modifier
            .fillMaxWidth()
            .wuRise(delayMs = (index + 1) * 100, reducedMotion = reducedMotion, key = "row-${session.sessionId}"),
    ) {
        // Ink wash archive reveal behind the row.
        if (washAlpha > 0.005f) {
            Row(
                Modifier
                    .matchParentSize()
                    .padding(vertical = 1.dp)
                    .graphicsLayer { alpha = washAlpha }
                    .background(palette.paper2)
                    .padding(end = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.End,
            ) {
                ArchiveIcon(palette.ink2)
                Spacer(Modifier.width(8.dp))
                Text(
                    "archive",
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink2),
                )
            }
        }

        // Foreground row content (GPU graphicsLayer only for swipe & lift).
        Box(
            Modifier
                .fillMaxWidth()
                .graphicsLayer {
                    translationX = dxAnim.value
                    scaleX = liftScale
                    scaleY = liftScale
                    shadowElevation = liftShadow
                    shape = RoundedCornerShape(liftRadius)
                    clip = liftRadius > 0.1.dp
                }
                .background(palette.paper)
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { delta ->
                        isSwiping = true
                        val next = (dxAnim.value + delta).coerceIn(offscreenPx, 0f)
                        scope.launch { dxAnim.snapTo(next) }
                    },
                    onDragStarted = { isSwiping = true },
                    onDragStopped = {
                        if (dxAnim.value < -thresholdPx) {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            scope.launch {
                                dxAnim.animateTo(
                                    offscreenPx,
                                    tween(
                                        if (reducedMotion) WuDurations.ReducedFade else WuDurations.SwipeSlideOff,
                                        easing = WuEasing.Default,
                                    ),
                                )
                                isSwiping = false
                                onArchive()
                            }
                        } else {
                            scope.launch {
                                dxAnim.animateTo(
                                    0f,
                                    tween(
                                        if (reducedMotion) WuDurations.ReducedFade else WuDurations.SwipeReturn,
                                        easing = WuEasing.Default,
                                    ),
                                )
                                isSwiping = false
                            }
                        }
                    },
                )
                .combinedClickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = { if (!isSwiping && abs(dxAnim.value) < 6f) onOpen() },
                    onLongClick = { if (!isSwiping && abs(dxAnim.value) < 6f) onLongPress() },
                ),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .graphicsLayer { alpha = rowAlpha }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Seal(
                    kind = session.agentKind,
                    sizeDp = 30,
                    backgroundColor = palette.seal,
                    strokeColor = palette.onSeal,
                )
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        session.displayTitle,
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 19.sp,
                            lineHeight = 25.sp,
                            color = palette.ink,
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        subtitleFor(session),
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 14.5.sp,
                            lineHeight = 20.sp,
                            fontStyle = FontStyle.Italic,
                            color = palette.ink3,
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(14.dp))
                Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) {
                    StateMark(session, palette, reducedMotion)
                }
            }
            // Bottom hairline divider (border-bottom: 1px solid var(--line)).
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(palette.line),
            )
        }
    }
}

private fun subtitleFor(session: SessionSummary): String {
    val agent = session.agentKind.displayName
    return when {
        session.status == "waiting_for_permission" -> "$agent asks to run a command"
        session.status == "running" -> "$agent · working"
        session.status == "done" -> "$agent · done"
        session.status == "resting" -> "$agent · resting"
        session.agentLabel != null -> "$agent · ${session.status}"
        else -> session.status.ifEmpty { "idle" }
    }
}

@Composable
private fun StateMark(session: SessionSummary, palette: Palette, reducedMotion: Boolean) {
    when (session.status) {
        "waiting_for_permission" ->
            Box(Modifier.size(10.dp).background(palette.seal, CircleShape))
        "running" ->
            BrailleSpinnerText(color = palette.blue, fontSize = 15.sp, reducedMotion = reducedMotion)
        "done" -> Canvas(Modifier.size(15.dp)) {
            drawArc(
                palette.seal,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                style = Stroke(1.6.dp.toPx()),
            )
        }
        else -> Box(Modifier.size(6.dp).background(palette.ink3.copy(alpha = 0.6f), CircleShape))
    }
}

@Composable
private fun SheetActions(
    session: SessionSummary,
    palette: Palette,
    reducedMotion: Boolean,
    onPin: () -> Unit,
    onRename: () -> Unit,
    onOpen: () -> Unit,
    onArchive: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        Box(
            Modifier
                .width(36.dp)
                .height(4.dp)
                .background(palette.line, RoundedCornerShape(2.dp))
                .align(Alignment.CenterHorizontally),
        )
        Spacer(Modifier.height(14.dp))
        Text(
            session.displayTitle,
            style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 21.sp, color = palette.ink),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(bottom = 6.dp),
        )
        SheetAction("Pin to the top", palette, reducedMotion, icon = { PinIcon(palette.ink2) }, onClick = onPin)
        SheetAction("Rename", palette, reducedMotion, icon = { RenameIcon(palette.ink2) }, onClick = onRename)
        SheetAction("Open", palette, reducedMotion, icon = { WindowIcon(palette.ink2) }, onClick = onOpen)
        SheetAction("Archive", palette, reducedMotion, icon = { ArchiveIcon(palette.ink2) }, onClick = onArchive)
    }
}

@Composable
private fun SheetAction(
    label: String,
    palette: Palette,
    reducedMotion: Boolean,
    icon: @Composable () -> Unit,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .wuClickable(reducedMotion = reducedMotion, onClick = onClick)
            .semantics { role = Role.Button; contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon()
        Spacer(Modifier.width(14.dp))
        Text(label, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 18.sp, color = palette.ink))
    }
}

@Composable
private fun ArchiveIcon(color: androidx.compose.ui.graphics.Color) {
    Canvas(Modifier.size(18.dp)) {
        val u = size.width / 24f
        val stroke = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val p = Path().apply {
            moveTo(4f * u, 7f * u); lineTo(20f * u, 7f * u); lineTo(20f * u, 10f * u); lineTo(4f * u, 10f * u); close()
            moveTo(6f * u, 10f * u); lineTo(6f * u, 18f * u); lineTo(18f * u, 18f * u); lineTo(18f * u, 10f * u)
            moveTo(10f * u, 14f * u); lineTo(14f * u, 14f * u)
        }
        drawPath(p, color, style = stroke)
    }
}

@Composable
private fun PinIcon(color: androidx.compose.ui.graphics.Color) {
    Canvas(Modifier.size(18.dp)) {
        val u = size.width / 24f
        val stroke = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val p = Path().apply {
            moveTo(12f * u, 17f * u); lineTo(12f * u, 21f * u)
            moveTo(8f * u, 3f * u); lineTo(16f * u, 3f * u); lineTo(15f * u, 9f * u)
            lineTo(18f * u, 13f * u); lineTo(6f * u, 13f * u); lineTo(9f * u, 9f * u); close()
        }
        drawPath(p, color, style = stroke)
    }
}

@Composable
private fun RenameIcon(color: androidx.compose.ui.graphics.Color) {
    Canvas(Modifier.size(18.dp)) {
        val u = size.width / 24f
        val stroke = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        val p = Path().apply {
            moveTo(4f * u, 20f * u); lineTo(8f * u, 20f * u)
            lineTo(19f * u, 9f * u); lineTo(15f * u, 5f * u); lineTo(4f * u, 16f * u); close()
        }
        drawPath(p, color, style = stroke)
    }
}

@Composable
private fun WindowIcon(color: androidx.compose.ui.graphics.Color) {
    Canvas(Modifier.size(18.dp)) {
        val u = size.width / 24f
        val stroke = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        drawRoundRect(
            color = color,
            topLeft = Offset(4f * u, 5f * u),
            size = androidx.compose.ui.geometry.Size(16f * u, 14f * u),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(2f * u, 2f * u),
            style = stroke,
        )
        drawLine(color, Offset(4f * u, 9f * u), Offset(20f * u, 9f * u), strokeWidth = 1.7.dp.toPx(), cap = StrokeCap.Round)
    }
}

/**
 * Shared organic brush ink underline drawn across 100% of the composer field width
 * (`d="M2 5 C 40 2, 90 6, 140 3 S 190 4, 198 3"` from build3.py).
 */
@Composable
fun InkUnderline(
    palette: Palette,
    reducedMotion: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val drawProgress = remember { Animatable(if (reducedMotion) 1f else 0f) }
    LaunchedEffect(reducedMotion) {
        if (reducedMotion) {
            drawProgress.snapTo(1f)
        } else {
            drawProgress.animateTo(1f, tween(1600, easing = WuEasing.Default))
        }
    }
    Canvas(modifier.fillMaxWidth().height(6.dp)) {
        val w = size.width
        val h = size.height
        val endX = w * drawProgress.value
        if (endX <= 2f) return@Canvas
        val p = Path().apply {
            moveTo(2f, h * 0.625f)
            cubicTo(
                w * 0.20f, h * 0.25f,
                w * 0.45f, h * 0.75f,
                w * 0.70f, h * 0.375f,
            )
            cubicTo(
                w * 0.85f, h * 0.25f,
                w * 0.95f, h * 0.50f,
                w - 2f, h * 0.375f,
            )
        }
        clipRect(0f, 0f, endX, h) {
            drawPath(
                p,
                palette.ink.copy(alpha = 0.55f),
                style = Stroke(2.2.dp.toPx(), cap = StrokeCap.Round),
            )
        }
    }
}

/** Composer: italic placeholder, full-width ink underline, 48 dp stamped send seal. */
@Composable
fun Composer(
    palette: Palette,
    placeholder: String,
    modifier: Modifier = Modifier,
    value: String = "",
    stampTrigger: Int = 0,
    reducedMotion: Boolean = false,
    onValueChange: (String) -> Unit = {},
    onSend: () -> Unit = {},
) {
    var local by remember { mutableStateOf(value) }
    var lastEmitted by remember { mutableStateOf(value) }
    LaunchedEffect(value) {
        if (value != lastEmitted) {
            local = value
            lastEmitted = value
        }
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(50.dp)) {
            BasicTextField(
                value = local,
                onValueChange = { next ->
                    local = next
                    lastEmitted = next
                    onValueChange(next)
                },
                textStyle = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink),
                cursorBrush = SolidColor(palette.ink),
                singleLine = true,
                modifier = Modifier.fillMaxSize(),
                decorationBox = { inner ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                        if (local.isEmpty()) {
                            Text(
                                placeholder,
                                style = TextStyle(
                                    fontFamily = WuFonts.Garamond,
                                    fontSize = 17.sp,
                                    fontStyle = FontStyle.Italic,
                                    color = palette.ink3,
                                ),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        inner()
                    }
                },
            )
            InkUnderline(
                palette = palette,
                reducedMotion = reducedMotion,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp),
            )
        }
        Spacer(Modifier.width(10.dp))
        SealButton(
            sizeDp = 48,
            backgroundColor = palette.seal,
            strokeColor = palette.onSeal,
            label = "Send",
            stampTrigger = stampTrigger,
            reducedMotion = reducedMotion,
            onClick = onSend,
        )
    }
}
