# Third-party notices

This repository contains an independent application. It does not relicense JCode, its mark, its fonts, or the design handoff.

## JCode mark

`assets/mark/jcode-mark.png` is rasterized from JCode's existing halftone ring mark (`assets/brand/jcode-mark.svg` in `1jehuang/jcode`). It is not a redesign. The upstream license text is preserved at `assets/mark/JCode-LICENSE.txt`.

## Fonts

Bundled under `apps/android/app/src/main/res/font/` and `website/assets/fonts/` for Ziran 0.7.0, SIL Open Font License 1.1:

- EB Garamond (prose and headings)
- JetBrains Mono (machine labels, paths, diffs, and metadata)

Earlier fonts bundled under `assets/fonts/` for the legacy Stillness/Expo clients, all SIL Open Font License 1.1:

- Bricolage Grotesque (display) — `BricolageGrotesque-OFL.txt`
- Hanken Grotesk (interface/prose) — `HankenGrotesk-OFL.txt`
- IBM Plex Mono (code/paths) — `IBMPlexMono-OFL.txt`

Static instances were generated locally from the supplied variable fonts with `fonttools varLib.instancer` (weights 400/500/600; Bricolage at optical size 36, width 100). Latin Extended coverage was verified for Turkish and German glyphs.

## Painting details (Ziran Wu wei scenes)

Twelve cropped landscape painting details bundled in `apps/android/app/src/main/res/drawable/` and `design/wu-wei/assets/` (and pavilion/misty peaks details on the website) come from open-access public-domain works in the Metropolitan Museum of Art collection (Creative Commons Zero / CC0 1.0).

## Icons

The UI icon set is drawn for this app on a 24-unit grid with a 1.65-unit stroke. Its geometry follows the customized Lucide line set shipped with the design handoff, used under the ISC license preserved at `assets/mark/Lucide-LICENSE.txt`.

## Skills

Installed under `.jcode/skills/` with upstream license files:

- `react-native-best-practices` — Callstack, MIT (`agent-skills-LICENSE`)
- `react-native-testing` — Callstack, MIT (`react-native-testing-LICENSE`)
- `agent-device` — Callstack, MIT (`agent-device-LICENSE`)
- `frontend-design-deslop` — samber/cc-skills, MIT (`cc-skills-LICENSE`)

## Design handoff

`design/reference/JCode_Mobile_Design_Handoff/` is preserved unchanged, including its `assets/ATTRIBUTION.md` and font/brand licenses. The HTML exhibit is a design reference only and is not embedded in the app.

## Marketing site motion

The static marketing site bundles these runtime dependencies locally. There is
no CDN. Versions come from `bun.lock`; each package retains its own license.

- GSAP 3.15.1 with ScrollTrigger — GreenSock Standard License, not MIT. The
  license permits standard no-charge use and is available at
  <https://gsap.com/standard-license>. The bundled output retains the
  `https://gsap.com/standard-license` license string emitted by the package.
- Framer Motion 12.43.0 — MIT (`node_modules/framer-motion/LICENSE.md`).
- React 19.3.0 and ReactDOM 19.3.0 — MIT. These were already application
  dependencies; the marketing island uses the same installed copies.

## Application scaffold and dependencies

The initial directory structure came from Expo's blank TypeScript template (MIT, Copyright 650 Industries, Inc.). No open-source license is asserted for the authored application code. All npm dependencies retain their own licenses; see `package-lock.json` and each package's `LICENSE`.
