import { useMemo } from 'react';

interface TorusProps {
  size?: number;
  animated?: boolean;
  className?: string;
  label?: string;
}

interface Dot {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

/**
 * A halftone donut built from real dots, not a gradient badge. The reference's
 * mark is a dot field; generating it in one SVG keeps the same visual language
 * without shipping a 1000-line symbol.
 */
function dots(): Dot[] {
  const rings = [
    { radius: 15.5, count: 26, base: 0.5 },
    { radius: 19.2, count: 34, base: 0.72 },
    { radius: 23.2, count: 42, base: 0.9 },
    { radius: 27.4, count: 50, base: 1.0 },
    { radius: 31.4, count: 58, base: 0.94 },
    { radius: 35.2, count: 64, base: 0.82 },
    { radius: 39.0, count: 70, base: 0.64 },
    { radius: 42.2, count: 74, base: 0.44 },
  ];
  const result: Dot[] = [];
  let ringIndex = 0;
  for (const ring of rings) {
    for (let index = 0; index < ring.count; index += 1) {
      const angle = (index / ring.count) * Math.PI * 2 + (ringIndex % 2) * 0.045;
      const wobble =
        Math.sin(angle * 3.0 + ringIndex * 0.7) * 0.22 +
        Math.cos(angle * 5.0 - ringIndex * 0.35) * 0.14;
      const radius = ring.radius + wobble * 2.2;
      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;
      result.push({
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        r: Number((ring.base + wobble * 0.12).toFixed(2)),
        opacity: Number((0.72 + ring.base * 0.26).toFixed(2)),
      });
    }
    ringIndex += 1;
  }
  return result;
}

const generated = dots();

export function Torus({ size = 88, animated = true, className = '', label }: TorusProps) {
  const content = useMemo(() => generated, []);
  return (
    <svg
      className={`torus ${animated ? 'torus-live' : ''} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g fill="currentColor" stroke="none">
        {content.map((dot, index) => (
          <circle
            key={index}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            opacity={dot.opacity}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
