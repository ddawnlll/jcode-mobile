# Adapter v2 deployment (0.3.0)

Live host: `12735.example.com`, public origin `https://dawnll.duckdns.org`.
Caddy proxies the origin to `127.0.0.1:7644`; the adapter serves both the
mobile v2 API and the Stillness 12 web build on that port.

## Processes

| Unit | Scope | Binary | Purpose |
| --- | --- | --- | --- |
| `jcode-mobile-api-bridge.service` | user | `jcode api --api-socket …` | Harness API bridge onto the production daemon socket |
| `jcode-mobile-adapter-v2.service` | user | `target/release/jcode-adapter-v2` | Mobile v2 API, pairing, SQLite journal, static Stillness build |

The user manager has linger enabled, so both units start at boot without a
login session.

The bridge uses the installed JCode binary that matches the running daemon
(`/home/quant/local/opt/jcode-0.99.1/jcode-linux-x86_64.bin`). The adapter
speaks harness API major 1 through the pinned `jcode-sdk`; it does not restart
or replace the production daemon.

## Configuration

- Adapter data and journal: `/home/quant/.jcode/mobile-adapter-v2`
- Harness API socket: `/home/quant/.jcode/mobile-adapter-v2/api.sock`
- Allowed roots and default working directory: `/home/quant`
- Web build: `apps/stillness/dist`
- Allowed browser origin: `https://dawnll.duckdns.org`

Install or update with:

```sh
bash scripts/install-adapter-v2-service.sh
```

The script rebuilds nothing; run `cargo build --release -p adapter-server
--bin jcode-adapter-v2` and `(cd apps/stillness && bun run build)` first.

## Pairing

A pairing code is printed once per adapter start and expires after ten minutes:

```sh
journalctl --user -u jcode-mobile-adapter-v2.service -n 40 --no-pager |
  grep "Pairing code"
```

Restart the adapter to issue a new code. Codes are single use. Adapter v2
cannot import 0.2.2 device tokens, so the 0.3.0 client pairs once.

## Legacy 0.2.2 unit

`jcode-mobile-adapter.service` is a **system** unit and stays installed. Its
process was stopped with SIGTERM, which the TypeScript adapter turns into a
clean exit, so systemd does not restart it. Disable it so it cannot race the
user unit for port 7644 after a reboot:

```sh
sudo systemctl disable --now jcode-mobile-adapter.service
```

Rollback:

```sh
sudo systemctl enable --now jcode-mobile-adapter.service
systemctl --user disable --now jcode-mobile-adapter-v2.service \
  jcode-mobile-api-bridge.service
```

## Verified at cutover

- `GET /health` on loopback and through Caddy returns `adapter_version: 0.3.0`,
  `protocol_version: 2`, `jcode_connected: true`.
- `GET /` returns the Stillness 12 build (`JCode Mobile`).
- Playwright pairing through `https://dawnll.duckdns.org` succeeded against the
  production daemon, including the authenticated WebSocket.
- The real session list, history, plan, and activity rendered from the
  production daemon through Adapter v2.
