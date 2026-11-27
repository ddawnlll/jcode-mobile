package dev.ziran.android.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.data.AppState
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import dev.ziran.android.protocol.ModelRouteView

private val AllEffortLevels = listOf("minimal", "low", "medium", "high", "xhigh", "max")

/**
 * Reworked Model screen (`Model.dc.html` / `Model-Night.dc.html`):
 * - Scope toggle: `this thread` vs `new threads`.
 * - "In use" card: active model, `provider · api method · detail`, effort ink dots filtered by `effortOptions`,
 *   and plain timing note ("applies from the next turn" / "every new thread starts with it").
 * - Instant search over model, provider, and detail.
 * - Sort by `provider` (grouped with headers), `name`, or `available` first.
 * - Unavailable routes are dimmed, show their `detail` as reason, and cannot be selected.
 */
@Composable
fun ModelScreen(
    palette: Palette,
    state: AppState,
    initialScope: String = "thread",
    onBack: () -> Unit = {},
    onRetryModels: () -> Unit = {},
    onSelectThreadModel: (ModelRouteView) -> Unit = {},
    onSetThreadEffort: (String) -> Unit = {},
    onSelectDefaultModel: (ModelRouteView) -> Unit = {},
    onSetDefaultEffort: (String) -> Unit = {},
    reducedMotion: Boolean = false,
) {
    var scope by remember(initialScope) { mutableStateOf(initialScope) }
    var query by remember { mutableStateOf("") }
    var sortMode by remember { mutableStateOf("provider") }

    val routes = state.models.ifEmpty { state.runtime?.routes.orEmpty() }
    val agent = state.snapshot?.session?.agentLabel ?: "agent"

    val activeModelName = if (scope == "thread") {
        state.runtime?.model ?: state.defaultModel ?: routes.firstOrNull { it.available }?.model ?: routes.firstOrNull()?.model ?: "none"
    } else {
        state.defaultModel ?: state.runtime?.model ?: routes.firstOrNull { it.available }?.model ?: "server default"
    }
    val activeEffort = if (scope == "thread") {
        state.runtime?.reasoningEffort ?: state.defaultEffort ?: "high"
    } else {
        state.defaultEffort ?: state.runtime?.reasoningEffort ?: "high"
    }
    val activeRoute = routes.firstOrNull { it.model == activeModelName }
    val routeSubtitle = if (activeRoute != null) {
        listOfNotNull(activeRoute.provider, activeRoute.apiMethod, activeRoute.detail.takeIf { it.isNotBlank() })
            .joinToString(" · ")
    } else {
        listOfNotNull(state.runtime?.provider, state.runtime?.authMethod).joinToString(" · ").ifEmpty { "server route" }
    }

    val offeredEfforts = remember(state.runtime?.effortOptions) {
        val raw = state.runtime?.effortOptions?.map { it.trim().lowercase() }?.filter { it.isNotEmpty() }
        if (raw.isNullOrEmpty()) AllEffortLevels else raw
    }

    val filteredSorted = remember(routes, query, sortMode) {
        val q = query.trim().lowercase()
        val matched = routes.filter { r ->
            q.isEmpty() ||
                r.model.lowercase().contains(q) ||
                r.provider.lowercase().contains(q) ||
                r.detail.orEmpty().lowercase().contains(q)
        }
        val cmp = when (sortMode) {
            "name" -> compareBy<ModelRouteView> { it.model.lowercase() }
            "available" -> compareByDescending<ModelRouteView> { it.available }
                .thenBy { it.provider.lowercase() }
                .thenBy { it.model.lowercase() }
            else -> compareBy<ModelRouteView> { it.provider.lowercase() }
                .thenBy { it.model.lowercase() }
        }
        matched.sortedWith(cmp)
    }

    Box(Modifier.fillMaxSize().background(palette.paper)) {
        val safeTop = rememberSafeTopInsetDp()
        Column(
            Modifier
                .fillMaxSize()
                .safeTopAndHorizontalPadding()
                .navigationBarsPadding()
                .padding(horizontal = 22.dp),
        ) {
            Spacer(Modifier.height(contentTopSpacerDp(96, safeTop, minClearanceDp = 54).dp))

            Text(
                "Model",
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 30.sp,
                    lineHeight = 36.sp,
                    fontWeight = FontWeight.Medium,
                    color = palette.ink,
                ),
            )

            Spacer(Modifier.height(12.dp))

            WuSegmentedControl(
                options = listOf("thread" to "this thread", "new" to "new threads"),
                selectedKey = scope,
                palette = palette,
                reducedMotion = reducedMotion,
                onSelect = { scope = it },
            )

            // "In use" card
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp)
                    .background(palette.paper2, RoundedCornerShape(12.dp))
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "in use",
                        style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 13.5.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                    )
                    Text(
                        if (scope == "thread") "$agent uses it from its next turn" else "every new thread starts with it",
                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.ink3),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    activeModelName,
                    style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 17.sp, color = palette.ink),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Text(
                    routeSubtitle,
                    style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 14.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    val count = offeredEfforts.size.coerceAtLeast(1)
                    offeredEfforts.forEachIndexed { idx, level ->
                        val on = level.equals(activeEffort, ignoreCase = true)
                        val inkAlpha = if (count == 1) 0.85f else (0.14f + (idx.toFloat() / (count - 1)) * 0.84f)
                        val ringColor by animateColorAsState(
                            targetValue = if (on) palette.seal else Color.Transparent,
                            animationSpec = tween(if (reducedMotion) WuDurations.ReducedFade else 300, easing = WuEasing.Default),
                            label = "effort-ring-$level",
                        )
                        Column(
                            Modifier
                                .weight(1f)
                                .height(58.dp)
                                .wuClickable(reducedMotion = reducedMotion, onClick = {
                                    if (scope == "thread") onSetThreadEffort(level) else onSetDefaultEffort(level)
                                })
                                .semantics {
                                    role = Role.RadioButton
                                    selected = on
                                    contentDescription = "Effort $level"
                                },
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Box(
                                Modifier
                                    .size(32.dp)
                                    .border(1.6.dp, ringColor, CircleShape),
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(
                                    Modifier
                                        .size(22.dp)
                                        .background(palette.ink.copy(alpha = inkAlpha), CircleShape),
                                )
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(
                                level,
                                style = TextStyle(
                                    fontFamily = WuFonts.Mono,
                                    fontSize = 9.5.sp,
                                    color = if (on) palette.ink else palette.ink3,
                                ),
                                maxLines = 1,
                            )
                        }
                    }
                }
            }

            if (state.modelActionPending || state.modelActionError != null) {
                Text(
                    text = if (state.modelActionPending) "Updating model settings…" else state.modelActionError.orEmpty(),
                    style = TextStyle(
                        fontFamily = WuFonts.Mono,
                        fontSize = 11.sp,
                        color = if (state.modelActionPending) palette.blue else palette.seal,
                    ),
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            Spacer(Modifier.height(8.dp))

            WuSearchField(
                value = query,
                placeholder = "search models or providers",
                palette = palette,
                onValueChange = { query = it },
            )

            Spacer(Modifier.height(6.dp))

            WuSortRow(
                options = listOf("provider" to "provider", "name" to "name", "available" to "available"),
                selected = sortMode,
                palette = palette,
                reducedMotion = reducedMotion,
                onSelect = { sortMode = it },
            )

            Spacer(Modifier.height(6.dp))

            LazyColumn(
                contentPadding = PaddingValues(bottom = 30.dp),
                modifier = Modifier.fillMaxWidth().weight(1f),
            ) {
                if (state.modelsError != null && routes.isEmpty()) {
                    item(key = "models-error") {
                        Column(Modifier.fillMaxWidth().padding(vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(
                                state.modelsError,
                                style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, fontStyle = FontStyle.Italic, color = palette.seal),
                            )
                            Box(
                                Modifier
                                    .height(44.dp)
                                    .background(palette.seal, RoundedCornerShape(8.dp))
                                    .wuClickable(reducedMotion = reducedMotion, onClick = onRetryModels)
                                    .padding(horizontal = 16.dp)
                                    .semantics { role = Role.Button; contentDescription = "Retry loading models" },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("Retry", style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 12.sp, color = palette.onSeal))
                            }
                        }
                    }
                } else if (state.modelsLoading && routes.isEmpty()) {
                    item(key = "models-loading") {
                        Text(
                            "Loading models from server…",
                            style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                            modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                } else if (filteredSorted.isEmpty()) {
                    item(key = "empty-models") {
                        Text(
                            if (query.isNotBlank()) "No model by that name on this server." else "No models reported by this server.",
                            style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 16.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                            modifier = Modifier.padding(vertical = 24.dp),
                        )
                    }
                } else {
                    var lastProvider: String? = null
                    filteredSorted.forEach { route ->
                        val showHeader = sortMode == "provider" && route.provider != lastProvider
                        lastProvider = route.provider
                        if (showHeader) {
                            item(key = "hdr-${route.provider}", contentType = "provider-hdr") {
                                Row(
                                    Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 2.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        route.provider,
                                        style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 14.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                                    )
                                    Text(
                                        route.apiMethod,
                                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.ink3),
                                    )
                                }
                            }
                        }
                        item(key = "route-${route.provider}-${route.model}-${route.apiMethod}", contentType = "model-row") {
                            val on = route.model == activeModelName
                            val sub = if (sortMode == "provider") {
                                route.detail.ifBlank { if (route.available) "available" else "unavailable" }
                            } else {
                                listOfNotNull(route.provider, route.detail.takeIf { it.isNotBlank() }).joinToString(" · ")
                            }
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .animateItem()
                                    .defaultMinSize(minHeight = 54.dp)
                                    .graphicsLayer { alpha = if (route.available) 1f else 0.45f }
                                    .wuClickable(
                                        enabled = route.available,
                                        reducedMotion = reducedMotion,
                                        onClick = {
                                            if (scope == "thread") onSelectThreadModel(route) else onSelectDefaultModel(route)
                                        },
                                    )
                                    .drawBehind {
                                        drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                                    }
                                    .padding(vertical = 8.dp)
                                    .semantics {
                                        role = Role.RadioButton
                                        selected = on
                                        contentDescription = "${route.model}, $sub"
                                    },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        route.model,
                                        style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 13.sp, color = palette.ink),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        sub,
                                        style = TextStyle(fontFamily = WuFonts.Garamond, fontSize = 14.sp, fontStyle = FontStyle.Italic, color = palette.ink3),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                Spacer(Modifier.width(10.dp))
                                Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                                    if (on) {
                                        Canvas(Modifier.size(18.dp)) {
                                            drawCircle(
                                                color = palette.seal,
                                                radius = size.minDimension * 0.41f,
                                                style = Stroke(1.6.dp.toPx()),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        BackChevron(palette = palette, onBack = onBack, label = "Back", reducedMotion = reducedMotion)
    }
}
