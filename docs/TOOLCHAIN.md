# Toolchain preflight — JCode Mobile

Recorded 8 November 2026 on the primary development machine. No credential values are recorded here.

## Host

| Item | Value |
| --- | --- |
| OS | macOS 26.1 (build 25B78), arm64 |
| CPU / RAM | Apple M3 Pro / 18 GiB |
| Free disk at start | 60 GiB |
| Shell | zsh (no shell files modified) |

## Verified tools

| Tool | Version | Notes |
| --- | --- | --- |
| JCode | 0.99.1 (`7206efd0c1dbf49ef38d06b63f3a96a3a7cee611`, tag `v0.99.1`) | Local daemon already running; not restarted by this project |
| Node | v22.21.1 (nvm) | Kept existing LTS; satisfies agent-device 22.12+ |
| npm | 10.9.4 | Single lockfile (`package-lock.json`) |
| Git | 2.50.1 (Apple Git-155) | Existing author identity reused |
| GitHub CLI | 2.96.0 | Authenticated as `ddawnlll` (token scopes gist/read:org/repo/workflow) |
| Xcode | 26.1.1 (17B100) | Full Xcode selected at /Applications/Xcode.app |
| iOS Simulator | iOS 26.1 runtime | iPhone 17 Pro, iPhone 17, iPad Pro 13-inch (M5) available |
| CocoaPods | 1.17.0 | Homebrew Ruby 4.0.6 |
| Watchman | 2026.07.27.00 | Reused existing install |
| agent-device | 0.21.0 | `/Users/hootie/.local/bin/agent-device` |
| Java | Temurin 17.0.21+9 | Installed for Android (system JDK 24 also present; Gradle uses 17) |
| Android SDK | Command-line tools 15859902 + platform/build tools | Installed under `$HOME/Library/Android/sdk` |
| Python fonttools | present (Homebrew) | Used to generate static font instances |

## Version matrix (application)

| Package | Version | Source |
| --- | --- | --- |
| Expo SDK | 58.0.23 | `create-expo-app` template, current stable |
| React Native | 0.88.1 | SDK-managed via `expo install` |
| React | 19.3.0 | SDK-managed |
| TypeScript | 6.0.3 (strict) | SDK-managed |
| Hermes | default for SDK 58 | Expo default |
| React Navigation | 7.5.1 / native-stack 7.21.0 | npm |
| react-native-reanimated | 4.7.1 | `expo install` |
| @testing-library/react-native | 14.1.0 | Async render APIs (React 19) |
| jest-expo | 58.0.14 | RNTL preset |
| Node (pinned) | 22.21.1 | `.nvmrc` |

## Project-local skills

Installed as complete directories under `.jcode/skills/`:

| Skill | Source | Resolved commit |
| --- | --- | --- |
| `react-native-best-practices` | callstackincubator/agent-skills, `skills/react-native-best-practices/` | `59e9d17446a248b21d86f078fcd0bd2d36db1ca4` |
| `react-native-testing` | callstack/react-native-testing-library, `skills/react-native-testing/` | `564a84294717d8e4b0831f3e3a5e115cc3832e01` |
| `agent-device` | callstack/agent-device, `skills/agent-device/` | `b24ecf2091e94e4b445de0e32023dd9348223b87` |
| `frontend-design-deslop` | samber/cc-skills, `skills/frontend-design-deslop/` | `50a33836b20f690c668af557bd9ef9d07a8c7ef2` (repository commit; the reviewed `3df00b6…` value was a file blob, not a commit) |

Reproducible fetch (temporary clones are not committed):

```sh
git init /tmp/skill && cd /tmp/skill
git remote add origin https://github.com/<owner>/<repo>.git
git fetch --depth 1 origin <commit>
git checkout FETCH_HEAD
cp -R skills/<name> "$PROJECT/.jcode/skills/"
```

## MCP

`.jcode/mcp.json` merges an `agent-device` stdio server (`agent-device mcp`) with unrelated configuration preserved. Verified with `jcode mcp list`. The running session may need a reload to discover a newly merged entry; the agent-device CLI is used directly in that case.

## Known limits at preflight

- No physical iOS device paired, no Samsung A34 attached.
- The authorized SSH profile `v7-remote` resets the connection on its configured port (read-only probe), so the live VPS acceptance gate is BLOCKED. An isolated local staging daemon is used instead.
- Android emulator not yet created at the time of this record; see `docs/BUILD_STATE.md` for the final state.
