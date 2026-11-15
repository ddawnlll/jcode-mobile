# Issue #80 verification: stale turn, stop, restart, resume

Date: 2026-11-15/16
Adapter: `jcode-adapter-v4` 0.5.0, protocol 4
Daemon: pinned JCode fork `0abff12c7`, isolated `JCODE_HOME` under `.staging/`
Device: Android emulator API 35 (`jcode-audit-api35`), 1080 x 2400
Model: local Qwen 3.5 9B through LM Studio (`qwen35`, 32k context). Hosted
Command Code and OpenAI routes were rate limited during this run, so the
agent turn used the local provider. The daemon, tool execution, adapter and
Android client are the real components.

This is not physical-device verification.

## Condition 1: adapter restart distinguishes running from stopped

Protocol evidence (`adapter-restart-stop.txt`):

- The turn was running (`session_frog...`, `bash sleep` of a long answer).
- The adapter process was killed and restarted with the same data directory.
- A fresh snapshot returned `active_turn: null` and
  `daemon_status.status: "running"`.
- A stop without a turn id was accepted only after that daemon-confirmed
  running state.

Android evidence (`android-restart-recovered.png`):

- The app was force-stopped and relaunched while the daemon was still
  generating.
- The session restored with Stop, not Send.
- The footer said: "The daemon is still running this session. Stop targets
  that turn; its identity is recovering."
- Tool cards stayed truthful (`FAILED`, `COMPLETED`, `STARTED`), with no
  stuck `RUNNING`.

No false idle was observed after the adapter restart.

Final-APK evidence (`android-restart-running.png`):

- The release APK was reinstalled, a turn was started, and the app was
  force-stopped and relaunched while the turn was generating.
- The session restored with Stop, `Accepted by agent`, and streaming text
  resumed after the restart. A recovered running turn is not fenced as
  finished.

## Condition 2: atomic/idempotent stop

Protocol evidence (`adapter-restart-stop.txt`):

- Two concurrent stops for the same unknown-turn target returned success;
  one reported an in-flight stop, the other accepted the cancel. Neither
  returned a conflict or issued a second daemon cancel.
- After the daemon reported terminal state, a second stop returned
  `already_stopped: true` with `final_state: "idle"` and did not call the
  daemon cancel again.
- The adapter blocks new dispatches while a cancel lease is active.

Foreground command evidence (`foreground-command-stop.txt`):

- Real `bash` tool call (`sleep 60`) was observed through `tool_start`.
- Stop returned `cancelled: true`, `final_state: "idle"`.
- A repeated stop returned `already_stopped: true`.
- The next message dispatched and emitted `turn_started`.

Residual limitation: JCode's daemon cancel is still session-scoped. The
adapter fences it with a fresh daemon status, a validated turn id, and a
session dispatch block, but the daemon itself does not expose atomic
turn-id cancellation. The response keeps `atomic_turn_scope: false`.

## Condition 3: Android Stop -> Refresh -> Restart -> Resume

Screenshots:

1. `android-stop-composer.png`: after Stop, the composer is Send, the turn
   is `Ready`, and the unfinished tool is `UNKNOWN / RECONCILING` instead of
   a permanent `RUNNING`.
2. `android-stop-recovered.png`: after stopping a daemon-confirmed recovered
   turn, all tool cards are terminal and Send is enabled.
3. `android-restart-recovered.png`: after force-stop/relaunch, the exact
   session restored with Stop and the identity-recovery footer.
4. `android-resume-reply.png`: a new message after recovery was sent and
   answered ("Hello! How can I assist you today?").
5. `android-final-stop.png`: final APK after Stop; Send is enabled.
6. `android-final-resume.png`: final APK accepting a new message after Stop
   and showing the new turn streaming.

## Condition 4: real long command stopped, then a new message

- The daemon ran a real `bash` tool call for `sleep 60`.
- The tool was observed in the foreground (`tool_start`, `tool_exec`) before
  Stop.
- Stop interrupted the turn and the next snapshot showed no active turn and
  an idle daemon.
- A second message was reserved, dispatched, and emitted `turn_started`.

The Android run also executed real `bash` tool calls (`bun run e2e...`,
`git diff`, file reads) before Stop; statuses resolved to terminal or
`UNKNOWN / RECONCILING`.

## Checks run

- `cargo clippy --workspace --all-targets -- -D warnings`: PASS
- `cargo test --workspace`: PASS (41 adapter-core, 19 adapter-server
  integration, plus protocol/server unit tests)
- `bun run check`: PASS (typecheck, lint, 139 Jest tests)
- `bun test apps/stillness/test/controller-reconciliation.bun.ts`: PASS (15)
- `bun run stillness:build`: PASS
- `bun run ux:check`: PASS (15 + tool lifecycle checks)
- Isolated Chromium Stillness e2e: 5 passed, 3 skipped (run before the final
  local-only status normalization; model-dependent test was quota blocked)
- Android release APK built, installed and exercised on API 35 emulator
  (`c4d1e261…037c46`, 12 MB, versionCode 5000)

## Not run

- Physical Android device
- Hosted-provider long command (quota exhausted; local provider used)
- A daemon-side atomic turn cancel (requires an upstream JCode change)
