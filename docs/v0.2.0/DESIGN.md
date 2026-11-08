# JCode Mobile 0.2.0

Product and interaction design proposal · 9 November 2026

**Direction: Tidal Glass.** A precise, tactile mobile instrument for directing an agent that lives on your server. The first impression comes from the existing Tidal green colors, confident Swiss typography, glass chrome, smooth stateful motion, and immediate access to your work.

This is a design and implementation handoff, not a released app. The accompanying interactive concept uses sample projects, sessions, model names, and runtime events. It does not connect to a server. Scope and capability gates below govern what the native release may actually show.

## 1. What the current app tells us

Reviewed repository: [ddawnlll/jcode-mobile](https://github.com/ddawnlll/jcode-mobile), main at [`7a5e0b669314a3ae7f3186d38cbd0b9771920678`](https://github.com/ddawnlll/jcode-mobile/tree/7a5e0b669314a3ae7f3186d38cbd0b9771920678). The latest published release observed during this review was **0.1.3**. This review examined source and existing native evidence screenshots; it did not run the current native app on a device.

| Area | Observed baseline | Consequence for 0.2.0 |
| --- | --- | --- |
| Visual system | Bundled Bricolage Grotesque, Hanken Grotesk, IBM Plex Mono; complete light/night token palettes | Keep the useful assets and token discipline. Recompose and recalibrate the interface. |
| Animation | Reanimated and Gesture Handler are installed; native navigation and sheet motion exist | The problem is an incomplete expressive interaction system, rather than a need for a new animation stack. |
| First launch | Unpaired users enter Connect directly | Add a short product introduction, live appearance preview, and useful post-pair defaults. |
| Model selection | Adapter advertises `models` and implements `list_models` and `set_model`; no model picker appears in the reviewed screens | Expose the existing capability, and strengthen its confirmation behavior. |
| Effort | The mobile request union has no effort mutation; reviewed upstream JCode wire source has `set_reasoning_effort` | This requires adapter/protocol/controller work as well as a picker. |
| Folder selection | NewSessionSheet has an absolute server-path field and recent paths | Add a real server directory picker; retain direct path entry as an expert route. |
| Projects | No dedicated project feature in the reviewed feature tree | Introduce a small server-scoped project catalog based on canonical remote directories. |
| Menus | Conversation already contains Rename, Save, Copy ID, Server details, Archive | Improve discoverability, grouping, and reach. These actions are not all absent. |
| Appearance | System/light/night exists inside Server details | Give appearance its own accessible location and introduce it during first run. |
| Content rendering | Small handwritten Markdown parser; code has Copy/Wrap but no actual syntax tokenization or math path | Add a standards-based rich-content layer and structured tool rendering. |
| Continuity | Exact session identity, return seam, saved drafts, explicit delivery states, continuation on disconnect | Preserve these behaviors through every redesign. They are the product's strongest foundation. |

The current native evidence reads as a list of truncated prompts, faint separators, and a small set of similarly weighted controls. It lacks project identity and visible configuration. Changing the accent alone will not resolve that information hierarchy.

### Core product promise

**Open the phone, find the right project, understand the work, give the next instruction.**

The target user is a developer checking a VPS agent with one hand, often between other activities. The app must support short interventions and long reading. Android and iOS are both first-class. Web is not a release target.

App posture: unified brand, with native stack navigation, keyboard behavior, permission prompts, and platform back behavior. Keep React Native, TypeScript, React Navigation, StyleSheet, Reanimated, Gesture Handler, and the current persistence/controller architecture.

Design expression: **7/10** in the content, motion: **6/10** in first run and transitions but **2/10** while reading, density: **5/10**. The conversation remains quiet enough for prolonged use.

## 2. The visual decision

| Direction considered | Produced graphic reference | Suitability |
| --- | --- | --- |
| **Tidal Glass** | The current mineral-green system with precise Swiss hierarchy, translucent chrome and purposeful motion | Selected after the user confirmed the current colors and requested glass surfaces. |
| Swiss Signal | Swiss transport wayfinding, strong alignment and vermilion | Earlier alternative. Its hierarchy informs the revision; its replacement palette is superseded by the user’s current-color preference. |
| Technical folio | Technical-manual indexes, section labels, project covers | Useful for documentation, but adds ceremony and consumes too much of a phone's screen. |

Adjectives: **precise, assured, tactile, alive**. Aesthetic essence: **Work in reach.**

| Word | Visible interpretation |
| --- | --- |
| Precise | Strong left alignment, consistent 20/24 gutters, a compact hierarchy, readable remote paths |
| Assured | Graphite text, cool paper, deliberate empty space, one emphatic primary action |
| Tactile | Immediate press response, stable selection states, controlled glass surfaces, restrained haptics |
| Alive | A short welcome reveal, clear transitions, real work activity, the existing return seam |

### The signature stays the return seam

The horizontal boundary labelled **Since you left** remains the app's signature. It separates seen from unseen work in the conversation and the work log. The welcome introduces the same horizontal line as a continuity gesture. It never becomes a decorative border on every row.

On return, the seam appears once at the correct reading boundary. It can include a count only when a stored bookmark reconciles with actual content. Rewrites or a missing bookmark use **New activity since your last visit**, without a fabricated count.

### Composition

One reading field, flat session/project lists, and one clear action per state. The same typography and semantic palette run through onboarding, pairing, projects, configuration, work, and settings. Use glass for selected chrome and overlays, with an opaque reading field. Keep the composition free of stock illustrations, unrelated wallpaper, pastel icon squares and invented dashboard statistics.

The welcome can be a typographic composition. The sessions screen is a working list. The conversation is a reading surface. These three screens should not all share an oversized heading plus explanatory subtitle template.

## 3. Feature contract for 0.2.0

P0 means required for the proposed 0.2.0 experience. P1 is a worthwhile follow-up that must not delay or weaken P0. Future features are deliberately separated from this release.

| Priority | Feature | User experience | Implementation boundary |
| --- | --- | --- | --- |
| P0 | Welcome and appearance | Animated introduction, current Tidal plus ten theme families, System/Light/Night choice; then connect | Preserve existing colors/preferences; family and appearance are independent |
| P0 | Loading and glass | Stateful JCode-mark loading, glass composer/menus/context, opaque accessible fallbacks | Native UI-thread motion, SDK-compatible blur and measured resource limits |
| P0 | Context window | Reported prompt usage/model limit and inspectable freshness | New normalized context snapshot; usage totals alone do not establish occupancy |
| P0 | Reasoning display | Hidden / Compact / Expanded, default Compact | Display-only persisted preference over server-exposed reasoning |
| P0 | Pairing redesign | Scan/paste/manual choice, visible connection stages, specific recoverable errors | Preserve existing token handling and pairing diagnostics |
| P0 | Projects | Recent/pinned remote folders, friendly names, related sessions, explicit server identity | Server-scoped local catalog; canonical directory validation |
| P0 | Remote folder picker | Browse actual VPS directories, breadcrumbs, recent locations, type/paste path | New authenticated read-only directory capability |
| P0 | New session setup | Project, model, effort, optional initial instruction, all visible before starting | Create once, confirm effective config, then send to the returned session |
| P0 | Model and effort controls | Visible above the composer, searchable model catalog, model-specific effort options | Model confirmation strengthened; effort support added and negotiated |
| P0 | Discoverable app/session menus | Obvious labelled access to projects, appearance, defaults, server details, and session actions | Keep existing actions; do not hide all functionality behind long press |
| P0 | Conversation polish | Readable prose/code, clear action hierarchy, inspectable work, stable scroll position | Reuse the existing transcript and identity machinery |
| P0 | Rich message renderer | CommonMark/GFM, real syntax highlighting, inline/display LaTeX, selectable content and source copying | Typed AST pipeline; bounded native rendering and offline math integration |
| P0 | Structured tool renderer | Expandable calls, typed inputs/results, real lifecycle states, readable logs and generic-tool fallback | One normalized call record shared by conversation and Work |
| P0 | Motion and haptics | Complete press, navigation, selection, reveal, completion, and dismissal behavior | Existing animation stack; no heavyweight motion runtime |
| P0 | State completeness | Loading, empty, stale, offline, auth lost, unsupported, validation, unconfirmed delivery | Real data and events only |
| P1 | Project/session pinning improvements | Quick access to frequently used projects and important sessions | Local project pinning; existing session saved state where supported |
| P1 | Read-only file links | Open files referenced by work; bounded content with Copy and path context | Existing file read plus explicit root/canonicalization rules |
| P1 | Search and list refinements | Persistent filters, clear archived view, session search within project | Existing inventory; no full-transcript index promised |
| Future | Git diff and branch controls | Dedicated changes review and branch-aware project context | Needs a separately verified Git contract; not inferred from tool text |
| Future | Push, approval center, attachments | Real background notifications, approval decisions, uploads | No UI until transport, identity, delivery, and native permission flows exist end to end |
| Future | Swarm supervision and terminal | Multi-agent coordination or an interactive shell | Outside 0.2.0 |

### Priority within P0

The highest-value work is **projects/folders + model/effort + the session creation transaction + the rich-content/tool renderer**. These determine whether the beautiful interface can actually direct the agent. Styling and motion should proceed on fixtures alongside that integration, but release requires the real flows.

## 4. Navigation and menu architecture

Keep the `Sessions`, `Conversation`, `Connect`, and `ServerDetails` route identities. Expand the existing typed React Navigation stack. Do not migrate to Expo Router or add a bottom navigation bar for this redesign.

Projects organize sessions; they are not a third application embedded in a tab. Settings and the server connection are occasional destinations. A stack with clear header affordances fits these jobs.

### Current to proposed mapping

| Existing entry | Proposed behavior | Migration |
| --- | --- | --- |
| Sessions root | Updated list with project scope and visible app menu | Keep route name and last selected scope |
| Conversation | Project context, model/effort strip, work route, session actions | Keep exact server/session params and reading anchor |
| Connect | Pairing screen inside the first-run flow or reached from server management | Preserve `jcode://pair` and `jcodemobile://pair` handling |
| ServerDetails | Connection, diagnostics, device access and local data | Keep route name; Appearance also gets a direct app-menu entry |
| NewSessionSheet | A native modal flow with its own short stack | Preserve unfinished instruction and selected context on picker returns |
| WorkSheet | Work route with Tools/Plan content; tool detail is a child route | Preserve tool identities, bounded output and return seam |

### Route plan

| Route | Container and rationale | Entry |
| --- | --- | --- |
| Welcome | First-run route group; actual product introduction and theme input | First install; Replay welcome in Appearance |
| Connect | Native form route | Welcome or server management |
| FirstRunDefaults | Optional post-pair route; real model catalog is now available | Successful first pair |
| Sessions | Stack root, no tabs | Paired app launch |
| Projects | Push; browse the projects that scope this server's sessions | Project scope row or app menu |
| ProjectDetails | Push; one project's sessions and defaults | Project row |
| Conversation | Push; one exact session | Session row or validated deep link |
| NewSessionFlow/Details | Full-screen task flow; several inputs and explicit Close | New session |
| NewSessionFlow/RemoteFolder | Child route; folder hierarchy needs its own navigation state | Choose project / Browse server |
| NewSessionFlow/Configuration | Child route; searchable catalog and effort choices | Model or effort row |
| SessionConfiguration | Native modal; edit model/effort with Apply/Cancel | Composer configuration strip or session menu |
| Work | Push; inspect actual events or reported plan | View work |
| ToolDetail | Push within Work | Tool row |
| ContentDetail | Push; read-only code, table or equation detail with source-copy and appropriate pan/zoom | Open full view from a rendered block |
| SessionSwitcher | Searchable native modal | Conversation title |
| Appearance | Push; eleven theme families, appearance, effects and motion preferences | Welcome or app menu |
| ContextSheet | Lightweight sheet; snapshot, source, freshness and recovery action | Context action beside model/effort |
| ConversationPreferences | Push; Hidden/Compact/Expanded reasoning preference | App/session menu |
| Defaults | Push; server-level future-session defaults | App menu |
| ServerDetails | Existing push | Server header or app menu |

Lightweight sheets: App menu, row/session action menu, and Context snapshot. Conversation has at most two distinct sheet types; complex configuration/search remains a modal or push. No sheet contains a folder browser, search results, or another back stack. Configuration and New session are native modal flows, not a stack of nested bottom sheets.

Back and Close return to the previous screen without cancelling work. Dismissing a dirty New session keeps its saved setup draft; explicitly discarding it requires a confirmation. Every modal has a visible Close/Cancel. Android hardware/gesture back has the same result as header back. Native transition ownership remains with the navigator.

Tap budget: session opening 1; model/effort access 1; New session 1; projects 1; appearance 2 via app menu; work 1. Selecting a deeply nested server folder is intentionally a multi-step task and is not counted as a two-tap destination.

Proposed session/project deep links must contain a server-profile reference and a session/project identity. A cold link resolves the known server, pairs explicitly if needed, and builds a sane back stack. It never attaches to an arbitrary current server or silently creates a substitute session.

### App menu

**Workspace:** Projects, Saved sessions, Archived sessions. **Preferences:** Appearance, Session defaults. **Server:** Switch server, Server details, Connect another server. Build/version lives at the bottom of this menu or About. No account/avatar fiction for a product authenticated to a server.

### Session menu

Model & effort; Session details; Rename; Save/Unsave; Copy session ID; Archive/Restore. An idle session can be archived; a running one explains that it must finish or be explicitly stopped first. Stop is kept visibly separate from navigation, archive, disconnect, and configuration.

## 5. First-run journey

### Welcome

At rest: JCode mark and wordmark, **Your work. / In reach.**, a compact line of product truth, and **Connect a server** at thumb height. A secondary **Preview the app** enters a clearly labelled demo with sample data. No server is contacted and nothing runs in demo mode.

Welcome copy: **Your server runs JCode. This is where you stay close to the work.** Theme choice previews the selected family/material live. System/Light/Night appearance and the complete eleven-family picker are available from Welcome. No mandatory nickname, questionnaire, notification prompt, or three-slide tutorial.

Motion: the wordmark resolves first, the two headline lines enter by 8 logical units, then the continuity line extends once. Total authored sequence at most 600 ms; the CTA is usable from the first frame. No replay when returning from the background. Replay is an explicit preference action.

### Connect

Three clear methods: Scan pairing code, Paste pairing link, Enter details. Camera permission is requested only after Scan is tapped. Manual entry preserves the existing server address, six-digit pairing code, and device name. Keep TLS policy, secure credential storage, and exact failure codes.

Pairing action shows stages such as **Connecting to Studio**, **Checking code**, **Saving this phone** only when actually observed. Unknown stages show a neutral waiting label and elapsed time, not a fabricated progress bar. Success can show **Phone paired** once token storage succeeds; subsequent socket connection has its own state.

If the socket cannot become current after pairing, offer Retry and saved/demo access as applicable. Do not return to an endless pairing spinner or claim the server is ready.

### Make it yours, after pairing

The selected appearance carries forward. Choose the default model and its supported effort, or tap **Use server defaults**. Show **For new sessions on Studio** so scope is obvious. This step is skippable and available later in Defaults. New installations can choose their first project next; returning users go directly to their sessions.

Existing users upgrading from 0.1.x see their exact previous session and appearance. Offer the new controls contextually; do not force onboarding or replace their chosen palette mode.

## 6. Sessions and projects

### Sessions screen

Header: JCode identity, selected server and a visible App menu action. Screen title: **Sessions**. Beneath it: the project scope row, search, then the working list. A connected label is secondary, not a green badge on every row.

Order: pinned sessions if any, actual observed running work if any, then recent sessions. The most recently used observed running session can receive one graphite priority surface with light type; other sessions remain flat rows. This gives current work a clear visual anchor without creating a stack of cards. In Night, the priority surface is raised graphite rather than a white inversion. Omit empty group headings. A session row provides a readable title, project name, explicit status when known, last-activity time when supplied, and a small unseen-work indication when reconciled. Titles can wrap to two lines; full titles remain accessible.

For unknown/unobserved execution state, show saved history context without classifying the agent as idle or completed. The persisted inventory alone does not establish current execution state. Do not poll hundreds of attachments to manufacture a live status roster.

**New session** stays in a safe-area-aware bottom dock. Search and scrolling stay visible above it. Project selection is a real row with a label and chevron; filters and menu affordances do not imitate a second global tab bar.

### Project identity and storage

A project is a friendly reference to a canonical directory on one server. Minimum record: local project ID, server profile ID, canonical path, display name, optional pin, optional future-session model/effort preference, validation time. Start with local catalog entries; cross-device project synchronization is not promised in 0.2.0.

Derive a proposed display name from the directory basename, then allow editing. Never infer that two folders called `app` on different servers are the same project. Keep canonical paths visible in detail and copyable. A symlink alias is stored separately from the canonical identity if the user needs it.

Project defaults apply to future sessions only. Changing a project's defaults does not change existing sessions or restart work. Removing a project from this phone removes its catalog entry and local project preferences, not files or server sessions. Existing per-session drafts/history are managed separately.

### Project detail

Title, remote path, server, pinned state, configuration defaults, and this project's sessions. Main action: **New session here**. A small empty state says **No sessions in this project** with that same action. Git branch and repository health appear only when a verified future capability provides them.

## 7. Remote folder picker

This is a **server directory picker**, not Android Documents or iOS Files. It never browses the phone when the user is choosing where an agent will execute.

Header: **Folder on Studio**. Content: recent locations, configured workspace roots, breadcrumbs, and a virtualized directory list. Footer: **Use this folder** with the selected path. A **Enter path** action opens an absolute-path field and Validate action. Selection is retained on error.

Use single tap to enter a directory; use the footer to select the current directory. The current-folder label and parent action make selection unambiguous. Hidden directories are off by default with a visible Show hidden option. Preserve query, navigation position, and path draft when returning.

Required states: first load; empty directory; inaccessible directory; no permitted workspace roots; path does not exist; path is a file; symlink resolves outside allowed roots; network lost; stale response for an older location. Inline error names the path and offers Back or Retry. An inaccessible row is labelled, not silently missing when the server can provide that fact safely.

Proposed new adapter operations: `list_workspace_roots`, `list_directories`, `validate_directory`. Return canonical path, permitted navigation scope, bounded directory-only entries, an opaque continuation cursor if needed, and useful typed errors. These names are proposed additions, not existing endpoints.

Implementation rules: direct filesystem reads on the adapter, no shell command and no model-generated directory listing; explicit configured roots; realpath-based validation; reject traversal/root escape; handle symlinks and filesystem changes at use time; bounded page sizes and payloads; no recursive preload. A folder listing neither creates an agent session nor launches work. Old responses cannot replace a newer breadcrumb location.

If a server lacks browsing, the actual UI says **Enter a server path** and lists recent paths. It does not render a convincing but empty fake browser.

## 8. New session, designed as one useful setup

The setup screen has five pieces in this order:

1. Server identity, inherited from the current workspace and always visible.
2. Project/folder. Choose an existing project, browse the server, or enter a path.
3. Model and effort. Both are visible rows with current choices or **Server default**.
4. Optional first instruction, with a real label and a growing multiline input.
5. **Start session** with a short summary of project and configuration.

Returning to this form remembers its server-scoped draft. Starting from a project preselects the folder and that project's defaults. Starting globally uses the last chosen project on this server, with a clear way to change it.

Default resolution for **new sessions only**: explicit setup choice > project preference > server-level phone preference > daemon default. An existing session always shows its server-reported effective configuration. A stale/unavailable preferred model remains visible as an unresolved choice; the app asks for another model or an explicit server-default fallback.

### Start transaction

Validate directory and current capabilities, submit one client creation key, and retain it durably until reconciled. Obtain the exact server session ID. Apply the selected configuration and confirm effective values before sending the optional first instruction. The instruction is sent once to that exact session under the existing delivery-state contract.

Disable repeated Start while pending. A timeout means **Checking whether the session was created**, not an invitation to submit a second creation. Existing create deduplication is time-bounded; 0.2.0 must define durable resolution or a safe inventory recovery beyond that window.

If creation succeeds but configuration fails, preserve the returned session and show **Session created. Model change needs attention.** Offer Retry configuration, Choose another model, or explicitly Use server defaults. Never send the first instruction under an unconfirmed model, and never create a replacement session automatically.

During creation, Close may leave the pending operation visible in Sessions. The controller owns the transaction; a component unmount cannot abandon or reissue it.

## 9. Model and effort, made visible

### Composer configuration strip

Immediately above the composer: **[Effective model] ▾   [Effective effort] ▾**. Each control opens the same configuration modal focused on the relevant section. A long model name wraps or shortens accessibly; it must not squeeze out the effort target or the send action.

When metadata is unknown, show **Model unavailable** or **Server default** as appropriate. Do not display Medium just because it is a plausible value.

### Configuration modal

Header: **Model & effort**, Cancel and Apply. Search available models; group by provider only if the catalog actually provides it. Current and pending selections are distinguished. Show supported reasoning efforts for the selected model as labelled radio options, with an optional concise provider-backed explanation. No invented Fast/Smart/Best rankings, fabricated prices, or model logos used as colorful decoration.

Model names and effort levels come from negotiated server metadata. A raw string catalog can power model selection, but cannot establish available effort levels. Unsupported effort shows **This model does not offer an effort setting**. Unknown support shows **Effort options unavailable**. Changing model invalidates an incompatible effort and requires a new supported choice or explicit default.

The reviewed upstream wire request contains effort values, but its provider comment is not enough to prove support for every catalog route. Validate the actual selected provider/model. Show only supported values rather than a universal Low/Medium/High/Max row.

### Applying configuration

For idle sessions, Apply enters **Applying** and then reconciles the effective server configuration. The existing adapter `set_model` response is immediate transport handling, not sufficient proof of provider acceptance. 0.2.0 needs a correlated authoritative configuration result or equivalent state reconciliation.

For a running turn, the modal explains **Applies to the next turn**. This is enabled only after a verified daemon/adapter contract can defer both changes safely. Otherwise choices can be saved as a phone-local draft and applied when the turn ends, with explicit reconfirmation and no claim of a server queue. No model/effort change silently cancels, restarts, or modifies an active turn.

Mutations are serialized per session, include request identity and expected configuration revision, and reject stale edits. If model and effort cannot be updated atomically, resolve the effective model first, validate compatible effort, then confirm the final combined state. Partial failure is visible. On reconnect, server truth overrides local assumptions.

Credentials and provider keys remain on the VPS. A mobile model picker chooses an authorized server route; it is not an API key form.

### Proposed configuration contract

Server-level catalog for pre-creation setup; route identity, display name, available/auth status, supported effort values or unknown; session-level effective model/effort and revision; correlated configuration apply result; explicit deferred-configuration capability if supported. The existing mobile `models` capability is retained for compatibility. New capabilities are additive and separately negotiated.

## 10. Conversation and work

Header: native Back, readable session title/switcher, visible session menu. A project label resolves to its full server path in Session details. Conversation content is unboxed assistant prose with restrained user-message grouping. Preserve whitespace, selectable text, code copying and bounded code output.

The work dock answers **What is happening?** with one real activity line and **View work**. A separate Stop control acts on this session's current turn only. Once work finishes, the dock changes to a settled state and remains inspectable. It must not masquerade as an overall progress percentage.

The composer retains drafts across navigation, server switches and reconnects, scoped by server/session. Idle send is **Send**. Mid-turn guidance stays **Guide this turn** with the existing queued/injected evidence. Stop is not the same button as Send. New attachments, voice and slash-command menus do not appear until their capability exists.

Opening Work reveals Tools and a Plan section only when reported todos exist. A plan can say **2 of 5 reported steps complete**. It cannot claim the entire task is 40% complete, because a todo list is not an objective work estimate.

Tool rows show operation, meaningful file/command context, real state and bounded detail. ToolDetail retains exact output, truncation disclosure and Copy. No fabricated checkmarks, Git diff, or successful test result inferred from prose. Source-backed error states remain readable at rest.

On return, paint cached content immediately with a subtle **Saved on this phone** label. Reconcile before claiming Current. Restore the reading anchor and show the seam without jumping to the bottom if the user was reading history. Incoming tokens do not animate letter by letter, play sounds, pulse colored status dots, or re-render completed messages.

## 11. Context window and reasoning display

### Context window

Interpret “context window” as an inspectable measure of the active session's prompt context against its effective model limit. Place a 48-unit **Context** action in the composer configuration area, alongside model and effort. When both values are reported, show a quiet ring and **38%**; tapping opens a compact Context window sheet with exact used/limit/remaining counts, model identity, freshness and source basis.

The visual fixture is **48,600 / 128,000 tokens**, rounded to **38%**, with **79,400 remaining**. These are labelled sample values in every exhibit. They are not measurements from the user's VPS.

| State | Presentation |
| --- | --- |
| Current prompt snapshot and limit known | Used/limit, percentage, remaining and observation time |
| Last-request snapshot only | Label **Last request context**, with its observation time; do not call it current |
| Used count known, limit unknown | Show the count; omit percentage and ring fill |
| Limit known, used count unknown | Show the limit in detail; label usage unavailable |
| Neither known / unsupported server | **Context unavailable**, with no guessed 0% or generic model limit |
| Reconnecting / cached snapshot | Last-known values labelled stale until reconciled |
| Count exceeds limit | Show the reported counts and over-capacity warning; cap graphical ring travel, not the textual evidence |

Context occupancy is not lifetime billing, total session input/output usage, task completion, elapsed time, or the length of the visible history window. Do not add per-turn token usage into a fake context total, or estimate tokens as characters divided by four. Cache-hit accounting and output reservations remain separate fields when the server supplies them.

Propose an additive `context_snapshot` capability and request/event mapping carrying server/session/attachment identity, active model route, snapshot revision, `used_tokens`, `limit_tokens`, count basis, observation time and optional reported components/reserved output. Fields may be unknown independently. A model switch invalidates the old limit and mixed-revision snapshots until effective configuration and context reconcile.

Reviewed upstream JCode events contain a model-change `context_window` field, but its ordinary `tokens` event and session `total_tokens` are usage accounting. The reviewed mobile decoder does not expose a complete context-occupancy snapshot. Adding a ring therefore requires real adapter/controller integration; availability of a route limit alone is insufficient.

The sheet offers **New session in this project**, opening the existing creation flow with explicit confirmation. Compaction, summarization or destructive history controls appear only if negotiated and source-backed. The visual indicator never automatically rewrites context. Thresholds at 70% and 90% can introduce plain attention labels without pulsing, predictions or invented remaining-cost estimates.

Use an accessible progress role only when the numeric basis is valid, alongside visible counts. The ring remains secondary to the conversation and is labelled **Context**, so it cannot be confused with a connection spinner or the loading animation.

### Reasoning display: Hidden / Compact / Expanded

Add a persisted phone-wide **Reasoning display** setting in Settings → Conversation. Default: **Compact**. Also expose it from the session menu. This is a display preference, independent of model, reasoning effort, sending state and execution.

| Choice | Behavior |
| --- | --- |
| Hidden | Omit the reasoning section. Normal assistant text, tool calls, work state and Stop remain available. |
| Compact | One small disclosure row, such as **Thinking** while source-backed reasoning is active. Report duration only when measurable from actual events. Tap to inspect available reasoning. |
| Expanded | Show the server-exposed reasoning content in a bounded, subordinate text region with collapse and Copy where appropriate. |

Only render reasoning or reasoning summaries that the server/provider actually exposes. Do not request hidden chain-of-thought, invent a summary, or mislabel tool execution as a reasoning trace. Servers that supply no reasoning get no fake “Thinking transcript.” Their ordinary Working state can still be shown from actual runtime events.

Changing this preference rerenders retained presentation without sending a new prompt, cancelling the turn, changing effort, or issuing a provider call. It survives restart and is read by the message renderer, rather than being a dead setting. Hidden removes the section from screen-reader navigation; Compact announces only meaningful start/finish changes. Streaming does not announce every reasoning token or repeatedly expand the region.

Retain server/session/attachment/turn fencing on reasoning deltas and completion. A late reasoning event cannot reopen or modify another session. Bound retained reasoning under the existing cache policy and label any truncation; availability of live reasoning does not imply that historical reasoning can be reconstructed.


## 12. Rich content and tool-call rendering

**P0 release requirement.** Tool calls, Markdown, highlighted code, and LaTeX mathematics are part of the core conversation experience. They must receive the same care as navigation and theming. This section defines the required native product behavior; it does not claim that the existing browser concept implements a renderer.

### Rendering architecture

Keep the canonical transcript and raw tool events unchanged. Build a separate typed presentation layer from that evidence: Markdown block/inline AST, code tokens, math nodes, tool-call records, and readable unknown-content fallbacks. Source text remains available for copying and recovery. Renderer caches are disposable and versioned; they never become a second transcript authority.

Preferred starting point: a CommonMark parser with explicit GFM and math extensions, such as `remark-parse` + `remark-gfm` + `remark-math`, with a React Native AST adapter. Refractor core with an explicit grammar registry is a candidate for code tokenization. Validate Metro/Hermes compatibility and pin the selected versions before implementation. None of these packages, KaTeX, or React Native WebView is installed in the reviewed baseline.

Use native text and controls for ordinary Markdown and tool cards. For mathematics, use an offline, bundled KaTeX renderer in a bounded rich-content surface. Group inline mathematics with its containing paragraph or message so baseline alignment and selection stay coherent. Do not instantiate a WebView for every formula. A WebView-based implementation is a measured rendering exception, not the app shell or a replacement for the virtualized transcript. Prove local asset loading, selection, height measurement, accessibility and memory on both platforms before accepting that integration.

Tool lifecycle and prose remain ordered parts of the same conversation. The inline tool summary and Work detail reference one normalized call record; they cannot disagree about whether it is running or has failed. If the current message model cannot preserve interleaved text/tool order, extend its presentation mapping from actual protocol/history ordering rather than inferring order from the final prose.

### Tool-call anatomy

Collapsed tools should read like work, rather than a wall of serialized transport data. One row contains an operation label, meaningful target, a status icon plus text, and an explicit expand control. An example is **Read file · src/core/connection/reconnect.ts · Completed**. Long targets truncate only in the summary; detail shows the full value and Copy.

| Tool family | Summary | Expanded presentation |
| --- | --- | --- |
| Shell / command | Command name and a bounded first line | Exact command, working directory if reported, output/error, exit status if reported; selectable monospace text |
| Read / search | Path or search query | Structured arguments, file/match results, line references when present |
| Write / edit | Target path and reported operation | Inputs and actual result; a supplied patch can be highlighted as patch text |
| Todo / plan | Reported action or step count | The existing reported plan, with actual item states |
| Generic / MCP | Server/tool name and a useful parameter summary | Bounded structured arguments and result, plus an escaped raw-data view |

Summary labels come from a small deterministic renderer registry. Keep the original tool name available. Unknown tools use the generic renderer immediately. Missing fields remain unavailable instead of being filled with invented commands, timing or filenames.

Multiple consecutive calls can collapse into a **7 tool calls** group. Expanding preserves their actual order and individual status. The count is an event count, never a task-completion estimate. Auto-expansion is limited to the currently relevant first error; ordinary output arriving must not repeatedly open groups or move the reader.

### Tool states and evidence

The current mobile protocol already carries `tool_start`, `tool_exec`, and `tool_done`, with `call_id`, session, attachment and turn identity. Use these exact identities and lifecycle events. `tool_start` can show **Preparing**; `tool_exec` can show **Running**; `tool_done` settles the call with its actual output/error. Do not claim incremental argument streaming unless the adapter explicitly adds and supplies it.

Success requires a source-backed successful result. If a terminal event has no error but no stronger success semantics, **Completed** is safer than a fabricated exit code or test verdict. Socket loss shows last-known work and connection freshness, not a failed tool. Cancelling a turn does not by itself prove that an external child process was killed. **Waiting for approval** appears only with a real approval capability and event.

Key live calls by server/session/attachment/turn/call identity. Reconcile recorded history to live calls using real call/message identity; repeated invocations of the same tool are separate records. Do not key them by tool name or array position. Late results, replayed frames, history replacement and retry rollback cannot duplicate a card or overwrite a newer call.

Tool detail offers **Inputs**, **Result**, and **Raw data** where those sections exist. Pretty JSON preserves actual values; malformed/incomplete input remains escaped, selectable text. Logs are plain text by default. A tool result is interpreted as Markdown only when its content type explicitly establishes that format. ANSI/terminal escapes receive a bounded text normalization; no terminal commands or interactive shell are executed by the renderer.

Truncation distinguishes **preview collapsed** from **server output truncated**. **Show more** reveals only retained content. Copy labels distinguish visible output, full retained output, and truncated output. Do not promise a full result if the server no longer has it. Sensitive credential fields are redacted in presentation and clearly labelled redacted when copied.

### Markdown support

The release must handle CommonMark fundamentals and explicitly selected GitHub-style extensions. Replace the current small regular-expression block parser instead of adding a growing chain of formatting substitutions.

| Content | Required behavior |
| --- | --- |
| Headings, paragraphs, emphasis | Proper hierarchy; nested strong/emphasis; stable line spacing; inline code remains literal |
| Lists | Ordered starts, nested ordered/unordered lists, multiline items, code inside list items |
| Task lists | Read-only checked/unchecked rendering from message content; tapping never mutates the agent's actual plan |
| Tables | Real columns, header/alignment, escaped pipes and inline content; horizontal scrolling for genuinely wide data |
| Quotes and rules | Restrained separators and readable grouping, using the same semantic theme |
| Links and autolinks | Accessible tap targets and visible destinations in link actions; validated external/internal routing |
| Footnotes | Navigable reference and return-to-reading-position behavior |
| Code fences | Language labels, tilde/backtick fences, literal contents and open-fence streaming |
| Images | Alt text and a bounded placeholder; external images load on intent through a controlled image path |

Map message headings onto content title/subhead tokens, never the welcome display scale. Syntax colors use dedicated Light/Night semantic tokens with measured contrast; their functional distinctions do not create extra brand accents. Math fonts are functional assets rather than a new branding family.

Tables do not silently become unrelated key/value cards. An optional row-detail view can help a narrow phone, but the user must retain the original table and column relationships. Missing or malformed cells stay readable. Lists must preserve indentation instead of flattening every item into a bullet.

Remote file links resolve against the session's server and authorized workspace when file reading is supported. They never open a phone-local path just because the assistant emitted `/home/quant/...`. External URLs use validated schemes; raw HTML, JSX, embedded scripts and arbitrary custom protocols are not executable message content.

Text selection must work within prose/code and rich regions. A message action provides **Copy Markdown** for the exact source and **Copy text** for a readable projection; equations and code also have their own source-copy action. These explicit actions cover platform selection boundaries without claiming that cross-native/WebView drag selection is identical on both operating systems.

### Code and patch presentation

Ship real syntax tokenization for an explicit practical set: JavaScript, TypeScript, Python, JSON, Bash, YAML, SQL, Markdown and diff, plus aliases. Unknown languages fall back to selectable plain code with the supplied label. Do not claim support based on colored regular expressions or load an entire language registry by default.

A code block has a quiet language header, Copy, Wrap, and Open full view for long content. Optional line numbers belong in full view and are excluded from Copy. Wrap is a local viewing preference. There is no Run action. Preserve indentation, Unicode and exact clipboard contents.

Apply highlighting only to a closed, settled, size-bounded block. While an opening fence is incomplete, show readable provisional code. Large blocks keep a bounded inline preview and a paged/detail route; avoid thousands of mounted token nodes. Use semantic syntax tokens in Light/Night with readable contrast, and retain `+`/`-` patch markers so meaning survives grayscale.

A `diff` fence or a tool-supplied patch is agent-provided text. Rendering it clearly does not establish a verified Git diff or repository state; those remain behind the separate Git capability described above.

### LaTeX mathematics

Support inline `$...$` and `\(...\)`, display `$$...$$` and `\[...\]`, and an explicit `math` fence. Dollar math is an explicit extension to Markdown, not a CommonMark guarantee. Parenthesis/bracket delimiters need a compatible parser extension; a chosen library must not silently omit them.

Required expression coverage includes fractions, subscripts/superscripts, roots, sums, integrals, Greek symbols, aligned equations, matrices and cases within the supported KaTeX subset. This is mathematical typesetting, not an unrestricted TeX engine. Unsupported constructs remain readable as source with a concise **Cannot typeset this expression** action and Copy LaTeX.

Use offline bundled KaTeX assets and math fonts. Configure `trust: false`, finite `maxExpand` and `maxSize`, controlled macro scope and an error fallback. Use HTML plus MathML output for the visual/accessibility representation; verify the actual VoiceOver/TalkBack result rather than equating MathML presence with an accessibility pass. Never insert an unsanitized parser exception or agent-authored HTML into the rendered page.

Inline math follows paragraph baseline and text scale. A long display equation scrolls horizontally or opens an equation detail view; do not shrink it until it is unreadable. Provide a readable text/source alternative. Theme changes recolor the whole mathematical expression consistently. LaTeX source, code strings and escaped dollar signs retain their exact contents.

The delimiter policy must distinguish ordinary currency from formulas. Fixtures include `$20 USDT`, `$20 and $30`, `\$20`, `$x^2$`, explicitly closed `$5$`, math inside emphasis/table cells, escaped delimiters, and dollars inside code. Lock the grammar with these examples rather than scanning the already-rendered page with a second broad regex.

During streaming, keep an unmatched math expression as provisional literal text. Typeset it when its delimiters close and its revision is current. A closed expression may still be invalid; preserve its source and leave the rest of the message usable. Do not flash a large red error for every partial token or repeatedly re-typeset old equations.

### Streaming, performance and containment

Retain the controller's approximately 100 ms stream coalescing. Cache committed block trees by content revision and reprocess only the unstable tail where grammar permits. Reconcile reference definitions or structural corrections when needed, including the terminal full parse. Never advertise an incremental parser while reparsing and remounting the entire transcript every token.

Stable render identities preserve expansion, Wrap and the reading anchor across updates. Discard stale parse/highlight/math/height results using message identity and render revision. Width, appearance and text scale participate in the layout cache key. Retry rollback and history replacement invalidate only the affected presentation.

Keep expensive surfaces limited to visible/near-visible content and release offscreen resources through measured virtualization. Ordinary text-only messages must not instantiate a browser engine. Preserve existing code/output/cache budgets as starting limits, with explicit overflow handling and source access. Compare startup, scrolling and memory against the same native baseline on a midrange Android device and iOS before accepting a math WebView approach.

For any rich-content WebView, app-owned assets and scripts are the only executable code. Enforce navigation/resource restrictions and a narrow, identity-checked bridge for size, copy and link intent. A static HTML origin setting alone is not containment. Do not interpolate message text into executable JavaScript. Height updates are bounded, debounced and revision-checked so a late formula cannot move another session's reading position.

### Renderer acceptance corpus

These are release checks to implement and run, not results already verified by this document.

| Fixture | Required result |
| --- | --- |
| Mixed research answer | Nested Markdown, Python block, aligned table, inline/display math and footnotes coexist correctly |
| Currency and escaped syntax | Currency stays currency; code stays literal; explicit equations render |
| Token-by-token delivery | Split fences, escape sequences, JSON arguments and LaTeX do not crash or corrupt committed content |
| Overlapping tools | Calls with identical names keep separate arguments, status and results |
| Reconnect and rollback | No duplicate cards, stale status overwrite, lost expansion state or incorrect return seam |
| Malformed content | Broken tables/fences, invalid TeX and unknown tools retain readable source and recovery |
| Long output | A large shell result, long code block and math-heavy answer remain bounded and disclose truncation |
| Copy | Code, retained tool output and LaTeX copy exactly; partial/redacted copies are labelled |
| Small screen / large text | Wide tables/equations remain accessible at 320-wide layout and 200% text in both appearances |
| Accessibility / isolation | Reading order, named expand/copy actions, math alternatives and denied executable content pass native checks |

The renderer showcase must demonstrate a realistic mixed answer, an expanded shell call, a generic unknown tool, a failed tool, an incomplete streamed expression, and the same content in Light/Night. A static screenshot of a formula does not satisfy this gate.

Mermaid can be a P1 renderer extension with an explicit supported diagram subset and contained rendering. Until then, its fence remains selectable source. Arbitrary HTML/MDX execution and an interactive terminal are outside the rendering contract.


## 13. Appearance, typography and tokens

### Appearance controls

Theme family and appearance are separate preferences. Tidal remains the default family; System is the default appearance. Add ten complete theme families as specified below. Display **System · currently Night** when useful. Appearance is a phone-wide preference, separate from server/project/session configuration.

Honor OS Reduce Motion automatically. An additional **Reduce motion in JCode** option can reduce further; it cannot override an OS request for less motion. Live theme preview updates atomically with the whole page. Do not animate colors through low-contrast intermediate frames or use a circular theme wipe.

### Eleven theme families

The current **Tidal** palette remains the default, preserving its existing Light and Night colors exactly. Add ten established developer-theme families: **Gruvbox, Catppuccin, Dracula, Nord, Tokyo Night, Solarized, One Dark / Light, GitHub, Rosé Pine, and Monokai**. “Blue box” was interpreted as Gruvbox. This is a curated familiar set, not a claim to have measured the ten most popular themes worldwide.

Each family has a complete Light and Night app adaptation: 11 families and 22 palettes. Where a source lacks a canonical light counterpart, the companion is explicitly app-authored. Original palettes inform the design; mobile controls, selection, error, focus, syntax and material roles are adapted for contrast. These are independent app adaptations, not official endorsements.

Store `themeFamily` separately from `appearance = system | light | night`. Appearance System follows the OS within the selected family. Existing users migrate to `themeFamily = tidal` while preserving their appearance preference; an upgrade must not replace their chosen colors with the earlier vermilion concept.

`themes.json` contains the full family/mode role maps, source credits and material tokens. `tokens.json` is a generated default-Tidal projection. In native code, the existing `src/design/tokens.ts` remains the executable authority and consumes a validated equivalent registry; screen files never define competing palettes.

Theme selection is a real native Appearance destination, reachable from Welcome and Settings. Show compact previews of the same miniature UI for all families, a selected checkmark, and the Light/Night/System choice. Changing the family previews the whole page and persists on confirmation. Theme choice does not mutate server/session/model configuration.

### Glass material

The requested material is **Tidal Glass**: the original green reading canvas, opaque readable content and a small number of translucent, blurred chrome surfaces. Use glass for the composer dock, compact app/session menus and the context sheet. A top navigation material can use it while scrolling. Session rows, code blocks and long prose remain stable reading surfaces.

Material tokens define tint, minimum tint alpha, edge, fallback fill and content plate. Starting tint alpha is 0.84 in Light and 0.88 in Night, with a 24 CSS-pixel blur reference. Native blur intensity is a separate platform value to tune by measurement; do not translate CSS blur pixels directly into an Expo intensity number. Essential controls get a sufficiently opaque text/control plate when the backdrop could otherwise change their contrast.

At most two visible live blur regions are active. Opening a sheet can replace/suspend underlying chrome blur. Use one blur target where the supported native API permits it, render it in the documented order relative to dynamic lists, and keep the blurred area bounded. Animate surface transform/opacity, not blur radius on every frame. Avoid layered full-screen blur stacks or blurring the token stream repeatedly.

`expo-blur` is the candidate native material dependency; install an SDK-compatible pinned version during implementation. Current official guidance requires the correct Android blur target/method rather than assuming the legacy iOS usage produces Android blur. Preserve the existing React Navigation and Reanimated stack. Benchmark on a midrange Android device before accepting the effect.

Honor OS Reduce Transparency and a persisted **Effects: Auto / Reduced** preference with an opaque sibling material. Reduce Motion remains independent. The app must stay complete with both reductions enabled; a missing blur implementation cannot produce transparent controls over unreadable content. Verify actual composited contrast on varied backdrops in every family/mode, not just the opaque color swatches.

Glass does not require new app drop shadows: use the material edge and elevation by tone. Native hit targets, safe areas, text scaling and keyboard clearance remain unchanged. These explicit user requirements supersede the earlier single-palette, opaque-only visual proposal.


### Typography

Keep existing bundled fonts: Bricolage Grotesque 600 for the welcome and top-level short titles; Hanken Grotesk 400/500/600 for prose and controls; IBM Plex Mono 400 for paths/code. Mono is a functional exception to the two-family brand system. Keep existing font licenses and native static font mappings.

Scale: base 16, functional ratio approximately 1.125 with explicit display jumps. Use 13/18 caption, 14/20 secondary, 16/24 body, 18/26 lead, 20/26 subhead, 24/30 title, 44/48 screen, and 62/64 welcome. Welcome is the sole oversized composition. At compact widths screen/welcome step down to 36/40 and 52/55 respectively. Minimum editable input text is 16.

Body supports at least the current 200% scale contract, with no new fixed-height clipping. Larger accessibility categories require explicit verification. At large text, rows grow, model/effort controls stack, and headers use compact titles with accessible full text. Do not shrink labels to preserve a screenshot's geometry.

### Semantic palette

The original Tidal colors are preserved exactly. `themes.json` owns all 22 complete palette maps and source credits; `tokens.json` projects the default palette with OKLCH authoring values and exact sRGB exports. Brand and clay attention colors retain their existing distinct roles.

| Token | Tidal Light | Tidal Night |
| --- | --- | --- |
| bg | `#F3F6F5` | `#111F20` |
| surface | `#FFFFFF` | `#192C2B` |
| raised | `#E8EFEC` | `#223735` |
| ink | `#173B3A` | `#E5F0EB` |
| muted | `#536B65` | `#A0B6AD` |
| line | `#D5E0DB` | `#344D48` |
| control | `#718981` | `#69867E` |
| brand | `#164F49` | `#B5D6C5` |
| onBrand | `#F4F8F5` | `#18392E` |
| accent | `#E56F4D` | `#F2B09A` |
| accentSoft | `#FFE4D8` | `#432E27` |
| onAccent | `#542211` | `#F7C1AA` |
| success | `#276554` | `#A8D6BF` |
| warning | `#81502A` | `#E7C39D` |
| error | `#A23C2D` | `#F0A698` |
| focus | `#316E68` | `#B5D6C5` |

`THEME_CONTRAST.json` records 242 passing opaque semantic-pair checks across 22 palettes, including syntax colors. This is a calculation over the supplied tokens, not native compositing or accessibility certification. Actual glass contrast requires the backdrop checks described above. Faint line separators remain decorative.

### Geometry and surfaces

Preserve 4-unit base, 4/8/12/16/20/24/32/40/48/64 spacing, 20-unit compact and 24-unit regular gutters, 48-unit minimum touch targets, 12-unit control and 24-unit sheet radii. Circles are reserved for genuine round controls. No app drop shadows; opaque surface changes and purposeful separators define layers. Priority surfaces use the selected theme’s raised/ink roles. Glass uses its own complete material tokens and opaque fallback; these are component projections, not per-screen literals.

At 360 wide, stack configuration controls and allow row growth. At 320 and 200% text, preserve functionality through scrolling/reflow. On tablets use an optional project/session list and conversation split only when both panes remain readable. Never scale down a full phone as the native responsive strategy.

One icon family, existing Lucide-derived icons with consistent 24-unit grid and stroke. Keep JCode's real mark. No provider-logo confetti or emoji controls. Motion and type create the identity; icons stay subordinate.

## 14. Motion score

### Loading and first-run motion

The second user reference establishes the desired loading composition: stable session navigation, a recognizable animated centerpiece, clear state copy and a usable path back. Use JCode's own licensed mark rather than copying the reference app's pixel character. The first screenshot establishes the original Tidal colors, which remain the default.

| Moment | Presentation and behavior |
| --- | --- |
| Cold launch | Match splash and first-screen background; complete local bootstrap/fonts before network reconciliation, without waiting for a remote session. |
| First welcome | Real mark, **Your work. / In reach.**, short continuity-line reveal and a live theme/material preview. Total authored introduction ≤600 ms, with the action usable immediately. |
| Open with cache | Paint saved content first, label it saved, and show a compact synchronization state. Do not cover readable history with a full-screen loader. |
| Open without cache | After about 180 ms of actual pending work, show the loading composition to avoid a one-frame flash on fast requests. |
| Loading animation | Rasterized JCode mark rotates smoothly on the UI thread over a 1,400 ms cycle. Three quiet phase-offset dots may accompany it. The label names the real operation. |
| Ready | Stop the loop and settle into content with a ≤160 ms fade. Do not enforce an artificial minimum waiting period. |
| Long wait | After 8 s of the same pending operation, add **Still connecting** and Retry/Back where valid. The timeout/recovery contract remains separate from animation timing. |
| Error / revoked / missing session | Stop loading, preserve the known target/draft and offer the specific recovery. An indefinite spinner is not an error state. |
| Reduced Motion | Static mark plus text; no orbit or animated dots. Cached content and all recovery actions remain available. |

Only a genuinely pending operation runs the repeat animation. A normal ready screen does not loop decorations. Back, dismiss, leaving the phone, or changing appearance cannot cancel server work. A retry reuses the relevant correlation/creation identity when the prior outcome is ambiguous.

The animated GIF is a 1,400 ms reference loop, not a performance benchmark or a simulated server-progress estimate. The offline exhibit uses fixture state; its motion is visual evidence only. Loading labels must not cycle through invented connecting/authorizing/receiving stages on a timer.



| Interaction | Behavior | Timing | Reduce Motion |
| --- | --- | --- | --- |
| First welcome | Mark/wordmark settle; two title lines move 8 units; seam extends once | Whole sequence ≤600 ms; no input blocking | Static composition or ≤100 ms fade |
| Primary press | 0.98 scale, immediate pressed material, release to rest | 80 ms in, 120 ms out | Material feedback only |
| List row press | Surface response; native navigation owns travel | Immediate, native transition | Native reduced transition |
| Navigation | Existing native stack transition | Platform controlled | Native fade/reduced option |
| Menus | Opaque surface, short translation from its origin; explicit dismissal | 180–240 ms | ≤100 ms fade |
| Native modal | Platform presentation and drag dismissal | Platform controlled | Platform reduced motion |
| New session becomes conversation | Confirmed identity appears in new screen; subtle content fade | ≤240 ms | ≤100 ms fade |
| Model/effort selection | Stable selection marker moves; Apply owns confirmation | 120–180 ms | Immediate marker |
| Theme choice | Whole semantic palette switches together | Atomic | Same |
| Return seam | One reveal at the reconciled boundary; preserve anchor | ≤280 ms | Immediate or short fade |
| Async completion | Work dock settles; optional single success haptic in foreground | 180 ms | Immediate label change |
| Token stream | Content updates at existing coalescing cadence | No per-token animation | Same |

Use UI-thread transform/opacity worklets for authored motion, native navigation for route motion, and existing clamped spring constants for tactile interactions without overshoot. No JS timers pretending to animate scrolling. No entry animations replaying on recycled list cells. First-load row reveal is optional and limited to the first six rows once per screen visit.

Haptics: selection for committed picker changes; one light/notification event for confirmed async outcomes where meaningful; none for ordinary navigation. Do not replay completion haptics for historical work when reopening.

Animation must be interruption-safe. Rapid open/close, keyboard appearance, back gestures and a live theme change must not strand invisible content or steal interaction. Every authored entrance has a dismissal/rest state. The first useful screen should paint without waiting for the welcome sequence.

## 15. Component and state matrix

| Component | Required states and behavior |
| --- | --- |
| Primary action | Rest, pressed, focused, disabled with reason, loading; one visible action label throughout |
| Row/action menu | Pressed/focused/selected, unread/unknown/error as applicable; 48-unit targets; long press has a visible alternative |
| Input | Visible label, editing, validation pending, error with preserved value, disabled with reason; correct keyboard/autofill |
| Picker | Current versus draft choice, unavailable options, no results, fetching, error/retry; Apply/Cancel preserve original until confirmed |
| Content list | Layout-shaped loading, first-use empty, filtered empty, populated, refreshing, stale cache, offline, error/retry |
| Modal | Visible Close, focus on heading/first meaningful input, contained screen-reader focus, keyboard-safe footer, focus returns to trigger |
| Work dock | Unknown, working, interrupted, completed, stopped, connection stale; no inferred task percentage |
| Configuration strip | Confirmed, pending, unknown, unsupported, rejected; long names and large text reflow |
| Context / reasoning | Known/partial/stale/unavailable context; Hidden/Compact/Expanded reasoning from real events only |
| Loading / glass | Pending/ready/error/long wait; full/reduced effects and motion; opaque fallback |
| Directory browser | Loading, populated, empty, forbidden, invalid, unavailable, offline, stale-request rejection |
| Saved content | Source label and last checked context; live readiness follows authoritative reconciliation only |
| Tool-call renderer | Preparing/running/completed/error/unknown; expand/collapse, typed input/result, generic fallback and honest truncation |
| Markdown/code/math | Provisional/settled/error/unsupported/oversized; readable source, precise Copy and accessible full view |

All controls are keyboard and assistive-technology operable. Status does not depend on hue. VoiceOver/TalkBack announce coarse meaningful changes, not every token or timer tick. Text selection, Copy, native Back, OS keyboard dismissal, and reduced motion survive the visual redesign.

## 16. Implementation sequence and owners

The product remains one native client and a thin server adapter. No phone-side agent, duplicate transcript authority, webview shell, or provider proxy is introduced.

| Stage | Deliverable | Main touch points | Done when |
| --- | --- | --- | --- |
| 1. Contract | Capabilities, catalog/config confirmation, directory operations, creation recovery specified and proven | protocol frames/decode, adapter server/attachment, controller | Real daemon fixtures establish honest UI states |
| 2. Design foundation | New palette/type/motion projected into existing tokens and controls | `src/design/tokens.ts`, theme, controls, typography | Both appearances and all control states render consistently |
| 3. Renderer | Markdown/GFM, real code tokens, offline math and structured tool cards | conversation renderer, CodeBlock, Work, content adapters | Mixed-content fixtures, streaming corrections, copy and memory gates pass |
| 4. Useful entry | Welcome, pairing, defaults, Projects, RemoteFolder, NewSessionFlow | connect/newSession/new project features, SQLite | Pick real remote folder, select actual supported config, start once |
| 5. Daily use | Sessions composition, conversation strip, menus, Work navigation | sessions/conversation/work/server, typed navigation | Core jobs are reachable; continuity and drafts survive navigation |
| 6. Finish | Press/motion/haptics, large-text layouts, errors, migration | shared design and feature surfaces | Quality gates pass on both native platforms |

Persist the accepted proposal in `docs/v0.2.0/DESIGN.md` with product behavior alongside it, and keep the old handoff unchanged as historical reference. Update AGENTS.md/design authority pointers when implementation begins so a worker is not told that two conflicting visual documents are both authoritative. `src/design/tokens.ts` remains the single executable token source; do not add parallel scattered palettes.

Expected new modules: theme-family/material registry, pending-operation loader, normalized context snapshots and reasoning-display preferences; typed rich-content parser/native renderer, syntax-token adapter, bounded math host and shared tool-call renderers; projects catalog and selectors; remote directory protocol/controller; session configuration transaction/state; first-run route group; NewSessionFlow; Appearance; Defaults. Retain existing transport, identity fences, draft/cache scoping and reconcilers. Versioned SQLite migrations preserve existing drafts/bookmarks/profile identities.

No production daemon restart is part of a visual redesign. Integration tests use isolated staging as existing agent notes require. Implementation should use small commits by coherent behavior, not a one-shot rewrite of the controller and every screen.

## 17. Release gates

### Product and trust

- Choose a real folder on the server, select an available model and supported effort, start a session, and verify the daemon's effective configuration before the first prompt.
- Lose connectivity during creation, model apply, and message delivery. Recover the original session and actual config without duplicate work.
- Background/force-quit while a turn runs. Reopen the exact session, restore its draft/reading anchor and show the correct return boundary.
- Switch server/project while a delayed request is in flight. Old results cannot overwrite the new context.
- Confirm unavailable routes/efforts and denied folders produce useful recovery, rather than apparent success.
- Navigation, menus, theme switches, and modal dismissals never issue Cancel/Clear/Rewind.

### Themes, loading, context and reasoning

- Preserve original Tidal colors and existing appearance on upgrade. Exercise all 22 palettes and their syntax/material roles, System appearance, Reduce Motion and Reduce Transparency.
- Show cached content before reconciliation. Loader runs only while genuinely pending, exits on success/error and leaves navigation usable during long waits.
- Context occupancy is tested independently from billing totals, with unknown/stale limits, model switches and cross-session late events.
- Hidden/Compact/Expanded persist and affect only server-exposed reasoning; switching visibility sends no provider, cancellation or effort mutation.
- Benchmark native blur, streaming, keyboard interactions and Work virtualization on midrange Android and iOS.

### Rich content

- Run the renderer acceptance corpus against native release builds, including streamed Markdown/LaTeX, overlapping calls, exact Copy, failed/unknown tools, rollback and reconnect.
- Demonstrate real math typesetting and syntax tokenization with no network-dependent renderer assets; record accessibility, frame-time and memory results on both platforms.
- The renderer is required for 0.2.0. Placeholder formulas, decorative tool rows and plain code passed off as highlighted output do not satisfy the gate.

### Visual and native behavior

- Review welcome, pairing, sessions, projects, folder picker, setup, configuration, conversation, work, menus and appearance in Light and Night.
- Test 360-wide Android and 390-wide iOS plus 320-wide reflow and at least 200% text.
- Test submit/Apply/Use folder with the keyboard open, Android edge-to-edge, iOS home indicator, safe Back, screen readers, and Reduce Motion.
- Profile release builds with long histories and real streaming. Target fluid 60 Hz interactions; frame budget about 16.7 ms on a 60 Hz device. Treat this as a measured acceptance target, not a promise from the mockup.
- Preserve current virtualized list/cache/stream budgets. Compare cold/warm startup and peak memory against the baseline on the same device; record regressions and their cause before accepting them.
- No runtime font download, unnecessary animation library, full-screen blur stack, idle decorative loop, or full transcript rerender per token. A pending-only loading loop and bounded glass chrome are required.

### Design audit

The proposal preserves a real product-specific structure: project-scoped sessions leading into one continuous reading surface, with the same unseen-work boundary in the transcript and work. The structure remains useful without its red accent. Decorative AI-template patterns are excluded from the composition.

Calculated opaque palette contrast is recorded in THEME_CONTRAST.json. Glass compositing requires native backdrop verification. Native keyboard, screen-reader behavior, startup flash, gestures, Dynamic Type, scroll performance and real server interactions are **not verified by this design artifact**. The interactive preview illustrates visual direction and local interaction only. JavaScript parsing and static checks were run. Headless browser verification was attempted, but Chromium was absent and the browser download returned an invalid archive; a native simulator was not run. Browser layout and interaction checks therefore remain unverified. Do not score those native checks as passed or call 0.2.0 implemented on the strength of a browser concept.

## 18. Source notes

- [Mobile taste guide](https://github.com/draftbit/mobile-taste-skill/blob/eb58d9896d446b574ba4b0fb83e3587e8708a9e1/skills/mobile-taste/SKILL.md): app/navigation read, one meaningful expressive move, full state cycles, UI-thread motion, platform behavior and anti-template checks. Related redesign, navigation and review references were also read.
- [Frontend design deslop](https://github.com/samber/cc-skills/blob/main/skills/frontend-design-deslop/SKILL.md): strategy before pixels, distinct grounded directions, semantic tokens, component states, contrast and structural audit. Existing project constraints and this explicit redesign brief determine the final choices.
- [Current design authority](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/design/reference/JCode_Mobile_Design_Handoff/DESIGN.md): original typography, geometry and return seam.
- [Current package manifest](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/package.json): actual stack and installed motion primitives.
- [Current NewSessionSheet](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/src/features/newSession/NewSessionSheet.tsx): manual server folder and recent paths.
- [Current adapter server](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/integration/jcode-adapter/src/server.ts) and [attachment](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/integration/jcode-adapter/src/attachment.ts): existing model requests, attachment and continuation behavior.
- [Current mobile frames](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/src/core/protocol/frames.ts): current capability and mutation surface.
- [Current conversation](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/src/features/conversation/ConversationScreen.tsx) and [Server details](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/src/features/server/ServerDetailsScreen.tsx): existing menus and appearance.
- [Adapter contract](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/docs/ADAPTER_CONTRACT.md) and [agent constraints](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/AGENTS.md): trust semantics and staging boundary.
- [Reviewed upstream wire source](https://github.com/1jehuang/jcode/blob/7206efd0c1dbf49ef38d06b63f3a96a3a7cee611/crates/jcode-protocol/src/wire.rs): catalog and reasoning-effort request shapes. This is the upstream tag referenced by the existing adapter contract, not proof of the user's live VPS version.

- [Reviewed Markdown renderer](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/src/features/conversation/Markdown.tsx) and [CodeBlock](https://github.com/ddawnlll/jcode-mobile/blob/7a5e0b669314a3ae7f3186d38cbd0b9771920678/src/features/conversation/CodeBlock.tsx): current parsing and code presentation baseline.
- [remark-gfm](https://github.com/remarkjs/remark-gfm) and [remark-math](https://github.com/remarkjs/remark-math/tree/main/packages/remark-math): candidate Markdown extensions; dollar-math ambiguity and delimiter support require explicit tests.
- [Refractor](https://github.com/wooorm/refractor): candidate Prism-based syntax-token AST and explicitly registered grammar approach.
- [KaTeX options](https://katex.org/docs/options) and [security guidance](https://katex.org/docs/security): output modes, error handling and bounds for untrusted mathematical content.
- [React Native WebView guide](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Guide.md): rich-content host integration, navigation and JS/native communication. Its native compatibility remains an implementation gate, not a verified property of this proposal.

Design changelog: 9 November 2026, proposed 0.2.0 Swiss Signal direction, first-run appearance, real projects/folders, visible model/effort, configuration confirmation and native release gates.

Design revision: 9 November 2026, renderer promoted to P0; added structured tool calls, CommonMark/GFM, syntax highlighting, LaTeX mathematics, streaming rules, architecture and native acceptance corpus.

### Reference and review reconciliation

The updated bundle includes the original v0.1.0 handoff archive unchanged and the user-provided v0.1.0 code review. The repository’s v0.1.1 corrective response reports fixes for most findings, with F16 and F20 mitigated and F22 partial. Those statements are recorded source claims, not a new rerun of the review. Carry the remaining Work-memory/virtualization, registry concurrency and native focus/accessibility checks into 0.2.0; preserve corrected ownership, UTF-8, delivery, continuation and retry behavior. Do not treat a new animation or loader as a substitute for cache-first correctness.

Visual references: assets/v0.2.0/overview.png, features.png, themes.png, seven individual SVG/PNG screens, loading.gif, and the offline SHOWCASE.html. Every newly generated screen is authored from theme data and fixture content. The original handoff’s historical automated checks do not certify these new references.

Design revision: 9 November 2026, Tidal Glass supersedes the vermilion-only palette; added eleven theme families, glass materials, pending-state loading, welcome revisions, context snapshots, reasoning visibility, visual reference boards and an animation example.
