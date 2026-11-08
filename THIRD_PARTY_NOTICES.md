# Third-party notices

This repository contains an independent application. It does not relicense JCode, its mark, its fonts, or the design handoff.

## JCode mark

`assets/mark/jcode-mark.png` is rasterized from JCode's existing halftone ring mark (`assets/brand/jcode-mark.svg` in `1jehuang/jcode`). It is not a redesign. The upstream license text is preserved at `assets/mark/JCode-LICENSE.txt`.

## Fonts

Bundled under `assets/fonts/`, all SIL Open Font License 1.1:

- Bricolage Grotesque (display) — `BricolageGrotesque-OFL.txt`
- Hanken Grotesk (interface/prose) — `HankenGrotesk-OFL.txt`
- IBM Plex Mono (code/paths) — `IBMPlexMono-OFL.txt`

Static instances were generated locally from the supplied variable fonts with `fonttools varLib.instancer` (weights 400/500/600; Bricolage at optical size 36, width 100). Latin Extended coverage was verified for Turkish and German glyphs.

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

## Application scaffold and dependencies

The initial directory structure came from Expo's blank TypeScript template (MIT, Copyright 650 Industries, Inc.). No open-source license is asserted for the authored application code. All npm dependencies retain their own licenses; see `package-lock.json` and each package's `LICENSE`.
