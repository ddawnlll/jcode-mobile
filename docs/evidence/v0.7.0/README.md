# Ziran 0.7.0 evidence

Environment: macOS 26 arm64, Android API 35 x86_64 emulator (1080x2400, 420 dpi,
animator scale 1), app `dev.ziran.android` debug build. Adapter v4 on
`10.0.2.2:7651` against an isolated staging daemon
(`.jcode/scratch/jcode-mobile-staging`, socket `run/jcode.sock`). The production
daemon and the production adapter were never touched.

## Screens

| File | What it shows |
| --- | --- |
| `pair-from-link.png` | A pairing link fills the server and code fields before it pairs |
| `threads-paired.png` | Threads after pairing: one session, idle mark, server name from the adapter |
| `restored-thread.png` | The thread: title block, prompt, history from the authoritative snapshot, composer |
| `model-routes.png` | Model picker with the routes the staging daemon reports, effort brush row |
| `keyboard-composer.png` | The composer rides the IME; the newest line stays in view |

## Motion (8 clips, app only)

Each clip is a screen recording of the app at 1x. They are **not** side-by-side
against the design boards; the board video pipeline from the earlier evidence was
not re-run here, so treat these as "the app does this", not "the app matches the
board frame for frame".

| Clip | What it shows | Matches the board |
| --- | --- | --- |
| `thread-open.mp4` | Tapping a row opens the thread: the new page is revealed by a circle from the tap point, the list dims behind it (900 ms) | Yes, the ink-drop origin is the tap |
| `back-button.mp4` | The chevron slides the page right while the page beneath returns from the 22 percent parallax (420 ms) | Yes |
| `back-system.mp4` | The system back key runs the same 420 ms slide | Yes. A plain back press has no gesture progress, so it commits |
| `picker-unroll.mp4` | Model unrolls from the top behind a thin ink rod (800 ms) | Yes |
| `archive-undo.mp4` | Swipe a row past 110 px: it leaves, the list closes the gap, the undo bar rises for 4.6 s; undo restores the session | Yes; the session count returns to 1 |
| `long-press.mp4` | 450 ms hold opens the action sheet with a haptic tick | Yes |
| `pull-refresh.mp4` | Pulling at the top fills the ink ring, then the list reloads and settles | Yes |
| `keyboard.mp4` | Tapping the composer raises the keyboard and the composer moves with it | Yes |

## Verified behaviour, this build

| Item | Result |
| --- | --- |
| Pair through `ziran://pair?...` | PASS: code redeemed, `/v2/ws` connected, hello negotiated v4 |
| Session list | PASS: `sessions.delta` merged, one session, idle mark |
| Open a thread | PASS: `sessions.subscribe` tail 160, snapshot history and runtime shown |
| Model routes | PASS: `models.list` rendered three routes and the effort options |
| Archive and undo | PASS: row leaves, undo restores it |
| Long press | PASS: sheet opens |
| Pull to refresh | PASS: ring fills, list reloads |
| Keyboard | PASS: composer rides the IME |
| Relaunch | PASS: the app returns to the same server and the same thread |

## NOT_RUN or BLOCKED

- **Tool-call timeline:** BLOCKED. The staging provider answers plain prompts; no
  tool-capable route is configured, so `tool_start`/`tool_exec`/`tool_done` rows
  were never driven. Nothing is faked here.
- **Predictive back under a finger:** NOT_RUN. `adb shell input swipe` from the
  left edge does not open the system back animation on this emulator, so the
  shrink-to-0.9 / rounded-corner / follow-the-finger state is wired and
  unit-tested (`NavTransitionTest`) but not captured on video.
- **Stop during a long answer:** NOT_RUN. The send tap and the stop control could
  not be landed reliably through `input tap` while the IME shifted the composer,
  so no turn was stopped on camera.
- **Queue isolation:** NOT_RUN on device. The staging daemon had one session, so
  there was no second thread to queue across. Covered by `MessageQueuesTest`.
- **Notification fires while backgrounded:** NOT_RUN. The permission reason bar
  is on screen and asks once (see `keyboard-composer.png`), but a posted
  turn-done notification was not observed.
- **Pairing link while the app is running:** NOT_RUN with the app already in the
  foreground. The link path itself is verified cold-start and unit-tested
  (`DeepLinkParseTest`).
- **Frame pacing:** not measured in this run. No 120 Hz or physical-device claim.

## What changed in this pass

The earlier evidence claimed a few things the code did not do. This directory now
matches the code: the connection layer, request payloads, queue scope, back
handling and build hygiene were all rewritten before these clips were captured.
