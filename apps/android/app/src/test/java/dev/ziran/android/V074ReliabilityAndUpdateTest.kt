package dev.ziran.android

import dev.ziran.android.data.LiveTool
import dev.ziran.android.data.QueueDrainPolicy
import dev.ziran.android.ui.DeepLinks
import dev.ziran.android.ui.ToolPresentation
import dev.ziran.android.update.UpdateManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class V074ReliabilityAndUpdateTest {

    // -- Auto-updater & version control ---------------------------------------

    @Test
    fun semverComparisonHandlesPrefixesAndOrdering() {
        assertEquals(Triple(0, 7, 4), UpdateManager.parseSemVer("ziran-v0.7.4"))
        assertEquals(Triple(0, 7, 5), UpdateManager.parseSemVer("v0.7.5"))
        assertTrue(UpdateManager.isNewerVersion("ziran-v0.7.5", "0.7.4"))
        assertTrue(UpdateManager.isNewerVersion("0.8.0", "0.7.4"))
        assertTrue(UpdateManager.isNewerVersion("1.0.0", "0.9.9"))
        assertFalse(UpdateManager.isNewerVersion("ziran-v0.7.4", "0.7.4"))
        assertFalse(UpdateManager.isNewerVersion("ziran-v0.7.3", "0.7.4"))
    }

    @Test
    fun parsesGitHubReleaseJsonAndPrefersReleaseApkWithSha256() {
        val sample = """
            {
              "tag_name": "ziran-v0.7.5",
              "name": "Ziran 0.7.5 — Wu wei",
              "body": "Fixes and auto-update.",
              "html_url": "https://github.com/ddawnlll/ziran/releases/tag/ziran-v0.7.5",
              "assets": [
                {
                  "name": "ziran-0.7.5-android-debug.apk",
                  "size": 16000000,
                  "browser_download_url": "https://example.com/debug.apk"
                },
                {
                  "name": "ziran-0.7.5-android-release.apk",
                  "size": 3400000,
                  "browser_download_url": "https://example.com/release.apk"
                },
                {
                  "name": "ziran-0.7.5-android-release.apk.sha256",
                  "size": 96,
                  "browser_download_url": "https://example.com/release.apk.sha256"
                }
              ]
            }
        """.trimIndent()
        val parsed = UpdateManager.parseGitHubReleaseJson(sample)
        assertNotNull(parsed)
        assertEquals("0.7.5", parsed!!.version)
        assertEquals("ziran-v0.7.5", parsed.tagName)
        assertEquals("https://example.com/release.apk", parsed.apkUrl)
        assertEquals("https://example.com/release.apk.sha256", parsed.sha256Url)
    }

    @Test
    fun parsesSha256FileLine() {
        val hash = "546bd746d1b243255f07b2b2aebf3ccfac6aaa7c19347bebad5c22a65441ef3f"
        assertEquals(hash, UpdateManager.parseSha256Line("$hash  ziran-0.7.4-android-release.apk\n"))
        assertNull(UpdateManager.parseSha256Line("not-a-hash"))
    }

    // -- #115 Structured tool summaries (never raw JSON in collapsed rows) ----

    @Test
    fun collapsedToolSummariesNeverLeakRawJson() {
        val todo = ToolPresentation.summarizeCollapsed(
            "todo",
            """{"todos":[{"id":"1","status":"done"},{"id":"2","status":"in_progress"}]}""",
        )
        assertFalse(todo.contains("{"))
        assertTrue(todo.contains("2 tasks"))
        assertTrue(todo.contains("1 done"))

        val write = ToolPresentation.summarizeCollapsed(
            "write",
            """{"file_path":"/src/app/Main.kt","content":"line1\nline2\nline3"}""",
        )
        assertFalse(write.contains("{"))
        assertTrue(write.contains("app/Main.kt"))
        assertTrue(write.contains("3 lines"))

        val edit = ToolPresentation.summarizeCollapsed(
            "edit",
            """{"file_path":"ui/ThreadScreen.kt","edits":[{"a":1},{"a":2}]}""",
        )
        assertFalse(edit.contains("{"))
        assertTrue(edit.contains("2 edits"))

        val partial = ToolPresentation.summarizeCollapsed(
            "write",
            """{"file_path":"src/Foo.kt","content":"unterminated""",
        )
        assertFalse(partial.contains("{"))
        assertTrue(partial.contains("src/Foo.kt"))

        val unknown = ToolPresentation.summarizeCollapsed(
            "custom_mcp_tool",
            """{"query":"hello","limit":5}""",
        )
        assertFalse(unknown.contains("{"))
        assertTrue(unknown.contains("query: hello"))
    }

    // -- #124 Full tool output pagination & copying ---------------------------

    @Test
    fun toolOutputSupportsLargePayloadsAndServerTruncationDetection() {
        val tenThousandLines = (1..10_000).joinToString("\n") { "line $it: 日本語 ✓" }
        val tool = LiveTool(
            seq = 1,
            callId = "call-1",
            name = "bash",
            input = """{"command":"seq 1 10000"}""",
            output = tenThousandLines,
            error = null,
            status = "done",
        )
        val full = ToolPresentation.fullCopyText(tool)
        assertEquals(10_000, full.lines().size)
        assertTrue(full.endsWith("line 10000: 日本語 ✓"))
        assertFalse(ToolPresentation.detectServerTruncation(full))
        assertTrue(ToolPresentation.detectServerTruncation("head\n... [truncated: 4096 bytes omitted]"))
    }

    // -- #119 Queue drain policy (bounded backoff + permanent rejection pause) -

    @Test
    fun queueDrainPolicyBacksOffAndPausesOnPermanentRejection() {
        val policy = QueueDrainPolicy(maxTransientAttempts = 3, baseDelayMs = 1_000L)
        assertTrue(policy.canDrain("s1", "t1", nowMs = 0L))

        val d1 = policy.recordTransientFailure("s1", "t1", "offline", nowMs = 100L)
        assertEquals(1_000L, d1)
        assertFalse(policy.canDrain("s1", "t1", nowMs = 500L))
        assertTrue(policy.canDrain("s1", "t1", nowMs = 1_100L))

        val d2 = policy.recordTransientFailure("s1", "t1", "offline", nowMs = 1_100L)
        assertEquals(2_000L, d2)

        val d3 = policy.recordTransientFailure("s1", "t1", "offline", nowMs = 3_100L)
        assertNull(d3) // exhausted -> paused
        assertNotNull(policy.pausedError("s1", "t1"))
        assertFalse(policy.canDrain("s1", "t1", nowMs = 999_999L))

        policy.clear("s1", "t1")
        assertTrue(policy.canDrain("s1", "t1", nowMs = 0L))

        policy.recordPermanentRejection("s1", "t1", "invalid")
        assertFalse(policy.canDrain("s1", "t1", nowMs = 999_999L))
        assertEquals("invalid", policy.pausedError("s1", "t1"))
    }

    // -- #122 Multi-server session deep link routing --------------------------

    @Test
    fun deepLinksPreserveServerIdForMultiAdapterNotifications() {
        val route = DeepLinks.parse("ziran://session/sess-42?server=vps-prod")
        assertTrue(route is DeepLinks.Route.Session)
        val s = route as DeepLinks.Route.Session
        assertEquals("sess-42", s.sessionId)
        assertEquals("vps-prod", s.serverId)

        val legacy = DeepLinks.parse("ziran://session/sess-99")
        assertTrue(legacy is DeepLinks.Route.Session)
        assertEquals("sess-99", (legacy as DeepLinks.Route.Session).sessionId)
        assertNull(legacy.serverId)
    }
}
