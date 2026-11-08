# DESIGN.md · JCode Mobile

Visual and interaction system · 1.0 · 8 November 2026

This is the visual authority for the future React Native + TypeScript app. PRODUCT_SPEC.md owns behavior; SOURCE_NOTES.md owns source facts. Logical units below mean dp on Android and points on iOS; the HTML uses equivalent CSS pixels at 100% scale. Device frames and desktop exhibition controls are presentation only.

## Context and commitment

Artifact: native mobile companion + conversational interface. Audience: a developer returning to VPS-hosted agents, often briefly, sometimes on a poor connection. Primary outcome: understand the actual work and take the next useful action.

Positioning: precise technical product with the care of a personal instrument. Adjectives: **composed, tactile, lucid, continuous**. Aesthetic essence: **Quiet moving work.**

| Word | Concrete design choice |
| --- | --- |
| Composed | One full-width reading surface, disciplined green-gray neutrals, no dashboard metrics |
| Tactile | Compact display type, 12-unit control geometry, immediate pressed response, opaque sheets |
| Lucid | Strong primary/secondary hierarchy; plain status labels; assistant prose free of bubble chrome |
| Continuous | A return seam, stable reading anchors, identity-preserving screen transitions, explicit cache freshness |

### Three directions considered

| Direction | Structure and material | Why it was or was not selected |
| --- | --- | --- |
| **Tidal** | Cool mineral canvas; deep green ink; humane compact type; ordered sessions opening into a long reading surface; return seam | Selected: directly expresses ongoing work and returning attention without turning the phone into an operations console |
| Signal | Slate and acid-yellow; dense dispatch roster; session lanes; visible cross-session coordination | Good for supervising many simultaneous workers; weaker for long conversation and calm reading on a compact phone |
| Folio | White and oxblood; large booklike session covers; multi-page narrative navigation | Strong authored identity; cover-based browsing spends too much space and can make navigation feel ceremonial |

Selection was based on the user’s tasks: rapid return, long conversations, sparse interventions, compact phones, low rendering cost. It is not a randomly selected theme and is not a reproduction of any reference product.

### References transposed

- [Linear Mobile](https://linear.app/mobile): narrow the away-from-keyboard job; make the primary creation flow reachable. Borrow the focus, not Linear’s palette or navigation.
- [Things](https://culturedcode.com/things/features/): a compact row can unfold into rich detail without exposing every field at rest. Borrow continuity and progressive disclosure, not task-list iconography.
- Apple motion and Android navigation/accessibility guidance: native back, readable targets, interruption-safe motion, and platform text behavior. Product identity remains shared.
- The requested frontend-design-deslop material informed strategy-first discovery, genuinely different directions, token-first styling, the structural critique, full state matrices, and the rendering audit. Hallmark informed the one-idea-per-screen discipline, meaningful product imagery, and rejection of superficial polish. Both are credited in SOURCE_NOTES.md; the showcase’s typography and structure were authored for this product.

### Signature: the return seam

The single signature is a **boundary between seen and unseen work**. In the transcript, a fine line breaks at a concise label, “Since you left”. In Work, the same boundary sits on the event spine at the first unseen recorded item. It may carry a count of actual committed items. Opening the work sheet preserves this conceptual point, so reading and inspecting feel like two views of the same work.

The seam is functional, not decoration. No seam when nothing is new. No count when the bookmark cannot be reconciled. No pulsing, sweeping scan line, or percent fill. Its visual motif does not spread to borders on every session row.

## Typography

| Role | Family | Weight and settings | Source and license |
| --- | --- | --- | --- |
| Display / session headings | Bricolage Grotesque | 600; optical size 32; width 100; tracking −0.02em for ≥32, −0.01em below | Google Fonts; SIL OFL 1.1; bundled license |
| Interface / prose | Hanken Grotesk | 400 body, 500 labels, 600 emphasis; tracking 0 | Google Fonts; SIL OFL 1.1; bundled license |
| Code / paths / identifiers | IBM Plex Mono | 400; tabular figures; tracking 0 | Google Fonts; SIL OFL 1.1; bundled license |

Bricolage’s compact, idiosyncratic shapes supply the personality. Hanken’s calm rhythm supports long output. Their roles stay separate: do not set all prose in the display face, or all UI labels in mono. Platform status bars and native pickers may use the platform’s system type. This is a platform behavior exception, not the app’s primary type choice.

Scale: base 16; major second ratio 1.125 for the functional steps, rounded to whole logical units, with explicit display jumps for clear hierarchy. This is intentionally tighter than a marketing scale. It is not an instruction to generate more sizes.

| Token | Size / line | Weight | Use |
| --- | --- | --- | --- |
| caption | 13 / 18 | 500 | Time, role metadata; never a whole paragraph |
| small | 14 / 20 | 500 | Secondary labels, helper/error text |
| body | 16 / 24 | 400 | Transcript, input, settings |
| lead | 18 / 26 | 400 | Onboarding explanation |
| subhead | 20 / 26 | 600 | Session rows, sheet subsections |
| title | 24 / 30 | 600 | Expanded session title, modal heading |
| screen | 32 / 36 | 600 | Compact page title |
| display | 40 / 44 | 600 | Sessions title on a roomy phone |

Body measure on a 390-wide phone is the available 350 units. No artificial 65-character requirement on phones. At tablet widths, cap prose measure around 68ch. Use natural ragged-right text. Preserve leading at large text sizes. Buttons are 16/20 medium; no letterspaced capitals. Numbers in times, counts, and plan totals use tabular figures.

### Text stress rules

- Row/session titles: two lines at default scale, then full accessible name. Large text may use additional lines and increase row height.
- Header compact title: one line; its switcher/detail reveals the full title. No scrolling marquee.
- Status: two lines maximum in the dock at default scale; height can expand at large text. The Stop target does not shrink.
- Paths: truncate leading directories only in summaries. Full paths wrap in detail/copy surfaces.
- German/Turkish labels and 30% expansion must fit. Unsupported scripts use platform fallback with comparable x-height; never show tofu to preserve the brand font.
- Font weight never changes on hover or selection. Reserve the same metrics across states.

## Color system

The dominant material is cool mineral gray with green-black ink. Tidal green is the primary action color. Clay is a selective warm signal for attention and the return boundary, always paired with readable dark text. It is not a blanket warning color or the default send button.

Typical conversation coverage: about 80–85% neutral reading field, 12–17% green ink/controls, 3% or less clay emphasis. The exhibition can use a large green band, but the app does not need large colored backgrounds on every screen.

Use the semantic colors in the generated palette appendix below. OKLCH is the design authoring value; exact sRGB hex is the React Native/export value. Do not ask a native StyleSheet to parse CSS OKLCH. The token JSON carries both values.

Semantic rules:

- `line` separates rows and is decorative. It is not a sufficient field boundary or focus indicator.
- `control` defines necessary input boundaries; `focus` defines keyboard/switch focus.
- `accent` is a graphic fill only. Normal text uses `onAccent` on `accentSoft`, never tiny white type on clay.
- `success`, `warning`, `error` are text/icon colors with explicit labels. They do not recolor all action buttons.
- `brand` and `onBrand` always travel together on primary buttons.
- Dark/Night is a composed sibling palette with elevated lightness steps. It is not an inversion or a black terminal theme.

## Geometry, spacing, and surfaces

Spacing base: 4 units. Allowed scale: **4, 8, 12, 16, 20, 24, 32, 40, 48, 64**. Optical 1-unit rules and 2-unit focus indicators are explicit exceptions. Safe-area dimensions are platform-provided, not spacing tokens.

Two app radii only: **12** for controls, user messages, output regions; **24** for large modal sheets. Circles are allowed for a round icon target or native platform control, not as a third card radius. Small rows are not enclosed cards.

Surface approach: **defined separation, no app drop shadows**. Use a surface change or a fine separator. An input can have a `control` edge. A sheet uses an opaque `surface`, optional top separator, and a dim scrim. Never combine a hairline edge and diffuse shadow. Device mockups in the exhibit may have physical casing shadows; these must not appear in the app.

| Relationship | Space |
| --- | --- |
| Icon to same-label text | 8 |
| Title to metadata | 4 |
| Body paragraph to paragraph | 12 |
| Related form fields | 16 |
| Group heading to first row | 12 |
| Unrelated sections | 32 |
| Compact horizontal gutter | 20 |
| Regular/tablet gutter | 24 |
| Bottom dock to safe area | 12 minimum |

## Layout contract

### Reference frames

| Platform frame | Logical size | Purpose |
| --- | --- | --- |
| iOS portrait | 390 × 844 | Primary visual reference |
| Android portrait | 412 × 892 | Android target/IME/back reference |
| Compact | 360 × 780, plus 320-wide stress case | Content reflow, not a shrunken screenshot |
| Large phone | 430 × 932 | More transcript, same readable type |
| Expanded / tablet | ≥720 width | Optional list/detail split with minimum 280 list + 400 conversation; collapse if text scale makes either unreadable |

The device casing is excluded from these sizes. The exhibition sometimes scales a whole framed specimen to fit a desktop composition; that visual scaling is not a native layout algorithm.

### Conversation bands at 390 × 844

| Band | Reference size | Behavior |
| --- | --- | --- |
| Top safe/status | Platform-provided, example 54 | Do not hardcode in native app |
| Navigation | 56 | Native back, title switcher, overflow |
| Expanded identity | 96–120 | Present near transcript top; compact on scroll; do not animate typography on every pixel |
| Transcript | Remaining flexible height | Virtualized, stable reading anchor |
| Connection notice | Content-sized, typically 32–48 | Inline below header when non-current; never floats over a message |
| Work dock | Min 48 | Above composer; hides only when there is no work/status to inspect |
| Composer | 56–144 input + 8/12 separation | Keyboard-aware; visible label; Send stays ≥48 |
| Bottom safe area | Platform-provided, example 34 | Opaque background, never text behind home indicator |

The keyboard reduces transcript space first. At very short height, collapse expanded identity and use a full-screen Work view; never compress touch targets or slide the composer under the IME. Readable content can scroll; app controls cannot disappear behind overlapping fixed layers.

### Structural rule

Sessions is an ordered list, Conversation is a reading surface, Work is an unfolding event list, and Settings is a grouped form. Do not reuse one rounded card template across these different jobs. The layout’s distinction survives grayscale: typography and unboxed groups still carry the hierarchy.

## Components and exact states

All controls inherit default, pressed, focus-visible, disabled, loading, error, selected, and read-only where relevant. Native menus/pickers may use native styling. Hover is only for pointer-capable platforms and never essential.

### Shared interaction matrix

| State | Primary button | Secondary / text action | Input / disclosure |
| --- | --- | --- | --- |
| Rest | `brand` fill, `onBrand` label | Transparent or `raised`, `ink` label | `surface`, `control` border, visible label |
| Hover | `brand` with subtle on-surface overlay, no size change | `raised` fill | `raised` fill only on clickable disclosure |
| Pressed | 0.985 scale for a standalone button; 0.96 opacity for a row | Immediate fill/opacity feedback | No input scale; row feedback only |
| Focus | 2-unit `focus` perimeter + 2-unit separation | Same | Same, with unobscured caret/label |
| Disabled | `raised` fill, `muted` text, no press transform | `muted`; helper reason nearby | Read-only content still selectable; sending reason visible |
| Loading | Preserve width; text “Starting…”/“Sending…” + compact state glyph | Preserve label and geometry | Disable duplicate mutation; keep typed input |
| Error | Keep hierarchy; local error text `error` | Retry beside failing item | `error` border + specific text; no clearing |
| Selected | Same weight; filled surface/checked glyph | `raised` + text/check | `aria-selected`/native semantic state |
| Read-only | No misleading press style | Copy/view actions remain | `raised`; “Read only” text if ambiguous |

For actual native code, derive hover overlays from tokens rather than adding scattered literal values. Disabled controls must not rely on 30% opacity gray-on-gray if their reason needs to be read. A persistent helper is required for offline send.

### Component dimensions

| Component | Shape / dimensions | Content and behavior |
| --- | --- | --- |
| Primary action | Min 48 high, radius 12, 16 horizontal inset | Verb label; one primary per decision surface |
| Icon target | 48 square, visible icon 20/24 | Accessible verb label; no tooltip-only meaning |
| Session row | Min 88 high, 20 horizontal screen gutter, 16 vertical inset | Title, directory, status, update time; full-row tap |
| Search field | Min 48 high, radius 12, 16 text inset | Visible label; clear action is separate 48 target |
| User message | Max 86% transcript width, radius 12, padding 12/16 | Leading role label accessible, body 16/24, right/trailing aligned |
| Assistant message | No enclosing card | Role/time 13/18; prose 16/24; actions appear after completed message |
| Return seam | Min 48 effective target, 1-unit horizontal line, 8/12 label spacing | One boundary, count if authoritative; no fill animation |
| Work dock | Min 48; top separator; no capsule floating above composer | Text disclosure and separate Stop target |
| Composer | Input min 56/max 144, radius 12; 48 Send target | Label remains visible; height follows content not token stream |
| Tool event | Min 64; 20-unit glyph/spine column + 12 gap | Verb, raw tool name, state, detail disclosure |
| Plan item | Min 64; label flexible, count outside item | Check/work/blocked glyph + text; read-only |
| Bottom sheet | Radius 24 at upper corners, 20/24 padding, opaque surface | 64% initial available height; full-screen at large text/compact landscape |
| Settings row | Min 56, 16 vertical if multiline | Label, value, optional native control; no nested cards |
| Code preview | Radius 12, 12 inset, mono 13/20 | Copy action, wrap control, bounded preview and disclosure |
| Banner / notice | Full content width, 12/16 inset | Icon + exact state + recovery action; no decorative colored side border |

### Empty, error, and loading treatments

Empty: one useful sentence and the existing primary action. No oversized symbolic illustration. Loading a first list: a quiet placeholder of 3 real row shapes, static when Reduced Motion; no full-screen infinite spinner. Reconnect: retain content and add freshness text. Tool failure: keep its actual output; never turn the whole conversation red. Error states do not erase drafts or silently dismiss the originating sheet.

### Focus and keyboard

Move focus to a sheet heading when opening, then its first actionable control. Trap within modal, dismiss on Escape, and restore to trigger. If the trigger was removed, move to the stable parent heading. Background controls are inert while modal is open. The HTML exhibit follows the same rule. No focus animation, no delayed outline. Native external-keyboard focus uses an equally visible ring.

## Motion

Motion expresses continuity and cause. It does not represent progress. All transitions can be interrupted. Button acknowledgment and keyboard input are immediate; nothing waits for the animation to finish before accepting another action.

### Motion tokens

| Token | Value | Use |
| --- | --- | --- |
| press | 80 ms | Press-in/out for isolated buttons |
| feedback | 120 ms | Local copy/check/label feedback |
| disclosure | 180 ms | State crossfade / short detail entrance |
| navigation | 240 ms | Session route continuity, unless native stack owns it |
| sheet | 280 ms | Bottom-sheet entrance/exit |
| maxReturn | 320 ms | Absolute settling cap for a returned sheet gesture |
| easeOut | cubic-bezier(.22, 1, .36, 1) | Enter / settle |
| easeMove | cubic-bezier(.4, 0, .2, 1) | On-screen position change |
| easeExit | cubic-bezier(.4, 0, 1, 1) | Leaving surface |
| direct manipulation | mass 1, stiffness 360, damping 38, overshoot clamped | Sheet release; use native platform equivalent if it matches |

Animate transform and opacity only. For content height changes, snap layout to its final measured size and crossfade/translate the visible detail, rather than springing a huge transcript height. Native keyboard transition follows the platform’s own timing/curve. Do not run a second arbitrary keyboard animation.

### Motion storyboards

| Trigger | 0 ms | Middle | End | Reduced Motion / haptic |
| --- | --- | --- | --- | --- |
| Open session row | Row receives immediate pressed fill; capture stable session identity | Incoming conversation translates 16 units and fades; native stack owns back relation | 240 ms, readable cached transcript; connection state remains separate | ≤100-ms crossfade; no haptic |
| Open Work from seam/dock | Mark trigger; sheet at translateY(100%); backdrop opacity 0 | Sheet tracks bottom origin; background stays still | 280 ms, sheet settled and heading focused | Instant layout + ≤100-ms fade; optional light selection haptic only after opening |
| Close sheet | Current pose | Sheet translates down; scrim fades in sync | 220–280 ms; focus returns to trigger | ≤100-ms fade; no haptic |
| Drag sheet | Movement after 8-unit intentional drag threshold | Sheet follows finger 1:1; no rubber band on text scroll | Dismiss if >25% sheet height OR downward velocity >900 units/s; otherwise critically damped return ≤320 ms | Keep drag tactile but snap settle; Close button always available |
| Unread arrival while reading | No viewport movement | New activity action appears by 120-ms opacity change | Stays available; no pulse | Same opacity or instant; no haptic |
| Go to new activity | Preserve target boundary | Single native scroll to unread anchor, ≤240 ms only for short distance | Seam aligned below header | Instant scroll; do not animate thousands of rows |
| Send | Press feedback now; local pending message inserted at stable anchor | Input clears only after local pending record persisted; state text updates by real acknowledgment | Accepted only after actual server acceptance | No geometric animation; optional light send haptic after local persistence |
| Queued instruction incorporated | Queue label remains readable | 120-ms label/check crossfade only after matching injection event | “Added to this turn” | Same fade; no token-level haptic |
| Connection lost/recovered | Retain body; replace connection label | 120-ms crossfade; no page slide | Current only after reconciliation | Same fade; no haptic |
| Turn completes | Existing dock stays in place until terminal event | Replace work glyph/state with check/Ready, 120 ms | No confetti; result remains primary | Same or instant; optional success haptic if app foreground and user opted in |
| Change theme | Preserve route and layout | Instant semantic token swap | No cascading color animation | Same |

Sheet gesture arbitration: drag handle/header can dismiss immediately after threshold; dragging within scrollable content scrolls it first. Only a downward drag at content offset zero may become sheet dismissal. Never hijack text selection or horizontal code scrolling. In-sheet back navigation changes content; it does not fling the sheet across the screen.

No continuous decorative animation. A real indeterminate network spinner may run only while a visible request is outstanding; prefer static labeled status for long agent work. No sweeping bars, bouncing dots, per-character opacity, or arbitrary time-based progress.

## Iconography and identity

Retain JCode’s existing halftone ring mark (`assets/jcode-mark.svg`). Do not replace it with a sparkle, robot head, terminal chevron, or generic J monogram. The mark is static, and it is not a loading indicator.

UI icons use one coherent 24-unit grid, 1.65-unit stroke, round caps/joins, 2-unit optical inset. The showcase uses a consistent customized line set at that weight. The implementation may use a licensed equivalent set if optical geometry matches; do not mix native platform glyphs and a different-weight icon library in the same custom toolbar. Native system menus may use their own symbols.

| Meaning | Shape | Text requirement |
| --- | --- | --- |
| Working | Open square/work mark | Working / current tool name |
| Ready / completed item | Check | Ready / Complete |
| Unknown connection | Slashed link | Offline / Reconnecting |
| Needs input | Speech/return glyph | Needs a reply only with source support |
| Stop | Solid small square in 48 target | Accessibility label “Stop this turn”; visible label in Work |
| Activity order | Fine spine joining factual event marks | Each row carries its own verb/state |

No emojis as functional icons. A server-provided animal label may appear as text metadata, but is not used to disguise a state or as the app’s primary icon system.

## Imagery and assets

The actual interface is the imagery. Every screen uses consistent, openly labeled fixture content about a reconnect/session task. No stock photograph, generated pseudo-screenshot, ornamental 3D object, texture image, illustration, or hero blob is required. The existing halftone mark supplies the small material detail; the return seam supplies a functional graphic device.

Captures in `assets/screens/` are exported from the exhibit after review. They are reference images, not real app execution. All fonts are bundled with licenses. The standalone HTML embeds font subsets and icons so it opens without a network dependency. Do not introduce product analytics or CDN font calls while reproducing it.

## Night appearance

Default in the real app: System. Explicit Light/Night override persists locally. The showcase opens in Light to present the chosen primary art direction and provides a Night comparison. Night uses near-black green, three elevation lightness steps, off-white text, and a pale botanical primary action. Clay becomes less saturated and is used with a dark matching surface. There is no glow. Respect platform status-bar appearance for the current opaque header surface.

## Accessibility contract

- WCAG 2.2 AA contrast for the exhibition, native equivalent intent in the app. Normal text ≥4.5:1; large text and meaningful icons/boundaries ≥3:1. Verified token pairs are recorded in the final audit appendix.
- Every touch target ≥48 square or 48 high where full-row; no overlapping invisible hit slop.
- Every icon-only action has an accessible name. Decorative glyphs are hidden from accessibility.
- Text scaling reaches 200% without truncating primary actions. User-selected font size and platform accessibility settings outrank a reference screenshot.
- Reduced Motion removes route travel and sheet settling while retaining immediate feedback. No motion warning is needed; adaptation is automatic.
- Grayscale retains hierarchy, and state always includes text or shape.
- Focus is managed across sheets. Screen-reader live regions announce meaningful state changes, not every token.
- Connection errors and uncertain-send warnings remain in the owning screen until resolved. No disappearing toast is their sole carrier.

## Portability and implementation fidelity

The app uses native views, not this exhibit in a WebView. CSS logical units are a visual reference; safe areas, IME, text measurement, and gestures must use native semantics. Font files and token JSON can be consumed by a separate worker; the documents contain no production component implementation.

Preserve these invariants when choosing RN libraries: virtualized content, stable session-scoped keys, UI-thread direct manipulation, native text input/selection, native stack/back support, small dependency surface, and lazy output rendering. A library is not authorized to replace the locked visual system with its starter theme.

## Critique contract

Before delivery, compare the render with these promises:

1. Is there one clear reading surface, or has every message become a box?
2. Can a user find the actual state without interpreting a color or motion loop?
3. Does the seam identify new work, or merely decorate a layout?
4. Are the important actions reachable when the keyboard is up?
5. Does the bare structure support Sessions → Conversation → Work without a dashboard detour?
6. Is every backend-dependent control either verified or visibly unavailable?
7. Do typography and spacing survive compact width, Night, Reduced Motion, and long strings?

The final render audit and revisions are appended after visual inspection. Do not treat a source-only checklist as a native accessibility certification or a mobile performance benchmark.

## Changelog

- 8 November 2026, 1.0: authored Tidal direction, return seam, source-grounded continuity states, complete component and motion rules. Visual inspection results follow in the audit appendix.


## Palette and token appendix

The values below are generated from the same locked table used in the exhibit. `tokens.json` mirrors this appendix.

### Light

| Role | OKLCH | sRGB export |
| --- | --- | --- |
| `bg` | `oklch(0.9706 0.0034 174.48)` | `#F3F6F5` |
| `surface` | `oklch(1.0000 0.0000 89.88)` | `#FFFFFF` |
| `raised` | `oklch(0.9460 0.0084 168.75)` | `#E8EFEC` |
| `ink` | `oklch(0.3258 0.0413 192.87)` | `#173B3A` |
| `muted` | `oklch(0.5066 0.0300 178.06)` | `#536B65` |
| `line` | `oklch(0.8969 0.0136 167.14)` | `#D5E0DB` |
| `control` | `oklch(0.6088 0.0301 173.06)` | `#718981` |
| `brand` | `oklch(0.3894 0.0588 185.13)` | `#164F49` |
| `onBrand` | `oklch(0.9753 0.0058 153.78)` | `#F4F8F5` |
| `accent` | `oklch(0.6750 0.1550 36.90)` | `#E56F4D` |
| `accentSoft` | `oklch(0.9377 0.0339 45.49)` | `#FFE4D8` |
| `onAccent` | `oklch(0.3214 0.0796 38.89)` | `#542211` |
| `success` | `oklch(0.4611 0.0699 172.26)` | `#276554` |
| `warning` | `oklch(0.4791 0.0843 56.71)` | `#81502A` |
| `error` | `oklch(0.4964 0.1384 30.89)` | `#A23C2D` |
| `focus` | `oklch(0.4962 0.0639 186.75)` | `#316E68` |

### Night

| Role | OKLCH | sRGB export |
| --- | --- | --- |
| `bg` | `oklch(0.2270 0.0194 201.58)` | `#111F20` |
| `surface` | `oklch(0.2765 0.0249 191.59)` | `#192C2B` |
| `raised` | `oklch(0.3184 0.0270 188.38)` | `#223735` |
| `ink` | `oklch(0.9455 0.0134 167.17)` | `#E5F0EB` |
| `muted` | `oklch(0.7568 0.0274 169.03)` | `#A0B6AD` |
| `line` | `oklch(0.3982 0.0318 180.78)` | `#344D48` |
| `control` | `oklch(0.5951 0.0352 176.35)` | `#69867E` |
| `brand` | `oklch(0.8472 0.0422 163.01)` | `#B5D6C5` |
| `onBrand` | `oklch(0.3158 0.0440 169.32)` | `#18392E` |
| `accent` | `oklch(0.8135 0.0837 39.21)` | `#F2B09A` |
| `accentSoft` | `oklch(0.3238 0.0335 39.21)` | `#432E27` |
| `onAccent` | `oklch(0.8534 0.0698 44.19)` | `#F7C1AA` |
| `success` | `oklch(0.8371 0.0578 163.18)` | `#A8D6BF` |
| `warning` | `oklch(0.8389 0.0651 68.27)` | `#E7C39D` |
| `error` | `oklch(0.7930 0.0906 31.06)` | `#F0A698` |
| `focus` | `oklch(0.8472 0.0422 163.01)` | `#B5D6C5` |

### Portable CSS projection

These tokens specify the visual system; they are not production React Native code.

```css
:root {
  --font-display: "Bricolage Grotesque";
  --font-body: "Hanken Grotesk";
  --font-mono: "IBM Plex Mono";
  --j-bg: oklch(0.9706 0.0034 174.48); /* sRGB #F3F6F5 */
  --j-surface: oklch(1.0000 0.0000 89.88); /* sRGB #FFFFFF */
  --j-raised: oklch(0.9460 0.0084 168.75); /* sRGB #E8EFEC */
  --j-ink: oklch(0.3258 0.0413 192.87); /* sRGB #173B3A */
  --j-muted: oklch(0.5066 0.0300 178.06); /* sRGB #536B65 */
  --j-line: oklch(0.8969 0.0136 167.14); /* sRGB #D5E0DB */
  --j-control: oklch(0.6088 0.0301 173.06); /* sRGB #718981 */
  --j-brand: oklch(0.3894 0.0588 185.13); /* sRGB #164F49 */
  --j-onBrand: oklch(0.9753 0.0058 153.78); /* sRGB #F4F8F5 */
  --j-accent: oklch(0.6750 0.1550 36.90); /* sRGB #E56F4D */
  --j-accentSoft: oklch(0.9377 0.0339 45.49); /* sRGB #FFE4D8 */
  --j-onAccent: oklch(0.3214 0.0796 38.89); /* sRGB #542211 */
  --j-success: oklch(0.4611 0.0699 172.26); /* sRGB #276554 */
  --j-warning: oklch(0.4791 0.0843 56.71); /* sRGB #81502A */
  --j-error: oklch(0.4964 0.1384 30.89); /* sRGB #A23C2D */
  --j-focus: oklch(0.4962 0.0639 186.75); /* sRGB #316E68 */
  --radius-control: 12px;
  --radius-sheet: 24px;
  --duration-press: 80ms;
  --duration-feedback: 120ms;
  --duration-disclosure: 180ms;
  --duration-navigation: 240ms;
  --duration-sheet: 280ms;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
}
[data-theme="night"] {
  --j-bg: oklch(0.2270 0.0194 201.58); /* sRGB #111F20 */
  --j-surface: oklch(0.2765 0.0249 191.59); /* sRGB #192C2B */
  --j-raised: oklch(0.3184 0.0270 188.38); /* sRGB #223735 */
  --j-ink: oklch(0.9455 0.0134 167.17); /* sRGB #E5F0EB */
  --j-muted: oklch(0.7568 0.0274 169.03); /* sRGB #A0B6AD */
  --j-line: oklch(0.3982 0.0318 180.78); /* sRGB #344D48 */
  --j-control: oklch(0.5951 0.0352 176.35); /* sRGB #69867E */
  --j-brand: oklch(0.8472 0.0422 163.01); /* sRGB #B5D6C5 */
  --j-onBrand: oklch(0.3158 0.0440 169.32); /* sRGB #18392E */
  --j-accent: oklch(0.8135 0.0837 39.21); /* sRGB #F2B09A */
  --j-accentSoft: oklch(0.3238 0.0335 39.21); /* sRGB #432E27 */
  --j-onAccent: oklch(0.8534 0.0698 44.19); /* sRGB #F7C1AA */
  --j-success: oklch(0.8371 0.0578 163.18); /* sRGB #A8D6BF */
  --j-warning: oklch(0.8389 0.0651 68.27); /* sRGB #E7C39D */
  --j-error: oklch(0.7930 0.0906 31.06); /* sRGB #F0A698 */
  --j-focus: oklch(0.8472 0.0422 163.01); /* sRGB #B5D6C5 */
}
```

### Verified contrast pairs

Computed from the sRGB exports using relative luminance. Decorative separators are intentionally quieter than interactive boundaries.

| Pair | Light | Night | Required minimum |
| --- | ---: | ---: | ---: |
| `ink` on `bg` | 11.21:1 | 14.50:1 | 4.5:1 |
| `muted` on `bg` | 5.28:1 | 7.89:1 | 4.5:1 |
| `muted` on `raised` | 4.92:1 | 5.88:1 | 4.5:1 |
| `onBrand` on `brand` | 8.71:1 | 8.05:1 | 4.5:1 |
| `onAccent` on `accentSoft` | 10.74:1 | 7.94:1 | 4.5:1 |
| `error` on `bg` | 6.00:1 | 8.55:1 | 4.5:1 |
| `success` on `bg` | 6.28:1 | 10.51:1 | 4.5:1 |
| `warning` on `bg` | 6.20:1 | 10.23:1 | 4.5:1 |
| `control` on `surface` | 3.75:1 | 3.70:1 | 3:1 |
| `control` on `raised` | 3.21:1 | 3.19:1 | 3:1 |
| `focus` on `bg` | 5.42:1 | 10.79:1 | 3:1 |


## Final rendered review

Review date: 8 November 2026. Method: deliberate self-critique against the written aesthetic contract, rendered-screen inspection, keyboard interaction checks, computed contrast, and automated accessibility checks. This was not an independent usability study.

- Eight exhibition widths checked: 320, 360, 390, 412, 768, 1024, 1440, and 1920 CSS pixels. No unintended horizontal overflow remained.
- 27 scripted exhibition checks passed, including Work/Plan navigation, keyboard tab switching, Escape dismissal, queue/injection fixture states, offline draft retention, reconnect, scoped demo Stop, pairing validation, search-empty state, 200% conversation text, and Reduced Motion. Direct header drag dismissal was also exercised successfully.
- Chromium 136.0.7103.25 rendered all three embedded font families. No uncaught script errors and no external HTTP(S) requests occurred in the tested exhibition flow.
- Axe-core 4.10.3, WCAG A/AA rules through 2.2: zero reported violations in the tested Light, Night, Offline, and Work states. This is an automated exhibition result, not a claim of full WCAG conformance or native VoiceOver/TalkBack certification. Manual keyboard focus and dismissal were inspected separately.
- Twelve final reference images were exported at 390 × 844 (iOS) or 412 × 892 (Android), including Night and enlarged-text states. The keyboard-band and continuation diagrams were rendered and inspected.

Refinements from critique: removed a large curved background wash; tightened the hero; shortened the Sessions heading to one line where it fits; raised tiny app metadata; separated Send from a full-size Stop target; added a persistent search label; corrected a weak clay swatch label; strengthened control boundaries; removed duplicate static specimen IDs; made the Work sheet draggable; bound every tool-detail fixture to its selected activity row; and made the enlarged-text composer readable with a shorter placeholder. The final artwork keeps hierarchy in grayscale and does not rely on motion to suggest progress.

Slop-audit craft score: **9/10, self-assessed**. The structure is specific to returning to VPS work, the type pairing carries identity, and the return seam has a real job. Remaining uncertainty is in implementation fidelity: native keyboard physics, screen-reader phrasing, actual memory/latency, and server adapter integration cannot be established by a design exhibition. Those are explicit acceptance gates in PRODUCT_SPEC.md, not hidden claims.

The exhibit preserves native interaction conventions while avoiding terminal mimicry, ornamental progress, generic dashboard cards, default gradient branding, avatar clutter, looping status effects, and tiny tool controls. Phone status/casing details are stylized references; the implementation must use real platform safe areas, navigation, text input, and system UI.

Changelog addendum: 1.0 final, visual/accessibility refinements applied and reference images recaptured after review.
