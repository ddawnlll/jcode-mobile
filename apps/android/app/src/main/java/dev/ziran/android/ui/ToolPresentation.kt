package dev.ziran.android.ui

import dev.ziran.android.data.LiveTool
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * Structured, human-readable tool presentation (#115) and bounded paginated
 * output helpers (#124). Pure Kotlin so every edge case is unit-tested.
 */
object ToolPresentation {

    const val INITIAL_PREVIEW_LINES = 16
    const val PAGE_INCREMENT_LINES = 80

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    data class ToolDetailSections(
        val summary: String,
        val formattedInput: String?,
        val output: String?,
        val error: String?,
        val rawInput: String?,
        val isDiff: Boolean,
        val serverTruncated: Boolean,
    )

    /**
     * Produce a concise, human-readable collapsed summary for any tool call.
     * Never returns raw serialized JSON (`{...}` / `[...]`), even for unknown
     * tools or partial streaming payloads (#115).
     */
    fun summarizeCollapsed(toolName: String, rawInput: String): String {
        val trimmed = rawInput.trim()
        if (trimmed.isEmpty()) return ""
        val name = toolName.trim().lowercase()

        val parsedObj = parseJsonObjectOrNull(trimmed)
        if (parsedObj != null) {
            return summarizeJsonObject(name, parsedObj)
        }
        // Partial/streaming JSON object (not yet closed): extract readable fields without leaking raw braces.
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return summarizePartialJson(name, trimmed)
        }
        // Plain-text single-line intent.
        return trimmed.lines().firstOrNull().orEmpty().trim().take(96)
    }

    fun buildSections(tool: LiveTool): ToolDetailSections {
        val rawIn = tool.input.trim()
        val parsedObj = parseJsonObjectOrNull(rawIn)
        val formattedIn = when {
            parsedObj != null -> formatJsonFields(parsedObj)
            rawIn.startsWith("{") || rawIn.startsWith("[") -> summarizePartialJson(tool.name.lowercase(), rawIn)
            rawIn.isNotEmpty() -> rawIn
            else -> null
        }
        val out = tool.output.takeIf { it.isNotEmpty() }
        val err = tool.error?.takeIf { it.isNotEmpty() }
        val isDiff = tool.name.lowercase() in setOf("edit", "patch", "apply_patch", "str_replace") ||
            (out != null && out.lines().take(40).any { it.startsWith("+ ") || it.startsWith("- ") || it.startsWith("@@") })
        val truncated = detectServerTruncation(out) || detectServerTruncation(err)
        return ToolDetailSections(
            summary = summarizeCollapsed(tool.name, tool.input),
            formattedInput = formattedIn,
            output = out,
            error = err,
            rawInput = rawIn.takeIf { it.startsWith("{") || it.startsWith("[") },
            isDiff = isDiff,
            serverTruncated = truncated,
        )
    }

    /** Exact full available evidence text for clipboard copy (#124). */
    fun fullCopyText(tool: LiveTool): String = buildString {
        if (tool.output.isNotEmpty()) {
            append(tool.output)
        }
        if (!tool.error.isNullOrEmpty()) {
            if (isNotEmpty()) append("\n\n--- error ---\n")
            append(tool.error)
        }
        if (isEmpty() && tool.input.isNotEmpty()) {
            append(tool.input)
        }
    }

    fun detectServerTruncation(text: String?): Boolean {
        if (text.isNullOrEmpty()) return false
        val tail = if (text.length > 512) text.substring(text.length - 512) else text
        val lower = tail.lowercase()
        return lower.contains("[truncated") ||
            lower.contains("output truncated") ||
            lower.contains("bytes omitted") ||
            lower.contains("lines omitted") ||
            lower.contains("... (truncated)")
    }

    fun formatByteSize(bytes: Int): String = when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> String.format("%.1f KB", bytes / 1024.0)
        else -> String.format("%.2f MB", bytes / (1024.0 * 1024.0))
    }

    private fun parseJsonObjectOrNull(raw: String): JsonObject? {
        if (!raw.startsWith("{")) return null
        return runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
    }

    private fun summarizeJsonObject(name: String, obj: JsonObject): String {
        return when (name) {
            "todo", "todowrite", "todos", "plan" -> summarizeTodo(obj)
            "write", "write_file", "create_file" -> {
                val path = shortPath(firstString(obj, "file_path", "path", "file", "target"))
                val content = firstString(obj, "content", "text", "contents")
                val lines = content?.lines()?.size
                listOfNotNull(
                    path,
                    lines?.let { "$it ${if (it == 1) "line" else "lines"}" },
                ).joinToString(" · ").ifEmpty { "write file" }
            }
            "edit", "patch", "apply_patch", "str_replace", "replace" -> {
                val path = shortPath(firstString(obj, "file_path", "path", "file", "target"))
                val edits = (obj["edits"] as? JsonArray)?.size
                val oldStr = firstString(obj, "old_string", "old_str", "target_content", "search")
                val newStr = firstString(obj, "new_string", "new_str", "replacement_content", "replace")
                val delta = when {
                    edits != null && edits > 0 -> "$edits ${if (edits == 1) "edit" else "edits"}"
                    oldStr != null && newStr != null -> "+${newStr.lines().size} −${oldStr.lines().size}"
                    else -> null
                }
                listOfNotNull(path, delta).joinToString(" · ").ifEmpty { "edit file" }
            }
            "read", "read_file", "view_file", "cat" -> {
                val path = shortPath(firstString(obj, "file_path", "path", "file", "target"))
                val start = firstInt(obj, "offset", "start_line", "startLine", "from")
                val limit = firstInt(obj, "limit", "end_line", "endLine", "to")
                val range = when {
                    start != null && limit != null -> "L$start–L$limit"
                    start != null -> "from L$start"
                    else -> null
                }
                listOfNotNull(path, range).joinToString(" · ").ifEmpty { "read file" }
            }
            "bash", "shell", "run_command", "exec", "terminal", "sh" -> {
                val cmd = firstString(obj, "command", "cmd", "command_line", "script")
                cmd?.lines()?.firstOrNull()?.trim()?.take(96)?.ifEmpty { "run command" } ?: "run command"
            }
            "grep", "search", "ripgrep", "rg", "glob", "find", "find_by_name" -> {
                val pat = firstString(obj, "pattern", "query", "glob", "regex")
                val path = shortPath(firstString(obj, "path", "dir", "directory", "search_directory"))
                listOfNotNull(pat?.let { "\"$it\"" }, path).joinToString(" in ").ifEmpty { name }
            }
            else -> summarizeGenericObject(obj)
        }
    }

    private fun summarizeTodo(obj: JsonObject): String {
        val list = (obj["todos"] as? JsonArray)
            ?: (obj["goals"] as? JsonArray)
            ?: (obj["items"] as? JsonArray)
            ?: (obj["tasks"] as? JsonArray)
        if (list != null) {
            val total = list.size
            val done = list.count { el ->
                val o = el as? JsonObject
                val st = o?.get("status")?.asStringOrNull()?.lowercase()
                val completed = o?.get("completed")?.asStringOrNull()?.lowercase() == "true"
                completed || st == "done" || st == "completed"
            }
            val active = list.count { el ->
                val st = (el as? JsonObject)?.get("status")?.asStringOrNull()?.lowercase()
                st == "in_progress" || st == "running" || st == "active"
            }
            return buildString {
                append("$total ${if (total == 1) "task" else "tasks"}")
                if (done > 0) append(" · $done done")
                if (active > 0) append(" · $active active")
            }
        }
        return summarizeGenericObject(obj).ifEmpty { "update tasks" }
    }

    private fun summarizeGenericObject(obj: JsonObject): String {
        val parts = mutableListOf<String>()
        for ((k, v) in obj.entries) {
            if (parts.size >= 3) break
            val displayVal = when (v) {
                is JsonPrimitive -> v.contentOrNull?.lines()?.firstOrNull()?.trim()?.take(40)
                is JsonArray -> "${v.size} items"
                is JsonObject -> "${v.size} fields"
            }
            if (!displayVal.isNullOrBlank()) {
                parts.add("$k: $displayVal")
            }
        }
        return parts.joinToString(" · ").take(96)
    }

    private fun summarizePartialJson(name: String, raw: String): String {
        val keyRegex = Regex("\"([a-zA-Z0-9_]+)\"\\s*:\\s*\"([^\"\\\\]{1,64})")
        val matches = keyRegex.findAll(raw).take(2).toList()
        if (matches.isNotEmpty()) {
            val pathMatch = matches.firstOrNull { it.groupValues[1] in setOf("file_path", "path", "file", "command", "cmd", "pattern", "query") }
            if (pathMatch != null) {
                val key = pathMatch.groupValues[1]
                val value = pathMatch.groupValues[2]
                return if (key.contains("path") || key == "file") shortPath(value) ?: value else value
            }
            return matches.joinToString(" · ") { "${it.groupValues[1]}: ${it.groupValues[2]}" }.take(96)
        }
        return when (name) {
            "todo", "todowrite" -> "updating tasks…"
            "write", "write_file" -> "writing file…"
            "edit", "patch" -> "editing file…"
            "bash", "shell", "run_command" -> "running command…"
            else -> "preparing $name…"
        }
    }

    private fun formatJsonFields(obj: JsonObject): String = buildString {
        obj.entries.forEachIndexed { idx, (k, v) ->
            if (idx > 0) append('\n')
            when (v) {
                is JsonPrimitive -> append("$k: ${v.contentOrNull.orEmpty()}")
                is JsonArray -> append("$k: [${v.size} items]")
                is JsonObject -> append("$k: {${v.size} fields}")
            }
        }
    }

    private fun firstString(obj: JsonObject, vararg keys: String): String? {
        for (k in keys) {
            val v = obj[k]?.asStringOrNull()
            if (!v.isNullOrBlank()) return v
        }
        return null
    }

    private fun firstInt(obj: JsonObject, vararg keys: String): Int? {
        for (k in keys) {
            val v = obj[k]?.asStringOrNull()?.toIntOrNull()
            if (v != null) return v
        }
        return null
    }

    private fun shortPath(path: String?): String? {
        if (path.isNullOrBlank()) return null
        val parts = path.trimEnd('/').split('/')
        return if (parts.size <= 2) path else parts.takeLast(2).joinToString("/")
    }

    private fun JsonElement.asStringOrNull(): String? = (this as? JsonPrimitive)?.contentOrNull
}
