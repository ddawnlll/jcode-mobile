# JCode Mobile — task ledger

Status values: TODO / DOING / DONE / BLOCKED / FAIL. A gate is only DONE with evidence in `docs/VERIFICATION.md`.

## Phase 1 — Bootstrap (G0)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 1.1 | Inspect handoff ZIP, hash, all docs, 12 captures, diagrams | DONE | Hash matches `ee01b6fa…13344e`; all docs read; images inspected |
| 1.2 | Preflight toolchain record | DONE | `docs/TOOLCHAIN.md` |
| 1.3 | Install 4 project skills at pinned commits | DONE | `.jcode/skills/`, provenance recorded |
| 1.4 | Merge agent-device MCP config | DONE | `.jcode/mcp.json`, `jcode mcp list` |
| 1.5 | Scaffold Expo SDK 58 strict TS app | DOING | App builds and launches natively |
| 1.6 | Private GitHub repository | TODO | `gh repo view` shows PRIVATE; branch pushed |
| 1.7 | Android SDK/JDK + emulator | DOING | `sdkmanager` + AVD, `expo run:android` succeeds |

## Phase 2 — Contract and continuity (G1)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 2.1 | Verify protocol at v0.99.1 source | DONE | Capability table in `docs/ADAPTER_CONTRACT.md` |
| 2.2 | Adapter: authenticated WSS + pairing via JCode `devices.json` | DOING | Real `jcode pair` code pairs a device; revoked token → 401 |
| 2.3 | Adapter: attach with `continue_on_disconnect: true` | TODO | Wire-level test proves flag on every attach |
| 2.4 | Adapter: bounded history + revision + identity fencing | TODO | Contract tests |
| 2.5 | Adapter: delivery ledger for MessageAccepted id | TODO | A05 scenario |
| 2.6 | Isolated staging daemon + long tool fixture | TODO | Real JCode, not fixtures |
| 2.7 | Continuity proof A01 (force-quit, remote continues) | TODO | Server-side evidence |

## Phase 3 — Vertical slice (G2)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 3.1 | Design tokens, fonts, theme | DOING | Light/Night, measured |
| 3.2 | Sessions list (real inventory, search, groups) | TODO | Native capture |
| 3.3 | Conversation (virtualized, seam, stream, drafts) | TODO | Native capture |
| 3.4 | Send/accept/reconcile states | TODO | A03/A05 |
| 3.5 | Exit/reopen exact session | TODO | A02/A04 |

## Phase 4 — Complete base workflows (G3)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 4.1 | Work sheet: Activity, live tool rows, tool detail | TODO | A13 |
| 4.2 | Plan tab from TodoState, honest counts | TODO | A12 |
| 4.3 | New session sheet with validation | TODO | Server-returned ID |
| 4.4 | Connect/pair, server details, appearance | TODO | Pair/revoked/expired |
| 4.5 | Archive/restore with undo | TODO | A16 |
| 4.6 | Persistence: SecureStore, SQLite, drafts, cache limits | TODO | Reopen/migration tests |
| 4.7 | Offline/recovery states | TODO | A03, error inventory |

## Phase 5 — Craft, reliability, delivery (G4/G5)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 5.1 | Accessibility + large text + reduced motion | TODO | A11/A13, captures |
| 5.2 | Visual critique and refinement | TODO | Captures + review note |
| 5.3 | Stress/perf measurements | TODO | Recorded numbers |
| 5.4 | Tests: unit, RNTL, contract, e2e | TODO | `npm test` passes |
| 5.5 | Android APK + iOS Simulator .app | TODO | Checksums, install commands |
| 5.6 | CI, README, notices, push | TODO | CI run inspected |

## Genuine blockers

- Live VPS (`v7-remote`) unreachable: SSH resets. Live-VPS acceptance remains BLOCKED; local staging daemon used for real-JCode integration.
- Physical iOS device and Samsung A34 not attached: physical performance/battery checks NOT_RUN.
