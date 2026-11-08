# JCode Mobile — agent notes

Native React Native + TypeScript companion for JCode on a remote Linux VPS. The phone is a client; the daemon owns execution.

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
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # jest (pure + RNTL)
npm run ios            # expo run:ios (native dev build)
npm run android        # expo run:android
npm run adapter        # integration/jcode-adapter (Node SSE/WS)
npm run adapter:test   # adapter contract tests against a real daemon
```

## Layout

- `src/design/` semantic tokens, fonts, theme, controls, icons
- `src/core/protocol/` validated frames, capabilities, normalization, identity fencing
- `src/core/connection/` transport, attachment lifecycle, reconnect, delivery correlation
- `src/core/persistence/` SecureStore credentials, SQLite migrations, scoped caches
- `src/core/state/` selector store and session controller (survives screen unmounts)
- `src/features/` sessions, conversation, work, connect, new-session, server
- `integration/jcode-adapter/` small authenticated mobile adapter over the daemon socket
- `design/reference/` unchanged handoff; `docs/` evidence and decisions

Read `TASKS.md`, `docs/BUILD_STATE.md`, `docs/VERIFICATION.md` before resuming.
Do not restart the production JCode daemon. Staging runs with an isolated `JCODE_HOME`/socket.
