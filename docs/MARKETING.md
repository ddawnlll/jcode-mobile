# Marketing site tooling

Status: **build, serve, and test tooling only.** No marketing site has been
deployed by this repository, and these files make no claim that one is live.

The static site source lives in `website/` and is owned by the website worker.
This document describes the root-owned tooling around it:

| Path | Owns |
| --- | --- |
| `scripts/marketing/build.mjs` | Copy, validate, hash, and manifest the static tree |
| `scripts/marketing/serve.mjs` | Safe local static server for verification |
| `scripts/marketing/*.test.mjs` | Bun tests for the build and server contract |
| `e2e/marketing/` | Dedicated Playwright config, helpers, and specs |
| `.github/workflows/marketing.yml` | Manual-only GitHub Pages build/deploy |
| `package.json` | `marketing:build`, `marketing:serve`, `marketing:test` |

## Source and output contract

```text
website/
  index.html
  styles.css
  main.js
  assets/
    fonts/
    media/
    mark/
    favicon.png
    icon.png
    social-card.png
```

The build copies `website/**` **verbatim**. It does not rewrite HTML, inject a
base path, fingerprint filenames, or transform CSS. That is deliberate: the
output must work unchanged at a domain root and at a GitHub Pages project path
such as `/jcode-mobile/`.

Default output: `dist/marketing/` (ignored by `.gitignore` through `dist/`).
A staging output is also fine because `.staging/` is ignored:

```sh
bun --bun scripts/marketing/build.mjs \
  --source website \
  --out .staging/marketing/site
```

Every build writes `build-manifest.json` beside the copied files:

```json
{
  "schemaVersion": 1,
  "generator": "scripts/marketing/build.mjs",
  "entry": "index.html",
  "productVersion": "0.2.0",
  "basePath": ".",
  "fileCount": 23,
  "totalBytes": 1234567,
  "files": [
    { "path": "index.html", "bytes": 1234, "sha256": "..." }
  ]
}
```

The manifest is deterministic for unchanged inputs: sorted paths, no build
timestamp, SHA-256 per copied file. It excludes itself.

## Build validation

`buildMarketingSite` fails with a specific error instead of publishing a tree
that only works on one host:

| Guard | Failure |
| --- | --- |
| Root-absolute URL | `href="/styles.css"`, `url(/assets/x.png)`, `src='/main.js'` |
| Remote runtime asset | CDN script/style/font/image, `https://` `fetch`, remote CSS `url()` |
| Missing local file | Broken image, font, stylesheet, script, poster, or link |
| Escaping path | `../` beyond the site root |
| Project-path breakage | `<base href>` or an absolute canonical/`og:url` origin |
| Invented link | Any external anchor outside the approved product URL prefix |
| Accessibility basics | Missing `lang`, title, meta description, viewport, one `<h1>`, one `<main>` |
| Markup integrity | Duplicate ids or `#fragment` links with no matching id |
| Unsafe source | Symlink escaping the repository, output inside the source, output at the repo root |

Approved external navigations default to
`https://github.com/ddawnlll/jcode-mobile`. Extend deliberately:

```sh
MARKETING_ALLOWED_EXTERNAL_PREFIXES="https://example.com/product" \
  bun run marketing:build
```

The exact primary CTA target is:

```text
https://github.com/ddawnlll/jcode-mobile/releases/download/v0.2.0/jcode-mobile-0.2.0-android-release.apk
```

`e2e/marketing/layout.spec.ts` asserts that exact URL, the visible `0.2.0`
version, and `referrerpolicy="no-referrer"`.

## Commands

```sh
bun run marketing:build   # validate + copy to dist/marketing
bun run marketing:serve   # serve dist/marketing on 127.0.0.1:8092
bun run marketing:test    # build + Bun unit tests + Playwright matrix
```

Serve a project-path mount locally, matching GitHub Pages:

```sh
bun --bun scripts/marketing/serve.mjs \
  --dir dist/marketing \
  --host 127.0.0.1 \
  --port 8092 \
  --base-path /jcode-mobile
# http://127.0.0.1:8092/jcode-mobile/
```

Server options: `--dir`, `--port`, `--host`, `--base-path`, `--hsts`,
`--asset-cache-seconds`. Environment equivalents use the `MARKETING_` prefix.
Port `0` selects a free port.

The server is a verification harness, not a production web server. It supports
`GET` and `HEAD` only and has no SPA fallback: a missing file is a `404`, never
`index.html`. That makes broken links visible in tests instead of hiding them.

### Server behavior

| Concern | Behavior |
| --- | --- |
| Project path | `/jcode-mobile` returns `308` to `/jcode-mobile/`; anything outside the mount is `404` |
| Traversal | Decoded `..`, backslashes, NUL, dotfiles, and symlinks outside the root are refused |
| Directory | `/assets` redirects to `/assets/`; no directory listing; missing index is `404` |
| MIME | Explicit map for HTML, CSS, JS, JSON, SVG, images, fonts, video, PDF, APK, ZIP, WASM |
| HTML cache | `Cache-Control: no-cache` plus `ETag`/`Last-Modified` |
| Asset cache | `Cache-Control: public, max-age=3600` (configurable) |
| Conditional GET | `If-None-Match` and `If-Modified-Since` return `304` |
| Security | CSP (same-origin, no eval, no framing), `nosniff`, `DENY`, referrer policy, permissions policy, CORP |
| Methods | `OPTIONS`/`POST`/etc. return `405` with `Allow: GET, HEAD` |

`--hsts` adds `Strict-Transport-Security`; only use it behind HTTPS.

## Playwright matrix

`e2e/marketing/playwright.config.ts` starts its own isolated server on port
8093 under `/jcode-mobile/`. It does not touch the app staging daemon, the
adapter, production sessions, or port 8091.

| Project | Viewport | Coverage |
| --- | --- | --- |
| `site-320` | 320×720 | Layout overflow, headings, CTA, resources, scene keyboard, canvas, reduced motion, a11y/SEO |
| `site-390` | 390×844 | Same |
| `site-768` | 768×1024 | Same |
| `site-1440` | 1440×900 | Same |
| `no-js-390` | 390×844, JavaScript disabled | Readable fallback, CTA, nav, footer, no overflow |
| `server` | API request context | Headers, MIME, cache, 404, traversal, HEAD/304/405 |

Assertions include:

- no horizontal document/body overflow and a single visible `h1`
- visible heading hierarchy with no skipped levels
- exact v0.2.0 APK CTA and visible version text
- every internal anchor and local image resolves
- custom fonts load and all runtime requests stay inside `/jcode-mobile/`
- scene tabs are keyboard operable (`ArrowRight`, `Home`, `End`, `Enter`),
  expose one `aria-selected="true"` tab, update the tab panel, and show a
  visible focus indicator
- motion toggle pauses/resumes both orbit canvases via pointer and keyboard
- canvases pause when offscreen and when `visibilitychange` reports hidden
- `prefers-reduced-motion: reduce` removes long-running CSS animation and
  leaves both canvases paused
- no uncaught page errors or `console.error`
- no-JavaScript content remains readable and the APK CTA remains reachable
- basic semantics: one `main`, empty accessible names, image `alt`, broken ARIA
  references, `aria-hidden` focusables, `target="_blank"` hardening
- SEO basics: title, description, viewport, `og:type/title/description/image`,
  Twitter card, valid JSON-LD, and no invented absolute canonical origin

The canvas/background/reduced-motion checks are conditional only in the sense
that they require the site to expose `data-canvas-state` and the two canvas ids
agreed with the website worker. If the site adds no canvas, those specific
assertions should be removed with the feature, not silently skipped.

## Deploying

### Any static host

Publish the *contents* of `dist/marketing/`. There is no server-side rewrite
requirement, no build step on the host, and no runtime dependency outside that
directory.

Upload the whole directory, preserving `index.html` at the mount root. The
output is relative-path safe, so `https://host/`, `https://host/project/`, and
`https://user.github.io/repo/` all work without a base-path configuration.

### GitHub Pages, manually

`.github/workflows/marketing.yml` is `workflow_dispatch` only. It has no `push`
or `pull_request` trigger. A dispatch runs build + unit + Playwright checks and
uploads `dist/marketing` as an artifact. The deploy job exists only when both:

1. `publish` is `true`, and
2. `confirm` is exactly `DEPLOY`.

The deploy job uses `actions/configure-pages`, `upload-pages-artifact`, and
`deploy-pages` with `pages: write` and `id-token: write`. The repository owner
must enable Pages and choose GitHub Actions as the source. No workflow run has
been performed by the tooling work, and this document does not assert that a
Pages site is live.

For a project page, the site is served at `/<repo>/`; all URLs in the build are
relative, so no `basePath` setting is needed.

### Headers on GitHub Pages

GitHub Pages does not apply the local server's response headers. The local
server's CSP/security headers are therefore a verification aid, not a guarantee
for Pages. If those headers matter in production, front the site with a host
that supports custom headers, or add a `<meta http-equiv="Content-Security-Policy">`
through the website source. The build does not inject one, because that would
violate the verbatim-copy contract.

Do not add a canonical URL or `og:url` with a guessed domain. The build rejects
absolute canonical/`og:url` values unless they are local to the deployment
origin. When the real origin is known, change the website source deliberately.

## Failure modes and expectations

- `marketing source is missing index.html`: the website worker has not landed
  the source yet, or `--source` is wrong.
- `missing ... referenced by ...`: a path in HTML/CSS does not exist in the
  source tree case-sensitively. Fix the reference; do not add a server rewrite.
- `root-absolute URL ...`: replace leading `/` paths with relative paths.
- `remote ... in ...`: download the asset into `website/assets/` or remove the
  dependency. There is no CDN exception.
- `absolute canonical URL ...`: remove the guessed origin.
- Playwright cannot bind port 8093: set `MARKETING_E2E_PORT` to a free port; the
  config and server share it.
- Browser not installed: `bunx --bun playwright install chromium`. On rootless
  Debian/Ubuntu, follow the repository's `scripts/playwright-deps-linux.sh`
  path described in `AGENTS.md`.

## Boundaries

- The tooling never writes outside the repository unless
  `--allow-outside-repo` is passed. Unit tests use an isolated temporary
  repository root, so they exercise the safety checks without that override.
- It never cleans the website source, the repository root, `$HOME`, or `/`.
- It never starts the production daemon or adapter, and never touches the app
  staging directory or port 8091.
- It never publishes automatically. The Pages workflow is manual and gated.
