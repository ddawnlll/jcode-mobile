# Tool presentation provenance (0.6.0)

This note records what JCode actually reports for a tool call, what the mobile
client derives from those fields, and what it refuses to invent. It is the
source audit behind issues #83, #84 and #85.

Pinned upstream revision: `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8`
(`jcode-fork`), the same revision Adapter v4 links in `Cargo.toml`.

## Source fields

| Field | Origin | Mobile use |
| --- | --- | --- |
| `name` | `ApiEvent::ToolStart` / `ToolExec` / `ToolDone` | Family classification and exact tool name in Raw details. |
| `input` bytes | `ApiEvent::ToolInputDelta` | Accumulated JSON. Parsed only when complete or small enough; complete fields may be read from a bounded window while streaming. |
| `input.intent` | Model-supplied string, required by JCode's tool schema | Primary collapsed label when present, shown verbatim. |
| `input.command` | Bash input | Observed summary; exact command in the expanded command block. |
| `input.file_path` | Read/write/edit input | Basename in the collapsed row, full path with copy in the expanded card. |
| `input.content` | Write input | Requested content preview, line count and byte count. |
| `input.edits[]`, `input.old_string`, `input.new_string` | Edit input | Requested before/after change. Not proof that the file changed. |
| `input.patch_text` | ApplyPatch input | Patch viewer and path extracted from `*** Update/Add/Delete File:`. |
| `output`, `error` | `ApiEvent::ToolDone` | Combined result text, source diff when attached, reported exit code when JCode wrote a footer. |
| `tool_start` → `input_delta` → `exec` → `done` | Ordered adapter events with `call_id` | Execution state. Input arrival is not execution; a received edit is not a successful write. |

JCode adds `intent` centrally with `ensure_intent_in_schema` and reads it with
`ToolCall::intent_from_input`
(`crates/jcode-tool-core/src/lib.rs` and
`crates/jcode-message-types/src/lib.rs` upstream). Individual tools may also
declare the property; the central pass still marks it required. The adapter
forwards the model's input unchanged, so this works for Adapter v2, v3 and v4
without a wire change.

## Provenance matrix

| Family | Source-backed intent | Observed fallback | Expanded evidence | Never claimed |
| --- | --- | --- | --- | --- |
| Bash / shell aliases | `input.intent` | First line of `command` as a summary, under the `Run command` family label | Exact command, cwd when reported, combined output, stderr markers when present, exit code only when JCode reported one | A goal when intent is absent; exit 0 when no footer exists; background handoff from a timer. |
| Read | `input.intent` | Basename | Full path with copy, JCode's line-numbered file content | That the content is complete when JCode marked it truncated. |
| Write | `input.intent` | Basename | Full path, requested content, result summary, attached source diff | That the write succeeded before `tool_done`; a change count without a diff. |
| Edit / MultiEdit | `input.intent` | Basename | Full path, requested `edits`/`old_string`→`new_string`, result summary, authoritative diff | Success from input alone; invented `+/-` counts for requested edits. |
| ApplyPatch / Patch | `input.intent` | Basename from the patch header | Full path, patch text, result and source diff | A parsed patch when the payload is malformed. |
| Task / Agent / Communicate | `input.intent` | `description`, `label`, `prompt` or `task` | Exact input and result, plus the adapter's swarm strip | A child session, model or effort that the adapter did not report. |
| MCP proxies | `input.intent` | `description`, `query`, `summary` or `name` | Exact JSON input and result | A translated goal; MCP tool names are kept exact. |
| Unknown tools | `input.intent` | Humanized tool name | Exact input and output | A family label or purpose that was not reported. |

Tool-name aliases mirror upstream `resolve_tool_name`/`canonical_tool_name`:
`functions.bash`, `shell_exec`, `Bash` → bash; `file_read` → read;
`file_write` → write; `file_edit`, `str_replace` → edit; `patch` → apply_patch;
`file_grep`, `agentgrep` → search; `task`, `task_runner` → subagent;
`todo_write`, `todoread` → plan; `mcp__…` and `mcp.*` → MCP.

## Output facts

- JCode foreground bash results merge stdout and stderr. The client labels the
  block `Output` and never invents separate streams. Background output files may
  contain `[stderr]` markers, which are displayed as reported.
- Exit codes are read from JCode's own footers:
  `Exit code: N`, `Command finished with exit code: N`, or
  `Command exited with code N`. The footer is shown once as metadata and kept
  in the exact copy. When no footer exists the card says `not reported`.
- File tools attach the authoritative diff in the text result as
  `File diff:\n```diff …````, with the same diff in tool metadata. The mobile
  adapter forwards the text result; the client extracts that block and keeps it
  separate from the human summary. Diff counters are computed only from those
  actual diff lines.
- ANSI escapes and control characters are stripped from the rendered view only.
  Copy actions use the exact source text.

## Fallback and safety

1. `input.intent` is read only from a complete JSON string value. A partial
   stream may expose a completed intent/command/path string before the closing
   brace; an unterminated string is never used.
2. Without intent the card shows the family label plus observed fields. The
   family label describes a tool type, not a goal.
3. Compact previews redact common credential shapes (`TOKEN=…`,
   `Authorization: Bearer …`, `--password …`, key prefixes). Expanded exact
   evidence and every copy action remain unmodified.
4. Tool contents render as React text nodes. No tool output is interpreted as
   HTML or Markdown.
5. File paths grant no filesystem access. They are labels and copy values only.
6. History tool rows use the same descriptor as live rows. A restored result is
   labelled `Result received`, not `Completed`, because persisted rows lack the
   native error bit.

## Tests

`scripts/check-stillness-ux.mjs` runs the fixture checks under Node's native
TypeScript stripping:

- source intent wins over command/path, and absent intent is not invented;
- basename, full path, POSIX/Windows/Unicode paths and directory hints;
- partial streamed JSON, malformed input, aliases and apply-patch headers;
- credential redaction in previews with exact expanded evidence;
- exit-code footers, missing exit codes, attached diffs, ANSI stripping,
  truncation markers and 100 KB+ payload preservation;
- background handoff detection remains in `scripts/check-tool-status.mjs`.

## Android evidence (0.6.0)

On the API 36 arm64 emulator at 360 dp, a real provider turn
(`gpt-5.6-luna`) produced:

- collapsed intent `Print final E2E proof and OS`, family `Run command`, exact
  command `printf 'final-e2e\n' && uname -s`, and `RESULT`;
- expanded output `final-e2e` / `Darwin` with `Exit not reported`;
- filename-first restored cards (`tool-proof.txt · Write file · …`) with
  neutral `RESULT` rather than green `Completed`;
- no duplicate live/history cards after the idle snapshot and after an adapter
  restart.

Physical-device and TalkBack rendering remain `NOT_RUN`.
