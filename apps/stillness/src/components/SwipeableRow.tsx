/**
 * A single swipeable list row.
 *
 * Content follows the finger 1:1, resists past either tray boundary, snaps
 * with velocity, and registers itself so only one row stays open. Vertical
 * movement is never claimed, so list scrolling still works.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAxisDrag, requestSwipeRow, releaseSwipeRow, useBackGuard } from './gestures';
import { haptic, resistance, spring, SPRING } from './motion';

export const LEFT_TRAY = 158;
export const RIGHT_TRAY = 88;

export interface SwipeAction {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: 'default' | 'accent' | 'danger';
  onAction: () => void;
}

export function SwipeableRow({
  id,
  leftActions,
  rightActions,
  children,
  onLongPress,
}: {
  id: string;
  /** Revealed by swiping left (tray sits at the right edge). */
  leftActions: SwipeAction[];
  /** Revealed by swiping right (tray sits at the left edge). */
  rightActions: SwipeAction[];
  children: ReactNode;
  onLongPress?: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const springRef = useRef<ReturnType<typeof spring> | null>(null);
  const startRef = useRef(0);
  const openRef = useRef<'none' | 'left' | 'right'>('none');
  const [open, setOpen] = useState<'none' | 'left' | 'right'>('none');
  const leftWidth = leftActions.length ? LEFT_TRAY : 0;
  const rightWidth = rightActions.length ? RIGHT_TRAY : 0;

  const paint = (offset: number) => {
    offsetRef.current = offset;
    const element = contentRef.current;
    if (element) element.style.transform = `translate3d(${offset}px,0,0)`;
  };

  const settle = (target: number, velocity = 0) => {
    springRef.current?.cancel();
    springRef.current = spring(offsetRef.current, target, {
      ...SPRING.row,
      velocity,
      onFrame: paint,
      onRest: (value) => paint(value),
    });
  };

  const applyOpen = (next: 'none' | 'left' | 'right') => {
    openRef.current = next;
    setOpen(next);
    if (next === 'none') releaseSwipeRow(id);
    else
      requestSwipeRow(id, () => {
        applyOpen('none');
        settle(0);
      });
  };

  const close = (animated = true) => {
    if (openRef.current === 'none' && offsetRef.current === 0) return;
    applyOpen('none');
    if (animated) settle(0);
    else paint(0);
  };

  useBackGuard(open !== 'none', () => close(), `swipe-row:${id}`);

  useEffect(() => {
    return () => {
      springRef.current?.cancel();
      releaseSwipeRow(id);
    };
  }, [id]);

  const drag = useAxisDrag({
    axis: 'x',
    threshold: 9,
    shouldStart: (event) => {
      const target = event.target as HTMLElement | null;
      return !target?.closest('input, textarea, select, a');
    },
    onStart: () => {
      springRef.current?.cancel();
      startRef.current = offsetRef.current;
    },
    onMove: (info) => {
      const raw = startRef.current + info.dx;
      let next = raw;
      if (raw > rightWidth) next = rightWidth + resistance(raw - rightWidth, RIGHT_TRAY);
      if (raw < -leftWidth) next = -leftWidth - resistance(-raw - leftWidth, LEFT_TRAY);
      paint(next);
    },
    onEnd: (info) => {
      const offset = offsetRef.current;
      const velocity = info.vx;
      if (offset <= -leftWidth * 0.4 || velocity < -0.5) {
        applyOpen('left');
        haptic('snap');
        settle(-leftWidth, velocity);
      } else if (offset >= rightWidth * 0.4 || velocity > 0.5) {
        applyOpen('right');
        haptic('snap');
        settle(rightWidth, velocity);
      } else {
        close(true);
      }
    },
    onCancel: () => close(true),
    onLongPress,
    longPressMs: 480,
  });

  const runAction = (action: SwipeAction) => {
    close(true);
    window.setTimeout(action.onAction, 40);
  };

  return (
    <div className="swipe-row" data-open={open}>
      <div className="swipe-tray swipe-tray-left" aria-hidden={open !== 'left'}>
        {leftActions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`swipe-action ${action.tone ?? 'default'}`}
            tabIndex={open === 'left' ? 0 : -1}
            aria-label={action.label}
            onClick={() => runAction(action)}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <div className="swipe-tray swipe-tray-right" aria-hidden={open !== 'right'}>
        {rightActions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={`swipe-action ${action.tone ?? 'default'}`}
            tabIndex={open === 'right' ? 0 : -1}
            aria-label={action.label}
            onClick={() => runAction(action)}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={contentRef}
        className="swipe-content"
        {...drag}
        onClickCapture={(event) => {
          if (openRef.current === 'none') return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        {children}
      </div>
    </div>
  );
}
