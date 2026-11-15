# Adapter v4 deployment (0.5.0)

Live host: `12735.example.com`, public origin `https://dawnll.duckdns.org`.
A system Caddy unit reverse-proxies that origin to `127.0.0.1:7644`. The
adapter serves both the mobile WebSocket API and the Stillness build on that
port.

This records the move of the *working* deployment from the pre-v4 adapter to
Adapter v4 (0.5.0, protocol 4). It is the deployment companion to
[`ADAPTER_V4.md`](ADAPTER_V4.md) and
[`V0_5_0_RELEASE_NOTES.md`](V0_5_0_RELEASE_NOTES.md).

## What was running before

| Item | Value |
| --- | --- |
| Unit | `jcode-mobile-adapter-v2.service` (user) |
| Binary | `target/release/jcode-adapter-v2` |
| `adapter_version` | `0.3.1` |
| `protocol_version` | `2` (minimum 2) |
| Subprotocol | `jcode.mobile.v2` only |
| Origin | `https://dawnll.duckdns.org` → `127.0.0.1:7644` |

That binary is the pre-v4 implementation: its build identity string is
`Adapter v2` and it offers the single `jcode.mobile.v2` subprotocol. The v3
line (`docs/ADAPTER_V3.md`, released as 0.4.0) was written in this tree but was
never deployed on this host. No `jcode-adapter-v3` binary and no v3 unit were
ever installed here. Adapter v4 negotiates v2, v3, and v4 on the same
`/v2/ws` endpoint, so it is the first binary on this host that can speak v3.

The v2 unit had been stopped and disabled on 2026-11-15 13:56 UTC by an
unrelated cleanup, so the public origin had no adapter behind it before this
cutover.

## What runs now

| Item | Value |
| --- | --- |
| Unit | `jcode-mobile-adapter-v4.service` (user) |
| Binary | `target/release/jcode-adapter-v4` |
| `adapter_version` | `0.5.0` |
| `protocol_version` | `4` (minimum 2) |
| Subprotocols | `jcode.mobile.v4`, `jcode.mobile.v3`, `jcode.mobile.v2` |
| Origin | `https://dawnll.duckdns.org` → `127.0.0.1:7644` |

| Unit | Scope | Binary | Purpose |
| --- | --- | --- | --- |
| `jcode-mobile-api-bridge.service` | user | `jcode api --api-socket …` | Harness API bridge for inventory, archive and restore |
| `jcode-mobile-adapter-v4.service` | user | `target/release/jcode-adapter-v4` | Mobile v4 API, pairing, journal, native links, Stillness build |
| `jcode-mobile-adapter-v2.service` | user | `target/release/jcode-adapter-v2` | Installed and **disabled**, rollback only |

Linger is enabled for this account, so both active units start at boot without a
login session.

## Configuration

- Adapter data and journal: `/home/quant/.jcode/mobile-adapter-v2`
- Harness API socket: `/home/quant/.jcode/mobile-adapter-v2/api.sock`
- Native JCode socket: `/run/user/1000/jcode.sock`
- Bind: `127.0.0.1:7644`
- Allowed roots and default working directory: `/home/quant`
- Stillness build: `apps/stillness/dist`
- Allowed browser origin: `https://dawnll.duckdns.org`

Two sockets matter and they are not the same file:

- `JCODE_API_SOCKET` is the harness API bridge created by
  `jcode-mobile-api-bridge.service`. It serves inventory, archive and restore.
- `JCODE_SOCKET` is the JCode daemon's own native socket. Adapter v4 opens
  bounded native per-session links on it (up to 32 connections). It must be set
  explicitly, because the default is a `jcode.sock` beside the bridge socket,
  which does not exist.

The data directory keeps its Adapter v2 name on purpose. Adapter v4 extends the
schema in place with `CREATE TABLE IF NOT EXISTS` statements (`event_journal`,
`event_cursors`, `session_index`, `operation_attachments`, `device_push`,
`push_log`, `session_favorites`), so the `server_id` and every paired device
token survive the upgrade and no phone has to re-pair.

## Install or update

```sh
cd /home/quant/jcode-mobile
cargo build --release --locked -p adapter-server --bin jcode-adapter-v4
(cd apps/stillness && bun run build)
bash scripts/install-adapter-v4-service.sh
```

The script writes both user units, enables them, disables the v2 unit so it
cannot race for port 7644 after a reboot, restarts the bridge and the adapter,
and prints `/health` plus the new pairing code. It needs no root. It does not
build; run the two build commands first.

Overrides: `JCODE_MOBILE_DATA_DIR`, `JCODE_MOBILE_PORT`, `JCODE_MOBILE_ORIGINS`,
`JCODE_BIN`.

## Pairing

A pairing code is printed once per adapter start and expires after ten minutes.
Codes are single use.

```sh
journalctl --user -u jcode-mobile-adapter-v4.service -n 60 --no-pager |
  grep "Pairing code"
systemctl --user restart jcode-mobile-adapter-v4.service   # issue a new code
```

Devices paired against the 0.3.1 adapter keep working: the device table is
unchanged, and the adapter authenticates the same token. A 0.4.0 or 0.3.1 phone
app also keeps working, because it negotiates v3 or v2 and never receives a
frame at a version it did not negotiate.

## Verify

```sh
curl -s http://127.0.0.1:7644/health
curl -s https://dawnll.duckdns.org/health
```

Expected: `adapter_version` `0.5.0`, `protocol_version` `4`,
`min_protocol_version` `2`, `jcode_connected` `true`, and the same `server_id`
as before the upgrade.

The read-only live check drives the real daemon through the real public origin.
It pairs one device, negotiates v4, lists sessions, takes one snapshot, exercises
`device.list`/`device.revoke`, then confirms a v3 client and a v2 client still
negotiate down. It never reserves or dispatches an operation, so it cannot send
a prompt or start a turn.

```sh
ADAPTER_BASE_URL=https://dawnll.duckdns.org \
ADAPTER_PAIR_CODE=XXXX-XXXX-XXXX \
ADAPTER_EVIDENCE_PATH=.staging/v0.5.0-live/adapter-v4-live-check.json \
bun run scripts/adapter-v4-live-check.ts
```

Set `ADAPTER_KEEP_DEVICE=1` to keep the device the check paired. Without it the
check revokes every device it has created, including ones left by an earlier
run, so repeated verification does not litter the server device list.

## Verified at cutover

2026-11-15, on the live host against the production daemon. The daemon was not
restarted, and no session, turn or operation was sent.

| Check | Result |
| --- | --- |
| `GET /health` on loopback | PASS: `0.5.0`, protocol 4, minimum 2, `jcode_connected: true` |
| `GET /health` through Caddy | PASS: identical body, and the same `server_id` as the v2 deployment |
| `GET /` through Caddy | PASS: Stillness 0.5.0 build, `index-Dgm-tUk6.js` 412,578 B (121.50 kB gzip) |
| v4 handshake | PASS: negotiated 4, `max_protocol_version` 4, 41 capabilities |
| Live inventory | PASS: 127 sessions from `jcode.list_sessions`, revision 2, not stale |
| Session snapshot | PASS: newest session, 40 messages, epoch and `latest_seq` returned |
| v4 binary transport | PASS: one 64 KiB+ response sent as a `transport.bytes` descriptor and binary frames, reassembled to valid JSON |
| `sessions.unsubscribe` | PASS: accepted, v4-only request |
| Diagnostics | PASS: protocol 4, journal events and bytes advancing, 0 append failures, harness healthy, 0 reconnects |
| v3 client | PASS: negotiated 3, 127 sessions, every frame at v3 |
| v2 client | PASS: negotiated 2, 127 sessions, every frame at v2 |
| Paired devices | PASS: v2-era device tokens preserved, and the check revoked its own devices |

The raw evidence is `.staging/v0.5.0-live/adapter-v4-live-check.json` on the
host. It is not committed: it contains live session titles and provider
account detail.

Not exercised at cutover: a real prompt turn through v4 from the live adapter.
The live check is read-only by design, and the isolated full-stack turn is
covered by `scripts/v3-smoke-up.sh` plus the 0.5.0 benchmark in
`docs/evidence/v0.5.0/`.

## Rollback

```sh
systemctl --user disable --now jcode-mobile-adapter-v4.service
systemctl --user enable --now jcode-mobile-adapter-v2.service
```

The 0.3.1 binary reads the same data directory, ignores the v4 tables, and
speaks v2. Phones negotiate v2 and fall back to full listings and snapshot
recovery. A pre-upgrade copy of the data directory was taken at
`/home/quant/.jcode/mobile-adapter-v2.pre-0.5.0`. Restoring it loses devices and
pairings created after the copy and is only for a damaged database.

The rollback path keeps the media on the wire at v2, so a phone running the
0.5.0 client does not lose the session list or the transcript. It loses the v4
runtime and swarm notifications, the byte-package transport, and delta sync.
