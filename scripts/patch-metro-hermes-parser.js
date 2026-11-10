#!/usr/bin/env bun
/**
 * React Native 0.88.1 ships Flow sources that use `unknown`. The Hermes parser
 * bundled with Expo 58 (hermes-parser 0.25.1) rejects it, so the Release iOS
 * bundle fails in @expo/metro-config's transformSync before Babel can run.
 *
 * Babel (babel-preset-expo) parses these files correctly, including `unknown`.
 * Force the Babel path for non-TypeScript files. Idempotent and scoped to the
 * transform helper; no runtime code or app source is changed.
 */
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo',
  'node_modules',
  '@expo',
  'metro-config',
  'build',
  'transformSync.js',
);

if (!fs.existsSync(target)) {
  console.log('[patch-metro-hermes-parser] @expo/metro-config not installed; nothing to do');
  process.exit(0);
}

const source = fs.readFileSync(target, 'utf8');
const marker = '[patch-metro-hermes-parser]';
if (source.includes(marker)) {
  console.log('[patch-metro-hermes-parser] already patched');
  process.exit(0);
}

const before = "    (hermesParser || src.includes(' @flow'))) {";
const after = `    // ${marker} Babel handles Flow's \`unknown\`; hermes-parser 0.25.1 does not.
    (false && (hermesParser || src.includes(' @flow')))) {`;
if (!source.includes(before)) {
  console.error(
    '[patch-metro-hermes-parser] expected transform condition not found. ' +
      'Inspect @expo/metro-config transformSync.js after upgrading Expo.',
  );
  process.exit(1);
}
fs.writeFileSync(target, source.replace(before, after));
console.log('[patch-metro-hermes-parser] forced Babel parsing for Flow sources');
