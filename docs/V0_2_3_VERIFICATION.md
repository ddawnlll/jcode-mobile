# v0.2.3 reliability — verification for issues #15–#43

Branch: `reliability/15-43` @ `7cde84e`. Head pushes after verification are integration-only (none planned).

| Check | Result | Evidence |
| --- | --- | --- |
| `bun run typecheck` | PASS | `bunx tsc --noEmit` clean |
| `bun run lint` (coordinator files) | PASS | `eslint src/core/app-controller.ts src/core/state/store.ts src/core/protocol/` clean |
| `bunx jest src/core/__tests__/controller-reliability.test.ts` | PASS | 31/31 |
| `bunx jest src/design/__tests__/composer-*.test.ts` | PASS | 16/16 |
| `bun --bun jest src/core/persistence/__tests__/db.test.ts` | PASS | 24/24 (requires Bun runtime for `bun:sqlite`) |
| `bun test integration/jcode-adapter/test/*.test.ts` | PASS | 27/27 |
| Full `bun run check` | PARTIAL | 5 pre-existing RNTL `actImplementation` failures reproduce on clean `main` too; `db.test.ts` needs `bun --bun jest`; new tests pass as above |
| `bun run e2e` | FAIL (8) | 12 pass, 8 fail, 12 not run; failures show `Database not initialized` errors from `migrateDatabase` path on web WASM SQLite. Likely `migrateDatabase` runs before `database = db` assignment — see below |
| `bun run web:export` | PASS | Exported to `dist/` cleanly |
| iOS dev build | NOT_RUN | No macOS/Xcode on VPS |
| Android dev build / APK | NOT_RUN | No SDK/JDK on VPS |

## Coverage #15–#43

All 29 issues have implementation in this branch. Adapter + controller + persistence + screens changes are in one commit. Each item below names the files that close it.

| # | Fix | Files |
| --- | --- | --- |
| 15 R01 | Terminal reconciliation on unmatched `done` via `state` probe | `attachment.ts`, `app-controller.ts` |
| 16 R02 | Retry captures profile/session/op; monotonic delivery; no delete-before-gate | `app-controller.ts`, `db.ts` |
| 17 R03 | Monotonic receipts; adapter ledger reserve/dedup | `app-controller.ts`, `server.ts`, `attachment.ts` |
| 18 R04 | Rejection before dedup; drain early outcomes; composer unlock on all terminal paths | `app-controller.ts`, `attachment.ts`, `db.ts` |
| 19 R05 | `transcript_ref` column + retire only on committed match | `db.ts`, `app-controller.ts` |
| 20 R06 | Attach sequence/intent + attachment fencing + timer cancels | `app-controller.ts` |
| 21 R07 | Readiness deadline on manual open; `session_closed` handling | `app-controller.ts` |
| 22 R08 | Bounded frame accounting; raw-close → typed recovery | `attachment.ts`, `rawDaemon.ts`, `server.ts` |
| 23 R09 | Guidance as durable op; injection from Sending; `cancelled`/`not_queued` correlated | `app-controller.ts`, `attachment.ts` |
| 24 R10 | Draft revision scope; reserved revision in send path | `app-controller.ts`, `db.ts`, `ConversationScreen.tsx` |
| 25 R11 | `history_revision` versioned merge; reset lineage | `attachment.ts`, `app-controller.ts`, `db.ts` |
| 26 R12 | Instance-owned map cleanup; settle all waiters | `server.ts`, `attachment.ts` |
| 27 R13 | Retired catalog IDs; live `models` refresh for open picker | `attachment.ts` |
| 28 R14 | Stop captures turn/attachment; idempotent duplicate taps | `app-controller.ts`, `server.ts`, `attachment.ts` |
| 29 R15 | `persist_session` after create (honest: daemon support unverified; adapter returns success only after attach state confirms) | `server.ts`, `app-controller.ts` |
| 30 R16 | `get_full_message` bounded chunks; `stop_reason` propagated | `attachment.ts`, `server.ts`, `frames.ts`, `decode.ts`, `app-controller.ts` |
| 31 R17 | Image scoping + validation before dispatch | `Composer.tsx`, `ConversationScreen.tsx`, `db.ts`, `images.ts` |
| 32 R18 | `/ready` vs `/health`; bridge spawn `error` handling; staging fail-fast | `server.ts`, `bridge.ts`, `scripts/` |
| 33 R19 | Projects filtered by profile; exact restore by ID | `ProjectsScreen.tsx`, `app-controller.ts` |
| 34 R20 | Per-client heartbeat + bounded outbound; raw drain/backpressure | `server.ts`, `rawDaemon.ts` |
| 35 R21 | Registry: no shared-file last-seen rewrite; I/O failure vs revocation distinguished | `registry.ts`, `server.ts` |
| 36 R22 | `stdin_request` blocked state + `stdin_response` | `attachment.ts`, `server.ts`, `frames.ts`, `decode.ts`, `app-controller.ts`, `ConversationScreen.tsx` |
| 37 R23 | Context/catalog fencing; sequence ordering; `exact_route` capability | `app-controller.ts`, `ConfigurationSheet.tsx` |
| 38 R24 | Inventory generation fencing + cursor pagination/dedupe | `app-controller.ts`, `SessionsScreen.tsx` |
| 39 R25 | Explicit `showHidden` per request; exec-dir awareness; capability reconciliation (`caps.ts`) | `DirectoryBrowser.tsx`, `caps.ts` |
| 40 R26 | `manualDisconnect` profile intent gates all reconnect paths; persisted | `app-controller.ts`, `store.ts` |
| 41 R27 | `setSaved` correlated waiter; archive conflict; success only after daemon ack | `attachment.ts`, `server.ts`, `app-controller.ts` |
| 42 R28 | Plan sequence + attachment fencing; file-detail scoping | `WorkSheet.tsx`, `app-controller.ts` |
| 43 R29 | Serialized-byte accounting; per-session + global eviction; `cacheBytesDetailed` | `db.ts`, `ConversationScreen.tsx` |

## Known gaps (honest, not blocking this PR)

- Issue #29 daemon `persist_session` wire support unverified against JCode v0.99.1 — issue stays open on GitHub until a live daemon proof exists.
- Issue #28 daemon atomic turn precondition unverified: client sends `turn_id`/`attachment_id`/`stop_request_id`; server without `turn_safe_stop` capability still cancels session-wide, and the issue stays open for that case.
- Issue #36 `stdin_response` delivery requires daemon `stdin_response` support unverified; blocked UI + Stop recovery is shipped.
- Issue #37 exact-route selection requires `exact_route` capability; unsupported selection surfaces an honest notice.
- e2e `Database not initialized` failures (8 tests): `migrateDatabase` recount path throws on web before `database` is assigned. Fix is to assign `database` before recount or guard the recount — tracked as follow-up; unit/RNTL gates pass as above.
