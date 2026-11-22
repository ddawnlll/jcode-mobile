package dev.ziran.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
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
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppState
import dev.ziran.android.design.FlockScene
import dev.ziran.android.design.Painting
import dev.ziran.android.design.Palette
import dev.ziran.android.design.Seal
import dev.ziran.android.design.SealButton
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import dev.ziran.android.design.wuRise
import dev.ziran.android.design.wuStamp
import dev.ziran.android.protocol.AgentKind
import dev.ziran.android.protocol.PlanStepStatus
import dev.ziran.android.protocol.PlanStepView
import dev.ziran.android.protocol.PlanView
import kotlinx.coroutines.delay

/**
 * Plan screen: Plan.dc.html / Plan-Night.dc.html.
 * - 300 dp flock painting header with Ken Burns drift and paper fade.
 * - Title "The plan", thread + agent subtitle, coordinator trigram seal.
 * - Mono summary + segmented progress bar (done = indigo, now = flowing teal, todo = line).
 * - Step list on a vertical thread line; rows update in place and unfold on tap (750 ms).
 * - Bottom composer (no Stop) sending to the swarm's coordinator session.
 */
@Composable
fun PlanScreen(
    palette: Palette,
    state: AppState,
    coordinatorName: String,
    modifier: Modifier = Modifier,
    onBack: () -> Unit = {},
    onSend: (String) -> Unit = {},
    reducedMotion: Boolean = false,
) {
    val plan: PlanView? = state.plan
    val threadTitle = plan?.title ?: state.snapshot?.session?.title ?: "Thread"
    val agentNames = remember(state.agents, plan) {
        val fromAgents = state.agents?.mapNotNull { it.label?.trim()?.takeIf { l -> l.isNotEmpty() } } ?: emptyList()
        val fromSteps = plan?.steps?.mapNotNull { it.agent?.trim()?.takeIf { a -> a.isNotEmpty() } } ?: emptyList()
        (fromAgents + fromSteps).distinct()
    }
    val subtitle = remember(threadTitle, agentNames, coordinatorName) {
        val others = agentNames.filter { !it.equals(coordinatorName, ignoreCase = true) }
        if (others.isEmpty()) {
            "$threadTitle · $coordinatorName"
        } else {
            val joined = if (others.size == 1) others.first() else others.dropLast(1).joinToString(", ") + " and " + others.last()
            "$threadTitle · $coordinatorName with $joined"
        }
    }

    var composerText by rememberSaveable(state.activeSessionId) { mutableStateOf("") }
    var sendStamp by remember { mutableIntStateOf(0) }
    val expandedSteps = remember(state.activeSessionId) { mutableStateMapOf<String, Boolean>() }

    // Live 1s clock for running steps (uses tabular figures so rows never jump).
    val hasRunning = plan?.steps?.any { it.status == PlanStepStatus.Now } == true
    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(hasRunning) {
        while (hasRunning) {
            nowMs = System.currentTimeMillis()
            delay(1000L)
        }
    }

    Box(modifier.fillMaxSize().background(palette.paper)) {
        // 300 dp flock painting header.
        Box(Modifier.fillMaxSize()) {
            Painting(
                scene = FlockScene,
                palette = palette,
                modifier = Modifier.align(Alignment.TopCenter),
                heightDp = 300,
                reducedMotion = reducedMotion,
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
        ) {
            Spacer(Modifier.height(244.dp))

            // Title + subtitle + coordinator seal.
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 22.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "The plan",
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
                        subtitle,
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        modifier = Modifier
                            .padding(top = 2.dp)
                            .wuRise(delayMs = 80, reducedMotion = reducedMotion, key = "plan-sub"),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Seal(
                    kind = AgentKind.fromLabel(coordinatorName),
                    sizeDp = 28,
                    backgroundColor = palette.seal,
                    strokeColor = palette.onSeal,
                    modifier = Modifier.wuStamp(initialDelayMs = 300, reducedMotion = reducedMotion),
                )
            }

            Spacer(Modifier.height(14.dp))

            if (plan == null || plan.steps.isEmpty()) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = 22.dp, vertical = 24.dp),
                ) {
                    Text(
                        "No plan yet. The agent will make one when the work has steps.",
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 16.5.sp,
                            lineHeight = 24.sp,
                            fontStyle = FontStyle.Italic,
                            color = palette.ink3,
                        ),
                    )
                }
            } else {
                val steps = plan.steps
                val doneCount = steps.count { it.status == PlanStepStatus.Done }
                val nowCount = steps.count { it.status == PlanStepStatus.Now }
                val waitCount = steps.size - doneCount - nowCount

                // Summary line + segmented progress bar.
                Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            "$doneCount of ${steps.size} done",
                            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        )
                        Text(
                            "$nowCount at work · $waitCount waiting",
                            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .semantics {
                                contentDescription = "$doneCount of ${steps.size} steps done, $nowCount at work, $waitCount waiting"
                            },
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        steps.forEach { step ->
                            PlanSegment(
                                status = step.status,
                                palette = palette,
                                reducedMotion = reducedMotion,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))

                // Step list with continuous vertical thread line.
                LazyColumn(
                    contentPadding = PaddingValues(bottom = 16.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .padding(horizontal = 22.dp),
                ) {
                    itemsIndexed(steps, key = { _, s -> s.id }) { index, step ->
                        val isFirst = index == 0
                        val isLast = index == steps.lastIndex
                        val expanded = expandedSteps[step.id] == true
                        PlanStepRow(
                            step = step,
                            fallbackAgent = coordinatorName,
                            expanded = expanded,
                            isFirst = isFirst,
                            isLast = isLast,
                            nowMs = nowMs,
                            palette = palette,
                            reducedMotion = reducedMotion,
                            onToggle = { expandedSteps[step.id] = !expanded },
                        )
                    }
                }
            }

            // Bottom composer (no Stop) sending to coordinator session.
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 16.dp, top = 4.dp, bottom = 10.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .weight(1f)
                            .height(50.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) {
                        if (composerText.isEmpty()) {
                            Text(
                                "tell $coordinatorName what to change…",
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
                        BasicTextField(
                            value = composerText,
                            onValueChange = { composerText = it },
                            textStyle = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 17.sp,
                                color = palette.ink,
                            ),
                            cursorBrush = SolidColor(palette.ink),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            keyboardActions = KeyboardActions(
                                onSend = {
                                    val trimmed = composerText.trim()
                                    if (trimmed.isNotEmpty()) {
                                        sendStamp += 1
                                        onSend(trimmed)
                                        composerText = ""
                                    }
                                },
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        // Ink underline matching Plan.dc.html.
                        Canvas(
                            Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth()
                                .height(6.dp)
                                .padding(bottom = 2.dp),
                        ) {
                            val w = size.width
                            val h = size.height
                            val p = Path().apply {
                                moveTo(0f, h * 0.65f)
                                cubicTo(w * 0.2f, h * 0.25f, w * 0.45f, h * 0.8f, w * 0.7f, h * 0.4f)
                                cubicTo(w * 0.85f, h * 0.25f, w * 0.95f, h * 0.55f, w, h * 0.4f)
                            }
                            drawPath(
                                p,
                                color = palette.ink.copy(alpha = 0.55f),
                                style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round),
                            )
                        }
                    }
                    Spacer(Modifier.width(10.dp))
                    SealButton(
                        sizeDp = 48,
                        backgroundColor = palette.seal,
                        strokeColor = palette.onSeal,
                        label = "Send",
                        stampTrigger = sendStamp,
                        reducedMotion = reducedMotion,
                        onClick = {
                            val trimmed = composerText.trim()
                            if (trimmed.isNotEmpty()) {
                                sendStamp += 1
                                onSend(trimmed)
                                composerText = ""
                            }
                        },
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "the agents share this plan · it changes as they work",
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.ink3),
                    modifier = Modifier.padding(start = 2.dp),
                )
            }
        }

        // Top-left back chevron.
        BackChevron(palette = palette, onBack = onBack, label = "Back to the thread", reducedMotion = reducedMotion)
    }
}

@Composable
private fun PlanSegment(
    status: PlanStepStatus,
    palette: Palette,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val dur = if (reducedMotion) WuDurations.ReducedFade else 700
    val bg by animateColorAsState(
        targetValue = if (status == PlanStepStatus.Done) palette.seal else palette.line,
        animationSpec = tween(dur, easing = WuEasing.Default),
        label = "plan-seg-bg",
    )
    val flowProgress = if (status == PlanStepStatus.Now && !reducedMotion) {
        rememberInfiniteTransition(label = "plan-seg-flow").animateFloat(
            initialValue = -0.6f,
            targetValue = 1.6f,
            animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Restart),
            label = "plan-seg-flow-x",
        ).value
    } else null

    Box(
        modifier
            .height(5.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(bg),
    ) {
        if (status == PlanStepStatus.Now) {
            val blue = palette.blue
            Canvas(Modifier.fillMaxSize()) {
                val x = (flowProgress ?: 0.2f) * size.width
                val bandW = size.width * 0.6f
                drawRect(
                    brush = Brush.horizontalGradient(
                        0f to Color.Transparent,
                        0.5f to blue,
                        1f to Color.Transparent,
                        startX = x,
                        endX = x + bandW,
                    ),
                )
            }
        }
    }
}

@Composable
private fun PlanStepRow(
    step: PlanStepView,
    fallbackAgent: String,
    expanded: Boolean,
    isFirst: Boolean,
    isLast: Boolean,
    nowMs: Long,
    palette: Palette,
    reducedMotion: Boolean,
    onToggle: () -> Unit,
) {
    val dur = if (reducedMotion) WuDurations.ReducedFade else 700
    val who = step.agent ?: fallbackAgent

    val dotFill by animateColorAsState(
        targetValue = if (step.status == PlanStepStatus.Done) palette.seal else palette.paper,
        animationSpec = tween(dur, easing = WuEasing.Default),
        label = "plan-dot-fill",
    )
    val dotBorder by animateColorAsState(
        targetValue = when (step.status) {
            PlanStepStatus.Done -> palette.seal
            PlanStepStatus.Now -> palette.blue
            PlanStepStatus.Todo -> palette.ink3
        },
        animationSpec = tween(dur, easing = WuEasing.Default),
        label = "plan-dot-border",
    )
    val titleColor by animateColorAsState(
        targetValue = if (step.status == PlanStepStatus.Todo) palette.ink3 else palette.ink,
        animationSpec = tween(dur, easing = WuEasing.Default),
        label = "plan-title-color",
    )
    val chevronAngle by animateFloatAsState(
        targetValue = if (expanded) 90f else 0f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 450, easing = WuEasing.Default),
        label = "plan-chev",
    )
    val pulseAlpha = if (step.status == PlanStepStatus.Now && !reducedMotion) {
        rememberInfiniteTransition(label = "plan-dot-pulse").animateFloat(
            initialValue = 0.4f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(1300, easing = WuEasing.Default), RepeatMode.Reverse),
            label = "plan-dot-pulse-a",
        ).value
    } else 1f

    val metaText = when (step.status) {
        PlanStepStatus.Done -> "$who · ${step.touched ?: "touched"}"
        PlanStepStatus.Now -> {
            val secs = step.elapsedSecs ?: step.startedAtMs?.let { ((nowMs - it) / 1000L).coerceAtLeast(0L) } ?: 0L
            val mins = secs / 60
            val rem = secs % 60
            "$who · working · $mins:${rem.toString().padStart(2, '0')}"
        }
        PlanStepStatus.Todo -> "$who · waits for ${step.waitsFor ?: "the rest"}"
    }

    val lineColor = palette.ink3.copy(alpha = 0.32f)

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
                .defaultMinSize(minHeight = 48.dp)
                .wuClickable(reducedMotion = reducedMotion, onClick = onToggle)
                .semantics {
                    role = Role.Button
                    contentDescription = "${step.title}, $metaText"
                },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Left 18 dp column: vertical thread line + 11 dp status dot.
            Box(
                Modifier
                    .width(18.dp)
                    .fillMaxHeight()
                    .drawBehind {
                        val cx = size.width / 2f
                        val topY = if (isFirst) size.height / 2f else 0f
                        val botY = if (isLast && !expanded) size.height / 2f else size.height
                        if (botY > topY) {
                            drawLine(
                                color = lineColor,
                                start = Offset(cx, topY),
                                end = Offset(cx, botY),
                                strokeWidth = 1.dp.toPx(),
                            )
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier
                        .size(11.dp)
                        .graphicsLayer { alpha = if (step.status == PlanStepStatus.Now) pulseAlpha else 1f }
                        .background(dotFill, CircleShape)
                        .border(1.4.dp, dotBorder, CircleShape),
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                Text(
                    step.title,
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 16.5.sp,
                        lineHeight = 21.sp,
                        fontStyle = if (step.status == PlanStepStatus.Now) FontStyle.Italic else FontStyle.Normal,
                        color = titleColor,
                    ),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    metaText,
                    style = TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 11.sp,
                        lineHeight = 16.sp,
                        fontFeatureSettings = "tnum",
                        color = if (step.status == PlanStepStatus.Now) palette.blue else palette.ink3,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Spacer(Modifier.width(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Seal(
                    kind = AgentKind.fromLabel(who),
                    sizeDp = 20,
                    backgroundColor = palette.seal,
                    strokeColor = palette.onSeal,
                )
                Text(
                    "›",
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.ink3),
                    modifier = Modifier.graphicsLayer { rotationZ = chevronAngle },
                )
            }
        }

        if (step.status == PlanStepStatus.Now) {
            PlanFlowHairline(palette = palette, reducedMotion = reducedMotion, modifier = Modifier.padding(start = 30.dp, bottom = 4.dp))
        }

        AnimatedVisibility(
            visible = expanded && !step.detail.isNullOrBlank(),
            enter = expandVertically(
                tween(if (reducedMotion) WuDurations.ReducedFade else 750, easing = WuEasing.Default),
            ) + fadeIn(tween(if (reducedMotion) WuDurations.ReducedFade else 500, easing = WuEasing.Default)),
            exit = shrinkVertically(
                tween(if (reducedMotion) WuDurations.ReducedFade else 750, easing = WuEasing.Default),
            ) + fadeOut(tween(if (reducedMotion) WuDurations.ReducedFade else 400, easing = WuEasing.Default)),
        ) {
            Text(
                step.detail.orEmpty(),
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 14.5.sp,
                    lineHeight = 21.sp,
                    fontStyle = FontStyle.Italic,
                    color = palette.ink3,
                ),
                modifier = Modifier.padding(start = 30.dp, bottom = 10.dp),
            )
        }
    }
}

@Composable
private fun PlanFlowHairline(
    palette: Palette,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val progress = if (!reducedMotion) {
        rememberInfiniteTransition(label = "plan-row-flow").animateFloat(
            initialValue = -0.6f,
            targetValue = 1.6f,
            animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Restart),
            label = "plan-row-flow-x",
        ).value
    } else 0.3f

    val blue = palette.blue
    Canvas(modifier.fillMaxWidth().height(1.5.dp)) {
        val x = progress * size.width
        val bandW = size.width * 0.45f
        drawRect(
            brush = Brush.horizontalGradient(
                0f to Color.Transparent,
                0.5f to blue,
                1f to Color.Transparent,
                startX = x,
                endX = x + bandW,
            ),
        )
    }
}
