# Wu wei: design handoff for the Ziran client

This folder holds the complete Wu wei design for the jcode client. The product
name is **Ziran**; it was formerly JCode Mobile, and "Wu wei" is the name of
the 0.7.0 design. There are two targets:

- **Android phone.** Native Kotlin with Jetpack Compose. Tauri is not used.
- **macOS desktop.** SwiftUI, with AppKit where SwiftUI is not enough.

Every board is a working HTML page. Animations play, and the interactive
boards respond to clicks, typing and gestures. Treat the boards as the source
of truth for layout, colour, copy and motion.

## How to view

1. Open `index.html` in Chrome, Safari or Firefox. It shows every board at
   reduced size.
2. Click "open full size" on a board to use it at its real size, at 100% zoom.
   The phone boards are 390×844 and the Mac windows are 1280×800.
3. Fonts come from Google Fonts: EB Garamond for text, JetBrains Mono for
   machine text. Without internet the boards fall back to Georgia and Menlo.
   Ship both fonts inside the app.

No server or build step is needed. Every board runs from `file://`.

## Folder map

| Path | What it is |
| --- | --- |
| `index.html` | Gallery of all boards |
| `boards/*.dc.html` | One board per file. The `<style>` in `<helmet>` holds every colour, size and `@keyframes`. The `<script data-dc-script>` holds the board's logic (state, timers, gestures) |
| `boards/support.js` | A small runtime that renders `{{holes}}`, `<sc-if>`, `<sc-for>` and `on*` events. It is not part of the app |
| `assets/` | Painting crops (Metropolitan Museum open access, CC0, and old public-domain scrolls), blurred washes for the Mac header, and the paper grain |
| `source/` | The Python generators that wrote the boards (`build3.py`, `gestures.py`, `mac.py`), the Flow prototype logic (`flow2.js`) and the canvas layout (`canvas.json`) |

## Boards

### Phone (Android)

Each phone screen has a day board and a night board (`-Night`).

| Board | Screen | What to look at |
| --- | --- | --- |
| `Start` | Pairing | Server field, one-time code, seal button. The painting's step dots are the progress |
| `Sessions` | Thread list | Trigram seal per agent, state marks (indigo dot = waiting for you, braille spinner = working, ring = done, grey dot = resting) |
| `Main` | A thread | `1›` prompt, numbered tool steps, running step with live elapsed time, composer with the ink underline and send seal |
| `Model` | Model and effort | Model list, six ink dots for reasoning effort ("how much ink") |
| `Scenes` | Scene and theme | 12 paintings, day/night switch |
| `Live` | Live work | Looping timeline: thinking → tool calls appear → diff unfolds → tests → answer streams word by word |
| `Flow` | **Interactive prototype** | Real page transitions and every Android gesture. Press play and use it |
| `Motion` | Motion spec | Every movement with its timing and the Android API behind it |

The `Flow` prototype:

- Tap the seal to go to the threads list.
- Tap fox to open the thread with an ink-drop transition.
- Drag from the left edge for predictive back.
- On the threads list:
  - swipe a row left to archive it, with an undo bar;
  - long-press a row for actions;
  - pull down to refresh.
- Every tap leaves an ink ripple.

### Mac

Each Mac window also has a day board and a night board.

| Board | Window | What to look at |
| --- | --- | --- |
| `Mac-Main` | **Interactive main window** | Sidebar, thread and inspector. See the list below |
| `Mac-Live` | Live work | The phone's live timeline at desktop size |
| `Mac-Start` | Pairing window | Connects to jcode on the same Mac without a code |
| `Mac-Settings` | Settings | Scene, Brush and Servers tabs |
| `Mac-MenuBar` | Menu bar companion | Allow or deny commands without opening the window |
| `Mac-Native` | Build notes | Each element and animation mapped to SwiftUI/AppKit APIs. Targets macOS 14; two items need macOS 15 |

What to try in `Mac-Main`:

- Switching threads cross-fades the painting.
- The search icon opens Go to (⌘K): type to filter, use ↑↓, ↩ to open, esc to close.
- The model chip opens a popover with the model list and effort.
- The sidebar and the inspector each fold away.
- In crane, allow or deny the command.
- Messages sent while fox works are queued.

## Design tokens

| Token | Day | Night |
| --- | --- | --- |
| paper (background) | `#E5EBE0` | `#0E1613` |
| paper2 (fields, panels) | `#D6E0D3` | `#17221D` |
| ink (text) | `#16231D` | `#DCE8DE` |
| ink2 | `#2D3C34` | `#BCCFC1` |
| ink3 (secondary) | `#56685D` | `#86998C` |
| line | `#BCCBBE` | `#24342C` |
| seal (accent: indigo; send, done) | `#2E4374` | `#93A6D9` |
| on-seal | `#F1F4EC` | `#10140F` |
| blue (working) | `#3F7484` (Mac `#34677A`) | `#7FAFBD` |
| green (added, healthy) | `#3B7A5C` (Mac `#2F6B4E`) | `#6FA88A` |
| painting filter | none | brightness .58, saturate .85 |

The Mac adds a few surface tokens. `side`, `panel`, `sel`, `hov`, `shadow` and
`scrim` are set as CSS variables on each Mac board's root.

**Type.** EB Garamond is used for all prose: titles are 28px/500, body is
16–17px, and secondary text is italic. JetBrains Mono, 10.5–13.5px, is used for
anything a machine said: tool names, paths, model ids, elapsed times.

**Symbols.** The UI has no Chinese characters. Each agent has a trigram seal:
three strokes, where solid = 1 and broken = 0, read from top to bottom.

| Agent | Trigram |
| --- | --- |
| crane | 111 |
| fox | 101 |
| heron | 010 |
| owl | 100 |
| moth | 011 |

The send seal is a single rising brush stroke. Seals are indigo squares with a
slight rough edge.

**Paintings.** One painting crop sits at the top of each phone screen, with a
slow drift (34s Ken Burns) and a mist band. It fades into the paper. On the
Mac, the painting sits in the sidebar head and a blurred wash bleeds into the
thread header.

## Motion

- **Easing:** `cubic-bezier(.22,1,.36,1)` everywhere unless stated.
- **Performance:** animate only `opacity` and `transform`. Heights ease with
  `grid-template-rows 0fr → 1fr`.
- **Specs:** the full list with timings is in `boards/Motion.dc.html`. For the
  Mac, see `boards/Mac-Native.dc.html`.

| Movement | Behaviour | Timing | Native note |
| --- | --- | --- | --- |
| Touch | An ink ripple spreads from the fingertip and fades. | 650 ms · ease-out | Replaces the Material ripple. |
| Press | Controls sink to 97 %, seals to 90 % with a small tilt. | 180 ms | Haptic: CONTEXT_CLICK on seals. |
| Open a thread | Ink drops from the tapped row and spreads to fill the page. | 900 ms | Forward navigation; previous page dims behind. |
| Open a picker | Model and scene unroll from the top behind a thin ink rod. | 800 ms | Full-screen sheet; back rolls it away. |
| Back (button or system) | The page slides right; the one beneath returns from a 22 % parallax. | 420 ms | OnBackPressedDispatcher. |
| Predictive back | Drag from the left edge: the page shrinks to 90 %, rounds its corners and follows the finger. Past a third it commits; short of that it settles back. | follows finger · 320 ms settle | Android 14+: OnBackAnimationCallback; enableOnBackInvokedCallback="true". |
| Swipe a thread left | An ink wash reveals archive; past 110 px the row leaves, the list closes the gap, and an undo bar rises. | follows finger · 450 ms collapse · 4.6 s undo | Haptic tick on commit. |
| Long press | After 450 ms the row lifts with a soft shadow, a haptic tick, then the action sheet slides up. | 450 ms hold · 420 ms sheet | HapticFeedbackConstants.LONG_PRESS. |
| Pull to refresh | An ink ring fills as you pull, turns while the list reloads, then settles. | follows finger · 450 ms settle | Only at the top of the list; native overscroll stretch elsewhere. |
| Sheet | Slides up over a dimming scrim; tap the scrim or drag down to dismiss. | 420 ms | Back closes the sheet before the page. |
| Keyboard | The composer rides the keyboard frame by frame; the newest line stays in view. | IME-driven | WindowInsetsAnimationCompat. |
| Thinking | A thin line grows as words settle into the page; when done it folds to "thought for 4 s". | 500 ms per word, 65 ms stagger | Polite live region; collapse eases height. |
| Tool call | Ink drop, then the intent slides in; a hairline of ink flows while it runs; the drop becomes an indigo ring as it finishes. | 550 ms in · 900 ms ring | Rows change state in place; nothing jumps. |
| Diff and output | Panels unfold under their row and fold away when the step ends. | 750 ms height ease | Animate height smoothly. |
| Scene and theme | Paintings cross-fade and drift slowly; day and night ease their colours. | 1.2 s fade · 34 s drift · 600 ms theme | Follows system dark mode unless chosen. |
| Reduced motion | Everything above becomes a short fade. Gestures still follow the finger. | ≤ 150 ms | ANIMATOR_DURATION_SCALE. |

## What the boards are not

- The boards' copy and threads (fox, crane, heron, owl, moth) are sample data.
  Real data comes from the jcode adapter: `/v2/pair`, and the `/v2/ws`
  WebSocket with subprotocol `jcode.mobile.v4`.
- `support.js` and the `<sc-if>` and `<sc-for>` tags are the design tool's
  format. Rebuild the screens natively; don't embed the HTML.
