# JCode Mobile · design handoff

**Design only. React Native + TypeScript is the future implementation target.**

Open `SHOWCASE.html` first. It is a self-contained, offline design exhibition with high-fidelity phone screens and deliberately scripted interactions. It never connects to a server, starts an agent, or sends a message.

Then read in this order:

1. `PRODUCT_SPEC.md`: navigation, screens, behavior, content, recovery, performance budgets, and acceptance scenarios.
2. `DESIGN.md`: the visual contract, exact tokens, component measurements, motion, platform adaptations, accessibility, and critique.
3. `SOURCE_NOTES.md`: pinned JCode evidence, capability boundaries, and the integration that must exist before the client can promise continuity.

`assets/screens/` contains twelve reference captures. `assets/keyboard-anatomy.svg` explains keyboard-safe layout bands, and `assets/continuity-map.svg` shows process ownership. `assets/fonts/` contains the licensed font files. `assets/jcode-mark.svg` is JCode’s existing mark, not a proposed replacement. `tokens.json` is the machine-readable projection of DESIGN.md. Screen captures illustrate fixture content, not a real agent execution.

## The decision

**A quiet place to return to work.** Cool mineral surfaces, deep tidal green, tactile type, and a single return seam separating what you saw from what happened while you were away. The interface is built around conversation, readable work, and a few deliberate interventions.

The phone is a client. Execution belongs to the VPS. Leaving a screen, locking the phone, losing reception, and force-quitting must never be mapped to Cancel. Reopening restores the same server and session, then reconciles with server history. Daemon termination remains a separate failure with honest recovery copy.

## Implementation rule

Do not improvise backend features from the pictures. SOURCE_NOTES.md distinguishes verified behavior from proposed integration. In particular, the current raw WebSocket gateway and curated harness API are different transports; the harness bridge does not currently opt into disconnect continuation, and its declared permissions types are not a working permissions feature. These are release gates, not optional polish.

The HTML is an exhibit, not an application scaffold. Do not wrap it in a WebView or translate its device frames, desktop navigation, fixture controls, or artificial timing into the native app.

## Authority

User requirements → PRODUCT_SPEC.md behavior → DESIGN.md visual tokens → annotated showcase → captures. When a source fact conflicts with a picture, the verified source fact wins and the picture must change. Keep unknown states unknown.

Prepared 8 November 2026. Source snapshot: `1jehuang/jcode@629cca346f71f6c051cf8570dbea35cd0b20d5a2`.


## Reviewed output

The showcase was inspected at eight widths, with Light/Night, offline, work-detail, enlarged-text, and Reduced Motion scenarios. All 27 scripted exhibition checks passed; the four automated accessibility scans reported no violations. Native performance and actual VPS continuation remain implementation acceptance gates.
