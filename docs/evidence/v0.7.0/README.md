# Ziran 0.7.0 evidence

Environment: macOS 26 arm64, Android API 35 x86_64 emulator (1080x2400,
420 dpi, 1x animator scale), isolated staging JCode daemon reached through
the adapter on `10.0.2.2:7651`. Nothing here touches the production daemon.

| File | What it shows |
| --- | --- |
| `start-day.png` | Start screen, day palette, butterfly header |
| `threads-paired.png` | Threads after pairing: one session, idle state mark |
| `restored-thread.png` | Process killed and reopened: same server, same session, same transcript and model line |
| `airplane-offline.png` | Airplane mode on: transcript stays, label says saved on this phone, no invented state |
| `airplane-reconnected.png` | Airplane off: reconnect, transcript intact, no duplicate rows, Current state again |
| `flow-compare.mp4` | Left: `design/wu-wei/boards/Flow.dc.html` at 390x844, 2x, driven by Playwright. Right: the app at the same size driven by adb. Both do list, thread, back, swipe, long-press and pull. |

## What the comparison shows

- Palette, type scale, painting header, title block and row geometry match the
  board at the same viewport.
- The app's board-side transitions (ink ripple, slide, sheet, undo bar) are
  present; the design's ink-drop clip and 22 percent parallax are implemented in
  code and measured in `MotionMathTest`, but the recording does not attempt a
  frame-by-frame curve overlay.
- Long press opens the action sheet with a haptic tick. Swipe past 110 px
  archives and raises the undo bar for 4.6 s.

## Not captured

- A 0.25x slowed side-by-side and per-flow `compare.mp4` files for every
  transition (thread open, back, predictive back, archive, long press, pull,
  keyboard).
- Live tool-call streaming on video. The staging daemon answers plain prompts
  (the restored thread shows an assistant reply) but needs a provider route
  with tool use to exercise tool rows end to end.
- 120 Hz frame pacing. `dumpsys gfxinfo` on this emulator reports 86.8 percent
  janky frames with the CPU pinned, which is emulator-bound and is not a
  device claim.
