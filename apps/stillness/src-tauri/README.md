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

Build on Linux requires GTK 3 and WebKitGTK 4.1 development packages. Without
those, `cargo check` fails in `glib-sys` and the native build is honestly
reported as BLOCKED, not passed.
