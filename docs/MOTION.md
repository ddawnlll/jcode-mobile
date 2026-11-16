# Motion architecture (0.6.0 Animate!)

Motion is a presentation of real JCode state. It must never imply progress,
success, background work or completion that the source did not report.

## Inventory before 0.6.0

| Surface | Existing motion | Trigger | Engine |
| --- | --- | --- | --- |
| `GestureDrawer` | 1:1 finger tracking, rubber band, interruptible settle | Pointer drag and open/close state | Handwritten rAF spring (`motion.ts`) |
| Sheets and overlays | `translateY` with `--time-sheet` | User opens/closes | CSS transition |
| Screen change | 7 px rise and opacity with `--time-enter` | Navigation | CSS animation |
| Tool chevron | 160 ms rotation | User expands a card | CSS transition |
| Reasoning / tool text | none (only textual state) | Streaming events | React render |
| Torus mark | 26 s rotation | `animated` prop | CSS animation |
| Live status dot | 1.8 s opacity pulse | Active turn | CSS animation |
| Swarm status | 140 ms fade/slide on every mount | Status text change | CSS animation |
| Reduced motion | global duration clamp and `torus-live` disable | OS preference or app setting | CSS |

## Decision for 0.6.0

- **No Motion/Framer Motion dependency is added to Stillness.** Presence,
  chevrons, status color and small entrances are CSS
  `transform`/`opacity` transitions. Adding a layout-animation runtime for
  these cases would add bundle and a second owner for transforms without a
  measured benefit.
- **The handwritten rAF spring stays the only owner of pointer-driven drawer,
  sheet and swipe transforms.** It already preserves velocity across
  interruptions and is cheaper than an additional engine for 1:1 tracking.
- No Lottie/dotLottie asset is added. There is no rare completion state that
  justifies a runtime decoder, license surface and reduced-motion fallback.
- CSS and the spring never drive the same property on the same element.

## Tokens

Defined once in `:root` (`styles.css`):

| Token | Value | Use |
| --- | --- | --- |
| `--time-quick` | 115 ms | Press feedback, chevrons |
| `--time-tool` | 180 ms | Tool/reasoning presence and status color |
| `--time-enter` | 220 ms | Screen entrance |
| `--time-nav` | 240 ms | Reserved for navigation surfaces |
| `--time-drawer` | 280 ms | Drawer settle intent |
| `--time-sheet` | 290 ms | Modal/sheet movement |

`motion.ts` exposes spring curves for the same surfaces (`drawer`, `sheet`,
`row`, `prompt`). Tokens are starting points tuned on-device in #92, not
performance claims.

## Semantic rules

1. **Real triggers only.** Reasoning enters while `reasoning_delta` is live;
   tool cards enter on `tool_start`/`tool_exec` while genuinely active; failed
   cards get a one-shot border transition; a permission card enters when
   `permission_request` arrives; swarm status pulses only when the reported
   status string changes.
2. **Settled state does not replay.** Restored history, snapshot reconciliation
   and journal replay render settled cards without arrival animations. Only
   `running`/`started` items animate on mount. `result` history rows never get
   a success animation.
3. **Stable identity.** Tool cards key on `call_id`; reasoning on its block id;
   assistant rows on message id plus first observed seq; swarm on
   `session_id`. A status change updates the existing element instead of
   remounting it.
4. **No fabrication.** There is no typewriter delay, fake percentage, invented
   background timer, automatic success pulse or completion animation. Exit
   state remains textual and source-backed.
5. **Interruptible.** CSS animations are finite and non-blocking. The drawer
   spring keeps current position and velocity on retarget. Opening a card
   anchors its head position so streaming below cannot move what the user is
   reading.
6. **Bounded cost.** Animate `transform` and `opacity`; do not animate layout,
   box shadow or blur. No per-token element entrance. Tool text is paged and
   only the affected memoized item re-renders. Long output keeps its full copy.
7. **Pause when not visible.** The Torus pauses when offscreen
   (`IntersectionObserver`) and when the document is hidden; the live status
   pulse pauses when the document is hidden.
8. **Reduced motion.** OS `prefers-reduced-motion` and the app preference clamp
   animation/transition durations and disable the Torus spin. Layout and state
   text remain complete. Full/Subtle/Off behavior is defined in `docs/ACCESSIBILITY.md`.

## Scroll and timeline behavior

- Timeline order is the adapter's per-session seq, then stable ids. No local
  receipt timestamp is used for sorting.
- Auto-follow only runs when the user was within 90 px of the bottom. A
  restored mid-history position does not enable auto-follow.
- Expanding/collapsing a tool or reasoning card anchors the card head, so
  content growing above or below does not move the tapped control.
- `Jump to latest` scrolls smoothly only when motion is allowed; otherwise it
  jumps instantly.
- Reconnect/snapshot replacement does not remount the whole transcript: the
  session key stays stable, cards keep their ids and settled items stay
  settled.
- An authoritative idle snapshot removes live assistant/tool blocks already
  present in history (matched by text and `call_id`). Unmatched tools remain
  visible as `unknown`; with no history, all live work is kept. This prevents
  the same completed turn from rendering twice after completion or reconnect.

## Measured impact

| Build | Initial JS, gzip | CSS, gzip | Notes |
| --- | ---: | ---: | --- |
| 0.5.0 Feather and Arrow | 121.50 kB | 11.79 kB | Baseline release |
| 0.6.0 tool presentation (PR #94) | 128.07 kB | 12.51 kB | Source intent, structured cards |
| 0.6.0 motion layer | 128.62 kB | 12.87 kB | +0.55 kB JS (Torus visibility), +0.36 kB CSS |
| 0.6.0 motion + preferences | 128.89 kB | 13.08 kB | +0.82 kB JS / +0.57 kB CSS over PR #94 |

No new dependency. The JS delta is the offscreen Torus observer and the
reasoning/expand wiring, not an animation runtime.

Playwright Chromium on the web target reports first screen 23 ms online and
64 ms shell-to-cached-paint (0.5.0 harness). This is **not** Android frame
pacing. Real device p50/p95/p99 frame time, dropped frames and CPU/RAM remain
`NOT_RUN` until #92. The targets remain ≤16.7 ms at 60 Hz and ≤8.3 ms at 120 Hz;
they are goals, not claims.

## Verification

- `node scripts/check-stillness-ux.mjs`: ordering and descriptor fixtures.
- `bun test ./apps/stillness/test/controller-reconciliation.bun.ts`: stale
  turn, stop conflict, tool settlement and generation fences.
- `bash scripts/stillness-e2e.sh`: real isolated daemon, navigation, send,
  stop, reconnect surfaces.
- 360×800 visual fixture: collapsed/expanded command and edit cards, expand
  anchoring, reduced-motion class behavior.
- Android emulator and physical device measurements: #92, reported separately.
