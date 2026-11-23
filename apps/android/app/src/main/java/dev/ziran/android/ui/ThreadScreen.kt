package dev.ziran.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppState
import dev.ziran.android.data.LiveBlock
import dev.ziran.android.data.LiveTool
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
import dev.ziran.android.design.wuStamp
import dev.ziran.android.protocol.AgentKind
import dev.ziran.android.protocol.HistoryMessageView
import kotlinx.coroutines.delay

/**
 * Thread screen: Live.dc.html + Flow.dc.html.
 * - 210 dp scene header (stays still while the IME moves the composer frame by frame).
 * - Thinking block with growing ink bar, rotating grind ring, word-by-word stream, auto-fold.
 * - Tool rows with ink drop (550 ms) -> flowing hairline (1.6 s) -> red ring (900 ms) in place,
 *   plus unfolding/folding diff and output panels (750 ms height ease).
 * - Word-by-word streaming answer (500 ms ease + 3 dp rise, 55 ms stagger).
 * - Queued messages (`2› text queued`) rising smoothly while the turn runs.
 */
@Composable
fun ThreadScreen(
    palette: Palette,
    state: AppState,
    modifier: Modifier = Modifier,
    sceneKey: String = "peaks",
    listState: LazyListState = rememberLazyListState(),
    onBack: () -> Unit = {},
    onPlan: () -> Unit = {},
    onModel: () -> Unit = {},
    onScenes: () -> Unit = {},
    onTextChange: (String) -> Unit = {},
    onSend: (String) -> Unit = {},
    onSendWithMode: (String, String) -> Unit = { text, _ -> onSend(text) },
    onSteerModeChange: (String) -> Unit = {},
    onStop: () -> Unit = {},
    onPermission: (String) -> Unit = {},
    reducedMotion: Boolean = false,
) {
    val snapshot = state.snapshot
    val title = snapshot?.session?.title ?: "Thread"
    val agent = snapshot?.session?.agentLabel ?: "fox"
    val statusLine = statusLineFor(state)
    val isWorking = state.live.turnId != null ||
        state.live.status in setOf("dispatching", "thinking", "working", "writing") ||
        state.live.permission != null

    val imeBottomPx = WindowInsets.ime.getBottom(LocalDensity.current)

    // Follow newest line while a turn runs or keyboard rises, only if reader is near bottom.
    LaunchedEffect(
        state.lastSeq,
        state.live.turnId,
        state.live.assistants.size,
        state.live.tools.size,
        state.queuedMessages.size,
        imeBottomPx > 0,
    ) {
        val info = listState.layoutInfo
        val total = info.totalItemsCount
        if (total == 0) return@LaunchedEffect
        val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: return@LaunchedEffect
        if (lastVisible >= total - 2) {
            listState.animateScrollToItem(total - 1)
        }
    }

    var sendStamp by remember { mutableIntStateOf(0) }
    var steerSheetOpen by remember { mutableStateOf(false) }
    var pendingAskText by remember { mutableStateOf<String?>(null) }
    val userPromptCount = (snapshot?.messages?.count { it.role == "user" } ?: 0) +
        (if (state.pending != null) 1 else 0)

    Box(modifier.fillMaxSize().background(palette.paper)) {
        // Painting header stays still at the top even while the IME rises.
        ScreenChrome(sceneKey, palette, headerHeightDp = 210, reducedMotion = reducedMotion)

        // Header progress dots sit 58 dp above the bottom of the painting (so they clear the subtitle).
        val planSteps = state.plan?.steps.orEmpty()
        if (planSteps.isNotEmpty()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(210.dp),
            ) {
                Row(
                    Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .padding(start = 22.dp, end = 120.dp, bottom = 58.dp)
                        .semantics { contentDescription = "Steps on the way" },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    planSteps.forEachIndexed { idx, step ->
                        val isDone = step.status == dev.ziran.android.protocol.PlanStepStatus.Done
                        Box(
                            Modifier
                                .size(9.dp)
                                .then(
                                    if (isDone) {
                                        Modifier
                                            .background(palette.seal, CircleShape)
                                            .border(1.5.dp, palette.paper, CircleShape)
                                    } else {
                                        Modifier
                                            .background(palette.paper, CircleShape)
                                            .border(1.4.dp, palette.ink2, CircleShape)
                                    },
                                ),
                        )
                        if (idx < planSteps.lastIndex) {
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(1.dp)
                                    .background(palette.ink2.copy(alpha = 0.35f)),
                            )
                        }
                    }
                }
            }
        }

        val safeTop = rememberSafeTopInsetDp()
        // Foreground layout rides the IME cleanly via WindowInsetsAnimationCompat.
        Column(
            Modifier
                .fillMaxSize()
                .safeTopAndHorizontalPadding()
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
        ) {
            Spacer(Modifier.height(contentTopSpacerDp(170, safeTop, minClearanceDp = 56).dp))

            // Title + subtitle + stamped agent seal (top: 170 dp).
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        title,
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
                        "$agent · $statusLine",
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        modifier = Modifier.padding(top = 2.dp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Seal(
                    kind = AgentKind.fromLabel(agent),
                    sizeDp = 28,
                    backgroundColor = palette.seal,
                    strokeColor = palette.onSeal,
                    modifier = Modifier.wuStamp(initialDelayMs = 300, reducedMotion = reducedMotion),
                )
            }

            Spacer(Modifier.height(10.dp))

            // Scrollable live timeline.
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(top = 4.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 22.dp),
            ) {
                if (snapshot != null) {
                    val userOrdinals = buildMap {
                        var ord = 0
                        snapshot.messages.forEachIndexed { idx, msg ->
                            if (msg.role == "user") {
                                ord += 1
                                put(idx, ord)
                            }
                        }
                    }
                    itemsIndexed(
                        snapshot.messages,
                        key = { idx, message -> "history-$idx-${message.index}-${message.role}" },
                    ) { idx, message ->
                        val ord = userOrdinals[idx] ?: 1
                        HistoryRow(message, ord, palette)
                    }
                }
                if (state.pending != null) {
                    item(key = "pending-${state.pending.operationId}") {
                        PromptRow(
                            ordinal = (snapshot?.messages?.count { it.role == "user" } ?: 0) + 1,
                            text = state.pending.text,
                            palette = palette,
                            reducedMotion = reducedMotion,
                        )
                    }
                }
                if (state.live.reasoning.isNotEmpty()) {
                    item(key = "thinking-${state.live.turnId ?: state.live.finishedTurnId ?: "live"}") {
                        ThinkingFold(
                            reasoning = state.live.reasoning,
                            durationSecs = state.live.reasoningDurationSecs,
                            palette = palette,
                            reducedMotion = reducedMotion,
                        )
                    }
                }
                items(state.live.tools, key = { tool -> "tool-${tool.callId}" }) { tool ->
                    ToolRow(tool = tool, palette = palette, reducedMotion = reducedMotion)
                }
                if (state.live.assistants.isNotEmpty()) {
                    item(key = "answer-${state.live.turnId ?: state.live.finishedTurnId ?: "live"}") {
                        AnswerBlock(state.live.assistants, palette, reducedMotion)
                    }
                }
                if (state.live.permission != null) {
                    val perm = state.live.permission
                    item(key = "perm-${perm.requestId}") {
                        PermissionCard(perm.toolName, perm.description, palette, reducedMotion, onPermission)
                    }
                }
                itemsIndexed(state.live.sentDuringTurn, key = { index, s -> "steer-$index-${s.text.hashCode()}" }) { index, note ->
                    QueuedRow(
                        ordinal = (userPromptCount + index + 1).coerceAtLeast(2),
                        text = note.text,
                        tag = note.tag,
                        palette = palette,
                        reducedMotion = reducedMotion,
                    )
                }
                itemsIndexed(state.queuedMessages, key = { index, q -> "queued-$index-${q.hashCode()}" }) { index, queued ->
                    if (state.live.sentDuringTurn.none { it.text == queued }) {
                        QueuedRow(
                            ordinal = (userPromptCount + state.live.sentDuringTurn.size + index + 1).coerceAtLeast(2),
                            text = queued,
                            tag = if (isWorking) "waits for the turn" else "sent",
                            palette = palette,
                            reducedMotion = reducedMotion,
                        )
                    }
                }
            }

            // Composer + steer chip + footer (rides the IME frame by frame).
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 16.dp, top = 4.dp, bottom = 14.dp),
            ) {
                if (isWorking) {
                    val modeLabel = when (state.activeSteerMode) {
                        "stop" -> "stop, then send"
                        "after" -> "after this turn"
                        else -> "steer now"
                    }
                    val softCount = state.live.pendingSoftInterrupts
                    val chipText = if (softCount > 0 && state.activeSteerMode == "steer") {
                        "$modeLabel ($softCount) ▾"
                    } else {
                        "$modeLabel ▾"
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(
                            Modifier
                                .height(30.dp)
                                .border(1.dp, palette.line, RoundedCornerShape(15.dp))
                                .wuClickable(reducedMotion = reducedMotion, onClick = {
                                    pendingAskText = null
                                    steerSheetOpen = true
                                })
                                .padding(horizontal = 10.dp)
                                .semantics { role = Role.Button; contentDescription = "Send mode: $modeLabel" },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Box(Modifier.size(6.dp).background(palette.blue, CircleShape))
                            Text(
                                chipText,
                                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink2),
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        Row(
                            Modifier
                                .height(30.dp)
                                .border(1.dp, palette.line, RoundedCornerShape(15.dp))
                                .wuClickable(reducedMotion = reducedMotion, onClick = onStop)
                                .padding(horizontal = 12.dp)
                                .semantics { role = Role.Button; contentDescription = "Stop" },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Box(Modifier.size(8.dp).background(palette.ink2, RoundedCornerShape(1.5.dp)))
                            Text(
                                "stop",
                                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink2),
                            )
                        }
                    }
                }
                ComposerWithStop(
                    palette = palette,
                    value = state.composerText,
                    placeholder = "write to $agent…",
                    isWorking = false,
                    stampTrigger = sendStamp,
                    reducedMotion = reducedMotion,
                    onValueChange = onTextChange,
                    onSend = { text ->
                        if (isWorking && state.steerDefault == "ask") {
                            pendingAskText = text
                            steerSheetOpen = true
                        } else {
                            sendStamp += 1
                            onSend(text)
                        }
                    },
                    onStop = onStop,
                    sessionKey = state.activeSessionId ?: "thread",
                )
                Row(
                    Modifier.padding(top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        state.serverName ?: "studio-vps",
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        modifier = Modifier
                            .wuClickable(reducedMotion = reducedMotion, onClick = onScenes)
                            .padding(horizontal = 4.dp, vertical = 6.dp)
                            .semantics { role = Role.Button; contentDescription = "Scenes and theme" },
                    )
                    Text(
                        "·",
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        modifier = Modifier.padding(vertical = 6.dp),
                    )
                    val modelLabel = listOfNotNull(
                        state.runtime?.model,
                        state.runtime?.reasoningEffort,
                    ).joinToString(" · ").ifEmpty { "gpt-5.6-luna · high" }
                    Text(
                        modelLabel,
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        modifier = Modifier
                            .wuClickable(reducedMotion = reducedMotion, onClick = onModel)
                            .padding(horizontal = 4.dp, vertical = 6.dp)
                            .drawBehind {
                                val y = size.height - 3.dp.toPx()
                                drawLine(
                                    color = palette.line,
                                    start = Offset(4.dp.toPx(), y),
                                    end = Offset(size.width - 4.dp.toPx(), y),
                                    strokeWidth = 1.dp.toPx(),
                                )
                            }
                            .semantics { role = Role.Button; contentDescription = "Model $modelLabel" },
                    )
                }
            }
        }

        // Top-left threads menu button and top-right plan button sit above the foreground column.
        ThreadsMenuButton(palette = palette, onClick = onBack, reducedMotion = reducedMotion)
        PlanButton(
            palette = palette,
            onClick = onPlan,
            modifier = Modifier.align(Alignment.TopEnd),
            reducedMotion = reducedMotion,
        )

        // Steer mode bottom sheet (`Steer.dc.html`).
        SheetHost(
            visible = steerSheetOpen,
            palette = palette,
            reducedMotion = reducedMotion,
            onDismiss = {
                steerSheetOpen = false
                pendingAskText = null
            },
        ) {
            SteerSheetContent(
                agent = agent,
                selectedMode = state.activeSteerMode,
                palette = palette,
                reducedMotion = reducedMotion,
                onPick = { mode ->
                    onSteerModeChange(mode)
                    steerSheetOpen = false
                    val askText = pendingAskText
                    pendingAskText = null
                    if (askText != null) {
                        sendStamp += 1
                        onSendWithMode(askText, mode)
                    }
                },
            )
        }
    }
}

@Composable
private fun SteerSheetContent(
    agent: String,
    selectedMode: String,
    palette: Palette,
    reducedMotion: Boolean,
    onPick: (String) -> Unit,
) {
    val options = listOf(
        Triple("steer", "Steer now", "$agent reads it at its next step. Its work goes on."),
        Triple("stop", "Stop, then send", "$agent stops the current work first, then reads it."),
        Triple("after", "After this turn", "Waits until $agent is done, then goes."),
    )
    Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 6.dp)) {
        Text(
            "$agent is working. Your message should…",
            style = TextStyle(
                fontFamily = WuFonts.Garamond,
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium,
                color = palette.ink,
            ),
            modifier = Modifier.padding(bottom = 6.dp),
        )
        options.forEach { (key, title, note) ->
            val on = key == selectedMode
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(64.dp)
                    .wuClickable(reducedMotion = reducedMotion, onClick = { onPick(key) })
                    .drawBehind {
                        drawLine(
                            color = palette.line,
                            start = Offset(0f, size.height),
                            end = Offset(size.width, size.height),
                            strokeWidth = 1.dp.toPx(),
                        )
                    }
                    .semantics { role = Role.RadioButton; contentDescription = "$title: $note" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        title,
                        style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, color = palette.ink),
                    )
                    Text(
                        note,
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 14.5.sp,
                            fontStyle = FontStyle.Italic,
                            color = palette.ink3,
                        ),
                    )
                }
                Spacer(Modifier.width(10.dp))
                Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                    if (on) {
                        Canvas(Modifier.size(18.dp)) {
                            drawCircle(
                                color = palette.seal,
                                radius = size.minDimension * 0.41f,
                                style = Stroke(width = 1.6.dp.toPx()),
                            )
                        }
                    }
                }
            }
        }
        Text(
            "the default is set in settings · while an agent works",
            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.ink3),
            modifier = Modifier.padding(top = 10.dp, bottom = 12.dp),
        )
    }
}

private fun statusLineFor(state: AppState): String = when {
    state.live.permission != null -> "waiting for permission"
    state.live.status == "thinking" -> "thinking"
    state.live.turnId != null -> "working"
    state.live.status == "done" -> "finished"
    state.live.status == "stopped" -> "stopped"
    state.reconciling -> "reconciling"
    state.savedOnPhone -> "saved on this phone"
    else -> "idle"
}

@Composable
private fun HistoryRow(message: HistoryMessageView, ordinal: Int, palette: Palette) {
    when {
        message.role == "user" -> PromptRow(ordinal = ordinal, text = message.content, palette = palette, animate = false)
        message.role == "assistant" -> Text(
            message.content,
            style = TextStyle(
                fontFamily = WuFonts.Garamond,
                fontSize = 16.5.sp,
                lineHeight = 24.sp,
                fontStyle = FontStyle.Italic,
                color = palette.ink2,
            ),
            modifier = Modifier.padding(top = 4.dp),
        )
        message.toolName != null -> Text(
            "${message.toolName} ${message.content.take(80)}",
            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
            modifier = Modifier.padding(vertical = 2.dp),
        )
    }
}

@Composable
private fun PromptRow(
    ordinal: Int,
    text: String,
    palette: Palette,
    animate: Boolean = true,
    reducedMotion: Boolean = false,
) {
    val mod = if (animate) Modifier.wuRise(reducedMotion = reducedMotion, key = "prompt-$ordinal-$text") else Modifier
    Row(mod.fillMaxWidth()) {
        Text(
            "$ordinal›",
            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.seal),
            modifier = Modifier.padding(top = 2.dp, end = 8.dp),
        )
        Text(
            text,
            style = TextStyle(
                fontFamily = WuFonts.Garamond,
                fontSize = 16.sp,
                lineHeight = 24.sp,
                color = palette.ink,
            ),
        )
    }
}

/**
 * Thinking block (`Live.dc.html`):
 * - Growing left vertical bar (3.4 s, scaleY 0 -> 1 from top), fades out when done.
 * - Header crossfades in place between rotating broken ring + "thinking" and
 *   static broken ring + "thought for Xs ›" (tap to inspect).
 * - Words settle smoothly (500 ms ease + 3 dp rise, 65 ms stagger), then fold away (750 ms).
 */
@Composable
private fun ThinkingFold(
    reasoning: List<LiveBlock>,
    durationSecs: Long?,
    palette: Palette,
    reducedMotion: Boolean,
) {
    val allDone = reasoning.all { it.done }
    var userExpanded by remember { mutableStateOf(false) }
    val showBody = !allDone || userExpanded
    val fullText = remember(reasoning) { reasoning.joinToString("") { it.text }.trim() }
    val secsLabel = (durationSecs ?: 4L).coerceAtLeast(1L)

    // Left vertical bar grows downward over 3.4 s while thinking, fades out on done.
    val barGrow = remember { Animatable(if (reducedMotion || allDone) 1f else 0f) }
    LaunchedEffect(reducedMotion) {
        if (!reducedMotion && !allDone) {
            barGrow.animateTo(1f, tween(WuDurations.ThinkBarGrow, easing = WuEasing.Default))
        } else {
            barGrow.snapTo(1f)
        }
    }
    val runAlpha by animateFloatAsState(
        targetValue = if (allDone) 0f else 1f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 400, easing = WuEasing.Default),
        label = "think-run-alpha",
    )
    val doneAlpha by animateFloatAsState(
        targetValue = if (allDone) 1f else 0f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 500, easing = WuEasing.Default),
        label = "think-done-alpha",
    )

    val grindTransition = if (!allDone && !reducedMotion) rememberInfiniteTransition(label = "think-grind") else null
    val grindAngle = grindTransition?.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart),
        label = "think-grind-deg",
    )

    Column(
        Modifier
            .fillMaxWidth()
            .wuRise(reducedMotion = reducedMotion, key = "think-enter")
            .drawBehind {
                if (runAlpha > 0.01f) {
                    val pad = 6.dp.toPx()
                    val h = (size.height - pad * 2f).coerceAtLeast(0f) * barGrow.value
                    if (h > 0.5f) {
                        drawRect(
                            color = palette.ink3.copy(alpha = 0.5f * runAlpha),
                            topLeft = Offset(0f, pad),
                            size = Size(2.dp.toPx(), h),
                        )
                    }
                }
            }
            .padding(start = 14.dp),
    ) {
            // Stacked header: "thinking" and "thought for Xs ›" occupy the exact same 28 dp box.
            Box(Modifier.height(28.dp), contentAlignment = Alignment.CenterStart) {
                if (runAlpha > 0.01f) {
                    Row(
                        Modifier.graphicsLayer { alpha = runAlpha },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Canvas(
                            Modifier
                                .size(14.dp)
                                .graphicsLayer { rotationZ = grindAngle?.value ?: 0f },
                        ) {
                            drawArc(
                                color = palette.ink3,
                                startAngle = 0f,
                                sweepAngle = 225f,
                                useCenter = false,
                                style = Stroke(2.2.dp.toPx(), cap = StrokeCap.Round),
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "thinking",
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 14.sp,
                                fontStyle = FontStyle.Italic,
                                color = palette.ink3,
                            ),
                        )
                    }
                }
                if (doneAlpha > 0.01f) {
                    Row(
                        Modifier
                            .graphicsLayer { alpha = doneAlpha }
                            .wuClickable(
                                enabled = allDone,
                                reducedMotion = reducedMotion,
                                onClick = { userExpanded = !userExpanded },
                            )
                            .semantics { role = Role.Button; contentDescription = "thought for $secsLabel seconds" },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Canvas(Modifier.size(14.dp)) {
                            drawArc(
                                color = palette.ink3,
                                startAngle = -70f,
                                sweepAngle = 305f,
                                useCenter = false,
                                style = Stroke(2.0.dp.toPx(), cap = StrokeCap.Round),
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "thought for ${secsLabel}s ",
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 14.sp,
                                fontStyle = FontStyle.Italic,
                                color = palette.ink3,
                            ),
                        )
                        Text(
                            if (userExpanded) "⌄" else "›",
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 14.sp,
                                color = palette.ink3,
                            ),
                        )
                    }
                }
            }

            // Folding body (750 ms height ease + 500 ms opacity ease).
            AnimatedVisibility(
                visible = showBody && fullText.isNotEmpty(),
                enter = expandVertically(
                    animationSpec = tween(
                        if (reducedMotion) WuDurations.ReducedFade else MotionMath.PanelMs,
                        easing = WuEasing.Default,
                    ),
                    expandFrom = Alignment.Top,
                ) + fadeIn(tween(if (reducedMotion) WuDurations.ReducedFade else 500, easing = WuEasing.Default)),
                exit = shrinkVertically(
                    animationSpec = tween(
                        if (reducedMotion) WuDurations.ReducedFade else MotionMath.PanelMs,
                        easing = WuEasing.Default,
                    ),
                    shrinkTowards = Alignment.Top,
                ) + fadeOut(tween(if (reducedMotion) WuDurations.ReducedFade else 500, easing = WuEasing.Default)),
            ) {
                WordStreamText(
                    text = fullText,
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 15.5.sp,
                        lineHeight = 23.sp,
                        fontStyle = FontStyle.Italic,
                        color = palette.ink3,
                    ),
                    staggerMs = WuDurations.WordStagger,
                    alreadySettled = allDone,
                    reducedMotion = reducedMotion,
                    modifier = Modifier.padding(top = 2.dp, bottom = 4.dp),
                )
            }
        }
}

/**
 * Tool call row (`Live.dc.html`):
 * - Left 16 dp slot: 8 dp ink drop (scale 0 -> 1.35 -> 1 in 550 ms) crossfades in place
 *   to 14 dp vermilion ring (draws 0 -> 360° in 900 ms after 100 ms delay).
 * - Tool name (Mono 11.5 sp ink) + intent (Garamond 16 sp ink2) slide in (-6 dp -> 0, 600 ms).
 * - Right slot: braille spinner + live 0:0X elapsed time (blue) crossfades to summary (ink3).
 * - Flowing blue hairline (1.5 dp, 1.6 s infinite) while running.
 * - Diff / output panel unfolds (750 ms) while running and folds away smoothly (750 ms) on done.
 */
@Composable
private fun ToolRow(
    tool: LiveTool,
    palette: Palette,
    reducedMotion: Boolean,
) {
    val isDone = tool.status == "done" || tool.status == "failed"
    val isRunning = !isDone

    // Parse intent (line 1 of input) vs optional unfolding panel lines (lines 2+ of input or output).
    val inputLines = remember(tool.input) { tool.input.lines() }
    val intentText = inputLines.firstOrNull().orEmpty().take(80)
    val panelText = remember(tool.input, tool.output, tool.error) {
        val fromInput = if (inputLines.size > 1) inputLines.drop(1).joinToString("\n").trim() else ""
        val fromOutput = if (tool.output.contains('\n')) tool.output.trim() else ""
        when {
            fromOutput.isNotEmpty() -> fromOutput
            fromInput.isNotEmpty() -> fromInput
            tool.error != null -> tool.error
            else -> ""
        }
    }
    val hasPanel = panelText.isNotEmpty()
    var userToggled by remember(tool.callId) { mutableStateOf(false) }
    val panelOpen = hasPanel && (if (isRunning) true else userToggled)

    // Already-done tools (e.g. when returning from Model) paint immediately without re-animating entrance.
    val startedAsLive = remember(tool.callId) { isRunning && !reducedMotion }
    val dotScale = remember(tool.callId) { Animatable(if (startedAsLive) 0f else 1f) }
    val dotAlpha = remember(tool.callId) { Animatable(if (startedAsLive) 0f else 1f) }
    val nameIn = remember(tool.callId) { Animatable(if (startedAsLive) 0f else 1f) }
    val intentIn = remember(tool.callId) { Animatable(if (startedAsLive) 0f else 1f) }
    val scaleFactor = rememberAnimatorScale()

    LaunchedEffect(tool.callId, startedAsLive) {
        if (!startedAsLive) return@LaunchedEffect
        val sf = scaleFactor.coerceAtLeast(0.1f)
        // Ink drop: 0 -> 1.35 (60%) -> 1.0 (100%) over 550 ms.
        dotAlpha.snapTo(1f)
        val dur = WuDurations.ToolIn
        dotScale.animateTo(
            1f,
            keyframes {
                durationMillis = dur
                0f at 0 using WuEasing.Default
                1.35f at (dur * 0.6f).toInt() using WuEasing.Default
                1f at dur
            },
        )
    }
    LaunchedEffect(tool.callId, startedAsLive) {
        if (!startedAsLive) return@LaunchedEffect
        nameIn.animateTo(1f, tween(WuDurations.ToolSlideIn, delayMillis = 50, easing = WuEasing.Default))
    }
    LaunchedEffect(tool.callId, startedAsLive) {
        if (!startedAsLive) return@LaunchedEffect
        intentIn.animateTo(1f, tween(WuDurations.ToolSlideIn, delayMillis = 120, easing = WuEasing.Default))
    }

    // Ring draw: 900 ms with 100 ms delay when transitioning to done.
    val ringSweep = remember(tool.callId) { Animatable(if (isDone && !startedAsLive) 1f else 0f) }
    LaunchedEffect(isDone, reducedMotion) {
        if (isDone) {
            if (reducedMotion) {
                ringSweep.snapTo(1f)
            } else {
                ringSweep.animateTo(
                    1f,
                    tween(WuDurations.RingDraw, delayMillis = WuDurations.RingDrawDelay, easing = WuEasing.Default),
                )
            }
        }
    }

    val runAlpha by animateFloatAsState(
        targetValue = if (isRunning) 1f else 0f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 400, easing = WuEasing.Default),
        label = "tool-run-${tool.callId}",
    )
    val doneAlpha by animateFloatAsState(
        targetValue = if (isDone) 1f else 0f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 500, easing = WuEasing.Default),
        label = "tool-done-${tool.callId}",
    )

    // Live elapsed seconds (`0:00`, `0:01`, ...) while running.
    var elapsedSec by remember(tool.callId) { mutableIntStateOf(0) }
    LaunchedEffect(tool.callId, isRunning, scaleFactor) {
        if (!isRunning) return@LaunchedEffect
        val tickMs = (1000f * scaleFactor.coerceAtLeast(0.25f)).toLong()
        while (true) {
            delay(tickMs)
            elapsedSec += 1
        }
    }
    val elapsedLabel = "0:${elapsedSec.coerceAtMost(59).toString().padStart(2, '0')}"

    val slideOffsetPx = with(LocalDensity.current) { (-6).dp.toPx() }
    val summary = remember(tool.name, tool.output, tool.error) { toolDoneSummary(tool) }

    Column(
        Modifier
            .fillMaxWidth()
            .then(
                if (isDone && hasPanel) {
                    Modifier.wuClickable(reducedMotion = reducedMotion, onClick = { userToggled = !userToggled })
                } else Modifier,
            ),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Left 16 dp stacked slot: ink dot -> red ring in place.
            Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
                if (runAlpha > 0.01f) {
                    Box(
                        Modifier
                            .size(8.dp)
                            .graphicsLayer {
                                val s = dotScale.value
                                scaleX = s
                                scaleY = s
                                alpha = dotAlpha.value * runAlpha
                            }
                            .background(palette.ink, CircleShape),
                    )
                }
                if (doneAlpha > 0.01f) {
                    Canvas(Modifier.size(14.dp).graphicsLayer { alpha = doneAlpha }) {
                        drawArc(
                            color = palette.seal,
                            startAngle = -90f,
                            sweepAngle = 360f * ringSweep.value,
                            useCenter = false,
                            style = Stroke(1.6.dp.toPx(), cap = StrokeCap.Round),
                        )
                    }
                }
            }

            Spacer(Modifier.width(10.dp))

            // Tool name (Mono 11.5 sp ink)
            Text(
                tool.name,
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink),
                modifier = Modifier.graphicsLayer {
                    val p = nameIn.value
                    alpha = p
                    translationX = slideOffsetPx * (1f - p)
                },
            )

            Spacer(Modifier.width(10.dp))

            // Tool intent (Garamond 16 sp ink2)
            Text(
                intentText,
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.ink2),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .weight(1f)
                    .graphicsLayer {
                        val p = intentIn.value
                        alpha = p
                        translationX = slideOffsetPx * (1f - p)
                    },
            )

            Spacer(Modifier.width(8.dp))

            // Right stacked slot: spinner + elapsed time -> concise result summary.
            Box(contentAlignment = Alignment.CenterEnd) {
                if (runAlpha > 0.01f) {
                    Row(
                        Modifier.graphicsLayer { alpha = runAlpha * nameIn.value },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BrailleSpinnerText(color = palette.blue, fontSize = 11.sp, reducedMotion = reducedMotion)
                        Spacer(Modifier.width(4.dp))
                        Text(
                            elapsedLabel,
                            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.blue),
                        )
                    }
                }
                if (doneAlpha > 0.01f) {
                    ToolDoneMeta(summary = summary, palette = palette, alpha = doneAlpha)
                }
            }
        }

        // Flowing blue hairline while running (`l-flow`: 1.6 s ease-in-out infinite).
        if (runAlpha > 0.01f) {
            FlowingHairline(
                color = palette.blue,
                alpha = runAlpha,
                reducedMotion = reducedMotion,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 26.dp, bottom = 2.dp),
            )
        }

        // Unfolding diff / output panel (750 ms height ease).
        AnimatedVisibility(
            visible = panelOpen,
            enter = expandVertically(
                animationSpec = tween(
                    if (reducedMotion) WuDurations.ReducedFade else MotionMath.PanelMs,
                    easing = WuEasing.Default,
                ),
                expandFrom = Alignment.Top,
            ) + fadeIn(tween(if (reducedMotion) WuDurations.ReducedFade else 500, easing = WuEasing.Default)),
            exit = shrinkVertically(
                animationSpec = tween(
                    if (reducedMotion) WuDurations.ReducedFade else MotionMath.PanelMs,
                    easing = WuEasing.Default,
                ),
                shrinkTowards = Alignment.Top,
            ) + fadeOut(tween(if (reducedMotion) WuDurations.ReducedFade else 500, easing = WuEasing.Default)),
        ) {
            ToolDetailPanel(
                toolName = tool.name,
                text = panelText,
                palette = palette,
                reducedMotion = reducedMotion,
            )
        }
    }
}

@Composable
private fun FlowingHairline(
    color: Color,
    alpha: Float,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val transition = if (!reducedMotion) rememberInfiniteTransition(label = "tool-hairline") else null
    val phase = transition?.animateFloat(
        initialValue = -0.60f,
        targetValue = 1.60f,
        animationSpec = infiniteRepeatable(
            animation = tween(WuDurations.HairlineFlow, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "hairline-x",
    )
    Canvas(modifier.height(1.5.dp).clipToBounds().graphicsLayer { this.alpha = alpha }) {
        val barW = size.width * 0.45f
        val startX = if (reducedMotion) size.width * 0.25f else size.width * (phase?.value ?: 0f)
        drawRect(
            brush = Brush.horizontalGradient(
                0f to Color.Transparent,
                0.5f to color,
                1f to Color.Transparent,
                startX = startX,
                endX = startX + barW,
            ),
            topLeft = Offset(startX, 0f),
            size = Size(barW, size.height),
        )
    }
}

@Composable
private fun ToolDetailPanel(
    toolName: String,
    text: String,
    palette: Palette,
    reducedMotion: Boolean,
) {
    val lines = remember(text) { text.lines().take(16) }
    val isDiff = remember(toolName, lines) {
        toolName == "edit" || lines.any { it.startsWith("- ") || it.startsWith("+ ") }
    }
    if (isDiff) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = 26.dp, top = 4.dp, bottom = 6.dp)
                .background(palette.paper2, RoundedCornerShape(4.dp))
                .padding(horizontal = 10.dp, vertical = 8.dp),
        ) {
            var plusIndex = 0
            lines.forEachIndexed { idx, line ->
                val isRemoved = line.startsWith("- ") || line.startsWith("-") && !line.startsWith("---")
                val isAdded = line.startsWith("+ ") || line.startsWith("+") && !line.startsWith("+++")
                val delayMs = if (isAdded) {
                    val d = 550 + plusIndex * 300
                    plusIndex += 1
                    d
                } else 0
                val style = when {
                    isRemoved -> TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 11.5.sp,
                        lineHeight = 20.sp,
                        color = palette.seal.copy(alpha = 0.8f),
                        textDecoration = TextDecoration.LineThrough,
                    )
                    isAdded -> TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 11.5.sp,
                        lineHeight = 20.sp,
                        color = palette.green,
                    )
                    else -> TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 11.5.sp,
                        lineHeight = 20.sp,
                        color = palette.ink3,
                    )
                }
                Text(
                    line,
                    style = style,
                    modifier = if (isAdded) Modifier.wuRise(delayMs = delayMs, reducedMotion = reducedMotion, key = "diff-$idx-$line") else Modifier,
                )
            }
        }
    } else {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = 26.dp, top = 2.dp, bottom = 6.dp),
        ) {
            lines.forEachIndexed { idx, line ->
                val styled = buildAnnotatedString {
                    if (line.startsWith("✓")) {
                        withStyle(SpanStyle(color = palette.green)) { append("✓") }
                        append(line.removePrefix("✓"))
                    } else {
                        append(line)
                    }
                }
                Text(
                    styled,
                    style = TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 11.5.sp,
                        lineHeight = 19.sp,
                        color = palette.ink3,
                    ),
                    modifier = Modifier.wuRise(
                        delayMs = 250 + idx * 500,
                        reducedMotion = reducedMotion,
                        key = "out-$idx-$line",
                    ),
                )
            }
        }
    }
}

private fun toolDoneSummary(tool: LiveTool): String {
    if (tool.error != null) return "failed"
    val out = tool.output.trim()
    if (out.isEmpty()) return "done"
    val first = out.lines().first().trim()
    if (!out.contains('\n') && first.length <= 16) return first
    if (tool.name == "edit") {
        val added = out.lines().count { it.startsWith("+") && !it.startsWith("+++") }
        val removed = out.lines().count { it.startsWith("-") && !it.startsWith("---") }
        if (added > 0 || removed > 0) return "+$added −$removed"
    }
    val passed = out.lines().count { it.trimStart().startsWith("✓") }
    if (passed > 0) return "$passed passed"
    return "${out.lines().size} lines"
}

@Composable
private fun ToolDoneMeta(summary: String, palette: Palette, alpha: Float) {
    val styled = remember(summary, palette) {
        buildAnnotatedString {
            val match = Regex("^(\\+\\d+)\\s+(−\\d+)$").matchEntire(summary)
            if (match != null) {
                withStyle(SpanStyle(color = palette.green)) { append(match.groupValues[1]) }
                append(" ")
                withStyle(SpanStyle(color = palette.seal)) { append(match.groupValues[2]) }
            } else {
                withStyle(SpanStyle(color = palette.ink3)) { append(summary) }
            }
        }
    }
    Text(
        styled,
        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp),
        modifier = Modifier.graphicsLayer { this.alpha = alpha },
    )
}

@Composable
private fun AnswerBlock(assistants: List<LiveBlock>, palette: Palette, reducedMotion: Boolean) {
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        assistants.forEach { block ->
            WordStreamText(
                text = block.text,
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 16.5.sp,
                    lineHeight = 24.sp,
                    fontStyle = FontStyle.Italic,
                    color = palette.ink2,
                ),
                staggerMs = WuDurations.AnswerWordStagger,
                alreadySettled = false,
                reducedMotion = reducedMotion,
            )
        }
    }
}

/**
 * Word-by-word settling text (`l-word`: 500 ms ease + 3 dp upward rise, staggered).
 * Uses ONE frame-driven clock that automatically stops once all visible words reach 1.0,
 * driving GPU graphicsLayer transforms with zero relayout and zero ghost pre-rendering.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WordStreamText(
    text: String,
    style: TextStyle,
    staggerMs: Int,
    alreadySettled: Boolean,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val words = remember(text) { text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() } }
    if (words.isEmpty()) return

    if (reducedMotion || alreadySettled) {
        Text(text, style = style, modifier = modifier)
        return
    }

    val animatedCap = 80
    val animatedWords = words.take(animatedCap)
    val overflowText = if (words.size > animatedCap) words.drop(animatedCap).joinToString(" ") else null

    // Record the exact arrival timestamp (in animation-scaled ms) for each word index.
    // Clock is a Float updated in withFrameNanos and read ONLY inside graphicsLayer so
    // streaming words run at full 120 Hz with zero per-frame recompositions.
    val arrivalMs = remember { mutableStateMapOf<Int, Float>() }
    var clockMs by remember { mutableFloatStateOf(0f) }
    val scaleFactor = rememberAnimatorScale().coerceAtLeast(0.1f)
    val risePx = with(LocalDensity.current) { 3.dp.toPx() }
    val wordDur = WuDurations.ThrottleWord.toFloat()

    // Stamp newly arrived words and tick a single frame clock until the final word settles.
    LaunchedEffect(animatedWords.size, scaleFactor) {
        val now = clockMs
        val lastEnd = arrivalMs.values.maxOrNull() ?: (now - staggerMs.toFloat())
        var cursor = maxOf(now, lastEnd + staggerMs.toFloat())
        for (i in animatedWords.indices) {
            if (!arrivalMs.containsKey(i)) {
                arrivalMs[i] = if (i == 0 && arrivalMs.isEmpty()) now else cursor
                cursor += staggerMs.toFloat()
            }
        }
        val targetEnd = (arrivalMs[animatedWords.lastIndex] ?: now) + wordDur + 24f
        if (clockMs >= targetEnd) return@LaunchedEffect
        var prevNanos = 0L
        while (true) {
            val done = withFrameNanos { nanos ->
                if (prevNanos == 0L) {
                    prevNanos = nanos
                    false
                } else {
                    val dtRealMs = (nanos - prevNanos) / 1_000_000.0
                    prevNanos = nanos
                    // Sub-millisecond Float delta keeps timing exact at 60/90/120/144 Hz and 0.25x.
                    clockMs += (dtRealMs / scaleFactor).toFloat().coerceIn(0f, 100f)
                    val endAt = (arrivalMs[animatedWords.lastIndex] ?: 0f) + wordDur + 24f
                    clockMs >= endAt
                }
            }
            if (done) break
        }
    }

    Column(modifier) {
        FlowRow(
            horizontalArrangement = Arrangement.Start,
            modifier = Modifier.fillMaxWidth(),
        ) {
            animatedWords.forEachIndexed { index, word ->
                val startAt = arrivalMs[index] ?: Float.MAX_VALUE
                Text(
                    text = if (index < animatedWords.lastIndex || overflowText != null) "$word " else word,
                    style = style,
                    modifier = Modifier.graphicsLayer {
                        val raw = ((clockMs - startAt) / wordDur).coerceIn(0f, 1f)
                        val e = WuEasing.Default.transform(raw)
                        alpha = e
                        translationY = risePx * (1f - e)
                    },
                )
            }
        }
        if (overflowText != null) {
            Text(overflowText, style = style, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun PermissionCard(
    toolName: String,
    description: String,
    palette: Palette,
    reducedMotion: Boolean,
    onPermission: (String) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .wuRise(reducedMotion = reducedMotion, key = "perm-$toolName-$description")
            .background(palette.paper2, RoundedCornerShape(4.dp))
            .padding(14.dp),
    ) {
        Text(toolName, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 13.5.sp, color = palette.ink))
        Text(
            description,
            style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, color = palette.ink3),
            modifier = Modifier.padding(vertical = 4.dp),
        )
        Row(Modifier.padding(top = 8.dp)) {
            Text(
                "deny",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.ink2, textDecoration = TextDecoration.Underline),
                modifier = Modifier
                    .padding(end = 16.dp)
                    .wuClickable(reducedMotion = reducedMotion, onClick = { onPermission("deny") })
                    .semantics { role = Role.Button; contentDescription = "Deny $toolName" },
            )
            Text(
                "allow",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.seal, textDecoration = TextDecoration.Underline),
                modifier = Modifier
                    .wuClickable(reducedMotion = reducedMotion, onClick = { onPermission("allow") })
                    .semantics { role = Role.Button; contentDescription = "Allow $toolName" },
            )
        }
    }
}

@Composable
private fun QueuedRow(
    ordinal: Int,
    text: String,
    tag: String,
    palette: Palette,
    reducedMotion: Boolean,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .wuRise(reducedMotion = reducedMotion, key = "queued-$ordinal-$text"),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            "$ordinal›",
            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.seal),
            modifier = Modifier.padding(top = 2.dp, end = 8.dp),
        )
        Text(
            text,
            style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, lineHeight = 24.sp, color = palette.ink),
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            tag,
            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.blue),
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
private fun ComposerWithStop(
    palette: Palette,
    value: String,
    placeholder: String,
    sessionKey: String,
    isWorking: Boolean,
    stampTrigger: Int,
    reducedMotion: Boolean,
    onValueChange: (String) -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
) {
    var local by remember(sessionKey) { mutableStateOf(value) }
    var lastEmitted by remember(sessionKey) { mutableStateOf(value) }
    LaunchedEffect(value) {
        if (value != lastEmitted) {
            local = value
            lastEmitted = value
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
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
        AnimatedVisibility(
            visible = isWorking,
            enter = fadeIn(tween(if (reducedMotion) WuDurations.ReducedFade else 250, easing = WuEasing.Default)),
            exit = fadeOut(tween(if (reducedMotion) WuDurations.ReducedFade else 250, easing = WuEasing.Default)),
        ) {
            Box(
                Modifier
                    .padding(start = 6.dp)
                    .height(38.dp)
                    .wuClickable(reducedMotion = reducedMotion, onClick = onStop)
                    .padding(horizontal = 4.dp)
                    .semantics { role = Role.Button; contentDescription = "Stop" },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "stop",
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink3),
                    modifier = Modifier.drawBehind {
                        val y = size.height + 3.dp.toPx()
                        drawLine(
                            color = palette.line,
                            start = Offset(0f, y),
                            end = Offset(size.width, y),
                            strokeWidth = 1.dp.toPx(),
                        )
                    },
                )
            }
        }
        Spacer(Modifier.width(10.dp))
        SealButton(
            sizeDp = 48,
            backgroundColor = palette.seal,
            strokeColor = palette.onSeal,
            label = "Send",
            stampTrigger = stampTrigger,
            reducedMotion = reducedMotion,
            onClick = { onSend(local) },
        )
    }
}
