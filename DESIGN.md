# DESIGN.md · JCode Mobile marketing site

Version 1.0 · 9 November 2026
Owner: website worker. Source root: `website/`.
This document is the contract for the standalone static marketing site. The app's
own visual authority remains `design/reference/JCode_Mobile_Design_Handoff/DESIGN.md`
and `src/design/tokens.ts`. The site projects those tokens into CSS. It does not
replace them.

## 1. Discovery context

| Field | Value |
| --- | --- |
| Artifact | Single-page static marketing site for a native developer tool |
| Audience | Developers who already run JCode on a Linux VPS, or are close to doing so |
| Job | Explain the continuity model, prove it with real captures, and offer the one real Android artifact |
| Primary outcome | Download the v0.2.1 Android APK with an honest sideload caveat, or read the setup path |
| Positioning | Precise personal instrument, not an operations dashboard and not a terminal toy |
| Adjectives | Precise, kinetic, tactile, self-assured, composed |
| Aesthetic essence | **Work in orbit.** |
| References | Swiss editorial posters and field guides, orbital diagrams, Apple product scroll narratives. Curated reference used for motion rhythm only. No visual cloning. |

The site is not a product UI. It is an annotated field guide to one product
behaviour: work continues on the server after the phone stops looking. Every
section answers a question a sceptical developer would ask.

## 2. Commitment and alternatives

### Chosen direction: Swiss orbital field guide

A warm light neutral field, deep Tidal petrol bands, enormous Bricolage display
type, fine measured rules, mono annotations, and a spatially shaded ASCII torus
that behaves like a specimen under observation. The page alternates light and
dark sections like plates in a printed guide. Composition is asymmetric and
left-aligned. Nothing floats on a decorative shadow.

### Alternatives considered

| Direction | Why it was rejected |
| --- | --- |
| Glass gallery | Blur, floating cards, and glow would contradict the app's opaque, no-shadow material and read as generic AI product marketing. |
| Terminal museum | Green-on-black nostalgia would sell the JCode CLI, not the phone client. It also makes long copy harder to read and narrows the audience. |
| Swiss orbital field guide | **Selected.** It carries precision, continuity, and calm technical authority. It borrows a real graphic system (the field guide plate) rather than a mood, and it gives the torus a job: a live specimen, not decoration. |

### What the page refuses

- No pill soup, rounded card grids, gradient blobs, glassmorphism, or icon tiles.
- No fake metrics, testimonials, customer logos, star ratings, or stock people.
- No App Store badge, no claim of a signed iOS build, no push notification claim.
- No invented domain, no fake live demo, no invented capability or percentage.
- No scrolljacking. Native scroll stays native. No wheel or touch interception.
- No shadows. Definition comes from rules, surface steps, and type.
- No em dashes in shipped copy.

### Signature move

**The orbit plate.** A huge ASCII torus, rendered from a real 3D point cloud with
per-cell lighting and halftone shading, rotates continuously. On scroll its
composition changes: pitch, yaw, roll, scale, and the position of the real app
screen in front of it. It is not a sparse dot field and not a decorative
background. It is the product's continuity metaphor rendered as a measuring
instrument. The torus hands off to real app captures in the continuity section,
where the phone screen becomes the subject and the torus recedes.

## 3. Typography

Bundled locally from `assets/fonts`. No remote font requests. SIL OFL notices
ship beside the files.

| Role | Face | Projection |
| --- | --- | --- |
| Display | Bricolage Grotesque SemiBold | `clamp(2.2rem, 10.5vw, 8.25rem)`, line-height 0.92, tracking -0.02em |
| Section display | Bricolage Grotesque SemiBold | `clamp(2.4rem, 5.6vw, 5.25rem)`, line-height 0.98, tracking -0.02em |
| Body | Hanken Grotesk Regular | 16 to 20px, line-height 1.55, measure 58 to 64ch |
| Emphasis | Hanken Grotesk Medium / SemiBold | 500 / 600, never a weight change on hover or selection |
| Labels and data | IBM Plex Mono Regular | 11 to 13px, uppercase labels, tracking 0.12em, tabular numerals |

The scale is intentionally editorial: display jumps are large, body steps are
tight. Display type is never used for paragraphs. Mono is never used for long
prose. All typography uses natural ragged-right text.

## 4. Color

The site uses the Tidal family from `src/design/themes.json`. Values are sRGB
projections of the locked OKLCH authoring values. No new hues are introduced.
Deep petrol carries structure. Warm light neutral carries reading. Sharp sage
carries the torus, the seam, and selected states on dark. Clay is a rare
attention mark and is never used for body-size text on a light field.

### Light projection

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#F3F6F5` | Light page field |
| `surface` | `#FFFFFF` | Highest light surface |
| `raised` | `#E8EFEC` | Tinted inset, table header |
| `ink` | `#173B3A` | Primary text |
| `muted` | `#536B65` | Secondary text, captions |
| `line` | `#D5E0DB` | Rules and decorative separators |
| `control` | `#718981` | Necessary boundaries |
| `brand` | `#164F49` | Primary button, selected underline |
| `onBrand` | `#F4F8F5` | Text on brand |
| `accent` | `#E56F4D` | Return seam mark only |
| `accentSoft` | `#FFE4D8` | Rare quote field |
| `onAccent` | `#542211` | Text on accentSoft |
| `focus` | `#316E68` | Focus perimeter |

### Night projection

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#111F20` | Dark page field |
| `surface` | `#192C2B` | Dark panel |
| `raised` | `#223735` | Dark inset, table row |
| `ink` | `#E5F0EB` | Primary text |
| `muted` | `#A0B6AD` | Secondary text |
| `line` | `#344D48` | Rules |
| `control` | `#69867E` | Boundaries |
| `brand` | `#B5D6C5` | Sage mark, primary button on dark |
| `onBrand` | `#18392E` | Text on sage |
| `accent` | `#F2B09A` | Return seam mark only |
| `focus` | `#B5D6C5` | Focus perimeter |

Ratio target: roughly 82 percent neutral field, 15 percent petrol structure,
3 percent sage or clay signal. The dark sections are composed siblings, not
inversions. No glow, neon, or colored box-shadow.

## 5. Space, geometry, and surface

- Base unit: 4px. Allowed steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80,
  96, 120, 160.
- Gutters: 20px compact, 24px regular. Maximum content width 1440px.
- Radii: 12px for controls and plates, 24px for the device sheet. No third
  radius. No pill-shaped containers. Circles only for the mark.
- Minimum target: 48px. Text links in dense footer lists still receive 44 to
  48px vertical padding.
- Shadows: none. A defined 1px rule or a surface step separates everything.
  Device frames use a 1px edge with an inner 1px inset. No diffuse elevation.
- Focus: 2px `focus` perimeter with 3px offset. Never removed. Never color-only.

## 6. Layout

Twelve-column grid inside the gutter. The page is deliberately asymmetric.

| Section | Composition |
| --- | --- |
| Masthead | Wordmark and edition left, two links and GitHub right, one hairline below |
| Hero | 7 columns of type left, 5-column orbit plate right. The real conversation screen sits inside the plate with a visible margin, so the capture is never clipped. Giant left-aligned headline. |
| Premise | Index rail, oversized statement, body column, then a three-row ledger and a typographic signal path |
| Continuity | Dark band. Sticky device right, tabs and three tall scene steps left. Torus behind the device. |
| Inspect | Real Work and Plan captures offset at different scales, annotated by a numbered note column. No equal cards. |
| Palettes | Eleven family rows, each with light and night swatch runs. A field-guide index, not a theme picker. |
| Release ledger | Dark table of what exists, what is preview, and what does not exist |
| Setup | Three sequential moves with code, plus the honest server prerequisite |
| Closing | Full-width dark statement, primary CTA, caveat, and footer links |
| Welcome | Light plate with the v0.2.1 design-preview loop, an explicit not-app-footage label, and the reduced-motion still |

Section rhythm alternates light, light-raised, dark, light, raised, dark, light,
dark. The hero first viewport is always headline, benefit, CTA, and the torus
plus real screen. On compact widths the plate stacks below the copy rather than
shrinking the type into illegibility.

## 7. Components and states

| Component | Rest | Hover | Pressed | Focus | Disabled |
| --- | --- | --- | --- | --- | --- |
| Primary download | Brand fill, onBrand text, 12px radius, 52px min height | Brand darkened 6 percent on light, sage raised on dark | Translate 1px down, no scale bounce | 2px focus perimeter, 3px offset | Not used, the artifact exists |
| Secondary action | Text with 1px bottom rule | Underline thickens, no weight change | 1px down | 2px focus perimeter | Not used |
| Scene control | Mono index + label, transparent, 1px bottom rule | Rule darkens | 1px down | 2px focus perimeter | Not used |
| Selected scene | Ink label, 2px brand underline, `aria-selected="true"` | No size or weight change | N/A | Same perimeter | N/A |
| Motion toggle | Text plus a drawn 12px glyph, transparent | Rule darkens | 1px down | 2px focus perimeter | Not used |
| Nav link | Ink or muted, 1px transparent rule | Rule appears | 1px down | 2px focus perimeter | Not used |
| Code block | Raised field, 1px control edge, mono | N/A | N/A | Scrollable, labelled | N/A |

Every icon is drawn from one 1px grid with square ends. No emoji. The mark is
the real halftone torus asset, not a redrawn mascot. All interactive controls
have visible text labels. No icon-only control except the GitHub mark, which
keeps an accessible name.

## 8. Motion

Motion communicates continuity, never urgency.

| Token | Value | Use |
| --- | --- | --- |
| Press | 80ms | Button and link press |
| Feedback | 120ms | Hover rule, selected underline |
| Disclosure | 180ms | Scene caption swap |
| Navigation | 240ms | Scene image crossfade |
| Sheet | 280ms | Device stage settle |
| Max return | 320ms | Sticky stage hand-off |
| Reduced | 100ms | Crossfade only, no travel |

Easing follows the app tokens: `cubic-bezier(0.22, 1, 0.36, 1)` for entry,
`cubic-bezier(0.4, 0, 0.2, 1)` for movement, `cubic-bezier(0.4, 0, 1, 1)` for
exit. No bounce, no elastic, no scroll-driven scroll position. Only transform
and opacity are animated in CSS. The torus is canvas and changes composition
through a lerp, not a tween library.

### Torus runtime contract

- 3D torus point cloud, 120 by 56 samples, projected with perspective.
- Per-cell depth, light, and 4x4 ordered dither. Glyph ramp `.,:;-=+*#%@/[]{}01`.
- Sage ink ramp on dark, petrol ink ramp on light plates. No purple, no glow.
- DPR capped at 1.5. Frame cadence capped at 30fps. Work is bounded to dirty rows.
- Continuous while visible. Paused offscreen with `IntersectionObserver`.
- Paused when `document.hidden`.
- `prefers-reduced-motion: reduce` starts paused on a settled static composition.
  The motion toggle can still opt in to play.
- One visible pause/play control with `aria-pressed` and a changing accessible
  name. A polite status region reports running, paused, or reduced motion.
- Canvas is `aria-hidden="true"`. Real text carries the meaning. A `<pre>`
  ASCII fallback is visible if canvas or JavaScript is unavailable.
- Scroll changes composition only. It never intercepts wheel, touch, or key
  scrolling. No scroll velocity hijack, no smooth-scroll override.

## 9. Accessibility

- WCAG 2.2 AA contrast for all text. Muted text is checked against its own field.
- Skip link to main content. Logical heading order. One h1.
- All controls keyboard operable. Scene arrows support Left, Right, Home, End.
- 48px minimum targets. Visible focus on every control.
- Status and selected state use text plus line weight plus `aria-selected`, never
  color alone.
- Content is readable with JavaScript disabled. No content is hidden behind a
  scroll reveal. Images carry alt text and version captions.
- Reduced motion is honoured. The page remains complete when animation is off.
- 320px, 390px, 768px, 1024px, and 1440px are test widths.
- No horizontal overflow at 320px. Code blocks scroll inside their own region.

## 10. Media and evidence rules

- Product images are real captures from `docs/media/`. No stock, no synthetic UI,
  no invented screenshots.
- Every screenshot caption records the version and theme. Where a newer capture
  is unavailable, the caption says "recorded in v0.2.0" and notes that the
  current preview may differ.
- The v0.2.1 welcome animation, if shown, is labelled **Design preview. Not
  recorded app footage.** It is not presented as a shipped build.
- Product captures that came from Preview mode keep that provenance in the
  caption. The sample-data banner inside the capture is not hidden or cropped.
- The social card is a 1200 by 630 composition built from the real mark, the
  real v0.2.0 Preview capture, the bundled fonts, and the ASCII orbit specimen.
  It adds no invented product UI.
- The Android CTA points to the exact v0.2.1 release asset. The visible label and
  caveat state that the APK is debug-signed for sideloading and is not a Play
  Store artifact.
- No iOS download CTA. The page states that no physical-iPhone artifact exists
  and that the iOS release is a Simulator app.
- No live domain is invented. Social metadata uses relative real assets. The
  footer links to the repository, the repository docs, and the upstream JCode
  project. Structured data carries no price or rating claim.

## 11. Content rules

- Plain technical English. Short sentences. No hype adjectives.
- No em dashes. No "supercharge", "seamless", "world-class", "enterprise-grade".
- No aphoristic pair constructions used as a substitute for information.
- Every number must be source-backed: 11 theme families, 22 palettes, 0.2.1,
  1.6s welcome, five-minute pairing code, 63 MiB APK.
- Claims about continuity follow the app contract: `continue_on_disconnect`,
  exact server and session restore, honest missing-target recovery, distinct
  send states, no automatic resend.
- Setup states the real prerequisite: a reachable JCode daemon on a Linux VPS,
  the mobile adapter, and TLS for remote connections.

## 12. Slop audit

Run against the rendered page at 1440, 1024, 768, 390, and 320.

| Check | Result |
| --- | --- |
| Primary face is not Inter, Roboto, Arial, or system | Pass: Bricolage Grotesque |
| Distinct display and body pairing | Pass: Bricolage + Hanken + Plex Mono |
| No purple or indigo gradient | Pass: Tidal petrol, warm neutral, sage |
| No gradient text, blobs, glass, or glow | Pass |
| No identical feature card grid | Pass: asymmetric ledger, sticky narrative, offset specimens |
| No shadows | Pass: rules and surface steps only |
| No pill soup | Pass: 12px control radius, text controls |
| No fake metrics, testimonials, logos, stock | Pass |
| No invented iOS or store artifact | Pass: release ledger states the gap |
| No scrolljacking | Pass: passive scroll, native behaviour |
| Motion paused offscreen and in background | Pass: IntersectionObserver + visibilitychange |
| Reduced motion path | Pass: settled torus, no CSS travel |
| Content readable without JS | Pass: static copy, fallback torus, first scene |
| Focus, 48px targets, selected state | Pass |
| 320px overflow | Pass: verified in Playwright |
| Contrast AA | Pass: token pairs checked in browser |
| Signature visible | Pass: orbit plate, torus, return seam |
| No em dashes in shipped copy | Pass: grep gate |
| Welcome preview labelled | Pass: visible design-preview label and poster fallback |
| Social card is a real composition | Pass: real mark, real capture, bundled type |

The wireframe test: with color and type removed, the page is still a field-guide
spread, not a hero plus three cards plus testimonial plus pricing stack. The
hero uses an asymmetric type and specimen split. The continuity section is a
sticky narrative with numbered states. The inspect section is an offset specimen
spread. The palette section is a ledger. Those structures survive grayscale.

## 13. Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-11-09 | Initial contract: Swiss orbital field guide, Tidal tokens, orbit plate signature, static accessibility and honesty rules. |
| 1.1 | 2026-11-09 | Added the labelled v0.2.1 welcome preview, Preview-mode capture provenance, the 1200 by 630 social card, the motion specimen hand-off, and the final responsive plate sizes. |
