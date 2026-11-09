# v0.2.0 verification

Updated: 2026-11-09. This file records only commands that actually ran. A native
gate is not closed by a browser or Playwright result.

## Candidate

| Item | Value |
| --- | --- |
| Branch | `feature/v0.2.0-tidal-glass` |
| Base | `cac75d0` (PR #12 merge) |
| Candidate SHA | `5bcb691` |
| Bun | 1.4.4 (`/home/quant/local/bun/bin/bun`) |
| Host | Debian 13 x86_64 VPS, Chromium headless shell 1254 |
| JCode | 0.99.1 (`7206efd0c`) |
| Staging | `.staging/jcode`, adapter `127.0.0.1:7645`, web `127.0.0.1:8091` |

## Implementation decisions

- `src/design/themes.json` is the complete 11-family record copied from the
  public v0.2.0 snapshot. `src/design/themes.ts` validates it; `tokens.ts`
  derives the executable Tidal palettes from it. Screen files define no palette.
- Theme family, System/Light/Night, Effects, and reasoning display persist
  independently in SQLite prefs. Reasoning visibility is presentation only.
- Tidal Glass uses `expo-blur` on native and an opaque sibling on web, Effects:
  Reduced, or Reduce Transparency. Chrome use is bounded to composer, menus,
  context, and inspectors.
- The rich renderer is `markdown-it` + `markdown-it-footnote` + a typed AST
  adapter. GFM tables, task lists, nested lists, quotes, footnotes, links,
  images, literal fenced code, and inline/display math are parsed as data.
  `highlight.js` core registers an explicit language set. Math is rendered
  natively with fraction/root/sup/sub/matrix/aligned/cases support and a
  source fallback; no WebView or network asset is used.
- Message actions provide exact Markdown and readable-text Copy. Hidden
  reasoning is excluded from both.
- Images are bounded `[media_type, base64]` tuples on the daemon wire. The
  composer sends at most four images (8 MiB base64 each, 20 MiB total). Markdown
  images load external URLs only on intent; attached and demo images render
  directly.
- New session is a create → configure → confirm → first-instruction
  transaction. The returned session is retained on partial failure; a second
  Start reuses it instead of creating a duplicate.
- Directory browsing is adapter-side, realpath-scoped to configured roots, with
  paging, hidden-folder toggle, canonical paths, and typed errors. No shell.
- The adapter is additive: `directory_browse`, `session_config`,
  `context_snapshot`, `image_input`, `changes`, model-specific effort, and
  bounded images. Existing continuation, fencing, delivery, and rename
  behavior is unchanged.
- Bun is the sole host runtime and package manager for this repository. The
  adapter runs under Bun, Jest/tsc/eslint/Playwright run through Bun, and CI
  uses `oven-sh/setup-bun` with `bun install --frozen-lockfile`.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Frozen install | `bun install --frozen-lockfile` | PASS |
| Types | `bun run typecheck` | PASS |
| Lint | `bun run lint` | PASS (one pre-existing warning in `registry.ts`) |
| Unit/RNTL | `bun run test` | PASS, 8 suites / 64 tests |
| Adapter contract | `bun run adapter:test` | PASS, 16 tests |
| Web export | `CI=1 bunx --bun expo export -p web` | PASS |
| Playwright | `bun run e2e` | see latest section |
| Clean environment | `bun install --frozen-lockfile` + check + adapter + export in a copied tree without `node_modules` | PASS; install 1.9 s, check 154.8 s, adapter 3.0 s, export 8.2 s |
| Bun-only PATH | same checks with `PATH` excluding Node/npm/npx | PASS; check 154.4 s, adapter 16 tests, export 6.3 s |
| Android release | `bash scripts/build-android-release.sh` | NOT_RUN this session (no SDK/JDK on VPS) |
| iOS release | `bash scripts/build-ios-simulator.sh` | NOT_RUN (macOS gate) |

### Bun vs Node adapter baseline

Same host, same adapter source, disposable state, `/health` on loopback. Three
runs after one warmup; install time reported separately from runtime metrics.

| Runtime | Version | Cold readiness | Idle RSS | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| Bun | 1.4.4 | 197–331 ms | ~44.1 MB | 0.54–0.82 ms | 1.96–6.31 ms |
| Node | v26.3.0 | 765–952 ms | ~114 MB | 0.82 ms | 1.21–7.17 ms |

Bun cuts cold readiness by roughly 60–70% and idle RSS by roughly 60%, with no
material steady-state p95 regression in this fixture. The measurement is an
HTTP readiness/latency fixture, not a provider streaming benchmark. Rollback is
the previous release: `cac75d0` with `npm ci` and the Node adapter command.

## Playwright coverage

Reports, traces, and screenshots live under `.staging/e2e/`:

- report: `.staging/e2e/report/index.html`
- traces: `.staging/e2e/results/**/trace.zip`
- screenshots: `.staging/e2e/screens/`
- failure screenshots: `.staging/e2e/results/**/test-failed-1.png`

Committed visual evidence from the running web build:

- `docs/evidence/v020/welcome-light.png`
- `docs/evidence/v020/welcome-night-dracula.png`
- `docs/evidence/v020/sessions-night.png`
- `docs/evidence/v020/conversation-rich-night.png`
- `docs/evidence/v020/conversation-math-code.png`
- `docs/evidence/v020/conversation-work-rail.png`
- `docs/evidence/v020/context-sheet.png`
- `docs/evidence/v020/appearance-screen.png`
- `docs/evidence/v020/changes-sheet.png`

The suite covers iPhone 14 (390-wide Chromium), Pixel 7 (412-wide), and a
320-wide compact project. Viewport and keyboard-focus assertions are web
coverage, not native IME evidence.

| Requirement | Evidence |
| --- | --- |
| Welcome, live theme preview, Connect/Preview | `v020.spec.ts` welcome flow; `connect.spec.ts` unpaired fields and setup disclosure |
| Pairing rejected/retry, switching, offline recovery, Forget | `connect.spec.ts`, `recovery.spec.ts`, `navigation.spec.ts` |
| Pinned/recent projects and sessions, search, quick switch | `v020.spec.ts` project scope and pinned preview session |
| Folder browsing, canonical path, recent, permission/error | `directory-images.test.ts`; `DirectoryBrowser` through the real adapter |
| New session model/effort/first instruction, partial failure | `helpers.createSession`, `title.spec.ts`, `v020.spec.ts` configuration sheet |
| Shared composer, draft/selection, short viewport | `v020.spec.ts` composer flow and short viewport |
| Loading/cache/reconnect/exact session | `recovery.spec.ts`, `title.spec.ts`, pending loader assertions |
| Context used/limit/remaining/basis/freshness | `v020.spec.ts` context sheet (`48,600 / 128,000 / 38% / 79,400`) |
| Hidden/Compact/Expanded reasoning | `v020.spec.ts` thinking modes; Hidden excludes reasoning text |
| CommonMark/GFM tables, tasks, footnotes, code, math | `markdown.test.ts`; `v020.spec.ts` table, footnote, code, math blocks |
| Copy message text and exact Markdown | `v020.spec.ts` clipboard read; `MessageActions` |
| Images in messages and Markdown | `v020.spec.ts` `message-image`; embedded demo PNG data |
| Code Copy/Wrap/Full view | `v020.spec.ts` code block controls |
| Inline Work rail and Work detail | `v020.spec.ts` work rail and Work sheet; `app.spec.ts` historical work |
| Menus, Find, Changes | `v020.spec.ts` session menu, find next/close, changes diff evidence |
| 22 palettes, independent appearance persistence | `v020.spec.ts` eleven-family loop, Light/Night, reload persistence |
| 320-wide and 200% text | `narrow.spec.ts`; 200% text remains a native/manual gate |
| Reduced motion/transparency | code paths present; native Reduce Motion/Transparency NOT_RUN |

## Unresolved gates

- Real Android/iOS IME, edge-to-edge, safe-area, keyboard dismissal, and
  TalkBack/VoiceOver passes are NOT_RUN. They require physical/emulated devices
  and are not claimed from web results.
- Native release-build scroll/frame-time/peak-memory results are NOT_RUN.
- Glass compositing contrast on varied native backdrops is NOT_RUN; opaque
  token contrast is recorded by the design source, not re-certified here.
- Expo prebuild/native bundling under Bun was not exercised on this VPS; the
  Android/iOS build gates remain pending macOS/SDK hosts.
- F16 Work-memory/virtualization, F20 registry coordination, and F22 native
  focus/accessibility are characterized by existing tests but not fully closed
  for 0.2.0.
- Playwright results are web coverage at mobile viewports. They do not certify
  native behavior.
