# JCode Mobile — agent notes

Native React Native + TypeScript companion for JCode on a remote Linux VPS. The phone is a client; the daemon owns execution.

## First: identify the host

Do not guess the toolchain. Run:

```sh
bash scripts/check-platform.sh
```

It prints the kernel, distro, Bun/JCode versions, and the exact commands
for this machine. The short version:

| Host | Native iOS | Native Android | Web + Playwright | Browser libraries |
| --- | --- | --- | --- | --- |
| macOS (Xcode 26.1+) | Yes, simulator and device signing | Yes, with SDK/JDK | Yes | `bunx --bun playwright install --with-deps chromium` |
| Debian/Ubuntu VPS | No | Only if SDK/JDK are installed | Yes, this is the CI target | `bunx --bun playwright install chromium`, then `bash scripts/playwright-deps-linux.sh` when sudo is unavailable |
| Other Linux (RHEL, Fedora, Arch) | No | Only if SDK/JDK are installed | Yes | Use the distro package manager, or a Debian container |
| Windows | No | No | WSL2 only | Use the Debian/Ubuntu path inside WSL2 |

### Debian/Ubuntu VPS (rootless)

The VPS account may have no sudo. Chromium then needs its shared libraries
extracted into a user prefix:

```sh
bun install --frozen-lockfile
bunx --bun playwright install chromium
bash scripts/playwright-deps-linux.sh     # writes ~/playwright-deps, no root
bun run check
bun run e2e                               # run-e2e.sh sets LD_LIBRARY_PATH
```

Do not use `sudo bunx --bun playwright install-deps` unless sudo is actually
available. Do not install system packages for the app itself.

The live adapter and web build on this class of host are separate from the
isolated e2e environment:

```sh
# Live adapter (serves /pair, /ws, and optionally the exported web UI)
JCODE_ADAPTER_PORT=7644 JCODE_ADAPTER_WEB_DIR=$PWD/dist/web \
  bun integration/jcode-adapter/src/main.ts

# Static web build
CI=1 bunx --bun expo export -p web --output-dir dist/web
bun --bun scripts/serve-web.mjs dist/web  # adds COOP/COEP for SQLite WASM
```

### macOS

Use the full Xcode toolchain for native work and the same JavaScript checks for
everything else:

```sh
xcode-select -p                           # must be the full Xcode
bun install --frozen-lockfile
bunx --bun playwright install --with-deps chromium
bun run check
bun run e2e
bun run ios                               # expo run:ios
bun run android                           # expo run:android
```

`scripts/run-e2e.sh` only adds `LD_LIBRARY_PATH` when the rootless Linux
prefix exists, so the same script is safe on macOS.

### Other Linux and Windows

On RHEL/Fedora/Arch install Chromium's libraries with `dnf`, `zypper`, or
`pacman`, or run the Debian e2e path in a container. Native iOS is not
available. On Windows use WSL2 and follow the Debian/Ubuntu path.

## Non-negotiable rules

1. Never map navigation, unmount, background, socket close, or app kill to Cancel/Clear/Rewind. Only the explicit Stop control targets the current turn, and it sends `cancel` for that session only.
2. Every session attachment to the daemon must carry `continue_on_disconnect: true`. Continuation is set during attach, never in a final goodbye frame.
3. Reopening restores the exact server + session. A missing target shows an honest recovery state; never create a replacement session implicitly.
4. Cached content paints first and is labelled as saved-on-this-phone. Only an authoritative history/runtime reconciliation may claim Current/Ready.
5. Sending states are distinct: Draft saved → Sending → Sent to server (bridge ACK) → Accepted (agent). Lost after write = Delivery unconfirmed; never auto-resend.
6. Fence stale output with `attachment_id` + `turn_id` + `session_id`. A slow response cannot overwrite newer live state.
7. Daemon death is not phone absence. Show saved history and a source-backed interruption state.
8. Unknown capability/status stays unknown. No invented percentages, approvals, push toggles, file browsers, or progress.
9. Design tokens come from `src/design/tokens.ts` only. Fonts are bundled locally. Keep the return seam, 48-unit targets, 20/24 gutters, 12/24 radii, no app drop shadows.
10. Server/session scope every draft, bookmark, cache, pending send, and reading position.

## Commands

```sh
bun run typecheck      # tsc --noEmit
bun run lint           # eslint
bun run test           # jest (pure + RNTL) under Bun
bun run e2e            # Playwright mobile UI against the isolated staging daemon
bun run web            # expo start --web
bun run web:export     # static web build in dist/web
bun run web:serve      # serve dist/web with COOP/COEP headers
bun run ios            # expo run:ios (native dev build)
bun run android        # expo run:android
bun run adapter        # integration/jcode-adapter under Bun (SSE/WS)
bun run adapter:test   # adapter contract tests under Bun
bash scripts/check-platform.sh  # host-specific setup and checks
```

## What to run before claiming a change works

Run the checks the host actually supports. Report a check as NOT_RUN rather
than implying it passed.

| Check | Command | When |
| --- | --- | --- |
| Types | `bun run typecheck` | Every change |
| Lint | `bun run lint` | Every change |
| Unit/RNTL | `bun run test` | Every change |
| Adapter contract | `bun run adapter:test` | Adapter or protocol change |
| Web/UI e2e | `bun run e2e` | UI, web target, or adapter change |
| iOS dev build | `bun run ios` | macOS with Xcode |
| Android dev build | `bun run android` | Android SDK/JDK present |
| iOS release app | `bash scripts/build-ios-simulator.sh` | macOS, release sign-off |
| Android release APK | `bash scripts/build-android-release.sh` | SDK/JDK present |

## Web target and Playwright

The web target exists for UI verification, not as a second product surface.
It runs the same screens through `react-native-web`.

- `metro.config.js` adds `wasm` to asset extensions. expo-sqlite's web driver
  needs it, and the page must be cross-origin isolated. `scripts/serve-web.mjs`
  and the adapter both send COOP/COEP headers; a plain static host will not.
- `src/core/persistence/credentials.web.ts` stores tokens in localStorage.
  That is preview/test storage, not a keystore. Never call it secure.
- `src/core/dev/e2e-seed.web.ts` is gated by the build-time
  `EXPO_PUBLIC_E2E=1` constant and is inert in a normal export. It imports a
  test token from localStorage and refuses non-loopback hosts.
- `scripts/e2e-prepare.sh` starts an isolated `.staging/jcode` daemon and an
  adapter on 7645. It never touches the production daemon on the user's
  socket or the live adapter on 7644.
- `bun run e2e` uses `.staging/e2e/web` and port 8091. Results, traces, and
  screenshots are under `.staging/e2e/` and are gitignored.
- Browsers cannot set `Authorization` on a WebSocket. The adapter accepts
  `jcode-v1` plus `token.<bearer>` as an offered subprotocol for web clients.
  Native clients keep the header.
- The adapter serves a web build only when `JCODE_ADAPTER_WEB_DIR` is set.
  Browser origins are allowed when loopback, or when listed in
  `JCODE_ADAPTER_ALLOWED_ORIGINS`.

## Layout

- `src/design/` semantic tokens, fonts, theme, controls, icons
- `src/core/protocol/` validated frames, capabilities, normalization, identity fencing
- `src/core/connection/` transport, attachment lifecycle, reconnect, delivery correlation
- `src/core/persistence/` SecureStore credentials, SQLite migrations, scoped caches
- `src/core/state/` selector store and session controller (survives screen unmounts)
- `src/features/` sessions, conversation, work, connect, new-session, server
- `integration/jcode-adapter/` small authenticated mobile adapter over the daemon socket
- `e2e/` Playwright setup, seeding, and mobile UI specs
- `scripts/` staging, e2e, platform check, web serving, native builds
- `design/reference/` unchanged handoff; `docs/` evidence and decisions

Read `TASKS.md`, `docs/BUILD_STATE.md`, `docs/VERIFICATION.md` before resuming.
Do not restart the production JCode daemon. Staging runs with an isolated `JCODE_HOME`/socket.
