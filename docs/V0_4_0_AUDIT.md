# JCode Mobile 0.4.0 — battery, privacy, permissions and accessibility audit

Date: 2026-11-14. Scope: Stillness client (web target and Android shell),
Adapter v3, and the native Android bridge shipped with 0.4.0.

Classification: PASS / PARTIAL / BLOCKED / NOT_RUN. Nothing is marked PASS
without an observation produced in this environment.

## Permissions

| Permission | Why | Notes |
| --- | --- | --- |
| `INTERNET` | adapter WebSocket and HTTPS | required |
| `POST_NOTIFICATIONS` | local turn/failure/approval notifications | requested at runtime on Android 13+; denial is respected |
| `USE_BIOMETRIC` | app lock | normal permission; enrollment may be absent |
| `VIBRATE` | haptic feedback | respects the system haptics setting |

Deliberately absent: `CAMERA` (platform camera app via `ACTION_IMAGE_CAPTURE`),
storage/`READ_MEDIA_*` (Photo Picker and SAF grant per-item access), location,
contacts, microphone, `RECEIVE_BOOT_COMPLETED`, foreground service permissions.
No foreground service is declared, so background work cannot masquerade as
always-on.

Status: PASS (manifest inspection). Runtime permission prompt behaviour on a
physical device: NOT_RUN.

## Background and battery

- WorkManager `PeriodicWorkRequest` with the platform minimum of 15 minutes and
  a network constraint; it performs one bounded `GET /health` probe and exits.
- No polling WebView, no infinite loop, no foreground service.
- The on/off preference is persisted natively and checked before every run.
- If the adapter URL is unset, the worker records `not_configured` and does no
  network call.
- Doze may delay or coalesce the run; the worker does not attempt to defeat it.
- Disabling background sync never stops a VPS turn.

Limitation: the scheduled probe is unauthenticated `/health`, so it reports
reachability, not authenticated session reconciliation. Authenticated background
reconciliation needs the device token in a native keystore and an adapter
overview endpoint; it is not claimed for 0.4.0.

Battery impact measurement (mAh, wake locks): NOT_RUN.

## Privacy

- Notification payloads contain no prompt, transcript, tool output, file
  content, or model name. The FCM data block carries `session_id`, `event_id`,
  `kind` and a `jcode://session/<id>` deep link only.
- Lock-screen visible text is generic ("Turn complete", "Approval needed").
- Adapter device tokens are stored hashed; API replies mask push tokens to the
  last six characters.
- The phone stores its adapter credential in the platform credential store; the
  Android native bridge does not log it. Biometric/Keystore protects the app
  lock secret, not the adapter token itself. This distinction is documented in
  `docs/ANDROID_NATIVE.md`.
- Adapter file previews remain confined to configured roots and deny credential
  filenames. No remote filesystem capability was added.
- Error messages shown to the user come from the adapter; the client does not
  invent success states.

Status: PASS (code and tests). A formal data-flow/privacy review by a human:
NOT_RUN.

## Accessibility

- All interactive targets are at least 44 x 44 CSS px in the Stillness UI.
- Focus-visible rings, icon-button aria labels, focus traps in the drawer and
  bottom sheet, and a keyboard-operable reasoning slider are implemented.
- Reduced motion is honoured through `prefers-reduced-motion` and the app motion
  setting; springs become a short crossfade.
- Contrast ratios measured against the active surface (WCAG 2.2):

| Pair | Ratio |
| --- | --- |
| light ink / bg | 14.35 |
| light secondary / bg | 6.06 |
| light quiet / bg | 4.90 |
| light quiet / surface | 5.22 |
| dark ink / bg | 14.68 |
| dark secondary / bg | 9.48 |
| dark quiet / bg | 6.88 |
| light danger / bg | 5.41 |
| dark danger / bg | 8.40 |

- A TalkBack/VoiceOver manual pass and 200% font-scale walkthrough on a physical
  device: NOT_RUN. Large-text layout was not re-measured for 0.4.0.

## Motion and frame performance

- Motion uses `transform` and `opacity` only; one rAF loop per drag; streaming
  text is batched on rAF; drawer/sheet animations are interruptible.
- No animation library was added.
- Frame pacing (jank, 120 Hz behaviour) on the emulator and a physical device:
  NOT_RUN. No FPS numbers are claimed.

## Startup measurements (web target, not native)

From `docs/evidence/v0.4.0/stillness-e2e-perf.txt` (Playwright Chromium,
production build, real adapter):

| Measurement | Value |
| --- | --- |
| Online first interactive screen | 27 ms |
| Cached screen with the WebSocket blocked | 60 ms |
| Shell start to cached paint | 56 ms |
| Cold requests | 6 |
| Cold transfer | 900,318 bytes |

These are browser numbers. Android cold start, memory and network cost are
NOT_RUN and must not be inferred from these values.

## Crash and lifecycle

- `configChanges` keeps the WebView alive across rotation, keyboard and density
  changes.
- Predictive back first offers the web layer a chance to close a layer
  (`jcode:back`) and only then falls back to system navigation.
- Process death / restoration on the emulator: NOT_RUN.
- Network interruption and reconnect: browser e2e covers reconnect against a
  real daemon; Android airplane-mode and process-death tests: NOT_RUN.

## Summary

| Area | Status |
| --- | --- |
| Permission minimization | PASS |
| No fake background execution | PASS |
| Notification payload privacy | PASS |
| Token hashing/masking | PASS |
| Contrast and target sizes | PASS |
| Reduced motion | PASS |
| Screen reader walkthrough | NOT_RUN |
| Battery measurement | NOT_RUN |
| Frame pacing | NOT_RUN |
| Native cold start/memory | NOT_RUN |
| Process death / airplane mode | NOT_RUN |
