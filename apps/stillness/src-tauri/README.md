# Stillness Tauri shell

The desktop target wraps the same Vite bundle in a Tauri 2 window. The client
detects `__TAURI_INTERNALS__` and uses the native credential commands here
instead of `localStorage`.

- Secrets: `keyring` writes the device credential to the OS secret store
  (Secret Service on Linux, Keychain on macOS, Credential Manager on Windows).
- Metadata: the app config directory stores only the active server URL and
  account names, mode `0600` on Unix.
- No provider API key is passed through this shell. Command Code keys remain on
  the JCode server.
- The adapter is reached over WebSocket from the webview; Tauri does not proxy
  or log the bearer.

Build on Linux requires GTK 3 and WebKitGTK 4.1 development packages. Prefer
the system packages:

```sh
bash scripts/build-tauri-linux.sh
```

When they are absent and there is no passwordless sudo, extract the Debian
development packages into a user prefix and point `TAURI_SYSROOT` at it:

```sh
TAURI_SYSROOT=$HOME/tauri-sysroot bash scripts/build-tauri-linux.sh
```

The script exports the matching `PKG_CONFIG_*`, `LIBRARY_PATH`, and
`LD_LIBRARY_PATH` values. A host without either path is reported as BLOCKED.
Runtime launch under Xvfb may additionally need a user-namespace overlay for
WebKit's helper processes; that is test-host setup, not part of the app.
