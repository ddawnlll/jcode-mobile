# Ziran 0.7.0 — "Wu wei"

A native Android client for jcode. The phone stays a client; the daemon owns
execution. Ziran speaks the same adapter protocol as the Stillness client.

## What is here

- A standalone Gradle project in `apps/android/`. Application id
  `dev.ziran.android`, version 0.7.0 (versionCode 70), compile and target SDK
  37, min SDK 26.
- A Kotlin and Jetpack Compose interface built from the `design/wu-wei/`
  boards: Start, Threads, Thread, Model and effort, and Scene and theme, in
  day and night. Fonts (EB Garamond and JetBrains Mono, OFL) and twelve
  painting crops are bundled.
- The adapter protocol ported from `apps/stillness/src/lib/`: pairing with
  Keystore-encrypted tokens, `client.hello` negotiation, `transport.bytes`
  packages, sessions delta and subscribe, event replay, reserve and dispatch,
  Stop, permissions, models, archive, restore, favourite and rename.
- Motion matching `boards/Motion.dc.html`: one easing, ink ripple, swipe
  archive with undo, long-press, pull-to-refresh, sheet, and reduced motion
  under ten lines of configuration.

## Build

```sh
cd apps/android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

## Adapter

Run the local adapter per `AGENTS.md`, then pair from the emulator at
`http://10.0.2.2:7644`. Loopback http is allowed for `10.0.2.2` and
`localhost` only.

```sh
JCODE_ADAPTER_PORT=7644 bun integration/jcode-adapter/src/main.ts
```

## Rules that hold

- Nothing on the phone cancels a turn except the explicit Stop control for
  that session. Navigation, background, socket close and process death never
  do.
- Reopening restores the exact server and session. A missing session shows a
  recovery state; it never creates a replacement.
- An unconfirmed send stays pending and unknown. The client never resends
  bytes that may already have reached the agent.
