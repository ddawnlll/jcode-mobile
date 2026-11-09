# Marketing media

Owned assets for the README and marketing site. Everything here is either a
capture of the real v0.2.0 app surfaces or a real capture of the shipped v0.2.1
welcome. The older `welcome-preview.gif` and `welcome-poster.png` are kept as
the historical issue #14 design reference, not as current product footage.

## Files

| File | Dimensions | Bytes | What it is |
| --- | --- | --- | --- |
| `readme-hero.png` | 3200x1800 (1600x900 at 2x) | 1,637,132 | Typographic README hero. Real v0.2.0 Preview screenshots, Bricolage Grotesque, Hanken Grotesk, IBM Plex Mono, and Tidal Glass colors. |
| `welcome-v021.png` | 1170x2532 (390x844 at 3x) | 193,326 | **Shipped v0.2.1 welcome**, Tidal Light, captured from the Expo web verification build after the opening settled. |
| `welcome-v021-night.png` | 1170x2532 (390x844 at 3x) | 199,776 | **Shipped v0.2.1 welcome**, Tidal Night, same capture path. Used by the README and website. |
| `welcome-preview.gif` | 240x519, 60 frames, 20 fps, 3.0 s, infinite loop | 1,529,838 | **Historical design reference.** Animated capture of the issue #14 HTML reference. Superseded by `welcome-v021.png`; not the shipping app. |
| `welcome-poster.png` | 780x1688 | 599,535 | Still poster for the historical design reference GIF. |
| `sessions-v020.png` | 860x1800 (430x900 at 2x) | 131,832 | Current v0.2.0 Sessions surface in labelled Preview mode. |
| `conversation-v020.png` | 860x1800 (430x900 at 2x) | 196,139 | Current v0.2.0 Conversation surface in labelled Preview mode, showing rich Markdown, table, quote, and math. |
| `work-v020.png` | 860x1800 (430x900 at 2x) | 132,356 | Current v0.2.0 Session work surface in labelled Preview mode. |
| `connect-v020.png` | 860x1800 (430x900 at 2x) | 141,138 | Current v0.2.0 connection setup screen, empty form, no server contacted. |

## Provenance and honesty

### Shipped v0.2.1 welcome captures

- Source: Expo web export of the v0.2.1 app, `CI=1 expo export -p web`.
- Driver: Playwright Chromium at 390x844 with device scale factor 3, light and
  night color schemes. The capture waits for `window.__JCODE_WELCOME_PERF__`
  to report at least one idle paint, so it is the settled screen, not a frame
  during the opening.
- Status: **shipped v0.2.1 welcome.** The same screen is in the native build.
  The capture is from the web verification surface, not a device recording.
- The title, actions, Skip/Pause control, theme strip, and ASCII torus are the
  real components. No hand-built replacement UI.

### Historical welcome GIF and poster

- Source: `origin/design/v0.2.1-ascii-welcome`, file
  `docs/v0.2.1/JCode_Mobile_ASCII_Welcome.html`.
- Driver: `scripts/marketing-media/capture-welcome.mjs`, which reads the file
  with `git show` and never switches branches.
- Status: **historical design reference.** It was produced while issue #14 was
  open and is superseded by `welcome-v021.png`.
- The phrase `v0.2.1 DESIGN PREVIEW` is baked into every GIF frame and into the
  poster so the asset cannot be mistaken for v0.2.0 app footage.
- Capture method: Playwright Chromium at 390x844, device scale factor 1 for the
  GIF and 2 for the poster. `requestAnimationFrame` and `performance.now` were
  replaced with a virtual clock before the page booted. Each screenshot advances
  exactly 50 ms and calls the reference's own `paint()`. This is deterministic:
  no dropped frames, no speed changes, and no hand-drawn replacement frames.
- Encoding: ffmpeg at 20 fps, 240 px wide, 48-color palette, no dithering, then
  ImageMagick `-layers Optimize` for inter-frame transparency. The first frame
  is the real ASCII noise field, not a blank or transparent placeholder. The
  loop returns to that opening state.
- The reference HTML embeds its own welcome fonts. The repository fonts in
  `assets/fonts` are not used by the reference capture.

### v0.2.0 app screenshots

- App: current `main` at `f74c6b6`, package version `0.2.0`.
- Build: `CI=1 bunx --bun expo export -p web --output-dir .staging/marketing/web`
  served by `scripts/serve-web.mjs` on `127.0.0.1:8092`.
- Driver: `scripts/marketing-media/capture-app-screens.mjs`.
- Browser: Playwright Chromium, 430x900 at device scale factor 2, dark color
  scheme, reduced motion, empty local storage.
- State: the app's own **Preview** mode. The screens show sample data and the
  app's own "Preview sample data. Nothing is sent to a server." banner.
- No adapter, daemon, provider, pairing code, credential, private session, or
  live server was contacted. Browser storage is cleared before the run.
- Theme: Tidal Glass night, the default family. Colors are defined in
  `src/design/themes.json` and projected by `src/design/tokens.ts`.

### README hero

- Source: `scripts/marketing-media/readme-hero.html`, rendered by
  `scripts/marketing-media/render-readme-hero.mjs`.
- The phone areas are the real `sessions-v020.png` and
  `conversation-v020.png` captures above. The hero draws only typography,
  rules, the real JCode mark, and a grain plate. It does not draw app UI.
- Fonts: `assets/fonts/BricolageGrotesque-SemiBold.ttf`,
  `assets/fonts/HankenGrotesk-Regular.ttf`,
  `assets/fonts/HankenGrotesk-Medium.ttf`, and
  `assets/fonts/IBMPlexMono-Regular.ttf`.
- Colors: Tidal Glass night tokens, `#111F20` bg, `#E5F0EB` ink,
  `#A0B6AD` muted, `#344D48` line, `#B5D6C5` brand, `#F2B09A` accent.
- The honesty line reads `V0.2.0 CAPTURES / PREVIEW BUILD, SAMPLE DATA`.

## Suggested captions and alt text

`welcome-v021-night.png`

> JCode Mobile 0.2.1 welcome. Real app capture, Tidal Night, 390x844.

Alt: "An ASCII halftone torus spins above the words Welcome to jcode, with
Get started and Preview without connecting actions."

`welcome-preview.gif`

> Historical design reference for the v0.2.1 ASCII welcome. Not current app
> footage.

Alt: "Animated portrait design preview: an ASCII torus assembles from noise,
spins, and the words Welcome to jcode appear over a deep green screen."

`welcome-poster.png`

> Historical v0.2.1 ASCII welcome design reference, still frame.

Alt: "Deep green portrait screen with a spinning ASCII torus above the words
Welcome to jcode and a v0.2.1 design preview label."

`readme-hero.png`

> JCode Mobile v0.2.0. Real Preview-mode captures, sample data only.

Alt: "Swiss-style dark green hero. Large type reads Your work. In reach. Two
JCode Mobile phone screenshots show the Sessions list and a conversation with a
Markdown table. A line reads v0.2.0 captures, preview build, sample data."

`sessions-v020.png`

> JCode Mobile 0.2.0 Sessions in Preview mode, sample data.

`conversation-v020.png`

> JCode Mobile 0.2.0 Conversation in Preview mode, sample data.

`work-v020.png`

> JCode Mobile 0.2.0 Session work in Preview mode, sample data.

`connect-v020.png`

> JCode Mobile 0.2.0 connection setup. No server contacted.

## Reproduce

Prerequisites: Bun 1.4.4, dependencies installed, Playwright Chromium,
ffmpeg, ImageMagick, and `origin/design/v0.2.1-ascii-welcome` fetched.

```sh
# 1. Current v0.2.0 web build and an isolated static server.
CI=1 bunx --bun expo export -p web --output-dir .staging/marketing/web
PORT=8092 HOST=127.0.0.1 bun --bun scripts/serve-web.mjs .staging/marketing/web

# 2. Real app captures.
node scripts/marketing-media/capture-app-screens.mjs

# 3. v0.2.1 design reference GIF and poster.
node scripts/marketing-media/capture-welcome.mjs

# 4. README hero.
node scripts/marketing-media/render-readme-hero.mjs
```

The scripts write intermediate frames, the reference HTML copy, and the capture
manifest under `.staging/marketing/`. Only the assets in this directory are
tracked.

Capture manifest for the final GIF:

```json
{
  "source": "origin/design/v0.2.1-ascii-welcome:docs/v0.2.1/JCode_Mobile_ASCII_Welcome.html",
  "sourceKind": "v0.2.1 ASCII welcome design reference; issue #14 open",
  "label": "v0.2.1 DESIGN PREVIEW",
  "fps": 20,
  "frameCount": 60,
  "durationMs": 3000,
  "captureViewport": { "width": 390, "height": 844 },
  "gifWidth": 240,
  "posterAtMs": 2800
}
```

## Constraints for website use

- Use `welcome-v021-night.png` or `welcome-v021.png` for current product pages.
  They are portrait 1170x2532. Do not crop them to 16:9 or 4:3.
- The historical GIF/poster must keep their design-reference captions if used.
  Do not present them as shipped app footage.
- The v0.2.0 screenshots already say Preview and sample data. Do not crop that
  banner out.
- The hero is 3200x1800 for a 1600x900 layout. It can be displayed at README
  width without cutting the headline, subhead, or honesty line.
