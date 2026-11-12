# Getting started

JCode Mobile 0.3.0 is the Stillness 12 Tauri client paired with the Rust
Adapter v2. The phone is the surface. The adapter and the JCode daemon do the
work on your server.

This guide covers the supported path on Linux:

1. Build and run Adapter v2 beside JCode.
2. Put TLS in front of the adapter.
3. Install and pair the Android APK, or build the native Linux shell.
4. Send a turn, leave, and return to the same session.

## What you need

| Piece | Version or note |
| --- | --- |
| JCode daemon | The pinned fork at `0abff12c7f2b55ec03b38a42dedbcd5f4eff13f8`, with the harness API socket available |
| Rust | Stable toolchain for the adapter and the Tauri shell |
| Bun | 1.4.4 for the Stillness web build and repository tooling |
| TLS | A certificate and key at a reverse proxy, or a reviewed private tunnel |
| Android | 7.0 or newer, `arm64-v8a` or `armeabi-v7a`, with sideloading enabled |
| Linux desktop | GTK 3 and WebKitGTK 4.1 development packages, or a `TAURI_SYSROOT` prefix |

The adapter does not run a second agent, keep a second canonical transcript, or
call a provider directly. It uses the curated `jcode-sdk` and harness API.

## 1. Build Adapter v2

```sh
git clone https://github.com/ddawnlll/jcode-mobile.git
cd jcode-mobile
cargo build --release -p adapter-server --bin jcode-adapter-v2
```

The binary is `target/release/jcode-adapter-v2`.

The adapter needs the JCode harness API socket. The default is the platform
runtime path, usually `$XDG_RUNTIME_DIR/jcode-api.sock`. Set
`JCODE_API_SOCKET` when your daemon uses another path:

```sh
export JCODE_API_SOCKET="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/jcode-api.sock"
```

## 2. Run the adapter

Run it as the user that owns the JCode home and runtime socket.

```sh
JCODE_ADAPTER_ALLOWED_ROOTS="$HOME/src" \
JCODE_ADAPTER_BIND=127.0.0.1:7646 \
./target/release/jcode-adapter-v2
```

The terminal prints:

```text
JCode Adapter v2 listening on http://127.0.0.1:7646
JCode harness socket: /run/user/1000/jcode-api.sock
Pairing code (valid for 10 minutes, single use): ABCD-EFGH-JKLM
Allowed roots:
  - /home/you/src
```

Keep that code. It is shown only for this adapter run, is single-use, and
expires after ten minutes. Restarting the adapter generates a new code unless
you set `JCODE_ADAPTER_PAIRING_CODE`.

### Adapter settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `JCODE_ADAPTER_BIND` | `127.0.0.1:7646` | Address the adapter listens on |
| `JCODE_ADAPTER_DATA_DIR` | `~/.local/share/jcode-mobile-adapter-v2` | SQLite journal and pairing records |
| `JCODE_ADAPTER_ALLOWED_ROOTS` | Current directory | Path-separated roots the project browser may use |
| `JCODE_ADAPTER_DEFAULT_WORKDIR` | First allowed root | Working directory for a new session with no project |
| `JCODE_ADAPTER_PAIRING_CODE` | Generated | Fixed code for a controlled deployment or test |
| `JCODE_ADAPTER_NAME` | `JCode Mobile` | Name shown to the client |
| `JCODE_ADAPTER_WEB_DIR` | Unset | Optional Stillness build served by the adapter |
| `JCODE_ADAPTER_ALLOWED_ORIGINS` | Loopback only | Extra browser origins for the web preview |
| `JCODE_ADAPTER_MAX_FILE_BYTES` | `262144` | Maximum preview read |
| `JCODE_ADAPTER_EVENT_QUEUE` | `512` | Bounded backend event channel |
| `JCODE_API_SOCKET` | Platform runtime path | JCode harness API socket |

`JCODE_ADAPTER_ALLOWED_ROOTS` uses the platform path separator. The adapter
canonicalizes every project and rejects traversal, NUL bytes, escaping symlinks,
and protected files such as `.ssh`, `.aws`, `.env*`, and private keys.

## 3. Put TLS in front

Do not expose the adapter directly to the internet. It is a loopback HTTP and
WebSocket service. Terminate TLS at a reverse proxy and keep the adapter on
`127.0.0.1`.

A Caddy site:

```caddyfile
dawnll.example.com {
    reverse_proxy 127.0.0.1:7646
}
```

Then use `https://dawnll.example.com` as the server address in the app. Caddy
handles the certificate. If you use a private tunnel instead, review its trust
policy and do not assume that a tunnel is a substitute for authentication.

The adapter does not implement a TLS terminator, VPN client, or SSH client for
the phone.

## 4. Install the Android APK

Download the current artifact:

[**jcode-mobile-0.3.0-android-release.apk**](https://github.com/ddawnlll/jcode-mobile/releases/download/v0.3.0/jcode-mobile-0.3.0-android-release.apk)

```text
11,020,965 bytes
SHA-256 4a79ba0aeaf026949ecbdb57591fc7e18dd87fb47d10c67ff49bf03be63060d2
package dev.jcode.stillness
minSdk 24
arm64-v8a + armeabi-v7a
```

```sh
sha256sum jcode-mobile-0.3.0-android-release.apk
adb install -r jcode-mobile-0.3.0-android-release.apk
```

The APK is debug-signed for sideloading. It is not a Play Store build. The
package identifier is new, so install it alongside or replace the older Expo
app deliberately. Data from `com.jcodemobile.app` does not migrate.

For a local emulator, forward the adapter port:

```sh
adb reverse tcp:7646 tcp:7646
```

Then enter `http://127.0.0.1:7646` and the pairing code.

## 5. Pair the phone

Open the app, tap **Pair a device**, and enter:

- **Server address:** `https://dawnll.example.com`, or
  `http://127.0.0.1:7646` for `adb reverse`
- **Pairing code:** the code printed by the adapter, for example
  `ABCD-EFGH-JKLM`
- **Device name:** anything you will recognize in the settings panel

Tap **Pair this device**. The app exchanges the code for a device token and
stores it in Android Keystore or the Linux Secret Service. The token is not
written to SQLite, logs, or the URL.

## 6. Send a turn and leave

Open a session, type an instruction, and send. The adapter journals the
operation, writes it to JCode, and waits for an authoritative acceptance event.
The reply streams into the session.

You can leave the conversation, background the app, lock the phone, or
force-quit it. The turn keeps running on the server. When you reopen, the app
restores the exact server and session, paints saved content first, and
reconciles against authoritative history.

Only **Stop** targets the current turn. Back, swipe, background, socket loss,
and app kill never send Cancel, Clear, or Rewind.

## 7. Build the native Linux shell

```sh
bash scripts/build-tauri-linux.sh
```

The release binary is written to:

```text
apps/stillness/src-tauri/target/release/stillness
```

If the host has no system GTK/WebKit development packages and no sudo, use the
user-space prefix:

```sh
TAURI_SYSROOT="$HOME/tauri-sysroot" bash scripts/build-tauri-linux.sh
```

The native shell uses Secret Service for the device token. It talks to the same
adapter and the same sessions as the Android build.

## 8. Web preview

The browser build is a verification surface, not a second product. It stores
the token in `localStorage`, which is test storage, not a keystore.

```sh
cd apps/stillness
bun run build
cd ../..

JCODE_ADAPTER_WEB_DIR="$PWD/apps/stillness/dist" \
JCODE_ADAPTER_ALLOWED_ORIGINS="http://127.0.0.1:7646" \
JCODE_ADAPTER_BIND=127.0.0.1:7646 \
./target/release/jcode-adapter-v2
```

Open `http://127.0.0.1:7646`. A remote browser origin must be listed in
`JCODE_ADAPTER_ALLOWED_ORIGINS`.

## Local staging without touching production

The repository can start an isolated JCode daemon, harness API bridge, and
adapter under `.staging/`. It never uses the production daemon or its sessions.

```sh
JCODE_STAGING_DIR="$PWD/.staging/jcode-mobile" \
JCODE_BIN="$HOME/projects/jcode-fork/target/release/jcode" \
bash scripts/staging-up.sh
```

The script prints the staging directory, which contains `home/` and `run/`.
Start the adapter against those paths:

```sh
JCODE_HOME="$PWD/.staging/jcode-mobile/home" \
JCODE_RUNTIME_DIR="$PWD/.staging/jcode-mobile/run" \
JCODE_SOCKET="$PWD/.staging/jcode-mobile/run/jcode.sock" \
JCODE_API_SOCKET="$PWD/.staging/jcode-mobile/run/jcode-api.sock" \
JCODE_ADAPTER_BIND=127.0.0.1:7652 \
JCODE_ADAPTER_ALLOWED_ROOTS="$PWD" \
JCODE_ADAPTER_PAIRING_CODE=DEMO-0300-MAIN \
JCODE_ADAPTER_WEB_DIR="$PWD/apps/stillness/dist" \
./target/debug/jcode-adapter-v2
```

The real-stack Playwright flow does this automatically:

```sh
bash scripts/stillness-e2e.sh
```

## Troubleshooting

### The app pairs, but the harness is unavailable

The adapter cannot reach the JCode harness API socket.

```sh
curl -s http://127.0.0.1:7646/health
```

`jcode_connected` must be `true`. Check `JCODE_API_SOCKET`, confirm the daemon
and harness bridge are running as the same user, and inspect the adapter log.
The JCode daemon may expose the bridge on a different path than the legacy
daemon socket.

### The pairing code is rejected

The code is single-use and expires after ten minutes. A restart invalidates the
previous code. Generate a new one by restarting the adapter, or set
`JCODE_ADAPTER_PAIRING_CODE` for a controlled run. Repeated failures are
rate-limited per peer IP.

### The terminal shows "Connect host" and a six-digit code

That is JCode's built-in mobile gateway, not Adapter v2. Stillness 0.3.0 calls
`/v2/pair` and expects the adapter's ten-minute code, normally formatted
`XXXX-XXXX-XXXX`.

Use the TLS origin without the gateway port:

```text
https://dawnll.example.com
```

Do not enter `https://dawnll.example.com:7643`. The built-in gateway on port
7643 is plain HTTP, so an `https://` fetch to that port fails before the app
can show an authentication error. Restart Adapter v2 to generate a fresh
adapter code:

```sh
systemctl --user restart jcode-mobile-adapter-v2
journalctl --user -u jcode-mobile-adapter-v2 -n 20 --no-pager |
  grep "Pairing code"
```

### The session list is empty

The adapter is connected but the harness has no sessions, or it is looking at a
different JCode home. Confirm the daemon's `$JCODE_HOME` and runtime directory.
Do not point a staging adapter at a production home just to make the list fill.

### Android cannot reach the server

- Use the TLS hostname, not a bare IP, when a proxy terminates TLS.
- For a local emulator only, use `adb reverse tcp:7646 tcp:7646` and
  `http://127.0.0.1:7646`.
- Confirm the proxy forwards WebSocket upgrades on `/v2/ws`.
- Confirm the device certificate chain is trusted by Android.

### The token was revoked

The app shows a re-pair state and keeps cached content readable. Open the
settings panel, forget the device, and pair again with a fresh code. Revocation
closes existing WebSocket connections for that device.

### Folder browsing is empty

`JCODE_ADAPTER_ALLOWED_ROOTS` is the complete list of browsable roots. A
project is a canonical directory under one of those roots. The browser does not
walk the whole filesystem.

## Security notes

- Bearer tokens live in the OS credential store, not in app SQLite.
- Remote deployments require TLS at a reviewed endpoint.
- The adapter logs connection counts, errors, and session ids. It does not log
  pairing codes, bearer tokens, request bodies, provider keys, or file contents.
- The pairing code is hashed in SQLite, is single-use, and expires after ten
  minutes.
- Command Code credentials remain JCode's domain. The adapter never reads,
  proxies, logs, or returns them.
- The file browser is root-scoped and read-only except for explicit folder
  creation.
- The web preview uses `localStorage` and is not a secure credential store.

For the protocol, read [`API.md`](API.md). For source evidence and non-goals,
read [`ADAPTER_CONTRACT.md`](ADAPTER_CONTRACT.md). For the exact verification
state, read [`VERIFICATION.md`](VERIFICATION.md).
