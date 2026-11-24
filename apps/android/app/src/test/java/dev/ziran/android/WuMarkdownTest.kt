package dev.ziran.android.ui

import dev.ziran.android.design.Palette
import dev.ziran.android.protocol.SessionSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class WuMarkdownTest {

    @Test
    fun parsesHeadingsParagraphsListsQuotesTablesAndCode() {
        val md = """
            # Title
            
            A paragraph with **bold**, *italic*, `inline()`, ~~old~~, and [docs](https://example.com).
            
            ```kotlin
            // greeting
            fun hello() = "world"
            ```
            
            > A calm line
            > Another line
            
            - First bullet
            - Second bullet
              - Nested bullet
            
            1. Step one
            2. Step two
            
            | Name | Status |
            | --- | --- |
            | fox | ready |
            | crane | working |
            
            ---
        """.trimIndent()

        val blocks = parseMarkdownBlocks(md)
        assertEquals(8, blocks.size)
        assertEquals(MarkdownBlock.Heading(1, "Title"), blocks[0])
        assertTrue(blocks[1] is MarkdownBlock.Paragraph)
        val code = blocks[2] as MarkdownBlock.CodeBlock
        assertEquals("kotlin", code.language)
        assertTrue(code.closed)
        assertTrue(code.code.contains("fun hello()"))
        val quote = blocks[3] as MarkdownBlock.BlockQuote
        assertEquals(listOf("A calm line", "Another line"), quote.lines)
        val bullets = blocks[4] as MarkdownBlock.BulletList
        assertEquals(3, bullets.items.size)
        assertEquals(1, bullets.items[2].indent)
        val ordered = blocks[5] as MarkdownBlock.OrderedList
        assertEquals(listOf("1.", "2."), ordered.items.map { it.marker })
        val table = blocks[6] as MarkdownBlock.Table
        assertEquals(listOf("Name", "Status"), table.headers)
        assertEquals(2, table.rows.size)
        assertEquals(MarkdownBlock.ThematicBreak, blocks[7])
    }

    @Test
    fun streamingUnclosedCodeFenceParsesWithoutCrash() {
        val partial = "Here is the fix:\n\n```rust\nfn main() {\n    println!(\"hi\");"
        val blocks = parseMarkdownBlocks(partial)
        assertEquals(2, blocks.size)
        val code = blocks[1] as MarkdownBlock.CodeBlock
        assertEquals("rust", code.language)
        assertFalse(code.closed)
        assertTrue(code.code.contains("println!"))
    }

    @Test
    fun inlineMarkdownPreservesSnakeCaseAndParsesLinksAndCode() {
        val out = buildMarkdownInline(
            "Call `foo_bar` in my_var_name with **strong** and [link](https://ziran.dev).",
            Palette.Day,
        )
        assertTrue(out.text.contains("my_var_name"))
        assertTrue(out.text.contains("foo_bar"))
        assertTrue(out.text.contains("strong"))
        assertTrue(out.text.contains("link"))
        assertTrue(out.spanStyles.isNotEmpty())
        assertTrue(out.getLinkAnnotations(0, out.length).isNotEmpty())
    }

    @Test
    fun syntaxHighlighterUsesWuWeiPaletteOnly() {
        val code = "// comment\nval count = 42\nfun hi() = \"ok\""
        val day = highlightCodeWuWei(code, Palette.Day)
        assertEquals(code, day.text)
        val colors = day.spanStyles.map { it.item.color }.toSet()
        val allowed = setOf(Palette.Day.seal, Palette.Day.green, Palette.Day.ink3, Palette.Day.blue)
        assertTrue(colors.isNotEmpty())
        assertTrue(colors.all { it in allowed })
    }

    @Test
    fun markdownCacheReusesParsedBlocksAndHandles250MessagesFast() {
        MarkdownCache.clear()
        val sample = "## Summary\n\n- Fixed **recomposition** in `Painting.kt`\n- Added `WuMarkdown`\n"
        val first = MarkdownCache.parse(sample)
        val second = MarkdownCache.parse(sample)
        assertSame(first, second)

        val startNs = System.nanoTime()
        for (i in 0 until 250) {
            MarkdownCache.parse("### Turn $i\n\nUpdated `file_$i.kt` with **fast** rendering.\n\n```kotlin\nval x = $i\n```")
        }
        val elapsedMs = (System.nanoTime() - startNs) / 1_000_000L
        assertTrue("Parsing 250 markdown messages should stay well under 500ms, took ${elapsedMs}ms", elapsedMs < 500L)
    }

    @Test
    fun threadTreeHandles250SessionsQuickly() {
        val sessions = (0 until 250).map { i ->
            SessionSummary(
                sessionId = "s-$i",
                title = "Thread number $i — Wu wei perf",
                titleSource = "user",
                status = if (i % 10 == 0) "working" else "idle",
                workingDir = "/work/$i",
                projectId = "p-1",
                updatedAtMs = 1_700_000_000_000L + i * 1000L,
                transcriptBytes = 4096L,
                saved = true,
                archived = false,
                parentSessionId = if (i % 7 == 0 && i > 0) "s-${i - 1}" else null,
                agentLabel = if (i % 2 == 0) "fox" else "crane",
                swarmStatus = null,
            )
        }
        val startNs = System.nanoTime()
        val recent = buildThreadTree(sessions, query = "", sortMode = "recent")
        val byName = buildThreadTree(sessions, query = "", sortMode = "name")
        val byStatus = buildThreadTree(sessions, query = "", sortMode = "status")
        val searched = buildThreadTree(sessions, query = "number 19", sortMode = "recent")
        val elapsedMs = (System.nanoTime() - startNs) / 1_000_000L

        assertTrue(recent.size > 200)
        assertEquals(recent.size, byName.size)
        assertEquals(recent.size, byStatus.size)
        assertTrue(searched.isNotEmpty())
        assertTrue("Tree build + 3 sorts + search on 250 threads took ${elapsedMs}ms", elapsedMs < 250L)
    }
}
