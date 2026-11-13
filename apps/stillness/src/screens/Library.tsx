import { useEffect, useMemo, useState } from 'react';
import { controller, type AppState } from '../lib/controller';
import { IconChevron, IconPlus, IconSearch } from '../components/Icons';
import { Torus } from '../components/Torus';
import { ConnectionBanner, EmptyState, ScreenHeader, SessionRow, SavedTag, useDocumentTitle } from '../components/ui';
import { sessionTitle, isRunning } from '../lib/format';
import { credentialStorageKind } from '../lib/credentials';

export function HomeScreen({ state }: { state: AppState }) {
  const [paused, setPaused] = useState(false);
  useDocumentTitle('Home');
  const running = state.sessions.filter((session) => isRunning(session.status));
  const recent = state.sessions.slice(0, 5);
  const projects = state.projects.slice(0, 5);
  return (
    <div className="screen" data-testid="home-screen">
      <ScreenHeader
        title="JCode"
        subtitle={<span>{state.server?.healthy ? 'Harness online' : 'Harness unavailable'}</span>}
        menu
        right={
          <>
            <button className="icon-btn" aria-label="Sessions" onClick={() => controller.go('sessions')}>
              <IconSearch />
            </button>
            <button className="icon-btn" aria-label="Create session" onClick={() => controller.go('new-session')} data-testid="new-session-button">
              <IconPlus />
            </button>
          </>
        }
      />
      <ConnectionBanner state={state} />
      <main className="body-scroll">
        <div className="view-content home-intro">
          <div className="home-brand">
            <div className="home-brand-copy">
              <p className="quiet-eyebrow">STILLNESS / REAL SESSIONS</p>
              <h1 className="page-heading">Your work.</h1>
              <p className="page-sub">Pick up where you left off.</p>
              <SavedTag state={state} />
            </div>
            <button
              className="torus-control"
              aria-label={paused ? 'Resume donut animation' : 'Pause donut animation'}
              aria-pressed={paused}
              onClick={() => setPaused((value) => !value)}
              title={paused ? 'Resume animation' : 'Pause animation'}
            >
              <Torus size={142} animated={!paused} label="JCode halftone donut" />
            </button>
          </div>
          <div className="recent">
            <div className="section-row">
              <h2>Continue</h2>
              <button className="tiny-action" onClick={() => controller.go('sessions')}>
                All sessions
              </button>
            </div>
            {running.length > 0 ? (
              <SessionRow session={running[0]} />
            ) : recent[0] ? (
              <SessionRow session={recent[0]} />
            ) : (
              <EmptyState title="No sessions on this server yet.">
                Create a session to start a real JCode turn. The server owns execution.
              </EmptyState>
            )}
            {recent.length > 1 ? (
              <>
                <div className="section-row spaced">
                  <h2>Recent</h2>
                  <span className="tiny-note">{state.sessionsSource || 'server'}</span>
                </div>
                {recent.slice(1).map((session) => (
                  <SessionRow key={session.session_id} session={session} />
                ))}
              </>
            ) : null}
          </div>
          <div className="project-section-top">
            <h2>Projects</h2>
            <button className="tiny-action" onClick={() => controller.go('projects')}>
              View projects
            </button>
          </div>
          {projects.length === 0 ? (
            <p className="empty-note">No projects are configured on this adapter.</p>
          ) : (
            projects.map((project) => (
              <button
                key={project.project_id}
                className="project-row"
                onClick={() => controller.selectProject(project.project_id)}
              >
                <span className="project-copy">
                  <span className="project-name">{project.label}</span>
                  <span className="project-path">{project.path}</span>
                </span>
                <span className="project-aside">
                  {project.session_count} {project.session_count === 1 ? 'session' : 'sessions'}
                  <IconChevron size={15} />
                </span>
              </button>
            ))
          )}
          <button className="plus-action" onClick={() => controller.go('new-session')}>
            <IconPlus className="i-lg" /> New session
          </button>
          <p className="home-footnote">
            A server-side turn keeps running when you leave this screen. Only the explicit Stop
            control targets the current turn.
          </p>
        </div>
      </main>
    </div>
  );
}

export function SessionsScreen({ state }: { state: AppState }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'finished'>('all');
  useDocumentTitle('Sessions');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.sessions.filter((session) => {
      if (filter === 'running' && !isRunning(session.status)) return false;
      if (filter === 'finished' && isRunning(session.status)) return false;
      if (!needle) return true;
      return (
        sessionTitle(session).toLowerCase().includes(needle) ||
        (session.working_dir ?? '').toLowerCase().includes(needle)
      );
    });
  }, [filter, query, state.sessions]);
  return (
    <div className="screen" data-testid="sessions-screen">
      <ScreenHeader
        title="Sessions"
        subtitle={`${state.sessions.length} on this server`}
        menu
        right={
          <button className="icon-btn" aria-label="New session" onClick={() => controller.go('new-session')}>
            <IconPlus />
          </button>
        }
      />
      <ConnectionBanner state={state} />
      <main className="body-scroll">
        <div className="view-content">
          <h1 className="page-heading">Sessions</h1>
          <p className="page-sub">Your threads live on the server.</p>
          <SavedTag state={state} />
          <label className="search-field">
            <span>Search sessions</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title or project"
              data-testid="session-search"
            />
          </label>
          <div className="mini-filter" role="group" aria-label="Filter sessions">
            {(['all', 'running', 'finished'] as const).map((value) => (
              <button
                key={value}
                className="filter-btn"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : value === 'running' ? 'Running' : 'Finished'}
              </button>
            ))}
          </div>
          <div data-testid="session-list">
            {filtered.map((session) => (
              <SessionRow key={session.session_id} session={session} active={session.session_id === state.activeSessionId} />
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="empty-note" data-testid="no-sessions">
              {state.sessions.length === 0
                ? 'No sessions exist on this server yet.'
                : 'No matching sessions. Try a different search.'}
            </p>
          ) : null}
          {state.sessionsError ? <p className="inline-error">{state.sessionsError}</p> : null}
        </div>
      </main>
    </div>
  );
}

export function ProjectsScreen({ state }: { state: AppState }) {
  const [query, setQuery] = useState('');
  useDocumentTitle('Projects');
  const projects = state.projects.filter((project) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return project.label.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle);
  });
  return (
    <div className="screen" data-testid="projects-screen">
      <ScreenHeader
        title="Projects"
        subtitle={`${state.projects.length} server folders`}
        menu
        right={
          <button className="icon-btn" aria-label="New project" onClick={() => controller.go('project-create')}>
            <IconPlus />
          </button>
        }
      />
      <ConnectionBanner state={state} />
      <main className="body-scroll">
        <div className="view-content project-intro">
          <h1 className="page-heading">Projects</h1>
          <p className="page-sub">Projects are folders where work lives.</p>
          <label className="search-field">
            <span>Find a project</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or directory"
            />
          </label>
          <div className="project-note">
            <span className="small-heading flush">ON THIS SERVER</span>
            <button className="tiny-action" onClick={() => controller.go('project-create')}>
              New project
            </button>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project.project_id}
                className="project-row"
                onClick={() => controller.selectProject(project.project_id)}
                data-testid="project-row"
              >
                <span className="project-copy">
                  <span className="project-name">{project.label}</span>
                  <span className="project-path">{project.path}</span>
                </span>
                <span className="project-aside">
                  {project.session_count} {project.session_count === 1 ? 'session' : 'sessions'}
                  <IconChevron size={15} />
                </span>
              </button>
            ))}
          </div>
          {projects.length === 0 ? (
            <p className="empty-note">No projects are configured. The adapter only exposes allowed server roots.</p>
          ) : null}
          <p className="project-footnote">
            Projects map to canonical folders inside the adapter’s configured roots. Folder creation
            is supported; rename stays disabled until a validated upstream capability exists.
          </p>
        </div>
      </main>
    </div>
  );
}

export function ProjectDetailScreen({ state }: { state: AppState }) {
  const project = state.projects.find((item) => item.project_id === state.activeProjectId) ?? null;
  useDocumentTitle(project?.label ?? 'Project');
  const sessions = state.sessions.filter((session) => session.project_id === project?.project_id);
  if (!project) {
    return (
      <div className="screen">
        <ScreenHeader title="Project" back="projects" />
        <main className="body-scroll">
          <div className="view-content">
            <EmptyState title="This project is no longer on the server.">
              Projects are not recreated implicitly. Return to the project list and choose another.
            </EmptyState>
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="screen" data-testid="project-detail">
      <ScreenHeader
        title={project.label}
        back="projects"
        right={
          <button className="icon-btn" aria-label="New session in this project" onClick={() => controller.go('new-session')}>
            <IconPlus />
          </button>
        }
      />
      <main className="body-scroll">
        <div className="view-content project-intro">
          <h1 className="project-detail-title">{project.label}</h1>
          <p className="project-detail-path">{project.path}</p>
          <div className="project-summary">
            <span>
              <strong>{sessions.length}</strong> sessions
            </span>
            <span>
              <strong>{project.pinned ? 'Pinned' : 'Not pinned'}</strong>
            </span>
            <span>
              <strong>{state.savedOnPhone ? 'Cached' : 'Current'}</strong>
            </span>
          </div>
          <button className="project-cta" onClick={() => controller.go('new-session')}>
            <span>New session in this project</span>
            <IconChevron style={{ transform: 'rotate(-90deg)' }} />
          </button>
          <div className="project-section-top">
            <h2>Sessions</h2>
            <button className="project-back-link" onClick={() => controller.go('sessions')}>
              View all
            </button>
          </div>
          <button className="text-link-new" onClick={() => controller.openBrowser(project.project_id)} data-testid="browse-files">
            <IconChevron style={{ transform: 'rotate(-90deg)' }} /> Browse project files
          </button>
          <div>
            {sessions.map((session) => (
              <SessionRow key={session.session_id} session={session} />
            ))}
            {sessions.length === 0 ? (
              <p className="empty-note">No sessions in this project yet.</p>
            ) : null}
          </div>
          <p className="project-footnote">
            Selecting a session opens the conversation. Navigating away never stops the server-side
            agent.
          </p>
        </div>
      </main>
    </div>
  );
}

export function ProjectCreateScreen({ state }: { state: AppState }) {
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle('New project');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!label.trim() || !path.trim()) {
      setError('A label and an existing server folder are required.');
      return;
    }
    setBusy(true);
    const ok = await controller.createProject(label.trim(), path.trim());
    setBusy(false);
    if (ok) controller.go('projects');
    else setError('The adapter rejected the project. Check that the folder exists inside an allowed root.');
  };
  return (
    <div className="screen" data-testid="project-create-screen">
      <ScreenHeader title="New project" back="projects" />
      <main className="body-scroll">
        <div className="view-content create-entry">
          <p className="quiet-eyebrow">PROJECT SETUP</p>
          <h1 className="page-heading">A place to build.</h1>
          <p className="page-sub">Choose an existing folder inside the adapter’s allowed roots.</p>
          <form onSubmit={submit} className="create-form">
            <label className="project-name-field">
              <span>Project name</span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Mobile adapter"
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="project-name-field">
              <span>Server folder</span>
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={state.projects[0]?.path ?? '/home/user/project'}
                autoComplete="off"
                spellCheck={false}
                className="mono"
              />
            </label>
            <p className="form-help">
              The adapter canonicalizes this path and rejects anything outside its configured roots.
              It never creates the folder as a side effect of adding a project.
            </p>
            {error ? <p className="inline-error" role="alert">{error}</p> : null}
            <button className="primary-btn" type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add project'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export function NewSessionScreen({ state }: { state: AppState }) {
  const [projectId, setProjectId] = useState<string | null>(state.activeProjectId ?? state.projects[0]?.project_id ?? null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  useDocumentTitle('New session');
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    await controller.createSession(projectId, title);
    setBusy(false);
  };
  return (
    <div className="screen" data-testid="new-session-screen">
      <ScreenHeader title="New session" back="sessions" />
      <main className="body-scroll">
        <div className="view-content create-entry">
          <p className="quiet-eyebrow">A NEW THREAD</p>
          <h1 className="page-heading">Where to work?</h1>
          <p className="page-sub">Choose a project, or use the adapter’s default server folder.</p>
          <div className="choice-rows" role="group" aria-label="Session location">
            {state.projects.map((project) => (
              <button
                key={project.project_id}
                className={`choice-row ${projectId === project.project_id ? 'selected' : ''}`}
                aria-pressed={projectId === project.project_id}
                onClick={() => setProjectId(project.project_id)}
              >
                <span>
                  <strong>{project.label}</strong>
                  <small>{project.path}</small>
                </span>
                <span className="choice-check">{projectId === project.project_id ? 'Selected' : ''}</span>
              </button>
            ))}
            <button
              className={`choice-row ${projectId === null ? 'selected' : ''}`}
              aria-pressed={projectId === null}
              onClick={() => setProjectId(null)}
            >
              <span>
                <strong>Personal chat</strong>
                <small>Adapter default folder</small>
              </span>
              <span className="choice-check">{projectId === null ? 'Selected' : ''}</span>
            </button>
          </div>
          <label className="project-name-field">
            <span>Title (optional)</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Let the server name it"
              maxLength={200}
              autoComplete="off"
            />
          </label>
          <p className="form-help">
            The client-generated request id makes creation idempotent. A retry returns the same
            session instead of creating a second one.
          </p>
        </div>
      </main>
      <footer className="sticky-create-footer">
        <div className="create-selection-caption">
          {projectId ? state.projects.find((project) => project.project_id === projectId)?.path : 'Default adapter folder'}
        </div>
        <button className="primary-btn create-continue" onClick={submit} disabled={busy} data-testid="create-session-submit">
          {busy ? 'Creating…' : 'Continue'}
        </button>
      </footer>
    </div>
  );
}

export function SettingsScreen({ state }: { state: AppState }) {
  useDocumentTitle('Preferences');
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  useEffect(() => {
    if (devicesLoaded || state.connection.status !== 'connected') return;
    setDevicesLoaded(true);
    void controller.loadDevices();
  }, [devicesLoaded, state.connection.status]);
  return (
    <div className="screen" data-testid="settings-screen">
      <ScreenHeader title="Preferences" subtitle="A few quiet choices" menu />
      <main className="body-scroll">
        <div className="view-content">
          <h1 className="page-heading">Preferences</h1>
          <p className="page-sub">Local display choices never change remote execution.</p>

          <section className="pref-group">
            <h2 className="pref-title">Appearance</h2>
            <div className="pref-row">
              <div>
                Theme<small>Follow the device or pin a palette.</small>
              </div>
              <div className="seg-switch" role="group" aria-label="Theme">
                {(['system', 'light', 'dark'] as const).map((value) => (
                  <button
                    key={value}
                    aria-pressed={state.theme === value}
                    onClick={() => controller.setTheme(value)}
                    data-testid={`theme-${value}`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="pref-row">
              <div>
                Glass accents<small>Frosted navigation only, never the transcript.</small>
              </div>
              <div className="seg-switch" role="group" aria-label="Glass accents">
                <button aria-pressed={state.glass} onClick={() => controller.setGlass(true)}>On</button>
                <button aria-pressed={!state.glass} onClick={() => controller.setGlass(false)}>Off</button>
              </div>
            </div>
            <div className="pref-row">
              <div>
                Motion<small>Reduced motion is a first-class setting.</small>
              </div>
              <div className="seg-switch" role="group" aria-label="Motion">
                <button aria-pressed={state.motion === 'system'} onClick={() => controller.setMotion('system')}>System</button>
                <button aria-pressed={state.motion === 'reduced'} onClick={() => controller.setMotion('reduced')}>Reduce</button>
              </div>
            </div>
          </section>

          <section className="pref-group">
            <h2 className="pref-title">Conversation</h2>
            <div className="pref-row">
              <div>
                Reasoning visibility<small>Reasoning is shown only when JCode sends it.</small>
              </div>
              <select
                className="select"
                value={state.reasoningVisibility}
                onChange={(event) => controller.setReasoningVisibility(event.target.value as AppState['reasoningVisibility'])}
                aria-label="Reasoning visibility"
              >
                <option value="compact">Compact</option>
                <option value="hidden">Hidden</option>
                <option value="expanded">Expanded</option>
              </select>
            </div>
            <div className="pref-row">
              <div>
                Session model<small>{state.runtime?.model ?? 'Not reported'}</small>
              </div>
              <button className="tiny-action" onClick={() => controller.openSheet('model')}>Change</button>
            </div>
            <div className="pref-row">
              <div>
                Provider<small>{state.runtime?.provider ?? 'Unknown'} · {state.runtime?.account_label ?? 'account unknown'}</small>
              </div>
              <button className="tiny-action" onClick={() => controller.openSheet('reasoning')}>Effort</button>
            </div>
          </section>

          <section className="pref-group">
            <h2 className="pref-title">Connection</h2>
            <div className="pref-row">
              <div>
                Server<small>{state.credential?.baseUrl ?? 'Not paired'}</small>
              </div>
              <span className={`inline-status ${state.connection.status === 'connected' ? 'ok' : 'warn'}`}>
                <span className="status-mark" /> {state.connection.status}
              </span>
            </div>
            <div className="pref-row">
              <div>
                JCode harness<small>Harness API {state.server?.jcode_version ?? 'unknown'} · API {state.server?.jcode_protocol_version ?? '—'}</small>
              </div>
              <span className={`inline-status ${state.jcodeConnected ? 'ok' : 'warn'}`}>
                <span className="status-mark" /> {state.jcodeConnected ? 'connected' : 'unavailable'}
              </span>
            </div>
            <div className="pref-row">
              <div>
                Device<small>{state.device?.name ?? 'unknown'} · {state.device?.device_id?.slice(0, 14) ?? '—'}</small>
              </div>
              <span className="note-sub">paired</span>
            </div>
            <div className="pref-row">
              <div>
                Adapter capabilities<small>{state.server?.capabilities.length ?? 0} verified</small>
              </div>
              <span className="note-sub">{state.server?.protocol_version ?? '—'} / v2</span>
            </div>
            <div className="pref-row">
              <div>
                Credential storage<small>{credentialStorageKind}. Web preview is test storage, not a keystore.</small>
              </div>
              <span className="note-sub">device-scoped</span>
            </div>
            {state.connection.status === 'connected' ? (
              <div className="pref-row">
                <div>
                  Devices<small>{state.devices.length} active</small>
                </div>
                <button className="tiny-action" onClick={() => controller.loadDevices()}>Refresh</button>
              </div>
            ) : null}
            {state.devices.map((device) => (
              <div className="pref-row" key={device.device_id}>
                <div>
                  {device.name}<small>{device.device_id.slice(0, 18)}</small>
                </div>
                {device.device_id === state.device?.device_id ? (
                  <span className="note-sub">this device</span>
                ) : (
                  <button className="tiny-action" onClick={() => controller.revokeDevice(device.device_id)}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
            {confirmUnpair ? (
              <div className="confirm-row">
                <p>Forget this device? The token is removed from this phone. The server session keeps running.</p>
                <button className="danger-btn" onClick={() => controller.unpair()}>Forget device</button>
                <button className="tiny-action" onClick={() => setConfirmUnpair(false)}>Cancel</button>
              </div>
            ) : (
              <button className="text-link-new danger-text" onClick={() => setConfirmUnpair(true)}>
                Forget this device
              </button>
            )}
          </section>

          <section className="pref-group">
            <h2 className="pref-title">About</h2>
            <div className="pref-row">
              <div>
                Adapter<small>Rust Adapter v2 · {state.server?.adapter_version ?? '0.3.1'}</small>
              </div>
              <span className="note-sub">{state.server?.server_id?.slice(0, 18) ?? '—'}</span>
            </div>
            <div className="pref-row">
              <div>
                Stillness 12<small>JCode Mobile 0.3.1</small>
              </div>
              <span className="note-sub">v0.3.1</span>
            </div>
            <div className="pref-row">
              <div>
                Verified capabilities<small>{state.server?.capabilities.join(' · ') || 'Not negotiated'}</small>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export function ChangesScreen({ state }: { state: AppState }) {
  useDocumentTitle('Changes');
  return (
    <div className="screen" data-testid="changes-screen">
      <ScreenHeader title="Changes" back="session" menu />
      <ConnectionBanner state={state} />
      <main className="body-scroll">
        <div className="view-content">
          <h1 className="page-heading">Files changed</h1>
          <p className="page-sub">Only authoritative server reports appear here.</p>
          <div className="honest-unavailable">
            <strong>File-level change reports are not available from this adapter build.</strong>
            <p>
              JCode’s curated API exposes aggregate edit statistics on session summaries, not a
              verified per-file diff. This screen deliberately shows no invented paths or line
              counts. Activity below reflects only observed tool and status events.
            </p>
          </div>
          <button className="text-link-new" onClick={() => controller.go('activity')}>
            Open observed activity
          </button>
        </div>
      </main>
    </div>
  );
}
