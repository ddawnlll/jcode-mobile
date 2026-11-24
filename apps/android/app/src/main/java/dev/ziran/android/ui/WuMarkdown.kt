package dev.ziran.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.ziran.android.design.Palette
import dev.ziran.android.design.WuDurations
import dev.ziran.android.design.WuEasing
import dev.ziran.android.design.WuFonts
import dev.ziran.android.design.wuClickable
import kotlinx.coroutines.delay

/**
 * Fast, zero-dependency, Wu wei markdown parser and renderer.
 *
 * Design goals:
 * - Single-pass block parser with LRU cache so scrolling through 200+ messages
 *   incurs zero re-parsing.
 * - Streaming-safe: handles unclosed fenced code blocks without flicker.
 * - Flattens cleanly into LazyColumn items so long multi-screen responses only
 *   compose and measure the blocks currently on screen.
 * - Uses only Wu wei Palette tokens and bundled EB Garamond / JetBrains Mono.
 */
@Immutable
sealed interface MarkdownBlock {
    @Immutable
    data class Heading(val level: Int, val text: String) : MarkdownBlock

    @Immutable
    data class Paragraph(val text: String) : MarkdownBlock

    @Immutable
    data class CodeBlock(val language: String?, val code: String, val closed: Boolean = true) : MarkdownBlock

    @Immutable
    data class BlockQuote(val lines: List<String>) : MarkdownBlock

    @Immutable
    data class BulletList(val items: List<MarkdownListItem>) : MarkdownBlock

    @Immutable
    data class OrderedList(val items: List<MarkdownListItem>) : MarkdownBlock

    @Immutable
    data class Table(val headers: List<String>, val rows: List<List<String>>) : MarkdownBlock

    @Immutable
    data object ThematicBreak : MarkdownBlock
}

@Immutable
data class MarkdownListItem(
    val marker: String,
    val indent: Int,
    val text: String,
)

/** Thread-safe bounded LRU cache for parsed markdown blocks. */
object MarkdownCache {
    private const val MAX_ENTRIES = 256
    private val map = object : LinkedHashMap<String, List<MarkdownBlock>>(MAX_ENTRIES, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<MarkdownBlock>>?): Boolean =
            size > MAX_ENTRIES
    }

    @Synchronized
    fun parse(markdown: String): List<MarkdownBlock> {
        if (markdown.isEmpty()) return emptyList()
        map[markdown]?.let { return it }
        val parsed = parseMarkdownBlocks(markdown)
        map[markdown] = parsed
        return parsed
    }

    @Synchronized
    fun clear() {
        map.clear()
    }
}

private val HeadingRegex = Regex("^(#{1,6})\\s+(.*)$")
private val FenceRegex = Regex("^\\s{0,3}(`{3,}|~{3,})\\s*([A-Za-z0-9_+.#-]*).*$")
private val OrderedListRegex = Regex("^(\\s*)(\\d+)\\.\\s+(.*)$")
private val BulletListRegex = Regex("^(\\s*)[-*+]\\s+(.*)$")
private val ThematicBreakRegex = Regex("^\\s{0,3}([-*_])(?:\\s*\\1){2,}\\s*$")
private val TableSeparatorRegex = Regex("^\\s*\\|?\\s*:?-{2,}:?\\s*(?:\\|\\s*:?-{2,}:?\\s*)*\\|?\\s*$")

/** Single-pass block parser for practical coding-agent markdown. */
fun parseMarkdownBlocks(source: String): List<MarkdownBlock> {
    if (source.isBlank()) return emptyList()
    val lines = source.lines()
    val out = ArrayList<MarkdownBlock>(8)
    var i = 0
    val n = lines.size

    while (i < n) {
        val line = lines[i]
        if (line.isBlank()) {
            i += 1
            continue
        }

        // 1. Fenced code block (``` or ~~~), streaming-safe if unclosed.
        val fenceMatch = FenceRegex.matchEntire(line)
        if (fenceMatch != null) {
            val fenceChars = fenceMatch.groupValues[1]
            val fenceChar = fenceChars[0]
            val fenceLen = fenceChars.length
            val lang = fenceMatch.groupValues[2].trim().ifEmpty { null }
            val codeBuf = StringBuilder()
            i += 1
            var closed = false
            while (i < n) {
                val cur = lines[i]
                val trimmed = cur.trim()
                if (trimmed.length >= fenceLen && trimmed.all { it == fenceChar }) {
                    closed = true
                    i += 1
                    break
                }
                if (codeBuf.isNotEmpty()) codeBuf.append('\n')
                codeBuf.append(cur)
                i += 1
            }
            out.add(MarkdownBlock.CodeBlock(lang, codeBuf.toString(), closed))
            continue
        }

        // 2. Heading (# .. ######)
        val headingMatch = HeadingRegex.matchEntire(line.trimStart())
        if (headingMatch != null) {
            out.add(MarkdownBlock.Heading(headingMatch.groupValues[1].length, headingMatch.groupValues[2].trim()))
            i += 1
            continue
        }

        // 3. Thematic break (---, ***, ___)
        if (ThematicBreakRegex.matches(line)) {
            out.add(MarkdownBlock.ThematicBreak)
            i += 1
            continue
        }

        // 4. Table (header row + separator row)
        if (line.contains('|') && i + 1 < n && TableSeparatorRegex.matches(lines[i + 1])) {
            val headers = splitTableRow(line)
            if (headers.isNotEmpty()) {
                i += 2
                val rows = ArrayList<List<String>>()
                while (i < n && lines[i].isNotBlank() && lines[i].contains('|')) {
                    rows.add(splitTableRow(lines[i]))
                    i += 1
                }
                out.add(MarkdownBlock.Table(headers, rows))
                continue
            }
        }

        // 5. Blockquote (>)
        if (line.trimStart().startsWith(">")) {
            val quoteLines = ArrayList<String>()
            while (i < n && lines[i].trimStart().startsWith(">")) {
                quoteLines.add(lines[i].trimStart().removePrefix(">").removePrefix(" "))
                i += 1
            }
            out.add(MarkdownBlock.BlockQuote(quoteLines))
            continue
        }

        // 6. Unordered list (-, *, +)
        if (BulletListRegex.matches(line)) {
            val items = ArrayList<MarkdownListItem>()
            while (i < n) {
                val m = BulletListRegex.matchEntire(lines[i]) ?: break
                val indent = (m.groupValues[1].length / 2).coerceAtMost(4)
                val itemText = StringBuilder(m.groupValues[2].trim())
                i += 1
                while (i < n && lines[i].isNotBlank() &&
                    !BulletListRegex.matches(lines[i]) &&
                    !OrderedListRegex.matches(lines[i]) &&
                    !FenceRegex.matches(lines[i]) &&
                    !HeadingRegex.matches(lines[i].trimStart()) &&
                    !lines[i].trimStart().startsWith(">") &&
                    lines[i].startsWith("  ")
                ) {
                    itemText.append(' ').append(lines[i].trim())
                    i += 1
                }
                items.add(MarkdownListItem("•", indent, itemText.toString()))
            }
            out.add(MarkdownBlock.BulletList(items))
            continue
        }

        // 7. Ordered list (1. ...)
        if (OrderedListRegex.matches(line)) {
            val items = ArrayList<MarkdownListItem>()
            while (i < n) {
                val m = OrderedListRegex.matchEntire(lines[i]) ?: break
                val indent = (m.groupValues[1].length / 2).coerceAtMost(4)
                val marker = "${m.groupValues[2]}."
                val itemText = StringBuilder(m.groupValues[3].trim())
                i += 1
                while (i < n && lines[i].isNotBlank() &&
                    !OrderedListRegex.matches(lines[i]) &&
                    !BulletListRegex.matches(lines[i]) &&
                    !FenceRegex.matches(lines[i]) &&
                    !HeadingRegex.matches(lines[i].trimStart()) &&
                    !lines[i].trimStart().startsWith(">") &&
                    lines[i].startsWith("  ")
                ) {
                    itemText.append(' ').append(lines[i].trim())
                    i += 1
                }
                items.add(MarkdownListItem(marker, indent, itemText.toString()))
            }
            out.add(MarkdownBlock.OrderedList(items))
            continue
        }

        // 8. Paragraph: collect until blank line or start of another block construct.
        val para = StringBuilder(line.trimEnd())
        i += 1
        while (i < n) {
            val next = lines[i]
            if (next.isBlank() ||
                FenceRegex.matches(next) ||
                HeadingRegex.matches(next.trimStart()) ||
                ThematicBreakRegex.matches(next) ||
                next.trimStart().startsWith(">") ||
                BulletListRegex.matches(next) ||
                OrderedListRegex.matches(next) ||
                (next.contains('|') && i + 1 < n && TableSeparatorRegex.matches(lines[i + 1]))
            ) {
                break
            }
            para.append('\n').append(next.trimEnd())
            i += 1
        }
        out.add(MarkdownBlock.Paragraph(para.toString()))
    }

    return out
}

private fun splitTableRow(line: String): List<String> {
    var trimmed = line.trim()
    if (trimmed.startsWith("|")) trimmed = trimmed.substring(1)
    if (trimmed.endsWith("|")) trimmed = trimmed.substring(0, trimmed.length - 1)
    return trimmed.split('|').map { it.trim() }
}

/**
 * Parses inline markdown into an [AnnotatedString] in a single linear scan:
 * - `code` (JetBrains Mono on subtle paper2 chip)
 * - ***bold italic***, **bold**, __bold__, *italic*, _italic_, ~~strike~~
 * - [label](https://...) clickable links in Wu wei blue
 * - backslash escapes (\*, \`, \[, etc.)
 */
fun buildMarkdownInline(text: String, palette: Palette): AnnotatedString = buildAnnotatedString {
    val len = text.length
    var i = 0
    val codeSpan = SpanStyle(
        fontFamily = WuFonts.Mono,
        fontSize = 13.sp,
        color = palette.ink,
        background = palette.paper2,
    )
    val linkStyles = TextLinkStyles(
        style = SpanStyle(
            color = palette.blue,
            textDecoration = TextDecoration.Underline,
        ),
    )

    while (i < len) {
        val c = text[i]

        // Backslash escape
        if (c == '\\' && i + 1 < len && text[i + 1] in "\\`*_{}[]()#+-.!~|") {
            append(text[i + 1])
            i += 2
            continue
        }

        // Inline code: `...`
        if (c == '`') {
            var ticks = 1
            while (i + ticks < len && text[i + ticks] == '`') ticks += 1
            val delim = "`".repeat(ticks)
            val close = text.indexOf(delim, i + ticks)
            if (close != -1) {
                val inner = text.substring(i + ticks, close).trim()
                withStyle(codeSpan) {
                    append('\u00A0')
                    append(inner)
                    append('\u00A0')
                }
                i = close + ticks
                continue
            }
        }

        // Link: [label](url)
        if (c == '[') {
            val closeBracket = text.indexOf(']', i + 1)
            if (closeBracket != -1 && closeBracket + 1 < len && text[closeBracket + 1] == '(') {
                val closeParen = text.indexOf(')', closeBracket + 2)
                if (closeParen != -1) {
                    val label = text.substring(i + 1, closeBracket)
                    val url = text.substring(closeBracket + 2, closeParen).trim()
                    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
                        withLink(LinkAnnotation.Url(url, styles = linkStyles)) {
                            append(label.ifEmpty { url })
                        }
                    } else {
                        withStyle(SpanStyle(color = palette.blue, textDecoration = TextDecoration.Underline)) {
                            append(label.ifEmpty { url })
                        }
                    }
                    i = closeParen + 1
                    continue
                }
            }
        }

        // Bold + italic: ***...***
        if (c == '*' && i + 2 < len && text[i + 1] == '*' && text[i + 2] == '*') {
            val close = text.indexOf("***", i + 3)
            if (close != -1) {
                withStyle(SpanStyle(fontWeight = FontWeight.Medium, fontStyle = FontStyle.Italic, color = palette.ink)) {
                    append(buildMarkdownInline(text.substring(i + 3, close), palette))
                }
                i = close + 3
                continue
            }
        }

        // Bold: **...** or __...__
        if ((c == '*' && i + 1 < len && text[i + 1] == '*') || (c == '_' && i + 1 < len && text[i + 1] == '_')) {
            val delim = if (c == '*') "**" else "__"
            val close = text.indexOf(delim, i + 2)
            if (close != -1 && close > i + 2) {
                withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = palette.ink)) {
                    append(buildMarkdownInline(text.substring(i + 2, close), palette))
                }
                i = close + 2
                continue
            }
        }

        // Strikethrough: ~~...~~
        if (c == '~' && i + 1 < len && text[i + 1] == '~') {
            val close = text.indexOf("~~", i + 2)
            if (close != -1 && close > i + 2) {
                withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough, color = palette.ink3)) {
                    append(buildMarkdownInline(text.substring(i + 2, close), palette))
                }
                i = close + 2
                continue
            }
        }

        // Italic: *...* or _..._ (avoid snake_case mid-word underscores)
        if (c == '*' || (c == '_' && (i == 0 || !text[i - 1].isLetterOrDigit()))) {
            val close = text.indexOf(c, i + 1)
            val validClose = close != -1 && close > i + 1 &&
                (c == '*' || close + 1 == len || !text[close + 1].isLetterOrDigit())
            if (validClose && text[i + 1] != ' ') {
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                    append(buildMarkdownInline(text.substring(i + 1, close), palette))
                }
                i = close + 1
                continue
            }
        }

        append(c)
        i += 1
    }
}

private val CodeKeywords = setOf(
    "fun", "val", "var", "class", "object", "interface", "data", "sealed", "enum", "override",
    "return", "if", "else", "when", "for", "while", "try", "catch", "finally", "import", "package",
    "private", "public", "internal", "protected", "suspend", "inline", "const", "companion",
    "fn", "let", "mut", "pub", "struct", "impl", "trait", "match", "use", "mod", "async", "await",
    "function", "export", "default", "type", "extends", "implements", "new", "throw", "from",
    "def", "lambda", "with", "yield", "pass", "break", "continue", "true", "false", "null", "nil", "None", "True", "False",
    "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "JOIN", "CREATE", "TABLE",
)

/**
 * Lightweight single-pass syntax highlighter using strictly Wu wei palette colors:
 * - Keywords: palette.seal (indigo)
 * - Strings: palette.green
 * - Comments: palette.ink3 italic
 * - Numbers: palette.blue
 * Caps highlighting at 8000 chars so massive logs stay instantaneous.
 */
fun highlightCodeWuWei(code: String, palette: Palette): AnnotatedString {
    if (code.length > 8000) return AnnotatedString(code)
    val kwStyle = SpanStyle(color = palette.seal, fontWeight = FontWeight.Medium)
    val strStyle = SpanStyle(color = palette.green)
    val commentStyle = SpanStyle(color = palette.ink3, fontStyle = FontStyle.Italic)
    val numStyle = SpanStyle(color = palette.blue)

    return buildAnnotatedString {
        val n = code.length
        var i = 0
        while (i < n) {
            val c = code[i]
            // Line comments: // or # (at line start or after space)
            if ((c == '/' && i + 1 < n && code[i + 1] == '/') ||
                (c == '#' && (i == 0 || code[i - 1] == '\n' || code[i - 1] == ' ' || code[i - 1] == '\t'))
            ) {
                val end = code.indexOf('\n', i).let { if (it == -1) n else it }
                withStyle(commentStyle) { append(code, i, end) }
                i = end
                continue
            }
            // Block comments: /* ... */
            if (c == '/' && i + 1 < n && code[i + 1] == '*') {
                val end = code.indexOf("*/", i + 2).let { if (it == -1) n else it + 2 }
                withStyle(commentStyle) { append(code, i, end) }
                i = end
                continue
            }
            // Strings: "...", '...', `...`
            if (c == '"' || c == '\'' || c == '`') {
                var j = i + 1
                while (j < n) {
                    val ch = code[j]
                    if (ch == '\\') {
                        j += 2
                        continue
                    }
                    if (ch == c) {
                        j += 1
                        break
                    }
                    if (ch == '\n' && c != '`') break
                    j += 1
                }
                val end = j.coerceAtMost(n)
                withStyle(strStyle) { append(code, i, end) }
                i = end
                continue
            }
            // Numbers
            if (c.isDigit() && (i == 0 || !code[i - 1].isLetterOrDigit() && code[i - 1] != '_')) {
                var j = i + 1
                while (j < n && (code[j].isLetterOrDigit() || code[j] == '.' || code[j] == '_')) j += 1
                withStyle(numStyle) { append(code, i, j) }
                i = j
                continue
            }
            // Identifiers / keywords
            if (c.isLetter() || c == '_') {
                var j = i + 1
                while (j < n && (code[j].isLetterOrDigit() || code[j] == '_')) j += 1
                val word = code.substring(i, j)
                if (word in CodeKeywords) {
                    withStyle(kwStyle) { append(word) }
                } else {
                    append(word)
                }
                i = j
                continue
            }
            append(c)
            i += 1
        }
    }
}

/**
 * Emits a parsed markdown message directly into a [LazyColumn], so very long
 * assistant responses (with many paragraphs, tables, and code blocks) only
 * compose and measure the blocks visible in the viewport.
 */
fun LazyListScope.wuMarkdownItems(
    keyPrefix: String,
    markdown: String,
    palette: Palette,
    reducedMotion: Boolean = false,
    animateLastBlock: Boolean = false,
) {
    val blocks = MarkdownCache.parse(markdown)
    if (blocks.isEmpty()) return
    itemsIndexed(
        items = blocks,
        key = { idx, block -> "$keyPrefix-md-$idx-${block::class.simpleName}" },
        contentType = { _, block ->
            when (block) {
                is MarkdownBlock.Paragraph -> "md-para"
                is MarkdownBlock.Heading -> "md-heading"
                is MarkdownBlock.CodeBlock -> "md-code"
                is MarkdownBlock.BlockQuote -> "md-quote"
                is MarkdownBlock.BulletList -> "md-bullet"
                is MarkdownBlock.OrderedList -> "md-ordered"
                is MarkdownBlock.Table -> "md-table"
                MarkdownBlock.ThematicBreak -> "md-rule"
            }
        },
    ) { idx, block ->
        val isStreamingTail = animateLastBlock && idx == blocks.lastIndex
        WuMarkdownBlockView(
            block = block,
            palette = palette,
            reducedMotion = reducedMotion,
            animateEntrance = isStreamingTail,
        )
    }
}

/** Renders a list of markdown blocks inside a Column (for compact or non-lazy containers). */
@Composable
fun WuMarkdown(
    markdown: String,
    palette: Palette,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = false,
    animateLastBlock: Boolean = false,
) {
    val blocks = remember(markdown) { MarkdownCache.parse(markdown) }
    if (blocks.isEmpty()) return
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEachIndexed { idx, block ->
            WuMarkdownBlockView(
                block = block,
                palette = palette,
                reducedMotion = reducedMotion,
                animateEntrance = animateLastBlock && idx == blocks.lastIndex,
            )
        }
    }
}

@Composable
internal fun WuMarkdownBlockView(
    block: MarkdownBlock,
    palette: Palette,
    reducedMotion: Boolean,
    animateEntrance: Boolean = false,
) {
    val density = LocalDensity.current
    val risePx = remember(density) { with(density) { 3.dp.toPx() } }
    val entrance = remember { Animatable(if (animateEntrance && !reducedMotion) 0f else 1f) }
    LaunchedEffect(animateEntrance, reducedMotion) {
        if (animateEntrance && !reducedMotion && entrance.value < 0.999f) {
            entrance.animateTo(1f, tween(WuDurations.ThrottleWord, easing = WuEasing.Default))
        } else {
            entrance.snapTo(1f)
        }
    }
    val mod = if (animateEntrance && !reducedMotion) {
        Modifier.graphicsLayer {
            val p = entrance.value
            alpha = p
            translationY = risePx * (1f - p)
        }
    } else {
        Modifier
    }

    when (block) {
        is MarkdownBlock.Heading -> {
            val sizeSp = when (block.level) {
                1 -> 22.sp
                2 -> 19.5.sp
                3 -> 17.5.sp
                else -> 16.sp
            }
            val lineSp = when (block.level) {
                1 -> 28.sp
                2 -> 25.sp
                3 -> 23.sp
                else -> 22.sp
            }
            val inline = remember(block.text, palette) { buildMarkdownInline(block.text, palette) }
            Text(
                text = inline,
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = sizeSp,
                    lineHeight = lineSp,
                    fontWeight = FontWeight.Medium,
                    color = palette.ink,
                ),
                modifier = mod.fillMaxWidth().padding(top = 6.dp, bottom = 2.dp),
            )
        }

        is MarkdownBlock.Paragraph -> {
            val inline = remember(block.text, palette) { buildMarkdownInline(block.text, palette) }
            Text(
                text = inline,
                style = TextStyle(
                    fontFamily = WuFonts.Garamond,
                    fontSize = 16.5.sp,
                    lineHeight = 24.5.sp,
                    color = palette.ink2,
                ),
                modifier = mod.fillMaxWidth(),
            )
        }

        is MarkdownBlock.CodeBlock -> {
            WuCodeBlock(
                language = block.language,
                code = block.code,
                palette = palette,
                reducedMotion = reducedMotion,
                modifier = mod,
            )
        }

        is MarkdownBlock.BlockQuote -> {
            val joined = remember(block.lines) { block.lines.joinToString("\n") }
            val inline = remember(joined, palette) { buildMarkdownInline(joined, palette) }
            val ruleColor = palette.seal.copy(alpha = 0.55f)
            Box(
                mod
                    .fillMaxWidth()
                    .drawBehind {
                        drawLine(
                            color = ruleColor,
                            start = Offset(0f, 3.dp.toPx()),
                            end = Offset(0f, size.height - 3.dp.toPx()),
                            strokeWidth = 2.dp.toPx(),
                        )
                    }
                    .padding(start = 12.dp, top = 2.dp, bottom = 2.dp),
            ) {
                Text(
                    text = inline,
                    style = TextStyle(
                        fontFamily = WuFonts.Garamond,
                        fontSize = 15.5.sp,
                        lineHeight = 23.sp,
                        fontStyle = FontStyle.Italic,
                        color = palette.ink3,
                    ),
                )
            }
        }

        is MarkdownBlock.BulletList -> {
            Column(mod.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                block.items.forEach { item ->
                    val inline = remember(item.text, palette) { buildMarkdownInline(item.text, palette) }
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(start = (item.indent * 14).dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Text(
                            text = "·",
                            style = TextStyle(
                                fontFamily = WuFonts.Mono,
                                fontSize = 14.sp,
                                lineHeight = 24.sp,
                                color = palette.seal,
                            ),
                            modifier = Modifier.width(14.dp),
                        )
                        Text(
                            text = inline,
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 16.sp,
                                lineHeight = 24.sp,
                                color = palette.ink2,
                            ),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        is MarkdownBlock.OrderedList -> {
            Column(mod.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                block.items.forEach { item ->
                    val inline = remember(item.text, palette) { buildMarkdownInline(item.text, palette) }
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(start = (item.indent * 14).dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Text(
                            text = item.marker,
                            style = TextStyle(
                                fontFamily = WuFonts.Mono,
                                fontSize = 11.5.sp,
                                lineHeight = 24.sp,
                                color = palette.seal,
                            ),
                            modifier = Modifier.widthIn(min = 22.dp).padding(end = 6.dp),
                        )
                        Text(
                            text = inline,
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 16.sp,
                                lineHeight = 24.sp,
                                color = palette.ink2,
                            ),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        is MarkdownBlock.Table -> {
            WuMarkdownTable(block = block, palette = palette, modifier = mod)
        }

        MarkdownBlock.ThematicBreak -> {
            Box(
                mod
                    .fillMaxWidth()
                    .padding(vertical = 6.dp)
                    .height(1.dp)
                    .background(palette.line),
            )
        }
    }
}

@Composable
private fun WuCodeBlock(
    language: String?,
    code: String,
    palette: Palette,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var copied by remember(code) { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1500L)
            copied = false
        }
    }
    val highlighted = remember(code, palette) { highlightCodeWuWei(code, palette) }
    val scroll = rememberScrollState()

    Column(
        modifier
            .fillMaxWidth()
            .background(palette.paper2, RoundedCornerShape(8.dp))
            .border(1.dp, palette.line, RoundedCornerShape(8.dp)),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .drawBehind {
                    drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                }
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = language ?: "code",
                style = TextStyle(fontFamily = WuFonts.Mono, fontSize = 10.5.sp, color = palette.ink3),
            )
            Text(
                text = if (copied) "copied" else "copy",
                style = TextStyle(
                    fontFamily = WuFonts.Mono,
                    fontSize = 10.5.sp,
                    color = if (copied) palette.green else palette.ink3,
                ),
                modifier = Modifier
                    .wuClickable(reducedMotion = reducedMotion, onClick = {
                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                        cm?.setPrimaryClip(ClipData.newPlainText("code", code))
                        copied = true
                    })
                    .padding(horizontal = 4.dp, vertical = 2.dp)
                    .semantics { role = Role.Button; contentDescription = "Copy code" },
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(scroll)
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Text(
                text = highlighted,
                style = TextStyle(
                    fontFamily = WuFonts.Mono,
                    fontSize = 12.sp,
                    lineHeight = 19.sp,
                    color = palette.ink,
                ),
            )
        }
    }
}

@Composable
private fun WuMarkdownTable(
    block: MarkdownBlock.Table,
    palette: Palette,
    modifier: Modifier = Modifier,
) {
    val scroll = rememberScrollState()
    val colCount = maxOf(block.headers.size, block.rows.maxOfOrNull { it.size } ?: 0)
    if (colCount == 0) return

    Box(
        modifier
            .fillMaxWidth()
            .border(1.dp, palette.line, RoundedCornerShape(6.dp))
            .horizontalScroll(scroll),
    ) {
        Column(Modifier.width(IntrinsicSize.Max)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(palette.paper2)
                    .drawBehind {
                        drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                    },
            ) {
                for (c in 0 until colCount) {
                    val cell = block.headers.getOrElse(c) { "" }
                    val inline = remember(cell, palette) { buildMarkdownInline(cell, palette) }
                    Text(
                        text = inline,
                        style = TextStyle(
                            fontFamily = WuFonts.Garamond,
                            fontSize = 14.5.sp,
                            lineHeight = 20.sp,
                            fontWeight = FontWeight.Medium,
                            color = palette.ink,
                        ),
                        modifier = Modifier
                            .widthIn(min = 96.dp, max = 220.dp)
                            .padding(horizontal = 10.dp, vertical = 7.dp),
                    )
                }
            }
            block.rows.forEachIndexed { rIdx, row ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .drawBehind {
                            if (rIdx < block.rows.lastIndex) {
                                drawLine(palette.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                            }
                        },
                ) {
                    for (c in 0 until colCount) {
                        val cell = row.getOrElse(c) { "" }
                        val inline = remember(cell, palette) { buildMarkdownInline(cell, palette) }
                        Text(
                            text = inline,
                            style = TextStyle(
                                fontFamily = WuFonts.Garamond,
                                fontSize = 14.5.sp,
                                lineHeight = 20.sp,
                                color = palette.ink2,
                            ),
                            modifier = Modifier
                                .widthIn(min = 96.dp, max = 220.dp)
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }
    }
}
