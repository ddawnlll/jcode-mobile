/**
 * Edge-swipe drawer.
 *
 * The drawer tracks the finger 1:1 from the left edge, rubber-bands past its
 * boundaries, and settles with a velocity-aware spring that can be interrupted
 * by another grab at any time. The scrim opacity follows the same value.
 */
import { useEffect, useRef, useState } from 'react';
import { controller, type AppState, type Screen } from '../lib/controller';
import { relativeTime, sessionTitle } from '../lib/format';
import { IconClose, IconList, IconMenu, IconMore } from './Icons';
import { Torus } from './Torus';
import { useAxisDrag, useBackGuard } from './gestures';
import { clamp, resistance, spring, SPRING } from './motion';
import { useSessionPrefs, visibleSessions } from '../lib/sessionPrefs';

const SAFE_WIDTH = 310;

export function Drawer({ state }: { state: AppState }) {
  const drawerRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const springRef = useRef<ReturnType<typeof spring> | null>(null);
  const xRef = useRef(-SAFE_WIDTH);
  const widthRef = useRef(SAFE_WIDTH);
  const dragStartRef = useRef(0);
  const releaseVelocityRef = useRef(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const prefs = useSessionPrefs(state.credential?.serverId ?? null);
  const online = state.connection.status === 'connected';
  const open = state.drawerOpen;
  const visible = open || dragging;

  useBackGuard(open, () => controller.openDrawer(false), 'drawer');

  const paint = (x: number) => {
    xRef.current = x;
    const width = widthRef.current || SAFE_WIDTH;
    const element = drawerRef.current;
    if (element) {
      element.style.transform = `translate3d(${x}px,0,0)`;
      element.style.visibility = x > -width + 0.5 ? 'visible' : 'hidden';
    }
    const scrim = scrimRef.current;
    if (scrim) {
      const progress = clamp(1 + x / width, 0, 1);
      scrim.style.opacity = String(progress);
      scrim.style.pointerEvents = progress > 0.02 ? 'auto' : 'none';
    }
  };

  const animateTo = (target: number, velocity = 0, restoreFocus = false) => {
    springRef.current?.cancel();
    springRef.current = spring(xRef.current, target, {
      ...SPRING.drawer,
      velocity,
      onFrame: paint,
      onRest: (value) => {
        paint(value);
        if (value <= -(widthRef.current || SAFE_WIDTH) + 0.5) {
          const element = drawerRef.current;
          if (element) element.style.visibility = 'hidden';
          if (restoreFocus) {
            const target = previousFocus.current;
            previousFocus.current = null;
            if (target && document.contains(target)) target.focus({ preventScroll: true });
          }
        }
      },
    });
  };

  useEffect(() => {
    const element = drawerRef.current;
    if (!element) return;
    widthRef.current = element.offsetWidth || Math.min(SAFE_WIDTH, window.innerWidth * 0.86);
    if (open) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.style.visibility = 'visible';
      window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 40);
    }
    const velocity = releaseVelocityRef.current;
    releaseVelocityRef.current = 0;
    animateTo(open ? 0 : -widthRef.current, velocity, !open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    paint(-(drawerRef.current?.offsetWidth || SAFE_WIDTH));
    return () => springRef.current?.cancel();
  }, []);

  const drawerDrag = useAxisDrag({
    axis: 'x',
    threshold: 8,
    shouldStart: (event) => {
      const target = event.target as HTMLElement | null;
      return !target?.closest('input, textarea, select, a');
    },
    onStart: () => {
      springRef.current?.cancel();
      dragStartRef.current = xRef.current;
      setDragging(true);
    },
    onMove: (info) => {
      const raw = dragStartRef.current + info.dx;
      const width = widthRef.current;
      let next = raw;
      if (raw > 0) next = resistance(raw, width, 1.1);
      if (raw < -width) next = -width - resistance(-raw - width, width, 1.1);
      paint(next);
    },
    onEnd: (info) => {
      setDragging(false);
      const width = widthRef.current;
      const shouldOpen = xRef.current > -width * 0.5 || info.vx > 0.55;
      releaseVelocityRef.current = info.vx;
      if (shouldOpen === open) animateTo(shouldOpen ? 0 : -width, info.vx, !shouldOpen);
      else controller.openDrawer(shouldOpen);
    },
    onCancel: () => {
      setDragging(false);
      animateTo(open ? 0 : -widthRef.current);
    },
  });

  const edgeDrag = useAxisDrag({
    axis: 'x',
    threshold: 4,
    shouldStart: () => !open,
    onStart: () => {
      springRef.current?.cancel();
      widthRef.current = drawerRef.current?.offsetWidth || widthRef.current;
      dragStartRef.current = -widthRef.current;
      setDragging(true);
    },
    onMove: (info) => {
      const width = widthRef.current;
      const raw = -width + info.dx;
      let next = raw;
      if (raw > 0) next = resistance(raw, width, 1.1);
      paint(clamp(next, -width, width * 0.12));
    },
    onEnd: (info) => {
      setDragging(false);
      const width = widthRef.current;
      const shouldOpen = xRef.current > -width * 0.45 || info.vx > 0.4;
      releaseVelocityRef.current = info.vx;
      if (shouldOpen) controller.openDrawer(true);
      else animateTo(-width, info.vx);
    },
    onCancel: () => {
      setDragging(false);
      animateTo(-widthRef.current);
    },
  });

  const trapTab = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !open) return;
    const element = drawerRef.current;
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

  const recent = visibleSessions(state.sessions, prefs, online).slice(0, 6);
  const nav: Array<{ screen: Screen; label: string; icon: React.ReactNode }> = [
    { screen: 'home', label: 'Home', icon: <Torus size={20} animated={false} /> },
    { screen: 'sessions', label: 'Sessions', icon: <IconList /> },
    { screen: 'projects', label: 'Projects', icon: <IconMenu /> },
    { screen: 'plan', label: 'Plan', icon: <IconMore /> },
    { screen: 'activity', label: 'Activity', icon: <IconMore /> },
    { screen: 'changes', label: 'Changes', icon: <IconMore /> },
    { screen: 'settings', label: 'Settings', icon: <IconMore /> },
  ];

  return (
    <>
      <div
        ref={scrimRef}
        className={`drawer-scrim ${visible ? 'open' : ''}`}
        style={{ opacity: 0, pointerEvents: 'none' }}
        onClick={() => controller.openDrawer(false)}
        aria-hidden={!open}
      />
      <aside
        ref={drawerRef}
        className={`drawer ${open ? 'open' : ''} ${dragging ? 'is-dragging' : ''}`}
        aria-label="Sidebar"
        aria-hidden={!open}
        {...drawerDrag}
        onKeyDown={trapTab}
      >
        <div className="drawer-top">
          <div className="drawer-brand">
            <span className="mark">
              jcode<span className="mark-slash">/</span>
            </span>
          </div>
          <button
            ref={closeRef}
            className="icon-btn"
            aria-label="Close sidebar"
            onClick={() => controller.openDrawer(false)}
          >
            <IconClose />
          </button>
        </div>
        <div className="drawer-body">
          <p className="drawer-sub">
            {state.server?.name ?? 'JCode Mobile'} · {state.server?.healthy ? 'harness online' : 'harness offline'}
          </p>
          <nav className="drawer-nav">
            {nav.map((item) => (
              <button
                key={item.screen}
                aria-current={state.screen === item.screen ? 'page' : undefined}
                onClick={() => controller.go(item.screen)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="drawer-recent">
            <h2>Recent sessions</h2>
            {recent.length === 0 ? <p className="drawer-empty">No sessions yet.</p> : null}
            {recent.map((session) => (
              <button
                key={session.session_id}
                className="drawer-thread"
                onClick={() => controller.openSession(session.session_id)}
              >
                {sessionTitle(session)}
                <small>{relativeTime(session.updated_at_ms)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-foot">
          <button onClick={() => controller.go('settings')}>
            <Torus size={18} animated={false} /> Preferences
          </button>
          <span className="preview">v0.4.0</span>
        </div>
      </aside>
      {!open ? (
        <div
          className="gesture-edge"
          aria-hidden="true"
          data-testid="drawer-edge"
          {...edgeDrag}
          onClick={() => controller.openDrawer(true)}
        />
      ) : null}
    </>
  );
}
