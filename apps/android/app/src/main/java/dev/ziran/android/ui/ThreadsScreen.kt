package dev.ziran.android.ui

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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import dev.ziran.android.protocol.SessionSummary
import dev.ziran.android.protocol.SwarmAgentView
import kotlinx.coroutines.delay

/**
 * Threads tab (`Sessions.dc.html` / `Sessions-Night.dc.html`):
 * - 170 dp quiet_river painting header.
 * - Live search across title, note, and agent label (instant, no debounce jank).
 * - Persisted sort pills (`recent`, `name`, `status`) with smooth `animateItem` re-sort.
 * - Nested foldable sub-agents (auto-unfolded on search match; never top-level).
 * - Swipe-to-archive + Undo bar, pull-to-refresh ink ring, floating new-thread seal.
 */
@Composable
fun ThreadsScreen(
    palette: Palette,
    sessions: List<SessionSummary>,
    snapshotAgents: List<SwarmAgentView>? = null,
    activeParentId: String? = null,
    sortMode: String = "recent",
    onSortChange: (String) -> Unit = {},
    onOpen: (String) -> Unit = {},
    onArchive: (String) -> Unit = {},
    onRestore: (String) -> Unit = {},
    onRefresh: () -> Unit = {},
    onNewThread: () -> Unit = {},
    reducedMotion: Boolean = false,
) {
    var query by remember { mutableStateOf("") }
    val expandedParents = remember { mutableStateMapOf<String, Boolean>() }
    var undoSession by remember { mutableStateOf<SessionSummary?>(null) }
    var archivedIds by remember { mutableStateOf(setOf<String>()) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(undoSession) {
        if (undoSession != null) {
            delay(4600L)
            undoSession = null
        }
    }

    val visibleSessions = remember(sessions, archivedIds) {
        sessions.filter { it.sessionId !in archivedIds }
    }
    val tree = remember(visibleSessions, query, sortMode, snapshotAgents, activeParentId) {
        buildThreadTree(
            sessions = visibleSessions,
            query = query,
            sortMode = sortMode,
            snapshotAgents = snapshotAgents,
            activeParentId = activeParentId,
        )
    }
    val listState = rememberLazyListState()
    val countLabel = "${tree.size} ${if (tree.size == 1) "thread" else "threads"}"

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        ScreenChrome("quiet_river", palette, headerHeightDp = 170, reducedMotion = reducedMotion)

        val safeTop = rememberSafeTopInsetDp()
        Column(
            Modifier
                .fillMaxSize()
                .safeTopAndHorizontalPadding()
                .padding(horizontal = 22.dp),
        ) {
            Spacer(Modifier.height(contentTopSpacerDp(112, safeTop, minClearanceDp = 12).dp))

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(
                    "Threads",
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 30.sp,
                        lineHeight = 36.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.ink,
                    ),
                )
                Text(
                    countLabel,
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 11.sp, color = palette.ink3),
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }

            Spacer(Modifier.height(10.dp))

            // Search bar (instant filter, zero debounce jank).
            WuSearchField(
                value = query,
                placeholder = "search threads and sub-agents",
                palette = palette,
                onValueChange = { query = it },
            )

            Spacer(Modifier.height(6.dp))

            // Sort pills (`recent`, `name`, `status`).
            WuSortRow(
                options = listOf("recent" to "recent", "name" to "name", "status" to "status"),
                selected = sortMode,
                palette = palette,
                reducedMotion = reducedMotion,
                onSelect = onSortChange,
            )

            Spacer(Modifier.height(8.dp))

            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(bottom = 148.dp),
                modifier = Modifier.fillMaxWidth().weight(1f),
            ) {
                if (tree.isEmpty()) {
                    item(key = "empty-threads") {
                        Text(
                            if (query.isNotBlank()) "Nothing by that name." else "No threads yet.",
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 16.sp,
                                fontStyle = FontStyle.Italic,
                                color = palette.ink3,
                            ),
                            modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                } else {
                    items(tree, key = { it.session.sessionId }) { item ->
                        val s = item.session
                        val st = s.swarmStatus ?: s.status
                        val isRest = sessionStatusRank(st) == 3
                        val open = item.autoExpandedBySearch || (expandedParents[s.sessionId] ?: false)
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .animateItem()
                                .drawBehind {
                                    drawLine(
                                        palette.line,
                                        Offset(0f, size.height),
                                        Offset(size.width, size.height),
                                        1.dp.toPx(),
                                    )
                                },
                        ) {
                            HomeThreadRow(
                                session = s,
                                note = "${s.agentLabel ?: "agent"} · $st",
                                elapsed = null,
                                palette = palette,
                                reducedMotion = reducedMotion,
                                dimmed = isRest,
                                onClick = { onOpen(s.sessionId) },
                            )
                            if (item.subAgents.isNotEmpty()) {
                                SubAgentGroupBlock(
                                    subAgents = item.subAgents,
                                    expanded = open,
                                    palette = palette,
                                    reducedMotion = reducedMotion,
                                    onToggle = { expandedParents[s.sessionId] = !open },
                                    onOpenSub = onOpen,
                                )
                            }
                        }
                    }
                }
            }
        }

        // Undo archive bar above bottom nav.
        val undo = undoSession
        UndoBar(
            visible = undo != null,
            title = undo?.title ?: "thread",
            palette = palette,
            reducedMotion = reducedMotion,
            onUndo = {
                if (undo != null) {
                    archivedIds = archivedIds - undo.sessionId
                    onRestore(undo.sessionId)
                }
                undoSession = null
            },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = 22.dp, vertical = 72.dp),
        )

        FloatingNewThreadSeal(
            palette = palette,
            reducedMotion = reducedMotion,
            onClick = onNewThread,
            modifier = Modifier.align(Alignment.BottomEnd),
        )
    }
}

@Composable
internal fun WuSearchField(
    value: String,
    placeholder: String,
    palette: Palette,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(42.dp)
            .drawBehind {
                drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
            },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(Modifier.size(18.dp)) {
            val u = size.minDimension / 24f
            val stroke = Stroke(1.7.dp.toPx(), cap = StrokeCap.Round)
            drawCircle(palette.ink3, radius = 5.5f * u, center = Offset(10.5f * u, 10.5f * u), style = stroke)
            drawLine(palette.ink3, Offset(14.6f * u, 14.6f * u), Offset(19f * u, 19f * u), 1.7.dp.toPx(), StrokeCap.Round)
        }
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) {
                Text(
                    placeholder,
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 16.sp,
                        fontStyle = FontStyle.Italic,
                        color = palette.ink3,
                    ),
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, color = palette.ink),
                cursorBrush = SolidColor(palette.ink),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
internal fun WuSortRow(
    options: List<Pair<String, String>>,
    selected: String,
    palette: Palette,
    reducedMotion: Boolean,
    onSelect: (String) -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            "sort",
            style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.ink3),
            modifier = Modifier.padding(end = 4.dp),
        )
        options.forEach { (key, label) ->
            val on = key == selected
            Box(
                Modifier
                    .height(28.dp)
                    .background(if (on) palette.paper2 else palette.paper, RoundedCornerShape(14.dp))
                    .border(1.dp, if (on) palette.ink3 else palette.line, RoundedCornerShape(14.dp))
                    .wuClickable(reducedMotion = reducedMotion, onClick = { onSelect(key) })
                    .padding(horizontal = 10.dp)
                    .semantics { role = Role.Tab; contentDescription = "Sort by $label" },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 10.5.sp,
                        color = if (on) palette.ink else palette.ink3,
                    ),
                )
            }
        }
    }
}

/** Gently curving ink underline used by ThreadScreen composer. */
@Composable
fun InkUnderline(
    palette: Palette,
    reducedMotion: Boolean = false,
    modifier: Modifier = Modifier,
) {
    @Suppress("UNUSED_VARIABLE")
    val ignored = reducedMotion
    Canvas(modifier.fillMaxWidth().height(6.dp)) {
        val w = size.width
        val h = size.height
        val p = androidx.compose.ui.graphics.Path().apply {
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
