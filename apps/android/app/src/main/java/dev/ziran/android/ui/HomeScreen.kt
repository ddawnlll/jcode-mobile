package dev.ziran.android.ui

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppState
import dev.ziran.android.design.BrailleSpinnerText
import dev.ziran.android.design.Palette
import dev.ziran.android.design.Seal
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import dev.ziran.android.protocol.AgentKind
import dev.ziran.android.protocol.SessionSummary
import kotlinx.coroutines.delay

/**
 * Home tab (`Home.dc.html` / `Home-Night.dc.html`):
 * - 232 dp misty peaks header with server name and live status.
 * - "waiting for you" permission cards (Allow once / Deny inline) and waiting threads.
 * - "at work" threads with ticking elapsed time and foldable nested sub-agents.
 * - "recent" finished/resting threads.
 * - Floating new-thread seal above the bottom nav.
 */
@Composable
fun HomeScreen(
    palette: Palette,
    state: AppState,
    onOpenThread: (String) -> Unit,
    onPermission: (String) -> Unit,
    onNewThread: () -> Unit,
    reducedMotion: Boolean = false,
) {
    val tree = remember(state.sessions, state.agents, state.activeSessionId) {
        buildThreadTree(
            sessions = state.sessions,
            query = "",
            sortMode = "recent",
            snapshotAgents = state.agents,
            activeParentId = state.activeSessionId,
        )
    }
    val working = remember(tree) { tree.filter { sessionStatusRank(it.session.swarmStatus ?: it.session.status) == 1 } }
    val waitingThreads = remember(tree) { tree.filter { sessionStatusRank(it.session.swarmStatus ?: it.session.status) == 0 } }
    val recent = remember(tree) { tree.filter { sessionStatusRank(it.session.swarmStatus ?: it.session.status) >= 2 }.take(8) }

    val expandedParents = remember { mutableStateMapOf<String, Boolean>() }

    val waitCount = waitingThreads.size + (if (state.live.permission != null) 1 else 0)
    val serverOnline = state.connection == "connected"
    val statusText = buildString {
        if (!serverOnline) {
            append("adapter offline")
        } else if (!state.jcodeConnected) {
            append("jcode not running")
        } else {
            append("jcode connected")
        }
        append(" · ${working.size} at work · ")
        append(if (waitCount == 0) "none waiting" else "$waitCount waiting")
    }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome("misty_peaks", palette, headerHeightDp = 232, reducedMotion = reducedMotion)

        val safeTop = rememberSafeTopInsetDp()
        Column(
            Modifier
                .fillMaxSize()
                .safeTopAndHorizontalPadding(),
        ) {
            Spacer(Modifier.height(contentTopSpacerDp(168, safeTop, minClearanceDp = 16).dp))

            Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp)) {
                Text(
                    state.serverName ?: "studio-vps",
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 30.sp,
                        lineHeight = 36.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.ink,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(
                    Modifier.padding(top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .background(if (serverOnline && state.jcodeConnected) palette.green else palette.ink3, CircleShape),
                    )
                    Text(
                        statusText,
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            LazyColumn(
                contentPadding = PaddingValues(start = 22.dp, end = 22.dp, bottom = 148.dp),
                modifier = Modifier.fillMaxWidth().weight(1f),
            ) {
                item(key = "hdr-waiting") {
                    HomeSectionLabel("waiting for you", palette)
                }
                if (state.live.permission != null) {
                    val perm = state.live.permission
                    item(key = "home-perm-${perm.requestId}") {
                        HomePermissionCard(
                            title = state.snapshot?.session?.title ?: perm.toolName,
                            agent = state.snapshot?.session?.agentLabel ?: "crane",
                            command = perm.description,
                            palette = palette,
                            reducedMotion = reducedMotion,
                            onAllow = { onPermission("allow_once") },
                            onDeny = { onPermission("deny") },
                        )
                    }
                }
                items(waitingThreads, key = { "wait-${it.session.sessionId}" }, contentType = { "thread-row" }) { item ->
                    HomeThreadRow(
                        session = item.session,
                        note = "waiting for you",
                        elapsedSinceMs = null,
                        palette = palette,
                        reducedMotion = reducedMotion,
                        onClick = { onOpenThread(item.session.sessionId) },
                        modifier = Modifier.animateItem(),
                    )
                }
                if (state.live.permission == null && waitingThreads.isEmpty()) {
                    item(key = "empty-waiting") {
                        Text(
                            "Nothing waiting for you right now.",
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 15.sp,
                                fontStyle = FontStyle.Italic,
                                color = palette.ink3,
                            ),
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                }

                item(key = "hdr-work") {
                    HomeSectionLabel("at work", palette, topPaddingDp = 16)
                }
                if (working.isEmpty()) {
                    item(key = "empty-work") {
                        Text(
                            "No agents working right now.",
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 15.sp,
                                fontStyle = FontStyle.Italic,
                                color = palette.ink3,
                            ),
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                } else {
                    items(working, key = { "work-${it.session.sessionId}" }, contentType = { "working-row" }) { item ->
                        val isOpen = expandedParents[item.session.sessionId] ?: true
                        Column(Modifier.fillMaxWidth().animateItem()) {
                            HomeThreadRow(
                                session = item.session,
                                note = item.session.swarmStatus ?: "working",
                                elapsedSinceMs = item.session.updatedAtMs ?: 0L,
                                palette = palette,
                                reducedMotion = reducedMotion,
                                onClick = { onOpenThread(item.session.sessionId) },
                            )
                            HomeFlowHairline(palette = palette, reducedMotion = reducedMotion, modifier = Modifier.padding(start = 40.dp, bottom = 4.dp))
                            if (item.subAgents.isNotEmpty()) {
                                SubAgentGroupBlock(
                                    subAgents = item.subAgents,
                                    expanded = isOpen,
                                    palette = palette,
                                    reducedMotion = reducedMotion,
                                    onToggle = { expandedParents[item.session.sessionId] = !isOpen },
                                    onOpenSub = onOpenThread,
                                )
                            }
                        }
                    }
                }

                item(key = "hdr-recent") {
                    HomeSectionLabel("recent", palette, topPaddingDp = 16)
                }
                if (recent.isEmpty()) {
                    item(key = "empty-recent") {
                        Text(
                            "No recent threads yet.",
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 15.sp,
                                fontStyle = FontStyle.Italic,
                                color = palette.ink3,
                            ),
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                } else {
                    items(recent, key = { "recent-${it.session.sessionId}" }, contentType = { "thread-row" }) { item ->
                        val st = item.session.swarmStatus ?: item.session.status
                        val isRest = sessionStatusRank(st) == 3
                        HomeThreadRow(
                            session = item.session,
                            note = if (isRest) "resting" else "finished",
                            elapsedSinceMs = null,
                            palette = palette,
                            reducedMotion = reducedMotion,
                            dimmed = isRest,
                            onClick = { onOpenThread(item.session.sessionId) },
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }

        FloatingNewThreadSeal(
            palette = palette,
            reducedMotion = reducedMotion,
            onClick = onNewThread,
            modifier = Modifier.align(Alignment.BottomEnd),
        )
    }
}

@Composable
private fun HomeSectionLabel(text: String, palette: Palette, topPaddingDp: Int = 8) {
    Text(
        text,
        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
        modifier = Modifier.padding(top = topPaddingDp.dp, bottom = 6.dp),
    )
}

@Composable
private fun HomePermissionCard(
    title: String,
    agent: String,
    command: String,
    palette: Palette,
    reducedMotion: Boolean,
    onAllow: () -> Unit,
    onDeny: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .background(palette.paper2, RoundedCornerShape(12.dp))
            .border(1.dp, palette.line, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Seal(
                kind = AgentKind.fromLabel(agent),
                sizeDp = 22,
                backgroundColor = palette.seal,
                strokeColor = palette.onSeal,
            )
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, lineHeight = 22.sp, color = palette.ink),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "$agent wants to run",
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 13.5.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                )
            }
            Box(Modifier.size(10.dp).background(palette.seal, CircleShape))
        }
        Text(
            command,
            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.5.sp, lineHeight = 17.sp, color = palette.ink),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier
                    .weight(1f)
                    .height(44.dp)
                    .background(palette.seal, RoundedCornerShape(9.dp))
                    .wuClickable(reducedMotion = reducedMotion, onClick = onAllow)
                    .semantics { role = Role.Button; contentDescription = "Allow once" },
                contentAlignment = Alignment.Center,
            ) {
                Text("Allow once", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.onSeal))
            }
            Box(
                Modifier
                    .weight(1f)
                    .height(44.dp)
                    .border(1.dp, palette.line, RoundedCornerShape(9.dp))
                    .wuClickable(reducedMotion = reducedMotion, onClick = onDeny)
                    .semantics { role = Role.Button; contentDescription = "Deny" },
                contentAlignment = Alignment.Center,
            ) {
                Text("Deny", style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.ink2))
            }
        }
    }
}

@Composable
internal fun HomeThreadRow(
    session: SessionSummary,
    note: String,
    elapsedSinceMs: Long? = null,
    palette: Palette,
    reducedMotion: Boolean,
    dimmed: Boolean = false,
    statusRank: Int = sessionStatusRank(session.swarmStatus ?: session.status),
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val alphaFactor = if (dimmed) 0.62f else 1f
    val titleColor = if (dimmed) palette.ink.copy(alpha = alphaFactor) else palette.ink
    val noteColor = if (dimmed) palette.ink3.copy(alpha = alphaFactor) else palette.ink3
    val sealBg = if (dimmed) palette.seal.copy(alpha = alphaFactor) else palette.seal
    val sealFg = if (dimmed) palette.onSeal.copy(alpha = alphaFactor) else palette.onSeal
    Row(
        modifier
            .fillMaxWidth()
            .wuClickable(reducedMotion = reducedMotion, onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Seal(
            kind = session.agentKind,
            sizeDp = 28,
            backgroundColor = sealBg,
            strokeColor = sealFg,
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                session.title ?: "Untitled thread",
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 17.sp, lineHeight = 22.sp, color = titleColor),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    note,
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 13.5.sp, lineHeight = 18.sp, fontStyle = FontStyle.Italic, color = noteColor),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (elapsedSinceMs != null) {
                    LiveElapsedText(sinceMs = elapsedSinceMs, color = palette.blue)
                }
            }
        }
        Spacer(Modifier.width(10.dp))
        SessionStatusMark(rank = statusRank, palette = palette, reducedMotion = reducedMotion)
    }
}

/** Leaf composable so only the 4-char timer recomposes once per second, never the whole HomeScreen. */
@Composable
private fun LiveElapsedText(sinceMs: Long, color: Color) {
    var nowMs by remember(sinceMs) { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(sinceMs) {
        while (true) {
            delay(1000L)
            nowMs = System.currentTimeMillis()
        }
    }
    val secs = if (sinceMs > 0L) ((nowMs - sinceMs) / 1000L).coerceAtLeast(0L) else 0L
    Text(
        " · ${secs / 60}:${(secs % 60).toString().padStart(2, '0')}",
        style = TextStyle(
            fontFamily = WuFonts.Mono,
            fontSize = 11.sp,
            fontFeatureSettings = "tnum",
            color = color,
        ),
    )
}

@Composable
internal fun SessionStatusMark(rank: Int, palette: Palette, reducedMotion: Boolean) {
    when (rank) {
        0 -> Box(Modifier.size(10.dp).background(palette.seal, CircleShape))
        1 -> BrailleSpinnerText(
            color = palette.blue,
            fontSize = 14.sp,
            reducedMotion = reducedMotion,
        )
        2 -> Canvas(Modifier.size(13.dp)) {
            drawCircle(palette.seal, radius = size.minDimension * 0.44f, style = Stroke(1.6.dp.toPx()))
        }
        else -> Box(Modifier.size(6.dp).background(palette.ink3.copy(alpha = 0.6f), CircleShape))
    }
}

/** Shared foldable nested sub-agent list used by both HomeScreen and ThreadsScreen. */
@Composable
internal fun SubAgentGroupBlock(
    subAgents: List<SessionSummary>,
    expanded: Boolean,
    palette: Palette,
    reducedMotion: Boolean,
    onToggle: () -> Unit,
    onOpenSub: (String) -> Unit,
) {
    val rot by animateFloatAsState(
        targetValue = if (expanded) 90f else 0f,
        animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 400, easing = WuEasing.Default),
        label = "sub-rot",
    )
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .height(32.dp)
                .padding(start = 40.dp)
                .wuClickable(reducedMotion = reducedMotion, onClick = onToggle)
                .semantics { role = Role.Button; contentDescription = "${subAgents.size} sub-agents" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "›",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.ink3),
                modifier = Modifier.graphicsLayer { rotationZ = rot },
            )
            Text(
                "${subAgents.size} ${if (subAgents.size == 1) "sub-agent" else "sub-agents"}",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
            )
        }
        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(tween(if (reducedMotion) WuDurations.ReducedFade else 420, easing = WuEasing.Default)) +
                fadeIn(tween(if (reducedMotion) WuDurations.ReducedFade else 300)),
            exit = shrinkVertically(tween(if (reducedMotion) WuDurations.ReducedFade else 380, easing = WuEasing.Default)) +
                fadeOut(tween(if (reducedMotion) WuDurations.ReducedFade else 240)),
        ) {
            Column(Modifier.fillMaxWidth()) {
                subAgents.forEach { sub ->
                    SubAgentRow(
                        sub = sub,
                        palette = palette,
                        reducedMotion = reducedMotion,
                        onClick = { onOpenSub(sub.sessionId) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SubAgentRow(
    sub: SessionSummary,
    palette: Palette,
    reducedMotion: Boolean,
    onClick: () -> Unit,
) {
    val st = sub.swarmStatus ?: sub.status
    val rank = sessionStatusRank(st)
    val lineColor = palette.ink3.copy(alpha = 0.4f)
    Row(
        Modifier
            .fillMaxWidth()
            .drawWithCache {
                val x = 13.5.dp.toPx()
                val midY = size.height * 0.48f
                val endX = 29.dp.toPx()
                val r = 8.dp.toPx()
                val path = Path().apply {
                    moveTo(x, 0f)
                    lineTo(x, (midY - r).coerceAtLeast(0f))
                    quadraticTo(x, midY, x + r, midY)
                    lineTo(endX, midY)
                }
                val stroke = Stroke(1.dp.toPx(), cap = StrokeCap.Round)
                onDrawBehind {
                    drawPath(path, lineColor, style = stroke)
                }
            }
            .wuClickable(reducedMotion = reducedMotion, onClick = onClick)
            .padding(start = 36.dp, top = 7.dp, bottom = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Seal(
            kind = AgentKind.fromLabel(sub.agentLabel),
            sizeDp = 20,
            backgroundColor = palette.seal,
            strokeColor = palette.onSeal,
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                sub.title ?: sub.agentLabel ?: "Sub-agent",
                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 15.5.sp, lineHeight = 20.sp, color = palette.ink),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    "sub-agent",
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.sp, color = palette.ink3),
                    modifier = Modifier
                        .border(1.dp, palette.line, RoundedCornerShape(4.dp))
                        .padding(horizontal = 4.dp, vertical = 1.dp),
                )
                Text(
                    "${sub.agentLabel ?: "agent"} · $st",
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 13.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        SessionStatusMark(rank = rank, palette = palette, reducedMotion = reducedMotion)
    }
}

@Composable
private fun HomeFlowHairline(palette: Palette, reducedMotion: Boolean, modifier: Modifier = Modifier) {
    val flowAnim = if (!reducedMotion) {
        rememberInfiniteTransition(label = "home-flow").animateFloat(
            initialValue = -0.6f,
            targetValue = 1.6f,
            animationSpec = infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Restart),
            label = "home-flow-x",
        )
    } else null
    val blue = palette.blue
    Canvas(modifier.fillMaxWidth().height(1.5.dp)) {
        val x = (flowAnim?.value ?: 0.3f) * size.width
        val w = size.width * 0.45f
        drawRect(
            brush = Brush.horizontalGradient(
                0f to Color.Transparent,
                0.5f to blue,
                1f to Color.Transparent,
                startX = x,
                endX = x + w,
            ),
        )
    }
}
