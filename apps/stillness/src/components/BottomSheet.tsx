/**
 * Draggable bottom sheet.
 *
 * Mounted only while open. It enters and leaves with the shared spring, tracks
 * a grab-handle drag 1:1, dismisses on velocity or distance, snaps back
 * otherwise, traps Tab, restores focus, and never eats Escape from a text
 * field without closing first.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconClose } from './Icons';
import { useAxisDrag, useBackGuard } from './gestures';
import { clamp, resistance, spring, SPRING } from './motion';

export function BottomSheet({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const yRef = useRef(0);
  const heightRef = useRef(480);
  const startYRef = useRef(0);
  const springRef = useRef<ReturnType<typeof spring> | null>(null);
  const closingRef = useRef(false);
  const openedAtRef = useRef(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();

  const paint = (y: number) => {
    yRef.current = y;
    const element = sheetRef.current;
    if (element) {
      const centered = window.innerWidth >= 601;
      element.style.transform = centered
        ? `translate(-50%, ${y}px)`
        : `translateY(${y}px)`;
    }
    const scrim = scrimRef.current;
    if (scrim) {
      const progress = clamp(1 - y / Math.max(1, heightRef.current), 0, 1);
      scrim.style.opacity = String(progress);
      scrim.style.pointerEvents = progress > 0.05 ? 'auto' : 'none';
    }
  };

  const animateTo = (target: number, velocity = 0, done?: () => void) => {
    springRef.current?.cancel();
    springRef.current = spring(yRef.current, target, {
      ...SPRING.sheet,
      velocity,
      onFrame: paint,
      onRest: (value) => {
        paint(value);
        done?.();
      },
    });
  };

  const dismiss = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    // A deliberate dismiss is faster than a drag release.
    animateTo(heightRef.current, 1.2, () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onClose();
    });
  };

  useBackGuard(true, dismiss, `sheet:${title}`);

  useLayoutEffect(() => {
    const element = sheetRef.current;
    openedAtRef.current = Date.now();
    heightRef.current = element?.offsetHeight || 480;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    paint(heightRef.current);
    animateTo(0);
    const focusTimer = window.setTimeout(() => {
      const firstField = element?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), [data-autofocus]',
      );
      (firstField ?? element)?.focus({ preventScroll: true });
    }, 30);
    return () => {
      window.clearTimeout(focusTimer);
      springRef.current?.cancel();
      const previous = previousFocus.current;
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // The sheet is mounted once per open; entry animation is intentionally so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => {
      heightRef.current = sheetRef.current?.offsetHeight || heightRef.current;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const drag = useAxisDrag({
    axis: 'y',
    threshold: 4,
    shouldStart: () => !closingRef.current,
    onStart: () => {
      springRef.current?.cancel();
      heightRef.current = sheetRef.current?.offsetHeight || heightRef.current;
      startYRef.current = yRef.current;
      setDragging(true);
    },
    onMove: (info) => {
      const raw = startYRef.current + info.dy;
      paint(raw < 0 ? resistance(raw, heightRef.current, 1.2) : raw);
    },
    onEnd: (info) => {
      setDragging(false);
      if (yRef.current > heightRef.current * 0.22 || info.vy > 0.5) {
        dismiss();
      } else {
        animateTo(0, info.vy);
      }
    },
    onCancel: () => {
      setDragging(false);
      animateTo(0);
    },
  });

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const element = sheetRef.current;
    if (!element) return;
    const focusable = Array.from(
      element.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((item) => item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={scrimRef}
      className="modal-scrim open"
      style={{ opacity: 0, pointerEvents: 'none' }}
      onClick={() => {
        // The tap that opened a sheet (long press, row action) can land on the
        // scrim a few milliseconds later. It is not a dismissal intent.
        if (Date.now() - openedAtRef.current < 300) return;
        dismiss();
      }}
      data-testid={testId ? `${testId}-scrim` : undefined}
    >
      <div
        ref={sheetRef}
        className={`modal open ${dragging ? 'is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
        data-testid={testId}
      >
        <div className="grab" {...drag} aria-hidden="true" />
        <header className="overlay-header sheet-drag-zone" {...drag}>
          <div className="overlay-title" id={titleId}>
            {title}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={dismiss}>
            <IconClose />
          </button>
        </header>
        <div className="overlay-body">{children}</div>
      </div>
    </div>
  );
}
