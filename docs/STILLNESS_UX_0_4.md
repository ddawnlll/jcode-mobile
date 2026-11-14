# Stillness 0.4 · interaction system

Worker B · branch `feat/stillness-gestures` · app `apps/stillness`.

Scope: issues #69, #70, #71, #72, #48, #77, #50, #51, #52, #44, #36, #49, #64,
#76, plus the native shell, composer attachments and authoritative
archive/restore/favorite. Protocol/client files (`lib/controller.ts`,
`protocol.ts`, `adapter.ts`, `cache.ts`, `credentials.ts`) and the bridge
(`lib/native.ts`, `lib/native-types.ts`) were not modified.

## 1. Architecture

| Layer | File | Responsibility |
| --- | --- | --- |
| Motion | `src/components/motion.ts` | One dependency-free spring loop, velocity tracker, rAF value batching, reduced-motion check, haptics, clipboard fallback, scroll memory, timing curves |
| Gestures | `src/components/gestures.ts` | Axis-locked pointer drag, predictive-back stack, one-open-row registry, native pull-to-refresh |
| Drawer | `src/components/GestureDrawer.tsx` | Edge-following drawer, rubber band, velocity spring, focus trap, ESC/back close |
| Sheet | `src/components/BottomSheet.tsx` | Grab-handle drag, 1:1 tracking, velocity dismiss, snap-back, focus trap, scrim guard |
| Rows | `src/components/SwipeableRow.tsx` | Swipe left/right trays, 1:1 content tracking, long press, one open row |
| Palette | `src/components/QuickSwitcher.tsx` | `⌘/Ctrl+K` quick switcher, cached search, server favorites with a phone-pin fallback, offline use |
| Timeline | `src/components/Timeline.tsx`, `src/lib/timelineJournal.ts` | Chronological live turn, history grouping, tool cards, copy controls |
| Markdown | `src/components/RichMarkdown.tsx` | Code copy, diff fences, lazy safe images, external links |
| Models | `src/components/ModelPicker.tsx`, `src/lib/modelSearch.ts` | Instant search, provider chips, grouped routes, disambiguation |
| Reasoning | `src/components/ReasoningSlider.tsx` | Discrete snapping slider with haptics and ARIA |
| Shelf | `src/lib/sessionPrefs.ts`, `src/lib/sessionShelf.ts`, `src/components/UndoToast.tsx` | Server-authoritative archive/favorite calls, server-scoped offline fallback, undo toast |
| Labels | `src/lib/toolLabels.ts` | Tool intent labels, diff classification, history grouping |

No animation or gesture dependency was added. Motion uses `transform` and
`opacity` only. Every interactive control is at least 44 × 44 CSS px.

## 2. Feature matrix

| Issue | Status | Evidence |
| --- | --- | --- |
| #69 Gesture engine | **PASS** | `verify.mjs` checks edge-follow, ESC close, one-open-row, velocity snap, long press, pull-to-refresh, sheet drag dismiss, history back. Screenshots `02`, `05`, `13`. |
| #70 Motion system | **PASS** | Shared spring in `motion.ts`; screen stage 220 ms translate+fade; reduced motion is a 180 ms crossfade; scroll memory per screen/session; streaming text batched on rAF. `verify.mjs` reduced-motion check. |
| #69 Predictive back | **PASS** | `useBackGuard` installs a history guard only while a layer is open, closes the top layer on `popstate`, `jcode:back`, or Escape. `verify.mjs` "history back closes the top sheet" passes; drawer ESC passes. |
| #72 / #48 Conversation timeline | **PASS** | `TimelineJournal` keeps observed order across reasoning, tools and assistant blocks; history is grouped and rendered in order; stable keys per call id; tool input/output expand; copy per block. Node check `timeline keeps observed order` passes. Screenshots `07`, `07b`, `12`. |
| #77 Copy icons | **PASS** | One-tap copy on user, assistant, reasoning, tool call, tool input, tool output, code fences, context. Transient check icon plus `Copied.` toast. Screenshot `11`. |
| #71 Quick switcher | **PASS** | `⌘/Ctrl+K` plus header command button; searches `state.sessions` for the paired server; server favorites first with a phone-pin fallback; offline label; archived sessions hidden. Node and browser checks pass. Screenshot `06`. |
| Archive / restore / favorite | **PASS** | Swipe trays and the row menu call `sessions.archive`, `sessions.restore` and `sessions.favorite` through the controller. `SessionSummary.favorite` and `.archived` are authoritative while connected. Undo restores on the server. Offline archive attempts fail without changing the row or the local shelf. |
| Delete | **UNSUPPORTED (honest)** | The controller sends `sessions.delete`; the adapter refuses because the daemon has no delete capability. The UI reports the refusal and removes nothing. |
| #51 / #50 / #52 Model picker | **PASS** | Search across model/provider/API, provider chips with availability counts, grouping, duplicate names disambiguated by provider + API method + availability, exact `selectModel(model, provider)` call. Screenshots `08`, `09`. |
| Reasoning effort slider | **PASS** | Six labeled stops, snap, haptic (no-op on unsupported platforms), keyboard arrows/Home/End, ARIA slider, commit on release. Screenshot `10`; keyboard check passes. |
| #36 Permission waiting state | **PASS (code), visual NOT_RUN** | Persistent `Waiting for your approval` panel above the composer with Approve/Deny wired to `controller.respondPermission`. No live daemon produced a permission event during capture, so there is no screenshot. |
| #44 Title stability | **PASS** | `confirmedSessionTitle` uses the snapshot while it exists and the inventory only as fallback; the two are never merged. Node check passes. |
| Accessibility | **PASS** | 44 px targets globally, focus-visible rings, aria labels on icon buttons, focus traps in drawer/sheet, reduced motion honored. Contrast pairs measured below. |
| Native bridge shell | **PASS (web), native NOT_RUN** | `useNativeShell` installs once after credentials restore. Deep links route to the exact session or new-session, pending shares are consumed with per-server scoping, insets become CSS variables, lock status gates the app with a focus-trapped Unlock, and native back closes the top layer before the app can exit. Event channels and pending drains are registered explicitly so a refused call surfaces its native error code. Off Android the install publishes `unsupported`, not `failed`. |
| Composer attachments (#49/#64) | **PARTIAL** | 44 px Add image control with an accessible name, 4 MiB/type validation, preview strip with remove buttons, 4-image count, Send disabled while reading, async reads fenced to the session that opened the picker. Native picker uses `readPickedImage`; web uses a file input with `FileReader`. The unsupported-capability message is browser verified; a live upload is NOT_RUN. |
| Native settings (#76) | **PARTIAL** | Notifications (status, permission request, test post), background sync (status, toggle, run now), haptics and biometric lock (enable, disable, lock now) read real bridge status and print native error codes. Web shows "Android only"; a failed install shows the install error instead. Android device states were not exercised in this environment. |

## 3. Contrast check

WCAG 2.2 ratios against the active surface for the pairs the new UI uses:

| Pair | Ratio |
| --- | --- |
| light ink / bg | 14.35 |
| light secondary / bg | 6.06 |
| light quiet / bg | 4.90 |
| light secondary / accent-soft | 5.71 |
| light ink / accent-soft | 13.52 |
| light quiet / surface | 5.22 |
| dark ink / bg | 14.68 |
| dark secondary / bg | 9.48 |
| dark quiet / bg | 6.88 |
| dark secondary / accent-soft | 6.76 |
| dark ink / accent-soft | 10.46 |
| light danger / bg | 5.41 |
| dark danger / bg | 8.40 |

Small accent-colored text in new components was moved to `--secondary`; the
accent remains on borders, fills, and decorative glyphs.

## 4. Server session state (integrated)

The controller now exposes these methods. `src/lib/sessionActions.ts` still
feature-detects them so an older controller build fails honestly.

```ts
archiveSession(sessionId: string): Promise<boolean>;
restoreSession(sessionId: string): Promise<boolean>;
deleteSession(sessionId: string): Promise<boolean>;
toggleFavorite(sessionId: string): Promise<boolean>;
```

The adapter verbs are `sessions.archive`, `sessions.restore`, `sessions.favorite`
and `sessions.delete`. `delete` is refused because the daemon has no delete
capability. Each acknowledged mutation updates `SessionSummary.archived` or
`.favorite`, and the UI renders those fields while connected.

Phone-local `sessionPrefs` is now only an ordering and offline fallback cache:

- It is mirrored after an acknowledged archive/restore/favorite so offline lists
  match the last server state.
- Offline, a phone pin is labelled "Pinned on this phone".
- A cached server favorite stays server-owned offline and refuses a local
  change with "Favorites are stored on the server. Reconnect to change this one."
- A local pin never overrides `favorite: false` from a connected adapter.

There is no unread field in `SessionSummary`, so the switcher deliberately shows
no unread count. If the adapter adds `unread_count` or `has_unread`, it can be
rendered directly.

## 5. Native back contract

The WebView history stack already handles Android back in the browser and in
Tauri: opening a sheet, drawer, row menu, or switcher pushes a guard entry, and
back closes only the top layer.

If the native shell intercepts the hardware button itself, it must dispatch:

```ts
window.dispatchEvent(new CustomEvent('jcode:back'));
```

or call the exported `requestBack()` helper. The shell should let the event
continue to system navigation only when `hasOpenBackLayer()` is false. The
hooks never intercept back when no layer is open.

## 6. Verification

### Build

```text
$ tsc --noEmit && vite build
✓ 147 modules transformed.
dist/assets/index-DKpM_9A0.css   57.58 kB │ gzip:  11.52 kB
dist/assets/index-CqzSq9sF.js   512.05 kB │ gzip: 166.16 kB
✓ built in 530ms
```

Zero TypeScript errors. The only console warning is the repository-level
`tsconfig.json` extending `expo/tsconfig.base`, which is unrelated to this app.
Rollup also reports the 500 kB chunk advisory for the single app chunk. It is a
size warning, not a build failure.

### Pure logic checks

`node scripts/check-stillness-ux.mjs` → 14/14 passed: tool labels, tool
summaries, diff classification, history grouping, model filtering/grouping,
timeline ordering, title stability, server-authoritative favorite/archive
selection, offline fallback, favorite-first ordering, image rules, deep-link
intents, share plans, and per-server pending-share scoping. The script relies on
Node's native TypeScript type stripping (Node 22.18 or newer); it adds no test
dependency.

### Browser interaction checks

`node .staging/ui-0.4/verify.mjs` (not committed, staging only) → 18/18 PASS:

1. Edge swipe opens the drawer and it follows the finger.
2. Drawer closes on Escape without navigating.
3. Session row swipes left; only one row stays open.
4. Swipe right pins locally and the row reports it.
5. A cached server favorite is visible and refuses an offline change.
6. Offline archive calls the server path, fails honestly, and leaves the row.
7. Long press opens the session context menu.
8. Quick switcher filters and excludes archived sessions.
9. Pull-to-refresh follows the finger and reports offline honestly.
10. Bottom sheet drags down and dismisses.
11. History back closes the top sheet, not the session.
12. Model search and provider chips narrow the catalog.
13. Reasoning slider snaps with the keyboard and updates ARIA.
14. Every icon button has an accessible name.
15. Reduced motion is a crossfade, not a spring.
16. Drawer spring can be interrupted mid-close.
17. Add image is 44 px with an accessible name, reports the missing v3 image
    capability, and adds nothing.
18. Settings shows "Android only" on web with no fabricated native toggles, no
    lock gate, and no false "bridge unavailable" failure.

The capture run used a seeded offline cache (`127.0.0.1:7666` was intentionally
not running); the only console errors were expected WebSocket refusals. This
verifies offline rendering and the refusal paths. The acknowledged
archive/restore/favorite round trips are covered by the adapter's Rust tests and
the controller contract; a live v3 adapter/daemon round trip was not run during
this UI pass.

### Screenshots

`/Users/hootie/src/jcode-mobile-app-ui/.staging/ui-0.4/`

| File | Content |
| --- | --- |
| `01-home.png` | Home with favorites first, command affordance, row menu |
| `02-drawer.png` | Drawer open |
| `03-session-restored.png` | Session restored from the phone cache |
| `04-sessions.png` | Sessions list, archived hidden, refresh controls |
| `05-row-swiped.png` | Swipe-left tray with Archive/Delete |
| `06-quick-switcher.png` | Command-palette switcher, favorites group, offline notice |
| `07-session-timeline.png` | Transcript at the latest activity |
| `07b-session-top.png` | Chronological history, tool card, copy controls |
| `08-model-picker.png` | Model sheet entry |
| `09-model-search.png` | Search plus provider chips, duplicate route disambiguation |
| `10-reasoning-slider.png` | Discrete reasoning slider |
| `11-copied.png` | Copy confirmation (check icon plus toast) |
| `12-tool-diff.png` | Expanded tool input and diff output |
| `13-pull-to-refresh.png` | Pull gesture with `RELEASE TO REFRESH` |

`report.json` and `verify.json` hold the capture and interaction results.
Screenshots were captured for the gesture/timeline release. The archive and
favorite wiring changes labels and state ownership, not layout, and the
coordinator's evidence under `docs/evidence/` was not overwritten.

## 7. Known limits

- **Live turn capture NOT_RUN.** The seeded session proves history rendering,
  but no live daemon streamed a turn during capture. The live timeline journal is
  covered by the node check and renders through the same components.
- **Permission panel screenshot NOT_RUN.** It requires a live `permission_request`
  event; there was no daemon. The panel is mounted from `state.live.permission`
  and uses the existing `respondPermission` action.
- **Delete unsupported by the daemon.** The controller sends `sessions.delete`,
  the adapter refuses, and the UI reports the refusal. Nothing is removed
  locally or remotely.
- **Offline server changes are refused.** Archiving requires the adapter.
  Favorite changes on a cached server favorite require a connection. Phone pins
  remain available for sessions the server does not report as favorites and are
  labelled "Pinned on this phone".
- **Live v3 mutation round trip NOT_RUN.** The UI harness ran against a seeded
  offline cache to prove refusal and fallback behavior. The acknowledged server
  mutations rely on the controller methods and adapter Rust tests merged by the
  coordinator.
- **Android native paths NOT_RUN.** Deep link delivery, share intake, insets,
  biometric lock, notifications, background sync, haptics and the native image
  picker require the Android shell. The web build verifies the no-op bridge
  path, the unsupported-capability messages, and the Android-only settings
  state, not a device run.
- **Live attachment round trip NOT_RUN.** The composer rejects images when the
  adapter does not advertise `attachments.images`. A v3 adapter with that
  capability was not running during this pass, so an actual upload was not
  exercised.
- **Unread indicator NOT_APPLICABLE.** No authoritative unread field exists in
  the protocol, so none is shown.
- **Android/iOS native gestures NOT_RUN.** This work is browser-verified
  Chromium at an iPhone viewport. The Android bridge is owned by the native
  worker; the UI wiring and the `jcode:back` contract above are covered by
  code inspection and the web no-op path only.
- On web, haptics no-op where `navigator.vibrate` is absent (notably iOS
  Safari). The Android shell routes the same calls through the native haptics
  command, which honors the Settings toggle.

## 8. Native shell and attachments

`lib/native.ts` and `lib/native-types.ts` are the merged Android bridge client.
They are bridge-owned and were not edited by this UI pass. Every wrapper throws
a `NativeBridgeError` with a code; the UI prints `code: message` instead of a
generic failure.

`components/useNativeShell.ts` wires the bridge once after credentials restore:

- Deep link: session id or session path opens that session; `new_session` opens
  the creation surface; unknown links toast instead of disappearing. A link that
  arrives before pairing or while the adapter is still connecting says so.
- Share: text and URLs go into the draft; image URIs are read through
  `readPickedImage` and added only when the adapter advertises
  `attachments.images`. Unsupported files and read failures are always named in
  the toast. Content that arrives before a session surface exists is held in
  `lib/pendingShare.ts`, scoped to the paired server, and applied when a
  session on that server mounts. A second inbound share that arrives while the
  first is being read is queued, not dropped.
- Insets: `top`, `right`, `bottom`, `left` and the IME bottom become
  `--native-inset-*` / `--native-ime-bottom` CSS variables. Existing safe-area
  rules now read those variables, and the native IME value lifts the composer.
- Lock: the biometric status is published to a store. `LockGate` covers the app
  while locked, traps focus, and Unlock calls `unlockWithBiometrics`. A refused
  or cancelled unlock prints the native result.
- Back: the handler closes the top overlay with `requestBack()` and returns
  true. With no overlay open it returns false so Android can leave the app.
- Failure paths: the install result is published as `checking`, `unsupported`,
  `ready` or `failed` in `components/nativeRuntime.ts`. The shell registers each
  event channel itself so one refused channel is named and the rest still run.
  `installNativeBridge` drains pending intents and layout with internal catch
  blocks; the shell immediately re-reads pending deep links, pending shares and
  layout so a refused drain surfaces instead of disappearing.

`components/NativeSettings.tsx` reads the published shell state, so the web
target shows "Android only" while a real install failure shows its
`code: message`. The haptics toggle is not decorative: `haptic()` in
`components/motion.ts` now calls the native haptics command inside the Tauri
shell, which honors `hapticsEnabled`; browsers keep the `navigator.vibrate`
fallback.

The composer keeps attachments in `controller.state.attachments`. It never
opens a picker when `hasImageAttachmentSupport()` is false, and Send stays
disabled while a file is being read or while unsupported attachments exist.
The preview strip is driven by controller state, so a successful send clears it
automatically.

## 9. Completion matrix

| Area | Status | Notes |
| --- | --- | --- |
| Native shell wiring | **PASS (web) / NOT_RUN (device)** | App installs once through `useNativeShell`; explicit status, deep link, share, back, insets, lock gate. The web path proves the `unsupported` branch only. |
| Composer attachments | **PASS (rules and refusal) / NOT_RUN (upload)** | Type/size limits, 4-image cap, 44 px control, preview/remove, reading state, capability message, web `FileReader` path. Native picker and a real adapter upload were not exercised. |
| Native settings (#76) | **PASS (web) / NOT_RUN (device)** | Real status reads, actions, and error codes in code; web shows Android only with no toggles. Device notification, sync, haptics and biometric states were not run. |
| Archive / restore / favorite | **PASS (contract and refusal)** | Controller calls are authoritative; failures leave the row and the local shelf untouched and preserve the adapter message. A live acknowledged round trip is NOT_RUN in this harness. |
| Delete refusal | **PASS (honest refusal)** | Offline: "adapter is offline"; online: the adapter refusal is shown. Nothing is removed. |
| Quick switcher favorites | **PASS** | `SessionSummary.favorite` wins while connected; phone pins are the offline fallback and are labelled as such. |

Bridge or controller methods were not missing for this pass, so no local
interface shim was needed beyond the existing feature-detecting
`lib/sessionActions.ts` wrapper.
