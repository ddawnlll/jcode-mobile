/**
 * The v0.2.1 welcome is a character grid: a halftone torus, a contour field and
 * opening noise share one monospaced cell lattice. The web reference lives at
 * docs/v0.2.1 in the design branch; this is the React Native projection of the
 * same 1.6-second assembly, without a canvas or a per-frame image upload.
 */

export const ASCII_OPEN_MS = 1600;
export const ASCII_TURN_MS = 7800;
export const ASCII_FRAME_MS = 33;
export const ASCII_IDLE_FRAME_MS = 125;

const TAU = Math.PI * 2;
const GLYPHS = '.,:;-=+*#%@/[]{}01';
const CONTOUR = ['·', '.', ':', ';', '+', '/'] as const;
const RING = 72;
const TUBE = 36;
const ROW_ASPECT = 1.85;
const DITHER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

interface TorusPoint {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

function buildTorusPoints(): TorusPoint[] {
  const points: TorusPoint[] = [];
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
}

const POINTS = buildTorusPoints();

function scatter(col: number, row: number): number {
  let hash = Math.imul(col + 71, 374761393) ^ Math.imul(row + 113, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function noiseGlyph(seed: number, tick: number): string {
  const stride = 2 + Math.floor(seed * 4);
  return GLYPHS[(Math.floor(seed * 255) + tick * stride) % GLYPHS.length];
}

function shadeGlyph(shade: number): string {
  return GLYPHS[Math.min(GLYPHS.length - 1, Math.max(0, Math.floor((shade / 9) * (GLYPHS.length - 1))))];
}

export interface AsciiFrameInput {
  cols: number;
  rows: number;
  /** Milliseconds since the screen opened. */
  elapsedMs: number;
  tick: number;
  reducedMotion?: boolean;
}

/** One frame of the shared character grid. Pure: safe for tests and snapshots. */
export function asciiWelcomeFrame({ cols, rows, elapsedMs, tick, reducedMotion }: AsciiFrameInput): string[] {
  const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, elapsedMs / ASCII_OPEN_MS));
  const phase = reducedMotion ? 0.35 : ((elapsedMs % ASCII_TURN_MS) / ASCII_TURN_MS) * TAU;
  const cx = cols / 2;
  const cy = rows / 2;
  const radiusScale = Math.min(cols * 0.4, rows * 0.4 * ROW_ASPECT) / 1.69;

  const depth = new Float64Array(cols * rows);
  depth.fill(-Infinity);
  const shade = new Int8Array(cols * rows);
  shade.fill(-1);

  const pitch = 0.53 + 0.25 * Math.sin(phase + 0.22);
  const yaw = 0.29 * Math.cos(phase);
  const roll = phase - 0.44 + 0.12 * Math.sin(phase);
  const sx = Math.sin(pitch);
  const cxr = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cyr = Math.cos(yaw);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const m00 = cr * cyr;
  const m01 = cr * sy * sx - sr * cxr;
  const m02 = cr * sy * cxr + sr * sx;
  const m10 = sr * cyr;
  const m11 = sr * sy * sx + cr * cxr;
  const m12 = sr * sy * cxr - cr * sx;
  const m20 = -sy;
  const m21 = cyr * sx;
  const m22 = cyr * cxr;
  const lx = -0.46 * m00 - 0.57 * m10 + 0.68 * m20;
  const ly = -0.46 * m01 - 0.57 * m11 + 0.68 * m21;
  const lz = -0.46 * m02 - 0.57 * m12 + 0.68 * m22;

  for (const point of POINTS) {
    const zWorld = m20 * point.x + m21 * point.y + m22 * point.z;
    const scale = radiusScale / (1 - zWorld / 6.8);
    const px = cx + scale * (m00 * point.x + m01 * point.y + m02 * point.z);
    const py = cy + (scale * (m10 * point.x + m11 * point.y + m12 * point.z)) / ROW_ASPECT;
    const col = Math.floor(px);
    const row = Math.floor(py);
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
    const index = row * cols + col;
    if (zWorld <= depth[index]) continue;
    depth[index] = zWorld;
    const light = Math.max(
      0,
      lx * point.nx + ly * point.ny + lz * point.nz,
    );
    const halftone = DITHER[(((row + col) & 3) * 4) + ((row - col) & 3)] / 15;
    shade[index] = Math.min(9, Math.floor(0.7 + light * 8 + halftone * 1.4));
  }

  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let line = '';
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const seed = scatter(col, row);
      const u = (col + 0.5 - cx) / (cols * 0.5);
      const v = (row + 0.5 - cy) / (rows * 0.5);
      const distance = Math.min(1, Math.hypot(u * 0.63, v * 0.66));
      const settle = 0.14 + 0.51 * distance + 0.17 * seed;
      if (progress < settle) {
        line += seed > 0.2 ? noiseGlyph(seed, tick) : ' ';
        continue;
      }
      if (shade[index] >= 0) {
        line += shadeGlyph(shade[index]);
        continue;
      }
      const curl = Math.hypot(u + 0.19 * v + 0.1 * Math.sin(v * 3), v * 0.92);
      const ridge = Math.abs(Math.sin(22 * curl + 1.5 * Math.sin(u * 5 + v * 2)));
      if (ridge > 0.92 && seed > 0.7) {
        line += CONTOUR[Math.floor(seed * CONTOUR.length)] ?? '.';
        continue;
      }
      line += ' ';
    }
    lines.push(line);
  }
  return lines;
}
