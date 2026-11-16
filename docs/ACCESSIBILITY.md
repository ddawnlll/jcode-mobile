# Motion preferences and accessibility (0.6.0)

The animated agent UI must remain fully operable without motion, gestures,
sight or precise touch. This note defines the behavior implemented in #89,
#90 and #91.

## Motion preferences

| Setting | Effective behavior | Resolution |
| --- | --- | --- |
| System | Follows the OS `prefers-reduced-motion` signal | OS reduce → Off; otherwise Full |
| Full | All event-driven motion and the live Torus | Explicit opt-in, even when the OS asks for reduction |
| Subtle | Presence fades, shorter tokens, no travel or spin | Explicit override |
| Off | No nonessential animation or transition; gesture springs jump | Explicit override or System + OS reduce |

Stored preferences are phone-local (`jcode.mobile.v3.preferences`), not server
or session state. The 0.5.0 stored value `reduced` migrates to `off`; unknown
values fall back to `system`. Changes apply immediately without reload and
persist across restarts.

The app writes both `data-motion` (resolved Full/Subtle/Off) and
`data-motion-preference` (the user's choice). CSS uses the resolved value. The
`prefers-reduced-motion` media query applies before React resolves the
preference and skips elements that explicitly chose Full or Subtle.

Off mode is a duration clamp, not a feature switch: cards still expand, copy,
scroll, focus and send. The drawer opens instantly, the Torus stops and screen
transitions become immediate.

## Announcement policy

| Signal | Accessibility behavior |
| --- | --- |
| Turn state (thinking, writing, waiting for approval, reconciling) | One polite live region; the elapsed-seconds timer is hidden from assistive tech. |
| Tool status | Polite live region with the full source label (for example `Unknown / reconciling`), while the compact visual text may shorten it. Text changes only on real status transitions. |
| Reasoning stream | Not a live region. The header announces `thinking`/`complete`; streamed tokens are not read automatically. |
| Assistant stream | Not a live region. Completed text remains readable and copyable. |
| Permission request | `role="alert"` because it blocks progress and needs a decision. |
| Connection loss / recovery | The existing banner uses `role="status"`. |
| Copy result | Button label changes to `Copied` on success; failure keeps the action label, shows `Blocked` in code blocks and a toast. Haptics distinguish success from failure, never the reverse. |

## Focus and controls

- Tool and reasoning headers are native `<button>` elements with
  `aria-expanded` and `aria-controls`. Keyboard Enter/Space works.
- Expanding or collapsing a card anchors its head position so the control
  does not move under the finger or focus ring.
- The drawer moves focus to Close when opened, traps Tab, closes on Escape,
  Android back / the native `jcode:back` event, scrim tap, or a left-to-right
  close gesture. Focus returns to the opener after the spring settles.
- The sidebar trigger is a labelled PanelLeft button (`Open sidebar`), never a
  More ellipsis. More menus remain separate.
- Copy controls are labelled per target (`Copy full path`, `Copy output`,
  `Copy requested content`, and so on). Tool-head copy targets are 48×48 CSS
  pixels; the shared copy control is 44×44.
- Raw JSON is an optional `<details>` section; it is never the only expanded
  content for a command or file tool.

## Visual clarity

- Tool families have distinct SVG glyphs in one 24-unit Lucide-compatible
  style: terminal, file, file-plus, edit, search, folder, globe, checklist,
  sparkles, server, layers and wrench.
- Diff lines use text sign plus restrained color, not color alone. Exit codes
  are text. Status text is present even when color is unavailable.
- Code blocks keep a language label and one-tap copy. Tabs render at two
  spaces; long command/diff output scrolls inside its own bounded region so
  the page never overflows horizontally at 360 dp.
- Compact previews redact credential shapes. Expanded evidence and copies
  remain exact.

## Verification status

| Check | Status |
| --- | --- |
| Motion resolver unit cases (System/Full/Subtle/Off, legacy migration) | PASS (`scripts/check-stillness-ux.mjs`) |
| Settings applies immediately, OS reduce changes System, explicit Full overrides | PASS (Playwright, isolated adapter) |
| Off clamps to 0.001 ms and disables the Torus | PASS (Chromium fixture) |
| Drawer focus enters Close and returns to Open sidebar | PASS (Chromium fixture) |
| Android drawer tap, system back and focus restore | PASS (API 36 emulator, 360 dp) |
| 360 dp collapsed/expanded command and edit cards | PASS (Chromium fixture, screenshots under `.staging/`) |
| TalkBack announcement/focus matrix | NOT_RUN until Android device QA (#92) |
| 200% Android font scale and high contrast | NOT_RUN until Android device QA (#92) |
| Physical device gestures, predictive back and keyboard | NOT_RUN until #92 |

Android emulator evidence: the PanelLeft tap opens the drawer and moves focus
to Close; system back closes the drawer without exiting the app and focus
returns to Open sidebar. A swipe beginning at the extreme left edge is consumed
by Android system back, which is the intended ownership rule.

Chromium results are web-target evidence only. They are not native Android or
TalkBack claims.
