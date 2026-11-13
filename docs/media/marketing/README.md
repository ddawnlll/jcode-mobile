# Marketing media

Current assets for JCode Mobile 0.3.1. Every current screenshot is a real
capture from an isolated adapter and a real Command Code-routed turn. No
mockup, hand-drawn app UI, or fabricated runtime state is used.

The older `*-v020.png`, `welcome-v021*`, and `welcome-preview.gif` files are
retained as historical evidence for the 0.2.x verification records. The
`*-v030.png` files are retained as the 0.3.0 evidence set. Neither is current
product footage, and neither is used by the 0.3.1 README or website.

## Current 0.3.1 captures

| File | Dimensions | Bytes | What it is |
| --- | --- | --- | --- |
| `readme-hero.png` | 3200x1800 | see run | README hero. Real 0.3.1 home and session captures with typography and the JCode mark. |
| `welcome-v031.png` | 860x1800 | see run | Stillness 12 welcome screen. |
| `pair-v031.png` | 860x1800 | see run | Pairing form with server address, code, and device name. |
| `pair-verified-v031.png` | 860x1800 | see run | Paired state after a real token exchange. |
| `home-v031.png` | 860x1800 | see run | Home with `Harness online` and the sessions list. |
| `session-v031.png` | 860x1800 | see run | Session with a real `gpt-6.1-sol` answer, model route, and composer. |
| `models-v031.png` | 860x1800 | see run | Model sheet with Command Code routes and the native provider. |
| `settings-v031.png` | 860x1800 | see run | Preferences and verified connection capabilities. |
| `desktop-v031.png` | 2560x1800 | see run | Three-pane Stillness 12 desktop shell at 1280x900, scale factor 2. |

`website/assets/social-card.png` is rendered separately at 2400x1260 (1200x630
at scale factor 2) from `scripts/marketing-media/social-card.html`. It uses the
real session capture and the JCode mark.

Run the following to regenerate these assets before a release:

```sh
# 1. Start an isolated adapter with the web build mounted, then:
APP_URL=http://127.0.0.1:7652/ PAIR_CODE=<test-only-code> \
  bun scripts/marketing-media/capture-stillness-screens.mjs
# 2. Typographic compositions:
node scripts/marketing-media/render-readme-hero.mjs
node scripts/marketing-media/render-social-card.mjs
```

`OUT_DIR` and `AUTH_FILE` can be pointed at `.staging/` so captures land
outside the repo before being copied in.

## Provenance

- Capture date: 2026-11-13.
- Driver: `scripts/marketing-media/capture-stillness-screens.mjs`.
- Source: Stillness 12 served by an isolated Rust Adapter v2 on
  `127.0.0.1:7652`, with an isolated `JCODE_HOME` and a real daemon.
- Phone viewport: 430x900 at device scale factor 2, which produces the
  860x1800 PNGs. Desktop viewport: 1280x900 at scale factor 2.
- The session title and prompt are sample content chosen for the capture. The
  answer, model route, delivery state, and capability list came from the
  running stack. The `list` rows and labels come from `jcode.list_sessions`.
- No production adapter, production daemon, private session, provider key, or
  credential is present in these files.
- The capture script refuses to run against a production adapter. Its manifest
  is `capture.json`; the run reported zero page errors.

The screenshot sequence is:

1. Welcome.
2. Pairing form.
3. Pairing verified by a real token exchange.
4. Home with the new session.
5. The live session while the real answer streams.
6. The model sheet.
7. Preferences and connection capabilities.
8. The desktop shell during the same live turn.

## README hero and social card

- `scripts/marketing-media/readme-hero.html` is a typographic composition. Its
  phone areas are the real `home-v031.png` and `session-v031.png` captures. It
  draws only type, rules, the real JCode mark, and a grain plate.
- Render it with `node scripts/marketing-media/render-readme-hero.mjs`.
- `scripts/marketing-media/social-card.html` is the 1200x630 social card. It
  uses `session-v031.png`, the JCode mark, and no drawn app UI.
- Render it with `node scripts/marketing-media/render-social-card.mjs`.
- Both compositions use the bundled Bricolage Grotesque, Hanken Grotesk, and
  IBM Plex Mono fonts. They make no remote font or image request.

## Historical assets

These files remain for the v0.2.x verification records only:

| File | Status |
| --- | --- |
| `sessions-v020.png`, `conversation-v020.png`, `work-v020.png`, `connect-v020.png` | Expo 0.2.0 Preview-mode captures, sample data. |
| `welcome-v021.png`, `welcome-v021-night.png` | Shipped 0.2.1 welcome, Expo web capture. |
| `welcome-preview.gif`, `welcome-poster.png` | Issue #14 design reference, labelled as a design preview. |

The `welcome-v030.png`, `pair-v030.png`, `pair-verified-v030.png`,
`home-v030.png`, `session-v030.png`, `models-v030.png`, `settings-v030.png`,
`desktop-v030.png` files remain for the 0.3.0 evidence record. Do not use a
historical asset on a current product page. Do not crop the Preview banner out
of a v0.2.0 capture. Do not describe the GIF or poster as shipped app footage.

## Reproduce the current captures

Prerequisites: Bun 1.4.4, Rust, the pinned JCode fork, Playwright Chromium, and
the rootless Playwright library prefix on Debian/Ubuntu.

```sh
# A real adapter and session are already running for the capture script.
# It refuses production and uses the isolated URL supplied by the operator.
APP_URL=http://127.0.0.1:7652/ PAIR_CODE=<test-only-code> \
  bun scripts/marketing-media/capture-stillness-screens.mjs

# Typographic compositions.
node scripts/marketing-media/render-readme-hero.mjs
node scripts/marketing-media/render-social-card.mjs
```

The isolated capture run used:

```text
JCODE_ADAPTER_BIND=127.0.0.1:7652
JCODE_ADAPTER_DATA_DIR=.staging/marketing/adapter
JCODE_ADAPTER_WEB_DIR=apps/stillness/dist
JCODE_ADAPTER_PAIRING_CODE=<test-only code>
```

The exact run metadata is in `capture.json`. Staging paths under `.staging/`
are gitignored.

## Website use

- Use the 860x1800 v0.3.1 captures at their native aspect ratio.
- `readme-hero.png` is 3200x1800 for a 1600x900 layout. It can be displayed at
  README width without cutting the headline, subhead, or provenance line.
- Keep the `Real capture / v0.3.1` label. Do not add a claim that the torus or
  orbit plate is live telemetry; it is a design specimen.
- The Android artifact is debug-signed and sideload-only. Do not imply a Play
  Store listing or a signed iOS build.
