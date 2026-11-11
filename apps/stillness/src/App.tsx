import { useEffect, useSyncExternalStore } from 'react';
import { controller, type AppState } from './lib/controller';
import { sessionTitle } from './lib/format';
import { Torus } from './components/Torus';
import { ConnectionBanner, Drawer, Toast } from './components/ui';
import {
  IconActivity,
  IconList,
  IconMenu,
  IconPlus,
  IconSettings,
  IconServer,
} from './components/Icons';
import { PairingScreen, PairScreen, ReadyScreen, WelcomeScreen } from './screens/Onboarding';
import {
  ChangesScreen,
  HomeScreen,
  NewSessionScreen,
  ProjectCreateScreen,
  ProjectDetailScreen,
  ProjectsScreen,
  SessionsScreen,
  SettingsScreen,
} from './screens/Library';
import { BrowserScreen } from './screens/Browser';
import { ActivityScreen, PlanScreen, SessionScreen } from './screens/Session';

function ScreenRouter({ state }: { state: AppState }) {
  switch (state.screen) {
    case 'welcome':
    case 'pair':
    case 'pairing':
    case 'ready':
      return <HomeScreen state={state} />;
    case 'home':
      return <HomeScreen state={state} />;
    case 'sessions':
      return <SessionsScreen state={state} />;
    case 'session':
      return <SessionScreen state={state} />;
    case 'projects':
      return <ProjectsScreen state={state} />;
    case 'project':
      return <ProjectDetailScreen state={state} />;
    case 'project-create':
      return <ProjectCreateScreen state={state} />;
    case 'new-session':
      return <NewSessionScreen state={state} />;
    case 'browser':
      return <BrowserScreen state={state} />;
    case 'plan':
      return <PlanScreen state={state} />;
    case 'activity':
      return <ActivityScreen state={state} />;
    case 'changes':
      return <ChangesScreen state={state} />;
    case 'settings':
      return <SettingsScreen state={state} />;
    default:
      return <HomeScreen state={state} />;
  }
}

function Rail({ state }: { state: AppState }) {
  const nav: Array<{ screen: 'home' | 'sessions' | 'projects' | 'settings'; label: string; icon: React.ReactNode }> = [
    { screen: 'home', label: 'Home', icon: <Torus size={18} animated={false} /> },
    { screen: 'sessions', label: 'Sessions', icon: <IconList /> },
    { screen: 'projects', label: 'Projects', icon: <IconMenu /> },
    { screen: 'settings', label: 'Preferences', icon: <IconSettings /> },
  ];
  return (
    <aside className="rail" aria-label="Primary">
      <div className="rail-brand">
        <button className="brand-mark" onClick={() => controller.go('home')} aria-label="JCode home">
          <Torus size={26} animated />
          <span>
            jcode<span className="mark-slash">/</span>
          </span>
        </button>
        <button className="icon-btn" aria-label="New session" onClick={() => controller.go('new-session')}>
          <IconPlus size={18} />
        </button>
      </div>
      <nav className="rail-nav">
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
        <button
          aria-current={state.screen === 'activity' ? 'page' : undefined}
          onClick={() => controller.go('activity')}
        >
          <IconActivity /> Activity
        </button>
      </nav>
      <div className="rail-section">
        <span>Sessions</span>
        <button className="tiny-action" onClick={() => controller.go('sessions')}>All</button>
      </div>
      <div className="rail-recent">
        {state.sessions.slice(0, 12).map((session) => (
          <button
            key={session.session_id}
            className={`rail-session ${state.activeSessionId === session.session_id ? 'is-active' : ''}`}
            onClick={() => controller.openSession(session.session_id)}
          >
            <span>{sessionTitle(session)}</span>
            <small>{session.status}</small>
          </button>
        ))}
        {state.sessions.length === 0 ? <p className="inspector-empty">No sessions yet.</p> : null}
      </div>
      <div className="rail-foot">
        <IconServer size={16} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>{state.server?.name ?? 'JCode server'}</strong>
          <div>{state.connection.status} · v{state.server?.adapter_version ?? '0.3.0'}</div>
        </div>
        <span className={`status-mark ${state.jcodeConnected ? '' : 'is-active'}`} />
      </div>
    </aside>
  );
}

function Shell({ state }: { state: AppState }) {
  return (
    <div className={`app-shell screen-${state.screen}`}>
      <Rail state={state} />
      <div className="app-main">
        <ConnectionBanner state={state} />
        <ScreenRouter state={state} />
      </div>
      <Drawer state={state} />
      <Toast message={state.toast} />
    </div>
  );
}

function Splash() {
  return (
    <div className="onboarding" data-testid="app-loading">
      <main className="body-scroll">
        <div className="loading-page">
          <div className="loading-donut">
            <Torus size={132} animated />
          </div>
          <p className="onboard-overline">JCODE MOBILE</p>
          <h1 className="onboard-title-compact">Restoring Stillness.</h1>
          <p className="onboard-lede">Checking this phone for a saved server pairing.</p>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = state.theme === 'system' ? (media.matches ? 'dark' : 'light') : state.theme;
      document.documentElement.dataset.theme = resolved;
      const reduced =
        state.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
      document.documentElement.dataset.glass = state.glass ? 'on' : 'off';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [state.theme, state.motion, state.glass]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const apply = () => {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
      document.documentElement.style.setProperty(
        '--keyboard-inset',
        `${Math.max(0, window.innerHeight - height)}px`,
      );
    };
    apply();
    viewport?.addEventListener('resize', apply);
    viewport?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    return () => {
      viewport?.removeEventListener('resize', apply);
      viewport?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);

  if (state.phase === 'loading') return <Splash />;
  if (state.phase === 'unpaired') {
    return (
      <>
        {state.screen === 'pair' ? <PairScreen state={state} /> : <WelcomeScreen state={state} />}
        <Toast message={state.toast} />
      </>
    );
  }
  if (state.phase === 'ready') return <ReadyScreen state={state} />;
  if (state.phase === 'pairing') return <PairingScreen state={state} />;
  return <Shell state={state} />;
}
