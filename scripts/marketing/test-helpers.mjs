import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fixture mobile</title>
  <meta name="description" content="Fixture description for the marketing build and server tests.">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1 id="top">Fixture mobile</h1>
    <p>Static tooling fixture. No product copy lives here.</p>
    <a id="download-apk" href="https://github.com/ddawnlll/jcode-mobile/releases/download/v0.2.0/jcode-mobile-0.2.0-android-release.apk">Download 0.2.0 APK</a>
    <img src="assets/pixel.png" alt="">
    <a href="#top">Back to top</a>
  </main>
  <script src="main.js" defer></script>
</body>
</html>
`;

export const FIXTURE_CSS = `@font-face {
  font-family: "Fixture";
  src: url("assets/font.ttf") format("truetype");
}

body {
  font-family: "Fixture", sans-serif;
  background-image: url("assets/pixel.png");
}
`;

export async function createSiteFixture({ html = FIXTURE_HTML, css = FIXTURE_CSS } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jcode-marketing-'));
  const source = join(root, 'website');
  await mkdir(join(source, 'assets'), { recursive: true });
  await writeFile(join(source, 'index.html'), html, 'utf8');
  await writeFile(join(source, 'styles.css'), css, 'utf8');
  await writeFile(join(source, 'main.js'), 'document.documentElement.dataset.fixture = "ready";\n', 'utf8');
  await writeFile(join(source, 'assets', 'font.ttf'), new Uint8Array([0x00, 0x01, 0x00, 0x00]));
  await writeFile(join(source, 'assets', 'pixel.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'marketing-fixture', version: '9.9.9' }), 'utf8');
  return { root, source, out: join(root, 'dist') };
}
