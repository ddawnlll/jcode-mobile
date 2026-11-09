# Marketing media

Owned assets for the README and marketing site. Everything here is either a
capture of the real v0.2.0 app or a rendered capture of the v0.2.1 welcome
design reference. No stock imagery and no hand-built fake app UI.

## Files

| File | Dimensions | Bytes | What it is |
| --- | --- | --- | --- |
| `readme-hero.png` | 3200x1800 (1600x900 at 2x) | 1,637,132 | Typographic README hero. Real v0.2.0 Preview screenshots, Bricolage Grotesque, Hanken Grotesk, IBM Plex Mono, and Tidal Glass colors. |
| `welcome-preview.gif` | 240x519, 60 frames, 20 fps, 3.0 s, infinite loop | 1,529,838 | **v0.2.1 DESIGN PREVIEW.** Animated capture of the ASCII welcome reference on `origin/design/v0.2.1-ascii-welcome`. Issue #14 is still OPEN. Not the shipping app. |
| `welcome-poster.png` | 780x1688 | 599,535 | Still poster and reduced-motion fallback for the GIF. Same v0.2.1 design preview frame at 2.8 s. |
| `sessions-v020.png` | 860x1800 (430x900 at 2x) | 131,832 | Current v0.2.0 Sessions surface in labelled Preview mode. |
| `conversation-v020.png` | 860x1800 (430x900 at 2x) | 196,139 | Current v0.2.0 Conversation surface in labelled Preview mode, showing rich Markdown, table, quote, and math. |
| `work-v020.png` | 860x1800 (430x900 at 2x) | 132,356 | Current v0.2.0 Session work surface in labelled Preview mode. |
| `connect-v020.png` | 860x1800 (430x900 at 2x) | 141,138 | Current v0.2.0 connection setup screen, empty form, no server contacted. |

## Provenance and honesty

### Welcome GIF and poster

- Source: `origin/design/v0.2.1-ascii-welcome`, file
  `docs/v0.2.1/JCode_Mobile_ASCII_Welcome.html`.
- Driver: `scripts/marketing-media/capture-welcome.mjs`, which reads the file
  with `git show` and never switches branches.
- Status: **v0.2.1 design preview.** Issue #14 remains OPEN. This is not the
  current shipping app, and it is not a device screen recording.
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

`welcome-preview.gif`

> Design preview of the planned v0.2.1 ASCII welcome. Not recorded app footage.
> Issue #14 is still open.

Alt: "Animated portrait design preview: an ASCII torus assembles from noise,
spins, and the words Welcome to jcode appear over a deep green screen."

`welcome-poster.png`

> v0.2.1 ASCII welcome design preview, still frame. Issue #14 is open.

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

- The welcome GIF is portrait 240x519. Do not crop it to 16:9 or 4:3. Place it
  in a phone frame and keep the baked `v0.2.1 DESIGN PREVIEW` label visible.
- Keep the caption "Design preview. Not recorded app footage." with the GIF.
- Do not describe the GIF as v0.2.0 or as shipping functionality.
- The v0.2.0 screenshots already say Preview and sample data. Do not crop that
  banner out.
- The hero is 3200x1800 for a 1600x900 layout. It can be displayed at README
  width without cutting the headline, subhead, or honesty line.
