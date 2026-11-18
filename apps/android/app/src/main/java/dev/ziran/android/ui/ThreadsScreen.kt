package dev.ziran.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.Seal
import dev.ziran.android.design.WuFonts
import dev.ziran.android.protocol.SessionSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Threads screen: Sessions.dc.html, plus the Flow gestures. Rows swipe left to
 * archive past 110 px with a 4.6 s undo bar, long-press opens the action sheet,
 * and pulling at the top shows the ink ring while the list refreshes.
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
    reducedMotion: Boolean = false,
) {
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var sheetFor by remember { mutableStateOf<SessionSummary?>(null) }
    var undoFor by remember { mutableStateOf<SessionSummary?>(null) }
    var pullPx by remember { mutableStateOf(0f) }
    var pullPhase by remember { mutableStateOf("idle") }
    var refreshTriggered by remember { mutableStateOf(false) }

    fun archive(session: SessionSummary) {
        onArchive(session.sessionId)
        undoFor = session
        scope.launch {
            delay(if (reducedMotion) 150 else 4600)
            if (undoFor?.sessionId == session.sessionId) undoFor = null
        }
    }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 280, reducedMotion = reducedMotion)
        Column(Modifier.fillMaxSize().padding(horizontal = 22.dp)) {
            Row(
                Modifier.padding(top = 54.dp).fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .semantics { role = Role.Button; contentDescription = "Server $serverName. Scenes and theme." },
                ) {
                    Box(Modifier.size(6.dp).background(palette.green, androidx.compose.foundation.shape.CircleShape))
                    Spacer(Modifier.width(8.dp))
                    Text(serverName, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink2))
                }
            }
            Spacer(Modifier.height(172.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f)) {
                    Text("Threads", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium, color = palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("~/src · ${sessions.size} sessions", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(top = 10.dp)
                    .pointerInput(Unit) {
                        detectVerticalDragGestures(
                            onDragStart = {
                                if (!listState.canScrollBackward) {
                                    pullPx = 0f
                                    pullPhase = "drag"
                                }
                            },
                            onDragEnd = {
                                if (pullPhase == "drag") {
                                    if (pullPx > 70f) {
                                        pullPhase = "refresh"
                                        refreshTriggered = true
                                        onRefresh()
                                    } else {
                                        pullPhase = "settle"
                                    }
                                }
                            },
                            onDragCancel = { if (pullPhase == "drag") pullPhase = "settle" },
                        ) { _, delta ->
                            if (pullPhase == "drag") pullPx = (pullPx + delta).coerceAtLeast(0f)
                        }
                    },
            ) {
                if (pullPhase != "idle") {
                    PullInkRing(palette, pullPx, pullPhase)
                }
                LazyColumn(
                    Modifier.fillMaxSize().offset { IntOffset(0, MotionMath.pullListY(pullPx, pullPhase).roundToInt()) },
                    state = listState,
                ) {
                    items(sessions, key = { it.sessionId }) { session ->
                        ThreadRow(
                            session = session,
                            palette = palette,
                            onOpen = { onOpen(session.sessionId) },
                            onLongPress = {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                sheetFor = session
                            },
                            onArchive = { archive(session) },
                        )
                    }
                }
            }
        }
        Composer(
            palette = palette,
            placeholder = "begin a new thread…",
            modifier = Modifier.align(Alignment.BottomCenter).padding(horizontal = 20.dp).padding(bottom = 22.dp).imePadding(),
        )
        // Undo bar, 4.6 s.
        UndoBar(
            visible = undoFor != null,
            title = undoFor?.displayTitle ?: "",
            palette = palette,
            onUndo = {
                undoFor?.let { onRestore(it.sessionId) }
                undoFor = null
            },
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 100.dp),
        )
        sheetFor?.let { session ->
            SheetHost(visible = true, palette = palette, onDismiss = { sheetFor = null }) {
                SheetActions(
                    session = session,
                    palette = palette,
                    onArchive = {
                        sheetFor = null
                        archive(session)
                    },
                    onRename = {
                        sheetFor = null
                        onRename(session.sessionId, session.displayTitle)
                    },
                    onOpen = {
                        sheetFor = null
                        onOpen(session.sessionId)
                    },
                )
            }
        }
    }
    // Pull settles back after the refresh call; the ring turns while waiting.
    LaunchedEffect(pullPhase, sessions) {
        if (pullPhase == "refresh") {
            delay(if (reducedMotion) 150 else 1300)
            pullPhase = "settle"
            pullPx = 0f
            delay(if (reducedMotion) 0 else 450)
            pullPhase = "idle"
            refreshTriggered = false
        } else if (pullPhase == "settle") {
            pullPx = 0f
            delay(if (reducedMotion) 0 else 450)
            pullPhase = "idle"
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ThreadRow(
    session: SessionSummary,
    palette: Palette,
    onOpen: () -> Unit,
    onLongPress: () -> Unit,
    onArchive: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    var dx by remember(session.sessionId) { mutableStateOf(0f) }
    var lifted by remember(session.sessionId) { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        // Ink wash reveal behind the row.
        Row(
            Modifier.fillMaxWidth().height(58.dp).padding(end = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End,
        ) {
            Text(
                "archive",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink2),
                modifier = Modifier.padding(end = 8.dp),
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .offset { IntOffset(dx.roundToInt(), 0) }
                .background(palette.paper)
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { delta ->
                        dx = (dx + delta).coerceIn(-460f, 0f)
                    },
                    onDragStopped = {
                        if (dx < -MotionMath.ArchiveThresholdPx) {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            scope.launch {
                                val anim = Animatable(dx)
                                anim.animateTo(MotionMath.ArchiveOffscreenPx, tween(260))
                                dx = anim.value
                                onArchive()
                            }
                        } else {
                            scope.launch {
                                val anim = Animatable(dx)
                                anim.animateTo(0f, tween(380, easing = dev.ziran.android.design.WuEasing.Default))
                                dx = anim.value
                            }
                        }
                    },
                )
                .combinedClickable(
                    onClick = onOpen,
                    onLongClick = onLongPress,
                )
                .padding(vertical = 12.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Seal(
                    kind = session.agentKind,
                    sizeDp = 30,
                    backgroundColor = palette.seal,
                    strokeColor = palette.onSeal,
                )
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(session.displayTitle, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 19.sp, lineHeight = 25.sp, color = palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(subtitleFor(session), style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 14.5.sp, lineHeight = 20.sp, fontStyle = FontStyle.Italic, color = palette.ink3), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.width(14.dp))
                StateMark(session, palette, haptic)
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(palette.line))
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
private fun StateMark(session: SessionSummary, palette: Palette, haptic: androidx.compose.ui.hapticfeedback.HapticFeedback) {
    when {
        session.status == "waiting_for_permission" ->
            Box(Modifier.size(10.dp).background(palette.seal, androidx.compose.foundation.shape.CircleShape))
        session.status == "running" ->
            Text("⠋", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 15.sp, color = palette.blue))
        session.status == "done" -> Canvas(Modifier.size(15.dp)) {
            drawArc(palette.seal, startAngle = -90f, sweepAngle = 360f, useCenter = false, style = Stroke(1.6.dp.toPx()))
        }
        else -> Box(Modifier.size(6.dp).background(palette.ink3.copy(alpha = 0.6f), androidx.compose.foundation.shape.CircleShape))
    }
}

@Composable
private fun SheetActions(
    session: SessionSummary,
    palette: Palette,
    onArchive: () -> Unit,
    onRename: () -> Unit,
    onOpen: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(bottom = 20.dp)) {
        Box(Modifier.width(36.dp).height(4.dp).background(palette.line, androidx.compose.foundation.shape.RoundedCornerShape(2.dp)).align(Alignment.CenterHorizontally))
        Spacer(Modifier.height(14.dp))
        Text(session.displayTitle, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 21.sp, color = palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
        SheetAction("Open", palette, onOpen)
        SheetAction("Rename", palette, onRename)
        SheetAction("Archive", palette, onArchive)
    }
}

@Composable
private fun SheetAction(label: String, palette: Palette, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .semantics { role = Role.Button; contentDescription = label }
            .combinedClickableCompat(onClick),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 18.sp, color = palette.ink))
    }
}

private fun Modifier.combinedClickableCompat(onClick: () -> Unit): Modifier =
    this.clickable { onClick() }

/** Composer: ink underline, 17 sp Garamond input, 48 dp send seal. */
@Composable
fun Composer(
    palette: Palette,
    placeholder: String,
    modifier: Modifier = Modifier,
    value: String = "",
    onValueChange: (String) -> Unit = {},
    onSend: () -> Unit = {},
) {
    var local by remember { mutableStateOf(value) }
    LaunchedEffect(value) { if (value != local) local = value }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            androidx.compose.foundation.text.BasicTextField(
                value = local,
                onValueChange = { next -> local = next; onValueChange(next) },
                textStyle = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink),
                modifier = Modifier.fillMaxWidth().height(50.dp),
                singleLine = true,
            )
            Canvas(Modifier.fillMaxWidth().height(6.dp).offset(y = -7.dp)) {
                val p = androidx.compose.ui.graphics.Path()
                p.moveTo(2f, size.height * 0.7f)
                p.cubicTo(size.width * 0.2f, size.height * 0.2f, size.width * 0.45f, size.height * 0.9f, size.width * 0.7f, size.height * 0.4f)
                p.cubicTo(size.width * 0.85f, size.height * 0.3f, size.width * 0.95f, size.height * 0.5f, size.width - 2f, size.height * 0.4f)
                drawPath(p, palette.ink.copy(alpha = 0.55f), style = Stroke(2.4.dp.toPx(), cap = StrokeCap.Round))
            }
        }
        Spacer(Modifier.width(10.dp))
        dev.ziran.android.design.SealButton(
            sizeDp = 48,
            backgroundColor = palette.seal,
            strokeColor = palette.onSeal,
            onClick = onSend,
        )
    }
}
