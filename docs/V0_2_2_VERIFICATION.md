# v0.2.2 verification: audit repairs and follow-up fixes

Updated: 2026-11-10

This release fixes every P1 and P2 finding in the 9 November 2026 audit and
the follow-up defects reported from the Android and iOS releases. The adapter,
mobile app, iOS project, and tests are all versioned `0.2.2`.

## Audit findings

| Area | Repair |
| --- | --- |
| DEP-1 | Adapter build is reported in `/info`, `/health`, `hello_ok`, and `server_info`. The app stores the adapter version, shows it and the capability gap in Server details, and gates Model/Context when the adapter omits them. |
| STR-1 | Live events are no longer queued behind history. Only pre-attach frames are buffered; compaction no longer re-arms a bootstrap gate. |
| STR-2 | History reconciliation preserves active provisional steps and reasoning, merges already-loaded older pages, and rechecks attachment identity after storage awaits. |
| STR-3 | `message_end` is distinct from `text_done`. The app keeps one provisional block per assistant step, commits each separately, and applies replacements only to the active step. |
| STR-4 | Control request ids are tracked. ACK is transport receipt only. `done` completes only a correlated turn; control `done` cannot finish a generation. |
| STR-5 | Every stream frame is fenced by session and attachment; turn checks precede mutation; plan/context/config replies are session-fenced. |
| TXT-1 | Legacy sentinel reasoning is decoded on live input and cached rows. Hidden and Copy never treat it as answer prose. |
| CFG-1 | Model catalog replies are routed by request id. Catalog frames never enter transcript bootstrap. Cached catalogs paint immediately while a refresh runs. |
| CFG-2 | Context uses `runtime_command: info` for the authoritative route limit and last usage. Usage is associated with its model. All-zero default usage is unknown, not 0%. Stored turn stats and a persisted adapter observation provide an honest last-known value after reload. |
| CFG-3 | The app writes only server-confirmed model/effort replies. Canonical per-model effort ladders are ported from the daemon. The model picker filters by provider route. |
| HIST-1 | Frame budget is negotiated. Text and media share one budget. Oversized media is omitted with a count. Truncated messages return the truncated copy. Client decode failures surface. |
| HIST-2 | Prompt ordinals are zero-based, boundaries are absolute, out-of-window anchors are not clamped, older pages apply images, and history replaces the image set. |
| HIST-3 | `has_older` is false at the retention floor, loaded pages survive snapshots, message metadata (reasoning/tools/images) is cached, the authoritative total is stored, and a deleted tail is reconciled. |
| SESS-1 | Session creation is reserved before its first await and validates the captured server/client before sending. The created session's attach is accepted over a stale attach fence. |
| WORK-1 | Failed live calls cannot reappear as confirmed edits. History-only edits are labelled attempts. |
| AUTH-1 | Every outbound stream frame performs a cached synchronous revocation check. Revocation disposes attachments and closes the socket. |
| THINK-1/2 | Thinking animates in Compact and Expanded, respects Reduce Motion, preserves reasoning across answer text, and resets timing per step. |
| TXT-2/3/4 | Adapter reasoning stripping preserves ordinary Markdown. Fences nested in quotes, lists starting at zero, and duplicate footnote definitions are fixed. Streaming uses adaptive flushes, no silent buffer truncation, batched reasoning, and non-animated follow scrolling. Code Full view is 1 MiB with an honest label. |
| SESS-2/3 | Accepted prompts stay visible until committed history contains them; peer prompts are shown. Retry preserves images and guidance, and first-message receipts use the adapter ledger. |
| WORK-2/3 | Tool rows are upserted, unfinished tools are resolved on stop, truncation is labelled, and plan replies are fenced with error cleanup. |
| UI-1/2 | Context scrolls at short heights. Project sessions open directly. New activity no longer clamps to the oldest row. |
| AUTH-2 | Pairing limits use a trusted proxy caller key, so Caddy callers no longer share one loopback bucket. |

## Follow-up fixes from the published builds

| Report | Cause | Repair |
| --- | --- | --- |
| Context still unknown | The daemon's in-memory `last_usage` is zero after an agent reload; no live `tokens` frame had arrived. | Adapter persists per-session observations, falls back to stored turn `response_stats`, marks the snapshot stale, and shows used/limit/remaining. A live turn updates it to current. |
| Model picker empty | The catalog request waited on one daemon reply and could time out after a valid cached catalog existed. | Cached catalog returns immediately and refreshes in the background. Model routes are forwarded and the picker has provider filters. |
| No provider filtering | Only model strings were exposed. | `available_model_routes` is forwarded as `routes`; the sheet derives provider chips and labels each model's provider. |
| Cannot create a project | Projects had no add flow and the folder browser had no search or folder creation. | Projects now has Add project, project search, and a direct New session action. The folder browser has this-folder search, New folder, and Use this folder. |
| New session asks for a prompt | Creation was a two-step prompt/config transaction. | Creation only selects a folder and opens an empty conversation. Model/effort and the first message live in the conversation. A known project opens a session immediately. |
| "The open session changed" on create | A stale attach fence rejected the created session's `attached` frame. | Create intent owns the next attach and clears the old fence. |
| Attachment crashes / returns to menu | The generated iOS `Info.plist` lacked `NSPhotoLibraryUsageDescription`; the folder picker could also exceed the frame budget. | Permission strings added to the native project and app config. The picker caps file size, lowers quality, and reports oversize images. |
| iOS release bundle failed | RN 0.88.1 Flow sources use `unknown`; the bundled Hermes parser rejects it. | Postinstall patch forces Babel for non-TypeScript Flow sources. |
| Simulator Keychain failed | Unsigned release builds have no usable Keychain entitlement. | Simulator release builds are ad-hoc signed (`CODE_SIGNING_ALLOWED=YES`, `CODE_SIGN_IDENTITY=-`). |
| Stale picker pod | The native project predated `expo-image-picker`. | `pod install` linked `ExpoImagePicker`; the app launches and opens the picker. |

## Verification

| Check | Result |
| --- | --- |
| `bun run typecheck` | PASS |
| `bun run lint` | PASS, no warnings |
| `bun run test` | PASS, 11 suites / 99 tests |
| `bun run adapter:test` | PASS, 27 tests |
| `bun run e2e` | PASS, 32/32 on a clean isolated staging environment (2026-11-10 06:23 UTC) |
| iOS Release Simulator build | PASS, Xcode 26.1.1, iPhone 17 Pro simulator |
| Native pairing and session creation | PASS: paired, created an empty session, sent `Reply with exactly OK`, received `OK` |
| Native Context | PASS: `29,198 / 1,000,000`, 3%, 970,802 remaining, model `gpt-6.1-sol`, source Server |
| Native Model & effort | PASS: server-confirmed `gpt-6.1-sol · low`, provider chips (All, Anthropic, Anthropic API, local-gemini, muse-go), model rows, per-model effort ladder |
| Native Projects | PASS: Add project, search projects, folder search, New folder field, Use this folder, New session here |
| Native direct creation | PASS: `Create session` opened an empty conversation with no prompt/config form |
| Native attachment | PASS: photo-library permission prompt shown with the new description; system picker opened; no crash or app exit |
| Picker selection confirmation | NOT_VERIFIED: the iOS photo picker is a remote system view outside the XCTest app tree, so the automated tap could not confirm the selection. The permission and picker-open path is verified. |
| Android release APK | NOT_RUN: no Android SDK/JDK on this host |
| Physical devices | NOT_RUN |

## Artifact

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `artifacts/jcode-mobile-0.2.2-ios-simulator.app.zip` | 29 MiB | `33269e4e09d34d3da5d35653451172c4f49225edee0e22966d8343c84e8e3859` |

## Remaining limits

- Android native build/install was not possible on this host. The Android
  manifest now includes `READ_MEDIA_IMAGES`, but the APK must be rebuilt and
  smoke-tested on a device with SDK/JDK.
- The iOS picker selection path needs one manual confirmation on a physical
  device or a simulator with UI automation that can target remote system views.
- Context remains honestly unavailable for sessions whose daemon and adapter
  have never observed usage (no stored turn stats and no live `tokens` frame).
