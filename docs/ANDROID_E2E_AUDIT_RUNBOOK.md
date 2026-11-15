# Android E2E and audit runbook for #73 and #75

This is a **test plan, not a sign-off**. Existing 0.4.0 observations are in
`docs/evidence/v0.4.0/README.md` and `docs/V0_4_0_AUDIT.md`; they do not prove
behavior for a different APK or commit. Record each matrix cell separately as
PASS, FAIL, PARTIAL, BLOCKED, or NOT_RUN, with evidence and a reason. A failed
or unavailable diagnostic is not a pass. Do not close either issue on the basis
of this runbook or the preflight.

## Safety and fixture setup

Use a dedicated emulator and a consenting, backed-up test phone, not a daily
personal device. Never use the production daemon, real credentials, private
transcripts, or sensitive files. Prepare a disposable isolated JCode home,
socket, adapter data directory, test project roots, and test account. The
existing `scripts/stillness-e2e.sh` and `scripts/android-adapter-up.sh` are
starting points: inspect their environment and endpoints before running them.
Record the daemon, adapter and fixture versions and verify the adapter points
at the isolated socket. Android must be able to reach the test endpoint using a
supported transport. Emulator loopback is not phone loopback. Generate unique,
nonsecret fixture markers for each run, session and prompt. Keep two sessions
and, for multi-server tests, two isolated server identities. Ensure test turns
are long enough for lifecycle and fault actions, with multiple tool calls, and
that their completion can be independently observed in daemon history. Do not
infer completion from a spinner or notification.

Preflight, substituting an explicitly selected serial and SDK path:

```sh
export ADB="$HOME/Library/Android/sdk/platform-tools/adb"
"$ADB" devices -l
ADB="$ADB" bash scripts/android-audit-preflight.sh YOUR_SERIAL
shasum -a 256 path/to/test.apk
# Use build-tools matching your SDK:
apksigner verify --verbose --print-certs path/to/test.apk
aapt2 dump badging path/to/test.apk
```

Record APK SHA-256, versionCode/name, signing certificate digest, source commit,
all local modifications, build command, adapter and daemon revisions, API,
model, screen size/density, refresh rate, network and UTC timestamps. The
preflight queries an already authorized device without installing, starting,
stopping or clearing an app. It prints device identifiers and build details:
redact identifiers before sharing. A successful preflight does not verify that
the installed APK matches the file. Establish the installed artifact identity
by an appropriately permitted package pull and hash comparison, accounting for
split APKs and signing, or mark the match unverified.

Store raw captures in a restricted, local evidence directory outside the repo.
Screenshots, videos, logcat, bugreports, databases, URLs and notification dumps
can contain tokens or user data. Review and redact before publishing or uploading
CI artifacts. Do not upload secrets, device serials or pairing codes. Record
redaction and link each sanitized artifact to its test case. No blanket logcat or
screenshot collection is performed by the preflight.

## Matrix and acceptance observations (#73)

Run these on API 24 and 33, 34, 35, 36 where available, plus a physical
midrange device. Include 360dp, landscape, tablet/foldable, and actual device
refresh rates. Missing combinations remain NOT_RUN, not inherited from another
API. Use the same pinned fixture and APK identity for comparisons.

| ID | Reproducible action | Required observation |
| --- | --- | --- |
| E1 install | On disposable device: fresh install, pair to fixture; separately upgrade from a verified 0.3.1 APK without clearing app data; also try fresh launch offline. | Identity, migration and honest offline/recovery state recorded independently. |
| E2 scope | Pair two fixture servers, create distinct sessions and drafts, switch repeatedly, reopen. | Exact server/session restored, no cross-session draft or event. |
| E3 continuity | Start one long unique-marker turn, switch screens and background/reopen. Observe adapter/daemon history and UI until terminal state. | One accepted operation, tool calls not repeated, output belongs to originating session, terminal state reconciles. No extra prompt is sent. |
| E4 process | During the same type of turn, kill the **test app process** via device controls or `adb -s SERIAL shell am kill dev.jcode.stillness` where permitted, reopen, reconcile. `am force-stop` has different OS semantics and must be reported separately. | Capture actual process death and continued daemon execution, then authoritative history and final state. No cancel or implicit new session. |
| E5 network | With a disposable device, interrupt its fixture network during a turn, restore it, reconcile; repeat with adapter and isolated bridge restarts one at a time. | Record interruption/reconnect timeline, history and operation IDs. No duplicate action, wrong-session output or phantom completion. Restore test network afterward. Do not restart production services. |
| E6 native | Exercise swipes, menus, horizontal code scroll, refresh, slider, keyboard insets, rotation, predictive back and share-target return; cancel each chooser. | Record screenshots/steps and state before/after; no unintended stop/send or data loss. |
| E7 permissions | Deny notifications, try biometrics with and without enrollment and test permission recovery. | Denial and unavailable biometric paths are truthful, app usable, no unauthorized notification. |
| E8 push | With a dedicated configured FCM project, test foreground, cold start, Doze, revoke/unpair and token rotation. Inspect lockscreen content and target session. | Only authorized notifications, no sensitive content, correct deep link. No credentials means BLOCKED, not PASS. |
| E9 accessibility | Execute the accessibility protocol below with a human and hardware keyboard. | Each required path and setting has observations, not only static checks. |

For every failure record APK hash, versions, device, setup, exact steps, expected
and actual result, timestamps, sanitized logs/capture and reproducibility. Open
a follow-up issue only with appropriate authorization and no private data.
Issue #73's device and fault acceptance remains open until all required paths
have actual evidence on both emulator and physical device.

## Battery and background (#75)

Use the same physical device, OS, APK, network, account, battery condition and
ambient conditions. Record power source, battery level, standby bucket, refresh
rate and background setting. Run repeated, alternating OFF and ON idle windows
of equal duration (at least several hours, preferably overnight), without USB
charging during measurement. Record start/end time and battery percentage;
if a calibrated external meter is available, record its method and mAh. Battery
percentage or `dumpsys batterystats` estimates are not a calibrated mAh result.
Separate FCM-only and periodic-sync conditions if supported/configured. Record
worker execution evidence, network bytes and wakelock data using platform
profiling tools and their limitations, plus CPU and memory samples. Compare
per-hour values and raw observations, repetitions and variability. Do not claim
zero work just because none was observed in one window: inspect scheduled work
and logs through an appropriate debug/instrumented build, and note Doze delays.
Test Doze/standby only on dedicated devices and restore changed settings.
No agreed drain threshold exists here: agree one before judging a regression.

## Performance and motion

Use a release-like signed build. For each device/refresh rate record 30 or more
cold starts and 30 representative interactions, the exact start/end event,
measurement tool, timestamps and raw samples. Compute p50/p95/p99 from the raw
samples, record sample count and percentile method; small-sample p99 is
uncertain. Separate cached/offline and online startups. Capture frame pacing
using Android frame tools for gestures, interrupted animations and a controlled
large streaming transcript, noting refresh rate, janky frames, memory and CPU.
Pre-agree budgets and baseline before testing. Compare like-for-like builds and
report exceptions rather than inventing a pass threshold. Browser timing is not
native timing.

## Accessibility and privacy review

With TalkBack enabled, traverse pairing, session list, conversation, composer,
menus, sheet, alerts and recovery in both orientations. Record focus order,
labels/roles, live announcements, gesture conflicts and whether every action is
reachable. Repeat at 200% system font scale, dark/high-contrast settings where
available, reduced motion, and with a hardware keyboard. Measure interactive
targets on-device and verify haptic actions have a non-haptic alternative.
Record OS/device settings and screenshots only after privacy review.

Inspect the **merged release manifest**, not just source: list and justify each
permission, exported component, intent filter and URI grant, including entries
injected by dependencies. Verify actual grant/deny and older-API fallback paths.
Trace synthetic markers through pairing, token storage, logs, URLs, share and
content URIs, exported files, notifications/lockscreen, biometric lock and
SQLite/log retention. Inspect authorized and unauthorized deep links and URI
access on a disposable fixture. Record observations and gaps separately from
source-based expectations. A clean sample cannot prove absence of all leaks.

## Evidence record template

```text
Case / matrix cell:                  Status: PASS | FAIL | PARTIAL | BLOCKED | NOT_RUN
Date UTC / tester:                   Device/API/display/refresh:
APK SHA-256 / version / signer:      Installed artifact match method:
Commit / dirty changes:              Daemon + adapter + fixture versions:
Preconditions / settings:            Steps and timestamps:
Expected:                            Actual:
Operation + session IDs (redacted):  Sanitized artifacts / raw storage location:
Limitations / follow-up:             Restoration performed:
```
