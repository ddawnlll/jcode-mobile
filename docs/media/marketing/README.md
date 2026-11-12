# Marketing media

Current assets for JCode Mobile 0.3.0. Every current screenshot is a real
capture from an isolated adapter and a real Command Code turn. No mockup,
hand-drawn app UI, or fabricated runtime state is used.

The older `*-v020.png`, `welcome-v021*`, and `welcome-preview.gif` files are
retained as historical evidence for the 0.2.x verification records. They are
not current product footage and are not used by the 0.3.0 README or website.

## Current 0.3.0 captures

| File | Dimensions | Bytes | What it is |
| --- | --- | --- | --- |
| `readme-hero.png` | 3200x1800 | 1,913,212 | README hero. Real 0.3.0 home and session captures with typography and the JCode mark. |
| `welcome-v030.png` | 860x1800 | 145,322 | Stillness 12 welcome screen. |
| `pair-v030.png` | 860x1800 | 120,958 | Pairing form with server address, code, and device name. |
| `pair-verified-v030.png` | 860x1800 | 98,925 | Paired state after a real token exchange. |
| `home-v030.png` | 860x1800 | 122,906 | Home with a live session and the `jcode-mobile` project. |
| `session-v030.png` | 860x1800 | 195,919 | Session with a real `deepseek/deepseek-v4-flash` answer, reasoning, and composer. |
| `models-v030.png` | 860x1800 | 191,077 | Model sheet with Command Code routes and the selected route. |
| `settings-v030.png` | 860x1800 | 155,825 | Preferences and verified connection capabilities. |
| `desktop-v030.png` | 2560x1800 | 332,782 | Three-pane Stillness 12 desktop shell at 1280x900, scale factor 2. |

`website/assets/social-card.png` is rendered separately at 2400x1260 (1200x630
at scale factor 2) from `scripts/marketing-media/social-card.html`. It uses the
real session capture and the JCode mark.

## Provenance

- Capture date: 2026-11-12.
- Driver: `scripts/marketing-media/capture-stillness-screens.mjs`.
- Source: Stillness 12 served by an isolated Rust Adapter v2 on
  `127.0.0.1:7652`, with an isolated `JCODE_HOME` and a real Command Code
  route.
- Phone viewport: 430x900 at device scale factor 2, which produces the
  860x1800 PNGs. Desktop viewport: 1280x900 at scale factor 2.
- The session title and prompt are sample content chosen for the capture. The
  answer, model route, token counts, delivery state, and capability list came
  from the running stack.
- No production adapter, production daemon, private session, provider key, or
  credential is present in these files.
- The capture script refuses to run against a production adapter. Its manifest
  is `capture.json`; the run reported no page errors.

The screenshot sequence is:

1. Welcome.
2. Pairing form.
3. Pairing verified by a real token exchange.
4. Home with the new session.
5. The live session while the real answer streams.
6. The model sheet.
7. Preferences and connection capabilities.
8. The desktop shell during the same live turn.

The desktop shell is captured before the page reload that would drop the live
assistant text. That is why the session image and the desktop image show the
same turn.

## README hero and social card

- `scripts/marketing-media/readme-hero.html` is a typographic composition. Its
  phone areas are the real `home-v030.png` and `session-v030.png` captures. It
  draws only type, rules, the real JCode mark, and a grain plate.
- Render it with `node scripts/marketing-media/render-readme-hero.mjs`.
- `scripts/marketing-media/social-card.html` is the 1200x630 social card. It
  uses `session-v030.png`, the JCode mark, and no drawn app UI.
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

Do not use a historical asset on a current product page. Do not crop the
Preview banner out of a v0.2.0 capture. Do not describe the GIF or poster as
shipped app footage.

## Reproduce the current captures

Prerequisites: Bun 1.4.4, Rust, the pinned JCode fork, Playwright Chromium, and
the rootless Playwright library prefix on Debian/Ubuntu.

```sh
# A real adapter and session are already running for the capture script.
# It refuses production and uses the isolated URL supplied by the operator.
node scripts/marketing-media/capture-stillness-screens.mjs

# Typographic compositions.
node scripts/marketing-media/render-readme-hero.mjs
node scripts/marketing-media/render-social-card.mjs
```

The isolated capture run used:

```text
JCODE_ADAPTER_BIND=127.0.0.1:7652
JCODE_ADAPTER_DATA_DIR=.staging/marketing/adapter-v030d
JCODE_ADAPTER_WEB_DIR=apps/stillness/dist
JCODE_ADAPTER_PAIRING_CODE=<test-only code>
```

The exact run metadata is in `capture.json`. Staging paths under `.staging/`
are gitignored.

## Website use

- Use the 860x1800 v0.3.0 captures at their native aspect ratio.
- `readme-hero.png` is 3200x1800 for a 1600x900 layout. It can be displayed at
  README width without cutting the headline, subhead, or provenance line.
- Keep the `Real capture / v0.3.0` label. Do not add a claim that the torus or
  orbit plate is live telemetry; it is a design specimen.
- The Android artifact is debug-signed and sideload-only. Do not imply a Play
  Store listing or a signed iOS build.
