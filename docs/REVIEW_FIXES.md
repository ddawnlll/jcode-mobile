# v0.1.1 corrective review response

Target: the 23 findings raised against `a632a6a` / `v0.1.0`.
This release does not change the visual direction. It adds ownership, protocol-evidence, transcript, authorization, bounds, and delivery corrections.

| ID | Status | Change | Evidence |
| --- | --- | --- | --- |
| F01 | Fixed | Raw daemon `ack` is now transport receipt only. `message_accepted` is emitted only after `state(is_processing)` or another processing event, and an ACK-then-error stays correlated as `send_rejected`. | `attach-contract.test.ts`: ACK does not accept; ACK then rejection; processing promotes |
| F02 | Fixed | Added connection generations, expected-attachment fencing, per-operation server/session/client capture, and no dispatch through a replacement client. Applied to send, guidance, history, pages, attach, open, inventory, stop, plan, rename, and create. | Source guards; typecheck/tests |
| F03 | Fixed | Streaming keeps an accumulated block. Delta flushes append; full replacement can set empty; suffix replacement applies to the whole provisional block; terminal commits flush first. | Source; native send verified |
| F04 | Fixed | Older-page RPC replies are suppressed from the authoritative history handler and merged once by `loadOlder`. Pages carry `has_older`. | `client.request(..., { suppressEvent })`; history test |
| F05 | Fixed | Decoder retains `interrupted_at_attach` and bounded `recovery` fields. | `decode.test.ts` history recovery case |
| F06 | Fixed | Removed content-only acceptance. Acceptance comes only from the adapter ledger/client ids; otherwise delivery stays unconfirmed. | Source; A05 native behavior |
| F07 | Fixed | Every post-upgrade request revalidates the exact token against the registry. Revoked/re-paired sockets get `unauthorized` and close with 4401, including existing sockets. | Source |
| F08 | Fixed | Bootstrap loads local data and sets ready before connecting. Session navigation renders the cached route immediately; connect/attach continues inside it. Revocation probe has a 4 s abort. | Source |
| F09 | Fixed | Outgoing history is bounded by UTF-8 bytes (3 MiB default) as well as message count. Per-message content is capped and safe-truncated. | `attach-contract.test.ts` byte/index case |
| F10 | Fixed | Raw request ids map to assigned normalized turn ids and are retained, so a late terminal cannot be stamped with a newer turn. | Source |
| F11 | Fixed | Absolute indexes are not offset twice. `historyOffset` is applied once; `total_messages` is the real total; empty older pages report `has_older: false`. | `attach-contract.test.ts` index case |
| F12 | Fixed | Raw daemon bytes use `StringDecoder('utf8')`, including split multibyte characters. | `raw-daemon.test.ts` split `ü` |
| F13 | Fixed | Accepted identities delete their durable pending rows before presentation filtering. | Source |
| F14 | Fixed | Send and guidance require a confirmed continuation attachment and the `mobile_continuation` capability; otherwise controls stay disabled with an explicit reason. | `canSend`/`sendGuidance` |
| F15 | Fixed | Guidance is journaled with `kind='guidance'`. Unknown outcomes become `unconfirmed`, never `rejected`; known rejects are explicit; injection deletes the durable row. | Schema + source |
| F16 | Mitigated | Retained live tools are capped at 120 rows, output at 8 KiB per row. Work still uses a ScrollView for the bounded list; the 10k stress/device-memory run remains unrun. | `boundTools` |
| F17 | Fixed | Opening another session detaches the old stream without cancelling work. Reconnect closes/supersedes the prior client; late callbacks are generation-gated. | Source |
| F18 | Fixed | Code copy uses the full block. Oversized blocks show an explicit 64 KiB preview limit instead of an ineffective expander. Actions meet the 48-unit target. | `CodeBlock.tsx` |
| F19 | Fixed | `workflow_dispatch` added and Android 36 packages installed explicitly. The manual Android job passed. | CI run `42513971926` (`android-build` success) |
| F20 | Mitigated | Registry writes use atomic rename and unreadable/adopted errors no longer collapse to an empty writable registry. External JCode writes remain uncoordinated because upstream exposes no shared lock. | `registry.ts` |
| F21 | Fixed | Remote command now sets `JCODE_ADAPTER_HOST=0.0.0.0` with TLS and firewall/reverse-proxy guidance; loopback remains documented for proxies. | README |
| F22 | Partial | Reduced motion no longer translates sheets and stack transitions fade. Focus-return prop, 48-unit targets, and input body font added. Trigger wiring and native accessibility verification are not complete. | `BottomSheet`, navigation, controls |
| F23 | Fixed | The phone persists and reuses the create request id until success. The adapter persists its create cache across restarts with TTL. | `create-cache.json`; controller prefs |

## Regression coverage

- `npm test`: 34 Jest tests.
- `node --test integration/jcode-adapter/test/*.test.ts`: 7 adapter tests, including ACK semantics, processing promotion, byte/index bounds, and split UTF-8.
- `npm run typecheck` and `npm run lint`: pass.
- Native v0.1.1 Android release: launched, cached conversation painted before attach, attached with continuation confirmation, sent `V011-OK`, received the reply.
- Android native CI: `android-build` passed in run `42513971926`.

## Remaining known limits

- F16 Work list is bounded but not virtualized; long-thread memory/input measurements remain.
- F20 cannot coordinate with an unrelated JCode writer; only atomicity and safe failure are fixed.
- F22 focus restoration is not wired through every trigger; manual TalkBack/VoiceOver and reduced-motion native checks remain unrun.
- Live VPS, physical devices, and iOS release over TLS remain blocked/unrun as recorded in `docs/VERIFICATION.md`.

## v0.2.0 review round (PR #13 at `3abd67d`)

| ID | Status | Change | Evidence |
| --- | --- | --- | --- |
| P1 session ownership | Fixed | Configuration is bound to the created session id. Client generation, profile and exact session are rechecked after every await. The first instruction uses `expectedSessionId`. Use server defaults skips rejected model/effort choices instead of resubmitting them. | `controller-reliability.test.ts`: delayed A confirmation, switched send refusal, null-default no-op |
| P1 Bun subprocesses | Fixed for scripts and generated Gradle; Android debug CI PASS; Node-free release NOT_RUN | `bun --bun` for typecheck/lint; `scripts/bun-shims` and `NODE_BINARY` in native build scripts; `plugins/withBunGradle` rewrites Expo's direct `node` calls. | Bun-only PATH typecheck/lint/Jest/adapter; fresh Android prebuild inspection; CI `assembleDebug` 15m52s. Full release/Node-free proof needs a JDK/SDK host. |
| P2 Android IME | Fixed in source; device check NOT_RUN | `softwareKeyboardLayoutMode: 'resize'`; measured inset is iOS-only. | Generated manifest; typecheck. |
| P2 math/image bounds | Fixed | 400-line / 64 KiB block scan, 4 KiB inline scan; URL classification for `data:`, `file:`, `blob:`, `http(s)`, `//`, and rejected schemes. | `markdown.test.ts` 20 KB/4,000-block fixture and deterministic 400-line bound; `message-image.test.tsx` |
| Welcome motion | Fixed | 1.6 s ASCII character-grid torus assembly, idle turn, paused offscreen, Reduce Motion settled frame. | `asciiTorus.test.ts`; welcome evidence images |
