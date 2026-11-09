import {
  ASCII_OPEN_MS,
  ASCII_OPEN_FRAME_MS,
  ASCII_IDLE_FRAME_MS,
  createAsciiScene,
  paintAscii,
} from '../asciiTorus';

const input = {
  width: 390,
  height: 844,
  artTop: 104,
  artHeight: 286,
  title: {
    lines: ['Welcome', 'to jcode.'],
    rect: { x: 24, y: 390, width: 330, height: 110 },
  },
};

function layerIds(paint: ReturnType<typeof paintAscii>): string[] {
  return paint.layers.map((entry) => entry.id);
}

describe('ascii welcome scene', () => {
  it('builds a stable character grid and a reusable field raster', () => {
    const scene = createAsciiScene(input);
    expect(scene.cols).toBeGreaterThan(40);
    expect(scene.rows).toBeGreaterThan(50);
    expect(scene.outsideField).toHaveLength(scene.rows);
    for (const line of scene.outsideField) expect(line).toHaveLength(scene.cols);
    expect(scene.donutStart).toBeGreaterThan(0);
    expect(scene.donutEnd).toBeGreaterThan(scene.donutStart);
    expect(scene.donutEnd).toBeLessThanOrEqual(scene.rows);
    expect(scene.titleMasked).toBe(true);
    expect(scene.typeCell.some((value) => value > 0)).toBe(true);
  });

  it('keeps every layer on the same fixed character grid', () => {
    const scene = createAsciiScene(input);
    for (const elapsed of [0, 320, 900, 1_200, ASCII_OPEN_MS, 4_000]) {
      const paint = paintAscii(scene, elapsed, 3);
      for (const layer of paint.layers) {
        expect(layer.lines.length).toBeGreaterThan(0);
        for (const line of layer.lines) expect(line).toHaveLength(scene.cols);
      }
    }
  });

  it('assembles from dense noise into the settled torus', () => {
    const scene = createAsciiScene(input);
    const opening = paintAscii(scene, 0, 0);
    const settled = paintAscii(scene, ASCII_OPEN_MS, 0);
    const filled = (paint: ReturnType<typeof paintAscii>) =>
      paint.layers
        .filter((entry) => entry.id !== 'type')
        .map((entry) => entry.lines.join(''))
        .join('')
        .replace(/ /g, '').length;

    expect(opening.opening).toBe(true);
    expect(opening.progress).toBe(0);
    expect(opening.typeOpacity).toBeGreaterThan(0);

    expect(settled.opening).toBe(false);
    expect(settled.progress).toBe(1);
    expect(settled.typeOpacity).toBe(0);
    expect(layerIds(settled)).not.toContain('type');
    expect(filled(settled)).toBeGreaterThan(0);
  });

  it('limits the idle turn to the torus band and reuses the outside field', () => {
    const scene = createAsciiScene(input);
    const first = paintAscii(scene, ASCII_OPEN_MS, 0);
    const second = paintAscii(scene, ASCII_OPEN_MS + 900, 4);
    const outside = first.layers.find((entry) => entry.id === 'field' && entry.top === 0);
    const outsideAgain = second.layers.find(
      (entry) => entry.id === 'field' && entry.top === 0,
    );
    expect(outside?.lines).toBe(outsideAgain?.lines);
    expect(outside?.lines).toEqual(scene.outsideField);

    const dynamic = second.layers.filter(
      (entry) => entry.top === scene.donutStart && entry.id !== 'field',
    );
    expect(dynamic.length).toBeGreaterThan(0);
    for (const entry of dynamic) {
      expect(entry.top).toBe(scene.donutStart);
      expect(entry.lines.length).toBeLessThanOrEqual(
        scene.donutEnd - scene.donutStart,
      );
    }
  });

  it('is deterministic and still for reduced motion', () => {
    const scene = createAsciiScene(input);
    const first = paintAscii(scene, 0, 2, true);
    const second = paintAscii(scene, 9_000, 77, true);
    expect(first).toEqual(second);
    expect(first.opening).toBe(false);
    expect(first.typeOpacity).toBe(0);
  });

  it('keeps opening and idle frame budgets under one second', () => {
    expect(ASCII_OPEN_FRAME_MS).toBeLessThan(ASCII_IDLE_FRAME_MS);
    expect(ASCII_OPEN_MS).toBe(1600);
  });
});
