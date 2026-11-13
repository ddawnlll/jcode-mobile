# JCode Mobile 0.3.1

JCode Mobile 0.3.1 is the reliability release for 0.3.0. An on-device audit of
the published 0.3.0 APK on a real ARM emulator, against the pinned JCode fork
and a Rust Adapter v2, reproduced and fixed nine defects. Three were
correctness failures in agent-state handling and are the reason for this
release. No UI redesign ships.

This is a development preview, not a Play Store release. The Android APK is
debug-signed for sideloading.

## Highlights

- **Stillness 12 is unchanged.** Same client, same screens, same flow. The
  fixes are under the hood.
- **Adapter v2 history is authoritative.** Snapshots read the full transcript
  (`user`/`assistant`/`tool` rows) after attaching for the session, instead of
  the lossy stored-record preview that used to drop every tool card and could
  lag the latest assistant message.
- **Session creation is identity-safe.** A "New session" request creates a
  distinct session instead of re-attaching and renaming the attached one.
- **The composer stays honest about delivery.** Once the adapter observes the
  user message in history, the pending send promotes to `observed_in_history`
  and the composer re-enables. After one completed turn the session is usable.
- **Loopback pairing works again.** The release build no longer blocks the
  documented loopback path; cleartext is allowed for loopback targets only.
- **Truthful status surface.** No false "harness unavailable" when the server
  is healthy; one connection banner (not two); completed turns reconcile and
  the "observed Ns" timer stops.
- **`Failed to fetch` is gone.** Pairing failures now name the server and the
  likely cause.

## Fixed defects

| Severity | What |
| --- | --- |
| P1 | Release manifest blocked cleartext loopback pairing by policy |
| P1 | Authoritative snapshot lost every assistant tool-use/tool-result row |
| P1 | "New session" re-attached and renamed the existing session |
| P1 | Composer permanently DISABLED after one completed turn; adapter rejected new sends |
| P2 | False "JCode harness is unavailable" banner on a healthy install |
| P2 | Completed live turn never reconciles; `observed Ns` ticks forever |
| P3 | Connection banner rendered twice; top copy overlapped the status bar |
| P3 | Pair form was covered by the on-screen keyboard |
| P3 | Raw `Failed to fetch` shown on pairing failure |

Full audit: `docs/evidence/v0.3.1/README.md`. Bug inventory, root causes, and
on-device screenshots live under `docs/evidence/v0.3.1/`.

## Android artifact

```text
jcode-mobile-0.3.1-android-release.apk
11,016,925 bytes
SHA-256 03a6d808524461e12dca1370540eede2e040e179e9f116cec980effb180da562
package dev.jcode.stillness
versionCode 3001, versionName 0.3.1
minSdk 24, targetSdk 37, compileSdk 37
ABIs arm64-v8a, armeabi-v7a
APK Signature Scheme v2 and v3, Android Debug certificate
```

Install with:

```sh
adb install -r jcode-mobile-0.3.1-android-release.apk
```

Verify the download with:

```sh
sha256sum jcode-mobile-0.3.1-android-release.apk
```

A clean install is expected; app data from the Expo 0.2.2 package does not
migrate. 0.2.2 remains available as the previous release.

## Upgrading Adapter v2

Adapter v2 now reads history through an attach + `get_history` call before
serving snapshots. The adapter is a single static Rust binary; there is no
database migration. Install the new binary and restart the unit. Persisted
operation state in the `operations` table is upgraded in place and a send that
was stuck in `accepted` is promoted on the next authoritative snapshot.

Operators pairing exactly one pinned harness should re-check `GET /health`
(`adapter_version: 0.3.1`, `jcode_connected: true`) after the restart.

## What was verified

- `cargo test --workspace` passed (32 tests); `cargo fmt --all -- --check`
  passed.
- Real isolated pinned daemon and adapter, Android emulator (arm64-v8a,
  API 35): fresh pairing, credential restore across force-stop/relaunch,
  resume after background, explicit Stop, adapter restart reconnect,
  switching sessions mid-turn, consecutive turns end to end.
- Marketing build and browser matrix passed (`bun run marketing:test`).
- The marketing capture pipeline reported zero page errors for the Session,
  Home, Models, Settings, Pair, Welcome, and Desktop captures in
  `docs/media/marketing/*-v031.png`.

## Known limits

- The Android APK is debug-signed and sideload-only. There is no Play Store
  release, release keystore, auto-update channel, or signed iOS artifact.
- Pairing over plain HTTP to a non-loopback address is not supported; use TLS
  or a tunnel to the adapter.
- Physical-device validation and a human screen-reader pass remain `NOT_RUN`.
- The pinned harness bridge implements `create_session` as a bare subscribe;
  the adapter works around it on a short-lived connection. Do not "simplify"
  that path back to the shared SDK connection.
- File-level changes are not exposed by the curated SDK. The Changes screen
  says so.
- Attachment support and provider credentials are not implemented in the
  mobile composer.
- Root repository checks (`bun run check`) passed on the release branch:
  typecheck, ESLint, and the legacy Jest/RNTL suite (14 suites / 139 tests).
