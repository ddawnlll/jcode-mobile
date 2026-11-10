# Getting started

JCode Mobile is a native iOS and Android client for [JCode](https://github.com/1jehuang/jcode). The phone directs the conversation. The server runs the agent. The exact thread is still there when you come back.

This guide covers the supported path: a Linux or macOS host running JCode, the small mobile adapter, and the Android app. The current public artifact is Android 0.2.2. iOS is built from source.

## What you need

| Piece | Version or note |
| --- | --- |
| JCode on the server | 0.99.1 verified. `jcode pair` must be available. |
| Bun on the server | 1.4.4. The adapter and repository tooling use Bun, not Node. |
| TLS | A certificate and key, or a TLS reverse proxy in front of a loopback-bound adapter. |
| Android | The 0.2.2 release APK, sideloaded with `adb`. |
| iOS | Xcode 26.1 or newer and a source build. There is no signed phone or App Store artifact. |

The adapter is a transport bridge. It opens the daemon socket, authenticates the phone, forwards the curated mobile envelope, and keeps a bounded delivery ledger. It does not run a second agent, keep a second canonical transcript, or call a model provider.

## 1. Run the mobile adapter

On the server, as the user that owns `$JCODE_HOME`:

```sh
git clone https://github.com/ddawnlll/jcode-mobile.git
cd jcode-mobile
bun install --frozen-lockfile

JCODE_ADAPTER_HOST=0.0.0.0 \
JCODE_ADAPTER_PORT=7643 \
JCODE_ADAPTER_TLS_CERT=/etc/jcode-mobile/fullchain.pem \
JCODE_ADAPTER_TLS_KEY=/etc/jcode-mobile/privkey.pem \
bun integration/jcode-adapter/src/main.ts
```

The adapter refuses to bind a non-loopback address without TLS. That is deliberate. Do not expose plain `ws://` to the internet.

For a reverse proxy, bind the adapter to loopback and terminate TLS at the proxy:

```sh
JCODE_ADAPTER_HOST=127.0.0.1 \
JCODE_ADAPTER_PORT=7644 \
bun integration/jcode-adapter/src/main.ts
```

A minimal Caddy site:

```caddyfile
dawnll.example.com {
    reverse_proxy 127.0.0.1:7644
}
```

Then enter `dawnll.example.com:443` in the app. If the adapter is kept as a service, give it the same `JCODE_HOME`, daemon socket, and user as the JCode daemon. If JCode's own gateway already occupies port 7643 with plain HTTP, use the loopback 7644 pattern above.

Useful adapter settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `JCODE_ADAPTER_HOST` | `127.0.0.1` | Interface to bind. Non-loopback requires TLS. |
| `JCODE_ADAPTER_PORT` | `7643` | Adapter HTTP and WebSocket port. |
| `JCODE_ADAPTER_TLS_CERT` / `_KEY` | unset | PEM certificate and key for direct TLS. |
| `JCODE_HOME` | `~/.jcode` | Must match the daemon that owns the pairing registry. |
| `JCODE_SOCKET` | runtime `jcode.sock` | Daemon socket path. |
| `JCODE_ADAPTER_ROOTS` | `$HOME` | Comma-separated roots the authenticated folder picker may browse. |
| `JCODE_ADAPTER_WEB_DIR` | unset | Optional exported web preview served by the adapter. |
| `JCODE_ADAPTER_ALLOWED_ORIGINS` | loopback only | Extra browser origins for the web preview. |

## 2. Mint a pairing code

On the server, as the same user that runs the daemon:

```sh
jcode pair
```

The six-digit code is valid for five minutes and is exchanged once for a device token. The adapter reads the same `$JCODE_HOME/devices.json` that `jcode pair` writes.

`/remote` is not available in JCode 0.99.1's CLI. Use `jcode pair`. If the command is missing, check `jcode --version` and upgrade JCode.

## 3. Install the Android app

Download the current release directly:

[**jcode-mobile-0.2.2-android-release.apk**](https://github.com/ddawnlll/jcode-mobile/releases/download/v0.2.2/jcode-mobile-0.2.2-android-release.apk) (about 63 MiB)

Then install it on a connected phone or emulator:

```sh
adb install -r jcode-mobile-0.2.2-android-release.apk
```

The APK is a release build with an embedded Hermes bundle for `arm64-v8a` and `armeabi-v7a`. It is debug-signed for sideloading. It is not a Play Store artifact.

The checksum is attached to the release as `jcode-mobile-0.2.2-android-release.apk.sha256` and recorded in [`BUILD_STATE.md`](BUILD_STATE.md).

### iOS

There is no signed IPA. The v0.2.2 iOS artifact is a Release Simulator `.app` zip. The historical v0.1.3 artifact is also a Simulator `.app` only. Build iOS from source with Xcode 26.1 or newer:

```sh
bun install --frozen-lockfile
bun run ios --device "iPhone 17 Pro"
```

A Simulator build will not install on a physical iPhone without Apple signing. The bundle identifier is provisional (`com.jcodemobile.app`). Change it before producing signed distribution builds.

## 4. Pair the phone

Open the app and enter:

- **Server address:** `your-server.example.com:7643`, or `dawnll.example.com:443` when a proxy terminates TLS
- **Pairing code:** the six digits from `jcode pair`
- **Device name:** anything you will recognize in the server registry

Tap **Pair this phone**. The token is stored in Keychain on iOS or Keystore on Android, never in SQLite, logs, or the URL.

Pairing completes when the token is stored. The WebSocket connection continues in the background, so a later connection problem appears in Sessions instead of leaving the Pair button spinning.

### If pairing fails

The app shows the exact code and the native detail where one exists.

| Code | Meaning |
| --- | --- |
| `PAIR_NETWORK` | DNS, firewall, wrong port, or the adapter is not running. The detail includes the native error. |
| `PAIR_TIMEOUT` | No `/pair` response within 12 seconds. |
| `PAIR_HTTP_400` | Usually an invalid or expired code. The server message is shown. |
| `PAIR_HTTP_401` / `PAIR_HTTP_403` | A reverse proxy or TLS client policy rejected the request. |
| `PAIR_TIMEOUT_UI` | The app-side 20 second guard fired before any result. |

Check, in order: the adapter process is alive, port 7643 or 443 is reachable, the certificate matches the hostname, `$JCODE_HOME` is the daemon's home, and the code has not expired.

## 5. Send a prompt and leave

Tap a session, type a prompt, and send. The reply streams in. The **Work** dock opens the exact tool calls and the plan the server reported.

You can leave the conversation, lock the phone, or force-quit the app. The turn keeps running on the server. When you return, the same server and the same session are reattached, and a return seam shows what changed while you were away.

If you want to cancel a turn, use **Stop**. Back, swipe, app background, socket loss, and force-quit are navigation and lifecycle events. They never send cancel, clear, or rewind.

## 6. Sign out or move on

Open **Server details**:

- **Disconnect this phone** closes the connection but keeps you signed in.
- **Forget this server** removes the token, drafts, reading positions, and cache from this phone. It is a local logout.
- **Pair this phone again** rotates the device token.

There is no password login after pairing. The device token does not expire. The app reconnects after restarts, network changes, and server reboots. If the token is revoked on the server, the app shows `Pair again` and keeps cached content readable.

## What the phone promises

- **Navigation is not cancellation.** Only Stop targets the current turn.
- **The server owns the work.** Every attach uses `continue_on_disconnect: true` with the exact `target_session_id`.
- **Sending is honest.** `Sending`, `Sent to server`, `Accepted`, and `Delivery unconfirmed` are distinct. An ambiguous delivery is never auto-resent.
- **Cache is last-known evidence.** Cached history paints first and is labelled as saved on this phone. Only an authoritative reconciliation claims `Current` or `Ready`.
- **Daemon death is not phone absence.** A reopened session shows saved history plus the server's interruption and recovery directive.
- **Capabilities gate controls.** No plan tab without reported todos, no unreported approvals or progress, and no push toggle when the server does not advertise it.
- **Exact return.** Reopening restores the exact server and session. A missing target shows a recovery state instead of creating a replacement session.

## Local staging without touching production

The repository can run a real JCode daemon against an isolated `$JCODE_HOME` and private sockets.

```sh
bash scripts/staging-up.sh
bash scripts/staging-adapter.sh
```

In another terminal, forward the port to an Android emulator:

```sh
adb reverse tcp:7643 tcp:7643
```

Then pair with `ws://127.0.0.1:7643` and a code from `jcode pair`. Android release builds allow cleartext only for loopback. iOS release builds keep local networking disabled, so use the iOS dev build for loopback testing.

Continuity and daemon-death proofs:

```sh
bash scripts/staging-run.sh integration/jcode-adapter/test/continuity.ts
bash scripts/staging-run.sh integration/jcode-adapter/test/daemon-death.ts
bun run adapter:test
```

The staging scripts never touch the production daemon, its socket, or its sessions.

## Security notes

- Bearer tokens live in Keychain or Keystore only.
- Remote adapters require TLS. Loopback cleartext is an explicit development exception.
- Transcript cache is SQLite, bounded, and scoped per server and session.
- App-switcher previews are hidden by default.
- Diagnostics redact tokens, pairing codes, and transcript text.
- The adapter's folder picker is limited to `JCODE_ADAPTER_ROOTS`. It never walks the whole filesystem.
- The web build is a preview and test surface. Its browser token storage is `localStorage`, not a keystore.

For architecture, tests, and contributor commands, read [`DEVELOPMENT.md`](DEVELOPMENT.md). For the protocol, read [`ADAPTER_CONTRACT.md`](ADAPTER_CONTRACT.md). For the exact verification state, read [`VERIFICATION.md`](VERIFICATION.md).
