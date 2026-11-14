# Stillness 0.4 · interaction system

Worker B · branch `feat/stillness-gestures` · app `apps/stillness`.

Scope: issues #69, #70, #71, #72, #48, #77, #50, #51, #52, #44, #36.
Protocol/client files (`lib/controller.ts`, `protocol.ts`, `adapter.ts`, `cache.ts`,
`credentials.ts`) were not modified.

## 1. Architecture

| Layer | File | Responsibility |
| --- | --- | --- |
| Motion | `src/components/motion.ts` | One dependency-free spring loop, velocity tracker, rAF value batching, reduced-motion check, haptics, clipboard fallback, scroll memory, timing curves |
| Gestures | `src/components/gestures.ts` | Axis-locked pointer drag, predictive-back stack, one-open-row registry, native pull-to-refresh |
| Drawer | `src/components/GestureDrawer.tsx` | Edge-following drawer, rubber band, velocity spring, focus trap, ESC/back close |
| Sheet | `src/components/BottomSheet.tsx` | Grab-handle drag, 1:1 tracking, velocity dismiss, snap-back, focus trap, scrim guard |
| Rows | `src/components/SwipeableRow.tsx` | Swipe left/right trays, 1:1 content tracking, long press, one open row |
| Palette | `src/components/QuickSwitcher.tsx` | `⌘/Ctrl+K` quick switcher, cached search, pinned group, offline use |
| Timeline | `src/components/Timeline.tsx`, `src/lib/timelineJournal.ts` | Chronological live turn, history grouping, tool cards, copy controls |
| Markdown | `src/components/RichMarkdown.tsx` | Code copy, diff fences, lazy safe images, external links |
| Models | `src/components/ModelPicker.tsx`, `src/lib/modelSearch.ts` | Instant search, provider chips, grouped routes, disambiguation |
| Reasoning | `src/components/ReasoningSlider.tsx` | Discrete snapping slider with haptics and ARIA |
| Shelf | `src/lib/sessionPrefs.ts`, `src/lib/sessionShelf.ts`, `src/components/UndoToast.tsx` | Server-scoped pinned/archived preferences, undo toast |
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
| #71 Quick switcher | **PASS** | `⌘/Ctrl+K` plus header command button; searches `state.sessions` for the paired server; pinned first; offline label; archived sessions hidden. Node and browser checks pass. Screenshot `06`. |
| #51 / #50 / #52 Model picker | **PASS** | Search across model/provider/API, provider chips with availability counts, grouping, duplicate names disambiguated by provider + API method + availability, exact `selectModel(model, provider)` call. Screenshots `08`, `09`. |
| Reasoning effort slider | **PASS** | Six labeled stops, snap, haptic (no-op on unsupported platforms), keyboard arrows/Home/End, ARIA slider, commit on release. Screenshot `10`; keyboard check passes. |
| #36 Permission waiting state | **PASS (code), visual NOT_RUN** | Persistent `Waiting for your approval` panel above the composer with Approve/Deny wired to `controller.respondPermission`. No live daemon produced a permission event during capture, so there is no screenshot. |
| #44 Title stability | **PASS** | `confirmedSessionTitle` uses the snapshot while it exists and the inventory only as fallback; the two are never merged. Node check passes. |
| Accessibility | **PASS** | 44 px targets globally, focus-visible rings, aria labels on icon buttons, focus traps in drawer/sheet, reduced motion honored. Contrast pairs measured below. |

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

## 4. Controller methods the coordinator must add

`src/lib/sessionActions.ts` feature-detects these at runtime. Until they exist,
archive and pin are phone-local and labelled that way, and delete reports that
it is unavailable without changing anything.

```ts
archiveSession(sessionId: string): Promise<boolean>;
restoreSession(sessionId: string): Promise<boolean>;
deleteSession(sessionId: string): Promise<boolean>;
toggleFavorite(sessionId: string): Promise<boolean>;
```

Contract: resolve `true` on an authoritative server acknowledgement, resolve
`false` (or throw) on rejection. No method should mutate the local list before
the adapter confirms. Once present, the UI calls them automatically from swipe
trays and the row menu.

Recommended protocol work (client layer): `sessions.archive`,
`sessions.restore`, `sessions.delete`, and a favorite/pin verb. There is no
unread field in `SessionSummary`, so the switcher deliberately shows no unread
count; if the adapter adds `unread_count` or `has_unread`, it can be rendered
directly.

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
✓ 137 modules transformed.
dist/assets/index-CkJg4ysn.css   54.28 kB │ gzip:  10.95 kB
dist/assets/index-f6uc_CJH.js   476.85 kB │ gzip: 155.85 kB
✓ built in 528ms
```

Zero TypeScript errors. The only console warning is the repository-level
`tsconfig.json` extending `expo/tsconfig.base`, which is unrelated to this app.

### Pure logic checks

`node scripts/check-stillness-ux.mjs` → 7/7 passed: tool labels, tool summaries,
diff classification, history grouping, model filtering/grouping, timeline
ordering, title stability. The script relies on Node's native TypeScript type
stripping (Node 22.18 or newer); it adds no test dependency.

### Browser interaction checks

`node .staging/ui-0.4/verify.mjs` (not committed, staging only) → 14/14 PASS:

1. Edge swipe opens the drawer and it follows the finger.
2. Drawer closes on Escape without navigating.
3. Session row swipes left; only one row stays open.
4. Swipe right pins locally and the row reports it.
5. Long press opens the session context menu.
6. Quick switcher filters and excludes archived sessions.
7. Pull-to-refresh follows the finger and reports offline honestly.
8. Bottom sheet drags down and dismisses.
9. History back closes the top sheet, not the session.
10. Model search and provider chips narrow the catalog.
11. Reasoning slider snaps with the keyboard and updates ARIA.
12. Every icon button has an accessible name.
13. Reduced motion is a crossfade, not a spring.
14. Drawer spring can be interrupted mid-close.

The capture run used a seeded offline cache (`127.0.0.1:7666` was intentionally
not running); the only console errors were expected WebSocket refusals. This
verifies offline rendering, not a live daemon turn.

### Screenshots

`/Users/hootie/src/jcode-mobile-app-ui/.staging/ui-0.4/`

| File | Content |
| --- | --- |
| `01-home.png` | Home with pinned first session, command affordance, row menu |
| `02-drawer.png` | Drawer open |
| `03-session-restored.png` | Session restored from the phone cache |
| `04-sessions.png` | Sessions list, archived hidden, refresh controls |
| `05-row-swiped.png` | Swipe-left tray with Archive/Delete |
| `06-quick-switcher.png` | Command-palette switcher, pinned group, offline notice |
| `07-session-timeline.png` | Transcript at the latest activity |
| `07b-session-top.png` | Chronological history, tool card, copy controls |
| `08-model-picker.png` | Model sheet entry |
| `09-model-search.png` | Search plus provider chips, duplicate route disambiguation |
| `10-reasoning-slider.png` | Discrete reasoning slider |
| `11-copied.png` | Copy confirmation (check icon plus toast) |
| `12-tool-diff.png` | Expanded tool input and diff output |
| `13-pull-to-refresh.png` | Pull gesture with `RELEASE TO REFRESH` |

`report.json` and `verify.json` hold the capture and interaction results.

## 7. Known limits

- **Live turn capture NOT_RUN.** The seeded session proves history rendering,
  but no live daemon streamed a turn during capture. The live timeline journal is
  covered by the node check and renders through the same components.
- **Permission panel screenshot NOT_RUN.** It requires a live `permission_request`
  event; there was no daemon. The panel is mounted from `state.live.permission`
  and uses the existing `respondPermission` action.
- **Delete BLOCKED on controller.** The UI confirms, then reports that delete is
  unavailable unless `deleteSession` exists. It never removes a session locally.
- **Unread indicator NOT_APPLICABLE.** No authoritative unread field exists in
  the protocol, so none is shown.
- **Android/iOS native gestures NOT_RUN.** This work is browser-verified
  Chromium at an iPhone viewport. The Android worker owns native shell changes;
  the `jcode:back` contract above is the seam.
- Haptics no-op where `navigator.vibrate` is absent (notably iOS Safari).
