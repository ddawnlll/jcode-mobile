#!/usr/bin/env node
/**
 * Verify the committed marketing media without opening a browser.
 *
 * Checks the GIF frame count, dimensions, delay, loop, and size, plus the
 * dimensions of the poster, hero, and v0.2.0 captures. Requires ImageMagick.
 *
 * Usage:
 *   node scripts/marketing-media/verify-media.mjs
 */
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.env.MEDIA_DIR ?? 'docs/media/marketing');
const GIF = join(DIR, 'welcome-preview.gif');
const IMAGE_EXPECTATIONS = {
  'welcome-poster.png': [780, 1688],
  'readme-hero.png': [3200, 1800],
  'sessions-v020.png': [860, 1800],
  'conversation-v020.png': [860, 1800],
  'work-v020.png': [860, 1800],
  'connect-v020.png': [860, 1800],
};

function magick(args) {
  return execFileSync('magick', args, { encoding: 'utf8' }).trim();
}

const gifBytes = readFileSync(GIF);

// The optimized GIF uses sub-rectangles for changed pixels. The logical screen
// size lives in the GIF header, and the loop count lives in the NETSCAPE
// application extension. ImageMagick's %wx%h reports each sub-rectangle.
const logicalWidth = gifBytes.readUInt16LE(6);
const logicalHeight = gifBytes.readUInt16LE(8);
const netscape = gifBytes.indexOf(Buffer.from('NETSCAPE2.0', 'ascii'));
const loopCount =
  netscape >= 0 && gifBytes[netscape + 11] === 0x03 && gifBytes[netscape + 12] === 0x01
    ? gifBytes.readUInt16LE(netscape + 13)
    : null;

const gifFrames = magick([
  'identify',
  '-format',
  '%s %T\n',
  GIF,
])
  .split('\n')
  .filter(Boolean);

const delays = new Set(gifFrames.map((line) => line.split(' ')[1]));
const firstMean = Number(
  magick([
    'identify',
    '-format',
    '%[fx:mean]',
    `${GIF}[0]`,
  ]),
);
const size = statSync(GIF).size;

const report = {
  gif: {
    path: GIF,
    bytes: size,
    frames: gifFrames.length,
    logicalScreen: `${logicalWidth}x${logicalHeight}`,
    delayCentiseconds: [...delays],
    loopCount,
    firstFrameMean: Number(firstMean.toFixed(4)),
  },
  images: {},
};

const problems = [];
if (gifFrames.length !== 60) problems.push(`expected 60 GIF frames, found ${gifFrames.length}`);
if (logicalWidth !== 240 || logicalHeight !== 519) {
  problems.push(`expected a 240x519 logical screen, found ${logicalWidth}x${logicalHeight}`);
}
if (delays.size !== 1 || [...delays][0] !== '5') {
  problems.push(`expected 5cs (20 fps) delays, found ${[...delays].join(', ')}`);
}
if (loopCount !== 0) problems.push(`expected infinite loop (0), found ${loopCount}`);
if (firstMean <= 0.03) problems.push('first GIF frame looks blank');
if (size > 3 * 1024 * 1024) problems.push('GIF exceeds the 3 MiB hard budget');
if (size > 1.5 * 1024 * 1024) {
  report.note = 'GIF is under the 3 MiB hard budget but above the 1.5 MiB ideal.';
}

for (const [name, [width, height]] of Object.entries(IMAGE_EXPECTATIONS)) {
  const path = join(DIR, name);
  const actual = magick(['identify', '-format', '%wx%h', path]);
  const bytes = statSync(path).size;
  report.images[name] = { dimensions: actual, bytes };
  if (actual !== `${width}x${height}`) {
    problems.push(`${name}: expected ${width}x${height}, found ${actual}`);
  }
}

console.log(JSON.stringify(report, null, 2));
if (problems.length > 0) {
  console.error(`media verification failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('media verification passed');
