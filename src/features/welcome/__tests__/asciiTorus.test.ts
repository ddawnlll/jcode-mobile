import { ASCII_OPEN_MS, asciiWelcomeFrame } from '../asciiTorus';

const base = { cols: 40, rows: 18, tick: 0 };

describe('asciiWelcomeFrame', () => {
  it('keeps one fixed character grid at every frame', () => {
    for (const elapsedMs of [0, 400, 900, ASCII_OPEN_MS, 3_200]) {
      const frame = asciiWelcomeFrame({ ...base, elapsedMs });
      expect(frame).toHaveLength(18);
      for (const line of frame) expect(line).toHaveLength(40);
    }
  });

  it('assembles from dense noise into the settled torus', () => {
    const opening = asciiWelcomeFrame({ ...base, elapsedMs: 0 });
    const settled = asciiWelcomeFrame({ ...base, elapsedMs: ASCII_OPEN_MS });
    const count = (frame: string[]) => frame.join('').replace(/ /g, '').length;
    expect(count(opening)).toBeGreaterThan(count(settled));
    expect(settled.join('')).not.toEqual(opening.join(''));
  });

  it('is deterministic and still for reduced motion', () => {
    const first = asciiWelcomeFrame({ ...base, elapsedMs: 0, reducedMotion: true });
    const second = asciiWelcomeFrame({ ...base, elapsedMs: 9_000, reducedMotion: true });
    expect(first).toEqual(second);
  });
});
