package dev.ziran.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppState
import dev.ziran.android.data.LiveBlock
import dev.ziran.android.data.LiveTool
import dev.ziran.android.design.MotionMath
import dev.ziran.android.design.Palette
import dev.ziran.android.design.Seal
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.protocol.AgentKind
import dev.ziran.android.protocol.HistoryMessageView

/**
 * Thread screen: Main.dc.html + Live.dc.html combined. Header 340 dp peaks,
 * title, prompt 1›, thinking fold, numbered tool steps with ink drop, running
 * hairline and red ring, diff/output panels, word-by-word answer, composer
 * with queued messages (soft interrupt), Stop, inline permission card.
 *
 * Data comes from AppState (snapshot history + live blocks). No second
 * canonical transcript is kept here; the reducer owns the live view.
 */
@Composable
fun ThreadScreen(
    palette: Palette,
    state: AppState,
    sceneKey: String = "peaks",
    listState: LazyListState = rememberScrollState().let { LazyListState() },
    onBack: () -> Unit = {},
    onModel: () -> Unit = {},
    onScenes: () -> Unit = {},
    onTextChange: (String) -> Unit = {},
    onSend: (String) -> Unit = {},
    onStop: () -> Unit = {},
    onPermission: (String) -> Unit = {},
    onQueue: (String) -> Unit = {},
    imePadding: Modifier = Modifier,
    reducedMotion: Boolean = false,
) {
    val snapshot = state.snapshot
    val title = snapshot?.session?.title ?: "Thread"
    val agent = snapshot?.session?.agentLabel ?: "fox"
    val statusLine = statusLineFor(state)
    Box(Modifier.fillMaxSize().background(palette.paper).then(imePadding)) {
        ScreenChrome(sceneKey, palette, headerHeightDp = 340, reducedMotion = reducedMotion)
        // Back chevron
        Box(
            Modifier.align(Alignment.TopStart).padding(start = 8.dp, top = 50.dp).size(44.dp)
                .semantics { role = Role.Button; contentDescription = "Threads" }.clickable { onBack() },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.size(22.dp)) {
                val p = androidx.compose.ui.graphics.Path()
                p.moveTo(size.width * 0.15f, size.height * 0.35f)
                p.lineTo(size.width * 0.85f, size.height * 0.35f)
                p.moveTo(size.width * 0.15f, size.height * 0.55f)
                p.lineTo(size.width * 0.55f, size.height * 0.55f)
                p.moveTo(size.width * 0.15f, size.height * 0.75f)
                p.lineTo(size.width * 0.7f, size.height * 0.75f)
                drawPath(p, palette.ink, style = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round))
            }
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = 22.dp).padding(top = 292.dp, bottom = 120.dp),
            state = listState,
        ) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Medium, color = palette.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("$agent · $statusLine", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(top = 2.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Seal(kind = AgentKind.fromLabel(agent), sizeDp = 28, backgroundColor = palette.seal, strokeColor = palette.onSeal)
                }
                Spacer(Modifier.height(12.dp))
            }
            // History messages from the authoritative snapshot.
            if (snapshot != null) {
                items(
                    snapshot.messages,
                    key = { message -> "history-${message.index}-${message.role}" },
                ) { message ->
                    HistoryRow(message, palette)
                }
            }
            // Prompt from the live composer state (pending or last user turn).
            if (state.pending != null) {
                item { PromptRow(state.pending.text, palette) }
            }
            // Thinking fold.
            if (state.live.reasoning.isNotEmpty()) {
                item { ThinkingFold(state.live.reasoning, palette) }
            }
            // Tool steps.
            items(state.live.tools, key = { tool -> "tool-${tool.callId}" }) { tool ->
                ToolRow(tool, palette, reducedMotion)
            }
            // Assistant answer, word by word.
            if (state.live.assistants.isNotEmpty()) {
                item { AnswerBlock(state.live.assistants, palette, reducedMotion) }
            }
            // Permission card inline.
            if (state.live.permission != null) {
                item {
                    PermissionCard(state.live.permission.toolName, state.live.permission.description, state.live.permission.requestId, palette, onPermission)
                }
            }
            // Queued messages (sent while working = soft interrupt).
            itemsIndexed(state.queuedMessages, key = { index, _ -> "queued-$index" }) { _, queued ->
                QueuedRow(queued, palette)
            }
        }
        // Composer + footer.
        Column(
            Modifier.align(Alignment.BottomCenter).padding(horizontal = 20.dp).padding(bottom = 22.dp).fillMaxWidth(),
        ) {
            ComposerWithStop(
                palette = palette,
                value = state.composerText,
                placeholder = "write to $agent…",
                isWorking = state.live.turnId != null || state.live.status in setOf("dispatching", "thinking", "working", "writing") || state.live.permission != null,
                onValueChange = onTextChange,
                onSend = onSend,
                onStop = onStop,
                sessionKey = state.activeSessionId ?: "thread",
            )
            Row(Modifier.padding(top = 2.dp)) {
                Text(state.serverName ?: "studio-vps", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp))
                Text("·", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(vertical = 6.dp))
                val modelLabel = listOfNotNull(state.runtime?.model, state.runtime?.reasoningEffort).joinToString(" · ").ifEmpty { "model" }
                Text(modelLabel, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3, textDecoration = TextDecoration.Underline), modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp).semantics { role = Role.Button; contentDescription = "Model $modelLabel" }.clickable { onModel() })
            }
        }
    }
}

private fun statusLineFor(state: AppState): String = when {
    state.live.permission != null -> "waiting for permission"
    state.live.turnId != null -> "working"
    state.live.status == "done" -> "finished"
    state.live.status == "stopped" -> "stopped"
    state.reconciling -> "reconciling"
    state.savedOnPhone -> "saved on this phone"
    else -> "idle"
}

@Composable
private fun HistoryRow(message: HistoryMessageView, palette: Palette) {
    if (message.role == "user") {
        PromptRow(message.content, palette)
    } else if (message.role == "assistant") {
        Text(message.content, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.5.sp, lineHeight = 24.sp, fontStyle = FontStyle.Italic, color = palette.ink2), modifier = Modifier.padding(vertical = 6.dp))
    } else if (message.toolName != null) {
        Text("${message.toolName} ${message.content.take(80)}", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(vertical = 4.dp))
    }
}

@Composable
private fun PromptRow(text: String, palette: Palette) {
    Row(Modifier.padding(vertical = 8.dp)) {
        Text("1›", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.seal), modifier = Modifier.padding(top = 1.dp, end = 8.dp))
        Text(text, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, lineHeight = 24.sp, color = palette.ink))
    }
}

@Composable
private fun ThinkingFold(reasoning: List<LiveBlock>, palette: Palette) {
    var expanded by remember { mutableStateOf(true) }
    val total = reasoning.sumOf { it.text.length }
    val allDone = reasoning.all { it.done }
    if (!allDone || expanded) {
        val words = reasoning.flatMap { it.text.split(" ") }.take(40)
        Row(Modifier.padding(vertical = 6.dp)) {
            Box(Modifier.width(2.dp).height(46.dp).offset(y = 6.dp).background(palette.ink3.copy(alpha = 0.5f)))
            Text(
                reasoning.joinToString("") { it.text },
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, lineHeight = 24.sp, fontStyle = FontStyle.Italic, color = palette.ink2),
                modifier = Modifier.padding(start = 10.dp),
            )
        }
    } else {
        Text("thought for 4 s", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, fontStyle = FontStyle.Italic, color = palette.ink3), modifier = Modifier.padding(vertical = 6.dp).semantics { role = Role.Button; contentDescription = "thought for 4 seconds" }.clickable { expanded = true })
    }
}

@Composable
private fun ToolRow(tool: LiveTool, palette: Palette, reducedMotion: Boolean) {
    var expanded by remember(tool.callId) { mutableStateOf(tool.status == "running") }

    // Ink drop, then the intent slides in: 550 ms in, one shared ease.
    var appeared by remember(tool.callId) { mutableStateOf(reducedMotion) }
    LaunchedEffect(tool.callId) {
        if (reducedMotion) { appeared = true; return@LaunchedEffect }
        kotlinx.coroutines.delay(16)
        appeared = true
    }
    val entrance by animateFloatAsState(
        targetValue = if (appeared) 1f else 0f,
        animationSpec = tween(MotionMath.ToolInMs, easing = WuEasing.Default),
        label = "tool-in-${tool.callId}",
    )

    // The drop becomes a red ring as the step finishes: 900 ms draw.
    val ring by animateFloatAsState(
        targetValue = if (tool.status == "done" || tool.status == "failed") 1f else 0f,
        animationSpec = tween(MotionMath.RingDrawMs, easing = WuEasing.Default),
        label = "ring-${tool.callId}",
    )

    val number = tool.seq.toString().padStart(2, '0')
    Row(
        Modifier
            .padding(vertical = 4.dp)
            .graphicsLayer {
                alpha = entrance
                translationX = (1f - entrance) * -12f
                translationY = (1f - entrance) * 6f
            },
    ) {
        Text(number, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.width(24.dp))
        Column(Modifier.weight(1f)) {
            Row {
                Text(tool.name, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink3), modifier = Modifier.padding(end = 4.dp))
                Text(tool.input.take(60), style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, lineHeight = 25.sp, color = palette.ink2), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (tool.status == "running") {
                Box(Modifier.fillMaxWidth().height(1.5.dp).padding(top = 2.dp, start = 26.dp).background(palette.ink3.copy(alpha = 0.5f)))
            }
            // Diff and output panels unfold under their row: 750 ms height ease.
            AnimatedVisibility(
                visible = expanded && (tool.output.isNotEmpty() || tool.error != null),
                enter = expandVertically(
                    animationSpec = tween(MotionMath.PanelMs, easing = WuEasing.Default),
                    expandFrom = Alignment.Top,
                ) + fadeIn(tween(MotionMath.PanelMs, easing = WuEasing.Default)),
            ) {
                Column {
                    Text(tool.output.take(400), style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(top = 4.dp))
                    if (tool.error != null) Text(tool.error, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.seal))
                }
            }
        }
        // Ink drop -> running hairline -> red ring drawn as the step finishes.
        when (tool.status) {
            "done" -> Canvas(Modifier.size(13.dp)) {
                drawArc(palette.seal, startAngle = -90f, sweepAngle = 360f * ring, useCenter = false, style = Stroke(1.6.dp.toPx()))
            }
            "failed" -> Canvas(Modifier.size(13.dp)) {
                drawArc(palette.seal, startAngle = -90f, sweepAngle = 360f * ring, useCenter = false, style = Stroke(1.6.dp.toPx()))
            }
            "running" -> Text("⠋", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 13.sp, color = palette.blue))
            else -> Box(Modifier.size(8.dp).background(palette.ink, androidx.compose.foundation.shape.CircleShape))
        }
    }
}

@Composable
private fun AnswerBlock(assistants: List<LiveBlock>, palette: Palette, reducedMotion: Boolean) {
    assistants.forEach { block -> AnswerWords(block, palette, reducedMotion) }
}

/**
 * The answer settles word by word, 65 ms apart. The full text is present from
 * the first frame: only the ink fades in, so a long answer is never hidden and
 * screen readers always read the whole message.
 */
@Composable
private fun AnswerWords(block: LiveBlock, palette: Palette, reducedMotion: Boolean) {
    val words = remember(block.text) { block.text.split(' ') }
    val cap = remember(words.size) { minOf(words.size, 80) }
    var revealed by remember(block.id) { mutableStateOf(0) }
    LaunchedEffect(block.text, reducedMotion) {
        if (reducedMotion) {
            revealed = words.size
            return@LaunchedEffect
        }
        while (revealed < cap) {
            kotlinx.coroutines.delay(MotionMath.WordStaggerMs.toLong())
            revealed += 1
        }
    }
    val styled = androidx.compose.ui.text.buildAnnotatedString {
        words.forEachIndexed { index, word ->
            val alpha = when {
                reducedMotion || index < revealed || revealed >= cap -> 1f
                index == revealed -> 0.5f
                else -> 0.15f
            }
            withStyle(SpanStyle(color = palette.ink2.copy(alpha = alpha))) { append(word) }
            if (index != words.lastIndex) append(" ")
        }
    }
    Text(
        styled,
        style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.5.sp, lineHeight = 24.sp, fontStyle = FontStyle.Italic, color = palette.ink2),
        modifier = Modifier.padding(vertical = 4.dp),
    )
}

@Composable
private fun PermissionCard(toolName: String, description: String, requestId: String, palette: Palette, onPermission: (String) -> Unit) {
    Column(Modifier.padding(vertical = 8.dp).background(palette.paper2, androidx.compose.foundation.shape.RoundedCornerShape(4.dp)).padding(14.dp)) {
        Text(toolName, style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 13.5.sp, color = palette.ink))
        Text(description, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.sp, color = palette.ink3), modifier = Modifier.padding(vertical = 4.dp))
        Row {
            Text("deny", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.ink2, textDecoration = TextDecoration.Underline), modifier = Modifier.padding(end = 16.dp, top = 8.dp).semantics { role = Role.Button; contentDescription = "Deny $toolName" }.clickable { onPermission("deny") })
            Text("allow", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.seal, textDecoration = TextDecoration.Underline), modifier = Modifier.padding(top = 8.dp).semantics { role = Role.Button; contentDescription = "Allow $toolName" }.clickable { onPermission("allow") })
        }
    }
}

@Composable
private fun QueuedRow(text: String, palette: Palette) {
    Row(Modifier.padding(vertical = 4.dp)) {
        Text("queued", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3), modifier = Modifier.padding(end = 8.dp))
        Text(text, style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.ink2))
    }
}

@Composable
private fun ComposerWithStop(
    palette: Palette,
    value: String,
    placeholder: String,
    sessionKey: String,
    isWorking: Boolean,
    onValueChange: (String) -> Unit,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
) {
    // The field owns its text while the user types: driving it from a StateFlow
    // drops fast IME characters. The controller still receives each change for
    // the per-session draft, and send carries the exact visible text.
    var local by remember(sessionKey) { mutableStateOf(value) }
    // Follow external changes (restored draft, rejected text) without fighting
    // fast IME input: value tracks local once the controller catches up.
    LaunchedEffect(value) { if (value != local) local = value }
    Row(verticalAlignment = Alignment.CenterVertically) {
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
                drawPath(p, palette.ink.copy(alpha = 0.55f), style = Stroke(2.4.dp.toPx(), cap = StrokeCap.Round))
            }
        }
        // Soft interrupt: sending while working queues the message. Stop is explicit.
        if (isWorking) {
            Text("stop", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, color = palette.ink3, textDecoration = TextDecoration.Underline), modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp).semantics { role = Role.Button; contentDescription = "Stop" }.clickable { onStop() })
        }
        Spacer(Modifier.width(10.dp))
        dev.ziran.android.design.SealButton(
            sizeDp = 48,
            backgroundColor = palette.seal,
            strokeColor = palette.onSeal,
            onClick = { onSend(local) },
        )
    }
}
