# JCode Mobile — task ledger

Status: DONE / DOING / TODO / BLOCKED / FAIL, with `NOT_RUN` and `PARTIAL` for verification items. A gate is only DONE with evidence in `docs/VERIFICATION.md`.

## Phase 1 — Bootstrap (G0)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 1.1 | Inspect handoff ZIP, hash, all docs, 12 captures, diagrams | DONE | Hash matches `ee01b6fa…13344e`; docs read; images inspected |
| 1.2 | Preflight toolchain record | DONE | `docs/TOOLCHAIN.md` |
| 1.3 | Install 4 project skills at pinned commits | DONE | `.jcode/skills/`, provenance recorded |
| 1.4 | Merge agent-device MCP config | DONE | `.jcode/mcp.json` |
| 1.5 | Scaffold Expo SDK 58 strict TS app | DONE | Native dev build launched |
| 1.6 | Private GitHub repository | DONE | `ddawnlll/jcode-mobile`, private, pushed |
| 1.7 | Android SDK/JDK + emulator | DONE | SDK 36, JDK 17, AVD booted |

## Phase 2 — Contract and continuity (G1)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 2.1 | Verify protocol at v0.99.1 source | DONE | `docs/ADAPTER_CONTRACT.md` |
| 2.2 | Authenticated WSS + pairing via JCode registry | DONE | Real `jcode pair` code pairs iOS and Android |
| 2.3 | Attach with `continue_on_disconnect: true` | DONE | Contract test + A01 |
| 2.4 | Bounded history + identity fencing | DONE | base index, total, tail fingerprint, attachment/turn ids |
| 2.5 | Delivery ledger for accepted ids | DONE | implemented; A05 native test NOT_RUN |
| 2.6 | Isolated staging daemon | DONE | private home/runtime dirs, no production contact |
| 2.7 | Continuity proof A01 | DONE | `docs/evidence/continuity-*.json` |

## Phase 3 — Vertical slice (G2)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 3.1 | Design tokens, fonts, theme | DONE | Light/Night, native captures |
| 3.2 | Sessions list (inventory, search, groups) | DONE | Native captures iOS + Android |
| 3.3 | Conversation (virtualized, seam, stream) | DONE | Native captures; real streamed reply |
| 3.4 | Send/accept/reconcile states | DONE | `APP-DONE` round trip; delivery states implemented |
| 3.5 | Exit/reopen exact session | DONE | Last-route restore on both platforms |

## Phase 4 — Complete base workflows (G3)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 4.1 | Work sheet, tool rows, detail, file read | DONE | Live and historical rows deduped by call id; file read capability-gated |
| 4.2 | Plan tab only when reported | DONE | Hidden with zero todos |
| 4.3 | New session sheet + validation | DONE | Native create with server folder + first instruction; returned id used for attach |
| 4.4 | Connect/pair, server details, appearance | DONE | Deep-link pairing, revoked re-pair, server details, Night |
| 4.5 | Archive/restore with undo | DONE | Undo notice, archived list toggle, restore action |
| 4.6 | Persistence: SecureStore, SQLite, drafts, cache | DONE | Serialized transactions; bounded cache; no transaction errors in final runs |
| 4.7 | Offline/recovery states | DONE | Android offline capture + reconciliation |

## Phase 5 — Craft, reliability, delivery (G4/G5)

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 5.1 | Accessibility, 200% text, reduced motion | DONE (manual SR NOT_RUN) | Large-text capture; AX tree inspected |
| 5.2 | Visual critique and refinement | DONE | Seam, dock, scrim, composer, spine fixes |
| 5.3 | Performance measurements | PARTIAL | Android emulator baseline recorded; physical performance NOT_RUN |
| 5.4 | Tests: unit, RNTL, contract | DONE | 34 tests + 7 adapter tests |
| 5.5 | Android APK + iOS Simulator `.app` | DONE | Final v0.1.3 checksums `eb5c7029…1960` / `d5b5259a…8586`; both installed and launched |
| 5.6 | CI, README, notices, push | DONE | CI run `42497990160` success; private draft assets verified; repo private |

## Genuine blockers

- Live VPS (`v7-remote`) unreachable: SSH resets. Live-VPS acceptance remains BLOCKED; isolated local staging used.
- Physical iOS device and Samsung A34 not attached: physical performance/battery/manual screen-reader checks NOT_RUN.
- The manual screen-reader pass remains NOT_RUN; A06, A09, and performance are PARTIAL. A05/A07/A08/A10/A15/A16 are now PASS.

## Phase 6 — v0.1.4 reliability (#2–#11)

Status is DONE only with evidence in `docs/V0_1_4_VERIFICATION.md`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 6.1 | Connection ownership, retry intent, attempt deadline (#2, #4) | DONE | Fake-time controller regressions; late A failure cannot mutate B |
| 6.2 | Foreground health, adapter/daemon distinction, contact timestamps (#3) | DONE | Silent socket retired; inventory failure is not Current |
| 6.3 | Inventory polling intent across background/resume (#5) | DONE | Timer restored with one owner |
| 6.4 | Forget resets navigation; Disconnect stays distinct (#6) | DONE | Playwright forget/back flow |
| 6.5 | Handshake readiness and socket fencing (#7) | DONE | Transport tests for reject, timeout, late callbacks |
| 6.6 | Exact-session title ownership and cache persist (#8) | DONE | Controller fencing tests; offline reopen Playwright |
| 6.7 | Authoritative rename confirmation and errors (#9) | DONE | Adapter confirmation/rejection/ambiguous/busy tests |
| 6.8 | Pairing deadline covers body and is cancellable (#10) | DONE | Timeout and late-success-after-forget tests |
| 6.9 | Sessions Retry reconnects; Server details recovery (#11) | DONE | RNTL wiring test; Playwright recovery |
| 6.10 | Batch verification and handoff | DONE | check 52/52, adapter 11/11, e2e 10/10; Android/iOS NOT_RUN |

## Phase 7 — v0.2.0 Tidal Glass and Bun (#1)

Status is DONE only with evidence in `docs/V0_2_0_VERIFICATION.md`.

| # | Task | Status | Acceptance |
| --- | --- | --- | --- |
| 7.1 | 11 families / 22 palettes and independent prefs | DONE (web) | Theme registry, Appearance screen, persistence, Playwright family loop |
| 7.2 | Welcome, live preview, pending loader | DONE (web) | 1.6 s ASCII character-grid reveal, demo preview, 1,400 ms pending mark, reduced-motion still frame |
| 7.3 | Rich content pipeline | DONE (web) | Typed CommonMark/GFM/math parser, highlight.js, native math, code full view, parser tests |
| 7.4 | Message copy and images | DONE (web) | Copy text/Markdown, composer picker, bounded adapter tuples, Markdown images |
| 7.5 | Projects, folder browser, new-session transaction | DONE (web) | Real adapter directory tests; create/configure/send flow; staging app spec |
| 7.6 | Composer, context, thinking, work rail, menus, find, changes | DONE (web) | Playwright v020 spec passes at 390/412; 320 narrow spec passes |
| 7.7 | Bun sole runtime and package manager | DONE (prebuild) / NOT_RUN (release build) | Lock/scripts/CI/Jest/adapter/export; clean Bun-only PATH proof; generated Gradle uses Bun; no JDK/SDK on VPS |
| 7.8 | Bun vs Node performance | DONE | Cold readiness and RSS improve; p95 recorded |
| 7.9 | Playwright full suite | DONE | 20/20 passed in 3.2 min; iPhone 14, Pixel 7, 320-wide |
| 7.10 | PR for issue #1 | DONE | PR #13, candidate head, CI, coverage matrix and screenshots |
