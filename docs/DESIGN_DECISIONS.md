# Design decisions and implementation adjustments

The handoff's `PRODUCT_SPEC.md`, `DESIGN.md`, and `tokens.json` remain authoritative. This note records how the native implementation resolves the places where source facts, platform behavior, or missing server data required a concrete choice.

## Visual system

| Decision | Reason |
| --- | --- |
| `src/design/tokens.ts` is the only color/space/radius/motion source | Prevents a second theme preset from drifting from the locked sRGB projection |
| Bricolage Grotesque SemiBold instanced at weight 600, optical size 36, width 100 | The supplied file is variable; native fonts need a static, named face. 36 is the nearest named optical stop to the design's 32 |
| Hanken Grotesk 400/500/600 and IBM Plex Mono 400 are separate bundled files | iOS maps custom families to PostScript names; weight synthesis on a variable family is unreliable |
| Text scaling is capped at 200% (`maxFontSizeMultiplier: 2`) | Meets the accessibility contract while preventing clipped primary actions beyond the tested range |
| No app drop shadows; surface changes and hairline separators only | DESIGN.md forbids combining hairline edges with diffuse elevation |
| The mark is a tinted PNG rasterized from the supplied SVG | 1,441 SVG circles per render would cost more than a static asset. The source has no semantic detail lost at 22–40 units |
| Session rows are separated by full-width hairlines, not cards | The structural rule distinguishes a reading list from cards |
| The return seam is a horizontal hairline that breaks at “Since you left” | Matches the signature description; an earlier vertical rule was rejected in native review |

## Conversation and streaming

- The transcript is a non-inverted `FlatList` with stable keys (`m-<index>`, `d-<clientId>`). It is not inverted because the seam and reading anchor are positional, and inversion makes “first unseen” anchoring error-prone.
- Streaming text is coalesced in the controller at 100 ms and flushed at tool/message/turn boundaries. Completed assistant messages are memoized by content.
- Markdown is a small in-repo block parser. This avoids executing agent-supplied HTML, avoids a large dependency, and bounds work at 600 blocks per message. Incomplete code stays plain; it is never syntax-highlighted mid-stream. Highlighting is intentionally not implemented rather than doing offscreen or per-token work.
- User messages use the raised surface at 86% width; assistant prose is unboxed. History messages carry no timestamps, so no time is fabricated for them.
- Tool results are bounded in the adapter (64 KiB) and in the UI preview (24 lines / 8 KiB). Expanding shows the remaining bounded window with a truthful truncation note.
- The Work sheet reconstructs historical tool calls from raw `tool_data` on history messages. The curated bridge drops those fields, which is one more reason the adapter attaches on the raw socket. Historical rows are labelled “Recorded in saved history” and do not invent timestamps or outputs.

## Continuity

- Attachment identity is adapter-normalized: every attach gets an `attachment_id`; every stream frame carries a monotonic `turn_id`. The client ignores frames from a previous attachment or an older turn.
- The return seam is derived from a stored `{messageIndex, fingerprint}`. If the message at that index changed, the client searches the loaded window for the fingerprint; if it cannot be found (compaction/rewrite), it shows “New activity since your last visit” with no count.
- The bookmark advances only when content is actually displayed or the user taps “Mark seen”. Foregrounding does not clear unread state.
- Cached history paints first and is labelled. `Current` is set only after an authoritative history response for the current attachment.
- Leaving Conversation does not dispose the attachment; the controller keeps the stream so a running turn continues to update the list. Force-quitting closes the socket; `continue_on_disconnect` keeps the server turn alive.

## Platform behavior

- The native stack owns edge-back and Android Back. No screen maps navigation to Cancel.
- The bottom sheet is custom (Reanimated + Gesture Handler) so it can use the exact 280 ms reveal, 25%/900 velocity dismissal, and an opaque surface. The drag gesture is on the handle/header only, so content scrolling and selection are never hijacked.
- Opening a sheet dismisses the keyboard; closing it does not refocus the composer.
- The composer sits in a `KeyboardAvoidingView` sibling below the transcript. It never uses an assumed keyboard height or absolute positioning.
- iOS `InputAccessoryView` was removed after the SDK warned it is deprecated; single-line fields use a Done return key, and multiline text uses drag-to-dismiss.

## Unknown or missing server data

| Situation | UI behavior |
| --- | --- |
| Inventory status for an unattached session | Omitted. The daemon's persisted list reports `idle` for every unattached session, which is not an execution verdict. Working/Ready appears only for sessions the adapter has observed live |
| Unknown status string | “Status unavailable” plus the raw value in diagnostics |
| No plan | No Plan tab. The Plan tab appears only when the server reports at least one todo |
| Permissions, push, file upload | Not advertised; no controls. Server details says notifications are unavailable |
| Edit statistics without a Git diff | No diff view; parameters/results are shown as tool data |
| Truncated tool output | Explicit line/byte note, bounded expansion |

## Development-only paths

| Path | Guard |
| --- | --- |
| Loopback `ws://` address | `parseServerAddress` rejects cleartext for non-loopback hosts |
| Android cleartext | `usesCleartextTraffic` only when `JCODE_INSECURE_DEV=1` at build time |
| Simulator profile import | `importDevPairingFile` returns early when `__DEV__` is false and accepts only loopback hosts |
| Coarse pairing deep link | Prefills host/code only; it never sends, cancels, or approves. An explicit Pair tap is still required |

## Deliberate deviations from the exhibit

- The exhibit's desktop frames, exhibition navigation, scripted timing, and fixture conversations are absent.
- Session titles come from the server. In staging they are long first-message titles, which wrap to two lines; no synthesized short title is invented.
- The app does not show a synthetic “Working” state or progress ring in the session list for sessions it has not observed.
- The Plan tab is hidden when there is no plan instead of showing an empty percentage.
- No QR image is generated on the phone; only camera scanning and paste/manual entry are implemented.
