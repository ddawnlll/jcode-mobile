/**
 * The v0.2.1 welcome is one full-screen character grid: a halftone torus, a
 * contour field, opening noise and a bitmap title silhouette share the same
 * monospaced cell lattice. This module is the pure projection of the design
 * reference at `docs/v0.2.1/JCode_Mobile_ASCII_Welcome.html`.
 *
 * The native renderer draws the grid as a handful of overlapping monospaced
 * Text blocks instead of one Text node per character. That keeps the character
 * raster reusable: the field and title are rasterized once per layout, the
 * opening only recomputes visible glyph layers, and the idle turn redraws only
 * the rows that can contain the torus.
 */

export const ASCII_OPEN_MS = 1600;
export const ASCII_TURN_MS = 7800;
export const ASCII_OPEN_FRAME_MS = 32;
export const ASCII_IDLE_FRAME_MS = 80;

/** IBM Plex Mono advances at exactly 0.6 em. */
export const ASCII_MONO_ADVANCE = 0.6;

const TAU = Math.PI * 2;
const GLYPHS = '.,:;-=+*#%@/[]{}01';
const FIELD_GLYPHS = '.,:-+/';
const TYPE_GLYPHS = '.,:;-=+*#%@';
const RING = 120;
const TUBE = 56;
const ROW_ASPECT = 1.31;
const DITHER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

type Point = { x: number; y: number; z: number; nx: number; ny: number; nz: number };

export type AsciiLayerId =
  | 'field'
  | 'noise'
  | 'ringDim'
  | 'ringMid'
  | 'ringBright'
  | 'type';

export interface AsciiLayer {
  id: AsciiLayerId;
  /** First grid row in the block. */
  top: number;
  /** One string per grid row. Spaces are transparent cells. */
  lines: string[];
}

export interface AsciiPaint {
  opening: boolean;
  progress: number;
  /** Fades the bitmap title silhouette out as the real headline arrives. */
  typeOpacity: number;
  donutStart: number;
  donutEnd: number;
  layers: AsciiLayer[];
}

export interface AsciiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AsciiTitle {
  lines: string[];
  rect: AsciiRect;
}

export interface AsciiSceneInput {
  width: number;
  height: number;
  artTop: number;
  artHeight: number;
  title?: AsciiTitle | null;
}

export interface AsciiScene {
  key: string;
  width: number;
  height: number;
  artTop: number;
  artHeight: number;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  centerY: number;
  radiusScale: number;
  donutStart: number;
  donutEnd: number;
  titleMasked: boolean;
  /** Outside the torus reach. Blanks cover the idle redraw band. */
  outsideField: string[];
  fieldGlyph: Uint8Array;
  fieldShade: Uint8Array;
  typeCell: Uint8Array;
  seeds: Uint8Array;
  arrival: Float32Array;
  depth: Float32Array;
  shade: Int8Array;
}

const POINTS: Point[] = (() => {
  const points: Point[] = [];
  for (let ring = 0; ring < RING; ring += 1) {
    const around = (TAU * ring) / RING;
    const cosAround = Math.cos(around);
    const sinAround = Math.sin(around);
    for (let tube = 0; tube < TUBE; tube += 1) {
      const across = (TAU * (tube + (ring % 2) * 0.5)) / TUBE;
      const cosAcross = Math.cos(across);
      const sinAcross = Math.sin(across);
      const radius = 1.22 + 0.47 * cosAcross;
      points.push({
        x: radius * cosAround,
        y: radius * sinAround,
        z: 0.47 * sinAcross,
        nx: cosAcross * cosAround,
        ny: cosAcross * sinAround,
        nz: sinAcross,
      });
    }
  }
  return points;
})();

function scatter(col: number, row: number): number {
  let hash = Math.imul(col + 71, 374761393) ^ Math.imul(row + 113, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function ease(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function reveal(progress: number) {
  return {
    brand: ease(0.22, 0.48, progress),
    type: ease(0.65, 0.9, progress),
    actions: ease(0.64, 0.94, progress),
  };
}

function noiseGlyph(seed: number, tick: number): string {
  const stride = 2 + (seed & 3);
  return GLYPHS[(seed + tick * stride) % GLYPHS.length] ?? '.';
}

function ringGlyph(shade: number): string {
  return GLYPHS[Math.max(0, Math.min(GLYPHS.length - 1, shade))] ?? '.';
}

function fieldGlyphAt(index: number): string {
  return FIELD_GLYPHS[index] ?? '.';
}

/**
 * 5 x 7 bitmap glyphs for the title silhouette. The pattern is deliberately
 * small: it only needs to read as a type-shaped interruption in the field for
 * a fraction of the opening, then real selectable type replaces it.
 */
const BITMAP_GLYPHS: Record<string, readonly string[]> = {
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
  l: ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
  c: ['00000', '00000', '01110', '10000', '10000', '10000', '01110'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  m: ['00000', '00000', '11011', '10101', '10101', '10101', '10101'],
  t: ['00100', '00100', '11110', '00100', '00100', '00100', '00010'],
  j: ['00010', '00000', '00110', '00010', '00010', '10010', '01100'],
  d: ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function bitmapFor(char: string): readonly string[] | null {
  return BITMAP_GLYPHS[char] ?? BITMAP_GLYPHS[char.toLowerCase()] ?? null;
}

function paintBitmaps(
  scene: Pick<AsciiScene, 'cols' | 'rows' | 'originX' | 'originY' | 'cellW' | 'cellH' | 'typeCell'>,
  title: AsciiTitle,
): boolean {
  const { cols, rows, originX, originY, cellW, cellH, typeCell } = scene;
  if (!title.lines.length || title.rect.width < 8 || title.rect.height < 8) return false;
  const startCol = Math.round((title.rect.x - originX) / cellW);
  const startRow = Math.round((title.rect.y - originY) / cellH);
  const availableCols = Math.floor(title.rect.width / cellW);
  const lineRows = Math.max(
    8,
    Math.floor((title.rect.height / title.lines.length) / cellH),
  );
  const glyphRows = Math.min(7, Math.max(4, lineRows - 3));
  let painted = false;

  title.lines.forEach((line, lineIndex) => {
    const widthCells = Math.max(0, line.length * 6 - 1);
    if (!widthCells) return;
    const col0 = startCol + Math.max(0, Math.floor((availableCols - widthCells) / 2));
    const row0 =
      startRow +
      lineIndex * lineRows +
      Math.max(0, Math.floor((lineRows - glyphRows) / 2));
    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const pattern = bitmapFor(line[charIndex]);
      if (!pattern) continue;
      for (let patternRow = 0; patternRow < 7; patternRow += 1) {
        const targetRow =
          row0 + Math.floor((patternRow * glyphRows) / 7);
        if (targetRow < 0 || targetRow >= rows) continue;
        for (let patternCol = 0; patternCol < 5; patternCol += 1) {
          if (pattern[patternRow][patternCol] !== '1') continue;
          const targetCol = col0 + charIndex * 6 + patternCol;
          if (targetCol < 0 || targetCol >= cols) continue;
          typeCell[targetRow * cols + targetCol] = 1;
          painted = true;
        }
      }
    }
  });
  return painted;
}

/** Build the stable parts of the character grid for one layout. */
export function createAsciiScene(input: AsciiSceneInput): AsciiScene {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const artTop = Math.max(0, input.artTop);
  const artHeight = Math.max(1, input.artHeight);
  const cellW = Math.max(4.5, width / 67);
  const cellH = Math.ceil(cellW * ROW_ASPECT);
  const cols = Math.max(1, Math.floor(width / cellW));
  const rows = Math.max(1, Math.floor(height / cellH));
  const originX = (width - cols * cellW) / 2;
  const originY = (height - rows * cellH) / 2;
  const centerY = artTop + artHeight * 0.49;
  const radiusScale = Math.min(width * 0.386, artHeight * 0.378) / 1.69;
  const reach = radiusScale * 1.82 + cellH;
  const donutStart = Math.max(0, Math.floor((centerY - reach - originY) / cellH));
  const donutEnd = Math.min(rows, Math.ceil((centerY + reach - originY) / cellH));

  const size = cols * rows;
  const fieldGlyph = new Uint8Array(size);
  const fieldShade = new Uint8Array(size);
  const typeCell = new Uint8Array(size);
  const seeds = new Uint8Array(size);
  const arrival = new Float32Array(size);
  const depth = new Float32Array(size);
  const shade = new Int8Array(size);

  for (let row = 0; row < rows; row += 1) {
    const y = originY + (row + 0.5) * cellH;
    const hero = 1 - ease(0.37, 0.72, Math.abs(y - centerY) / artHeight);
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const x = originX + (col + 0.5) * cellW;
      const u = (x - width / 2) / (width * 0.5);
      const v = (y - centerY) / (width * 0.53);
      const curl = Math.hypot(u + 0.19 * v + 0.1 * Math.sin(v * 3), v * 0.92);
      const ridge = Math.abs(Math.sin(22 * curl + 1.5 * Math.sin(u * 5 + v * 2)));
      const seed = scatter(col, row);
      seeds[index] = Math.floor(seed * 255);
      const distance = Math.min(1, Math.hypot(u * 0.63, (y - centerY) / (height * 0.66)));
      arrival[index] = 0.14 + 0.51 * distance + 0.17 * seed;
      const fade = Math.min(x / 33, (width - x) / 33, y / 45, (height - y) / 52, 1);
      if (fade < 0.08 || (ridge > 0.21 && seed > 0.16)) continue;
      if (seed > fade * (0.05 + 0.87 * hero)) continue;
      fieldGlyph[index] = 1 + Math.floor(seed * FIELD_GLYPHS.length);
      fieldShade[index] =
        ridge < 0.21 && hero > 0.4 ? (seed > 0.61 ? 2 : 1) : 0;
    }
  }

  const scene: AsciiScene = {
    key: [width, height, artTop, artHeight, cols, rows, input.title?.rect.x, input.title?.rect.y, input.title?.rect.width, input.title?.rect.height, input.title?.lines.join('|')].join('/'),
    width,
    height,
    artTop,
    artHeight,
    cellW,
    cellH,
    cols,
    rows,
    originX,
    originY,
    centerY,
    radiusScale,
    donutStart,
    donutEnd,
    titleMasked: false,
    outsideField: [],
    fieldGlyph,
    fieldShade,
    typeCell,
    seeds,
    arrival,
    depth,
    shade,
  };

  if (input.title) scene.titleMasked = paintBitmaps(scene, input.title);

  // Rasterize the settled field once. The idle loop can reuse these strings and
  // blank the torus band without touching the rest of the screen.
  const outsideField: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    if (row >= donutStart && row < donutEnd) {
      outsideField.push(' '.repeat(cols));
      continue;
    }
    const chars = new Array<string>(cols).fill(' ');
    for (let col = 0; col < cols; col += 1) {
      const glyph = fieldGlyph[row * cols + col];
      if (glyph) chars[col] = fieldGlyphAt(glyph - 1);
    }
    outsideField.push(chars.join(''));
  }
  scene.outsideField = outsideField;

  return scene;
}

function project(scene: AsciiScene, phase: number): void {
  const { depth, shade } = scene;
  depth.fill(-Infinity);
  shade.fill(-1);
  const pitch = 0.53 + 0.25 * Math.sin(phase + 0.22);
  const yaw = 0.29 * Math.cos(phase);
  const roll = phase - 0.44 + 0.12 * Math.sin(phase);
  const sx = Math.sin(pitch);
  const cx = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const m00 = cr * cy;
  const m01 = cr * sy * sx - sr * cx;
  const m02 = cr * sy * cx + sr * sx;
  const m10 = sr * cy;
  const m11 = sr * sy * sx + cr * cx;
  const m12 = sr * sy * cx - cr * sx;
  const m20 = -sy;
  const m21 = cy * sx;
  const m22 = cy * cx;
  const lx = -0.46 * m00 - 0.57 * m10 + 0.68 * m20;
  const ly = -0.46 * m01 - 0.57 * m11 + 0.68 * m21;
  const lz = -0.46 * m02 - 0.57 * m12 + 0.68 * m22;

  for (const point of POINTS) {
    const zWorld = m20 * point.x + m21 * point.y + m22 * point.z;
    const scale = scene.radiusScale / (1 - zWorld / 6.8);
    const screenX =
      scene.width / 2 + scale * (m00 * point.x + m01 * point.y + m02 * point.z);
    const screenY =
      scene.centerY + scale * (m10 * point.x + m11 * point.y + m12 * point.z);
    const col = Math.floor((screenX - scene.originX) / scene.cellW);
    const row = Math.floor((screenY - scene.originY) / scene.cellH);
    if (col < 0 || col >= scene.cols || row < 0 || row >= scene.rows) continue;
    const index = row * scene.cols + col;
    if (zWorld <= depth[index]) continue;
    depth[index] = zWorld;
    const light = Math.max(
      0,
      lx * point.nx + ly * point.ny + lz * point.nz,
    );
    const halftone = DITHER[(((row + col) & 3) * 4) + ((row - col) & 3)] / 15;
    shade[index] = Math.min(
      10,
      Math.floor(0.7 + light * 9 + halftone * 1.6),
    );
  }
}

function blankRows(count: number, cols: number): string[] {
  return new Array<string>(count).fill(' '.repeat(cols));
}

function layer(id: AsciiLayerId, top: number, lines: string[]): AsciiLayer {
  return { id, top, lines };
}

const OPENING_IDS: AsciiLayerId[] = [
  'field',
  'noise',
  'ringDim',
  'ringMid',
  'ringBright',
  'type',
];

const DONUT_IDS: AsciiLayerId[] = ['field', 'ringDim', 'ringMid', 'ringBright'];

/**
 * One paint of the welcome. `tick` only changes the noise shimmer; the torus
 * phase is derived from `elapsedMs`, so the opening and the idle turn stay on
 * the same clock even when a frame is late.
 */
export function paintAscii(
  scene: AsciiScene,
  elapsedMs: number,
  tick: number,
  reducedMotion = false,
): AsciiPaint {
  const progress = reducedMotion
    ? 1
    : Math.min(1, Math.max(0, elapsedMs / ASCII_OPEN_MS));
  const opening = !reducedMotion && progress < 1;
  const phase = reducedMotion
    ? 0
    : ((elapsedMs % ASCII_TURN_MS) / ASCII_TURN_MS) * TAU;
  const show = reveal(progress);
  const typeOpacity = reducedMotion ? 0 : 1 - show.type;

  project(scene, phase);

  const { cols, rows, donutStart, donutEnd, depth, shade, seeds, arrival, fieldGlyph, typeCell } = scene;

  if (opening) {
    const fieldRows = blankRows(rows, cols);
    const noiseRows = blankRows(rows, cols);
    const typeRows = blankRows(rows, cols);
    const dimRows = blankRows(rows, cols);
    const midRows = blankRows(rows, cols);
    const brightRows = blankRows(rows, cols);
    const fieldChars = new Array<string>(cols);
    const noiseChars = new Array<string>(cols);
    const typeChars = new Array<string>(cols);
    const dimChars = new Array<string>(cols);
    const midChars = new Array<string>(cols);
    const brightChars = new Array<string>(cols);

    for (let row = 0; row < rows; row += 1) {
      fieldChars.fill(' ');
      noiseChars.fill(' ');
      typeChars.fill(' ');
      dimChars.fill(' ');
      midChars.fill(' ');
      brightChars.fill(' ');
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const seed = seeds[index];
        const seedUnit = seed / 255;
        const ring = depth[index] !== -Infinity;
        const letter = typeCell[index] > 0 && show.type < 1;
        const settle = letter
          ? 0.3 + 0.28 * (col / cols) + 0.11 * seedUnit
          : arrival[index] - (ring ? 0.04 : 0);
        if (progress < settle) {
          if (seed > 39) {
            const beat = (progress * ASCII_OPEN_MS + (seed & 63) * 0.85) / (108 + (seed & 31));
            const pulse = 1 - 0.26 * Math.abs(2 * (beat - Math.floor(beat)) - 1);
            if (pulse > 0.45) noiseChars[col] = noiseGlyph(seed, tick);
          }
          continue;
        }
        if (letter) {
          typeChars[col] = TYPE_GLYPHS[5 + (seed % 5)] ?? '.';
        } else if (ring) {
          const value = shade[index];
          const glyph = ringGlyph(value);
          if (value >= 7) brightChars[col] = glyph;
          else if (value >= 4) midChars[col] = glyph;
          else dimChars[col] = glyph;
        } else if (fieldGlyph[index]) {
          fieldChars[col] = fieldGlyphAt(fieldGlyph[index] - 1);
        }
      }
      fieldRows[row] = fieldChars.join('');
      noiseRows[row] = noiseChars.join('');
      typeRows[row] = typeChars.join('');
      dimRows[row] = dimChars.join('');
      midRows[row] = midChars.join('');
      brightRows[row] = brightChars.join('');
    }

    const layers: AsciiLayer[] = [
      layer('field', 0, fieldRows),
      layer('noise', 0, noiseRows),
    ];
    if (midRows.some((line) => line.trim())) layers.push(layer('ringMid', 0, midRows));
    if (dimRows.some((line) => line.trim())) layers.push(layer('ringDim', 0, dimRows));
    if (brightRows.some((line) => line.trim())) {
      layers.push(layer('ringBright', 0, brightRows));
    }
    if (typeOpacity > 0.01 && typeRows.some((line) => line.trim())) {
      layers.push(layer('type', 0, typeRows));
    }
    return {
      opening: true,
      progress,
      typeOpacity,
      donutStart,
      donutEnd,
      layers,
    };
  }

  // Settled: the field outside the torus band is reused verbatim. Only the
  // donut band is recomputed, which is the bounded idle redraw.
  const rowCount = Math.max(0, donutEnd - donutStart);
  const fieldRows = blankRows(rowCount, cols);
  const dimRows = blankRows(rowCount, cols);
  const midRows = blankRows(rowCount, cols);
  const brightRows = blankRows(rowCount, cols);
  const fieldChars = new Array<string>(cols);
  const dimChars = new Array<string>(cols);
  const midChars = new Array<string>(cols);
  const brightChars = new Array<string>(cols);

  for (let localRow = 0; localRow < rowCount; localRow += 1) {
    const row = donutStart + localRow;
    fieldChars.fill(' ');
    dimChars.fill(' ');
    midChars.fill(' ');
    brightChars.fill(' ');
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      if (depth[index] !== -Infinity) {
        const value = shade[index];
        const glyph = ringGlyph(value);
        if (value >= 7) brightChars[col] = glyph;
        else if (value >= 4) midChars[col] = glyph;
        else dimChars[col] = glyph;
      } else if (fieldGlyph[index]) {
        fieldChars[col] = fieldGlyphAt(fieldGlyph[index] - 1);
      }
    }
    fieldRows[localRow] = fieldChars.join('');
    dimRows[localRow] = dimChars.join('');
    midRows[localRow] = midChars.join('');
    brightRows[localRow] = brightChars.join('');
  }

  const layers: AsciiLayer[] = [layer('field', 0, scene.outsideField)];
  if (rowCount > 0) {
    layers.push(layer('field', donutStart, fieldRows));
    if (dimRows.some((line) => line.trim())) layers.push(layer('ringDim', donutStart, dimRows));
    if (midRows.some((line) => line.trim())) layers.push(layer('ringMid', donutStart, midRows));
    if (brightRows.some((line) => line.trim())) {
      layers.push(layer('ringBright', donutStart, brightRows));
    }
  }
  return {
    opening: false,
    progress: 1,
    typeOpacity: 0,
    donutStart,
    donutEnd,
    layers,
  };
}

/** The opening layer ids in paint order. Kept for tests and debugging. */
export const ASCII_OPENING_LAYERS = OPENING_IDS;
export const ASCII_DONUT_LAYERS = DONUT_IDS;
