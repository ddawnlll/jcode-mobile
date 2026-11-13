import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { controller, type AppState, type LiveState, type LiveTool } from '../lib/controller';
import {
  IconArrowUp,
  IconCheck,
  IconChevron,
  IconEdit,
  IconMore,
  IconRefresh,
  IconStop,
} from '../components/Icons';
import { Torus } from '../components/Torus';
import {
  ConnectionBanner,
  EmptyState,
  Markdown,
  ScreenHeader,
  Sheet,
} from '../components/ui';
import {
  longDate,
  operationLabel,
  parsePlan,
  relativeTime,
  sessionTitle,
  statusLabel,
  type ParsedPlan,
} from '../lib/format';
import type { ActivityItem, ContextView, HistoryMessageView } from '../lib/protocol';

function startedLabel(live: LiveState): string {
  if (live.needsReconcile) return 'Reconciling with server';
  if (live.permission) return 'Waiting for your permission';
  if (live.phase) return live.phase;
  if (live.turnId) {
    if (live.status === 'dispatching') return 'Sending to server';
    if (live.status === 'accepted') return 'Accepted by agent';
    if (live.status === 'thinking') return 'Thinking';
    if (live.status === 'writing') return 'Writing';
    if (live.status === 'reconciling') return 'Reconciling with server';
    return statusLabel(live.status);
  }
  return 'Ready';
}

function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!since) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const seconds = now ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return <span className="thinking-time">observed {seconds}s</span>;
}

const ToolCard = memo(function ToolCard({
  name,
  input,
  output,
  error,
  status,
}: {
  name: string;
  input?: string;
  output?: string;
  error?: string | null;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-card ${status}`}>
      <button className="tool-card-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="tool-dot" />
        <strong>{name}</strong>
        <span className="tool-status">{status}</span>
        <IconChevron size={15} />
      </button>
      {open ? (
        <div className="tool-card-body">
          {input ? (
            <div>
              <span className="small-heading flush">INPUT</span>
              <pre>{input}</pre>
            </div>
          ) : null}
          {error ? <p className="inline-error">{error}</p> : null}
          {output ? (
            <div>
              <span className="small-heading flush">OUTPUT</span>
              <pre>{output}</pre>
            </div>
          ) : null}
          {!input && !output && !error ? <p className="form-help">No payload was reported.</p> : null}
        </div>
      ) : null}
    </div>
  );
});

const HistoryRow = memo(function HistoryRow({ message }: { message: HistoryMessageView }) {
  if (message.role === 'user') {
    return (
      <article className="chat-message user-msg" data-testid="user-message">
        <div className="chat-meta">You</div>
        <div className="chat-text preserve">{message.content}</div>
      </article>
    );
  }
  if (message.role === 'assistant') {
    return (
      <article className="chat-message assistant-msg" data-testid="assistant-message">
        <div className="chat-meta">JCode</div>
        <Markdown text={message.content} />
      </article>
    );
  }
  if (message.role === 'tool') {
    return (
      <div className="quiet-work history-tool">
        <ToolCard
          name={message.tool_name ?? 'tool result'}
          input={message.tool_input ? JSON.stringify(message.tool_input, null, 2) : undefined}
          output={message.content}
          status="done"
        />
      </div>
    );
  }
  return (
    <article className="chat-message">
      <div className="chat-meta">{message.role}</div>
      <div className="chat-text preserve">{message.content}</div>
    </article>
  );
});

function LiveToolList({ tools }: { tools: LiveTool[] }) {
  if (!tools.length) return null;
  return (
    <div className="live-tools">
      {tools.map((tool) => (
        <ToolCard
          key={tool.callId}
          name={tool.name}
          input={tool.input}
          output={tool.output}
          error={tool.error}
          status={tool.status}
        />
      ))}
    </div>
  );
}

function PendingCard({ state }: { state: AppState }) {
  const pending = state.pending;
  if (!pending) return null;
  const label = operationLabel(pending.state);
  return (
    <article className={`chat-message user-msg pending-msg state-${pending.state}`} data-testid="pending-message">
      <div className="chat-meta">
        You <span className="pending-label">{label}</span>
      </div>
      <div className="chat-text preserve">{pending.text}</div>
      {pending.state === 'unknown' ? (
        <div className="delivery-warning">
          <p>
            The adapter wrote this request but did not observe an acknowledgment. It is not safe to
            resend automatically.
          </p>
          <button className="tiny-action" onClick={() => controller.refreshSnapshot()}>
            <IconRefresh size={14} /> Reconcile from server
          </button>
        </div>
      ) : null}
      {pending.error ? <p className="inline-error">{pending.error}</p> : null}
    </article>
  );
}

function PermissionCard({ state }: { state: AppState }) {
  const permission = state.live.permission;
  if (!permission) return null;
  return (
    <div className="permission-card" role="alert">
      <div>
        <strong>{permission.toolName}</strong>
        <p>{permission.description}</p>
      </div>
      <div className="permission-actions">
        <button className="primary-btn compact" onClick={() => controller.respondPermission('allow')}>
          Allow
        </button>
        <button className="onboard-secondary compact" onClick={() => controller.respondPermission('deny')}>
          Deny
        </button>
      </div>
    </div>
  );
}

function ReasoningBlock({ state }: { state: AppState }) {
  if (state.reasoningVisibility === 'hidden' || !state.live.reasoning) return null;
  const expanded = state.reasoningVisibility === 'expanded';
  return (
    <details className="reasoning-block" open={expanded}>
      <summary>Reasoning</summary>
      <div className="reasoning-copy">{state.live.reasoning}</div>
    </details>
  );
}

function Composer({ state }: { state: AppState }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hasTurn = Boolean(state.live.turnId);
  const pendingBlocks = Boolean(
    state.pending && ['staged', 'reserved', 'dispatching', 'accepted', 'unknown'].includes(state.pending.state),
  );
  const canSend = state.composerText.trim().length > 0 && !hasTurn && !pendingBlocks;
  const resize = () => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  };
  useEffect(resize, [state.composerText]);
  const send = () => {
    if (!canSend) return;
    void controller.send();
    if (textarea.current) textarea.current.style.height = 'auto';
  };
  return (
    <div className="composer-outer">
      <div className="composer">
        <label htmlFor="composer-input">Your instruction</label>
        <textarea
          id="composer-input"
          ref={textarea}
          rows={1}
          data-testid="composer-input"
          value={state.composerText}
          placeholder={state.connection.status === 'connected' ? 'Ask or guide JCode…' : 'Draft saved on this phone. Reconnect to send.'}
          onChange={(event) => {
            controller.setComposerText(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          aria-label="Message JCode"
        />
        <div className="composer-tools">
          <div className="composer-left">
            <button
              className="tool-button"
              aria-label="Attachments are not supported by this adapter"
              title="Attachments require an adapter capability that is not implemented"
              disabled
            >
              <IconMore />
            </button>
            <button
              className="model-button"
              onClick={() => controller.openSheet('model')}
              title="Model selection"
              data-testid="model-button"
            >
              {state.runtime?.model ?? 'Model unavailable'} <IconChevron size={14} />
            </button>
            <button
              className="model-button"
              onClick={() => controller.openSheet('reasoning')}
              title="Reasoning effort"
              data-testid="reasoning-button"
            >
              {state.runtime?.reasoning_effort ?? 'Effort —'}
            </button>
          </div>
          {hasTurn ? (
            <button className="stop-btn" aria-label="Stop the active turn" onClick={() => controller.stop()} data-testid="stop-button">
              <IconStop size={18} />
            </button>
          ) : (
            <button
              className="send-btn"
              aria-label="Send instruction"
              onClick={send}
              disabled={!canSend}
              data-testid="send-button"
            >
              <IconArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="under-composer" data-testid="delivery-state">
        {state.pending ? operationLabel(state.pending.state) : 'Navigation never stops a running turn.'}
      </div>
    </div>
  );
}

function ModelSheet({ state }: { state: AppState }) {
  if (state.sheet !== 'model') return null;
  const routes = state.models?.models ?? state.runtime?.routes ?? [];
  const commandCode = routes.filter((route) => route.is_command_code);
  const others = routes.filter((route) => !route.is_command_code);
  return (
    <Sheet title="Model" onClose={() => controller.openSheet(null)} testId="model-sheet">
      {routes.length === 0 ? (
        <div className="honest-unavailable">
          <strong>No model routes are available.</strong>
          <p>The adapter has not received an authoritative runtime catalog for this session.</p>
          <button className="onboard-secondary" onClick={() => controller.refreshModels()}>
            Retry runtime query
          </button>
        </div>
      ) : (
        <>
          {commandCode.length > 0 ? (
            <section className="model-section" data-testid="command-code-section">
              <h3>Command Code</h3>
              <p className="form-help">
                Native provider · account {state.runtime?.account_label ?? 'label unknown'}
              </p>
              {commandCode.map((route) => (
                <button
                  key={`${route.provider}:${route.model}`}
                  className={`overlay-row model-route ${state.runtime?.model === route.model ? 'selected' : ''}`}
                  disabled={!route.available}
                  onClick={() => controller.selectModel(route.model, route.provider)}
                >
                  <span>
                    {route.model}
                    <small>{route.api_method} · {route.detail || (route.available ? 'available' : 'unavailable')}</small>
                  </span>
                  {state.runtime?.model === route.model ? <IconCheck size={18} /> : null}
                </button>
              ))}
            </section>
          ) : null}
          {others.length > 0 ? (
            <section className="model-section">
              <h3>Other routes</h3>
              {others.map((route) => (
                <button
                  key={`${route.provider}:${route.model}`}
                  className={`overlay-row model-route ${state.runtime?.model === route.model ? 'selected' : ''}`}
                  disabled={!route.available}
                  onClick={() => controller.selectModel(route.model, route.provider)}
                >
                  <span>
                    {route.model}
                    <small>{route.provider} · {route.api_method} · {route.detail || (route.available ? 'available' : 'unavailable')}</small>
                  </span>
                  {state.runtime?.model === route.model ? <IconCheck size={18} /> : null}
                </button>
              ))}
            </section>
          ) : null}
          <p className="form-help">
            Route availability is exactly what JCode reported. A model in the catalog is not proof of
            plan entitlement. Selection is verified again from runtime state.
          </p>
        </>
      )}
    </Sheet>
  );
}

function ReasoningSheet({ state }: { state: AppState }) {
  if (state.sheet !== 'reasoning') return null;
  const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  return (
    <Sheet title="Reasoning effort" onClose={() => controller.openSheet(null)}>
      <p className="form-help">
        Providers that do not support the chosen level reject it. The adapter re-reads runtime state
        instead of assuming the change took effect.
      </p>
      {efforts.map((effort) => (
        <button
          key={effort}
          className={`overlay-row ${state.runtime?.reasoning_effort === effort ? 'selected' : ''}`}
          onClick={() => controller.setReasoning(effort)}
        >
          <span>{effort}</span>
          {state.runtime?.reasoning_effort === effort ? <IconCheck size={18} /> : null}
        </button>
      ))}
      <div className="context-note">
        Provider: {state.runtime?.provider ?? 'unknown'} · account {state.runtime?.account_label ?? 'unknown'}
      </div>
    </Sheet>
  );
}

function PlanSummary({ plan }: { plan: ParsedPlan | null }) {
  if (!plan) {
    return <p className="inspector-empty">No plan has been reported by JCode.</p>;
  }
  return (
    <div className="plan-summary">
      <div className="plan-overview compact">
        <span>
          <span className="plan-count">
            {plan.completed} <small>/ {plan.total}</small>
          </span>{' '}
          complete
        </span>
        <span>{plan.active ? 'active step' : 'no active step'}</span>
      </div>
      {plan.groups.slice(0, 2).map((group) => (
        <div key={group.name} className="mini-plan-group">
          <strong>{group.name}</strong>
          {group.todos.slice(0, 3).map((todo) => (
            <span key={todo.id} className={`mini-plan-item ${todo.status}`}>
              <span className="step-state">{todo.status === 'completed' ? <IconCheck size={14} /> : null}</span>
              {todo.content}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionInspector({ state, plan }: { state: AppState; plan: ParsedPlan | null }) {
  const context = state.context;
  const recent = state.activity.slice(0, 4);
  return (
    <aside className="inspector" aria-label="Session inspector">
      <div className="inspector-head">
        <span>Inspector</span>
        <button className="icon-btn small" aria-label="Refresh inspector" onClick={() => {
          void controller.refreshPlan();
          void controller.refreshActivity();
          void controller.refreshContext();
          void controller.refreshModels();
        }}>
          <IconRefresh size={16} />
        </button>
      </div>
      <section className="inspector-section">
        <div className="inspector-title">
          <h3>Plan</h3>
          <button className="tiny-action" onClick={() => controller.go('plan')}>Open</button>
        </div>
        <PlanSummary plan={plan} />
      </section>
      <section className="inspector-section">
        <div className="inspector-title">
          <h3>Context</h3>
          <button className="tiny-action" onClick={() => controller.openSheet('context')}>Details</button>
        </div>
        <div className="context-grid">
          <span>Input</span>
          <strong>{context?.input_tokens != null ? context.input_tokens.toLocaleString() : 'Unknown'}</strong>
          <span>Output</span>
          <strong>{context?.output_tokens != null ? context.output_tokens.toLocaleString() : 'Unknown'}</strong>
          <span>Budget</span>
          <strong>{context?.effective_budget != null ? context.effective_budget.toLocaleString() : 'Unknown'}</strong>
        </div>
        <p className="inspector-note">Missing telemetry stays unknown, never zero.</p>
      </section>
      <section className="inspector-section">
        <div className="inspector-title">
          <h3>Activity</h3>
          <button className="tiny-action" onClick={() => controller.go('activity')}>Open</button>
        </div>
        {recent.length === 0 ? (
          <p className="inspector-empty">No observed activity in this view.</p>
        ) : (
          <div className="activity-mini">
            {recent.map((item, index) => (
              <div key={`${item.at_ms}-${index}`}>
                <strong>{item.title}</strong>
                <small>{relativeTime(item.at_ms)} · {item.kind}</small>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="inspector-section">
        <div className="inspector-title">
          <h3>Runtime</h3>
        </div>
        <div className="runtime-mini">
          <span>Provider</span>
          <strong>{state.runtime?.provider ?? 'Unknown'}</strong>
          <span>Model</span>
          <strong>{state.runtime?.model ?? 'Unknown'}</strong>
          <span>Effort</span>
          <strong>{state.runtime?.reasoning_effort ?? 'Unknown'}</strong>
          <span>Account</span>
          <strong>{state.runtime?.account_label ?? 'Unknown'}</strong>
          <span>Auth</span>
          <strong>{state.runtime?.auth_method ?? 'Unknown'}</strong>
        </div>
      </section>
    </aside>
  );
}

export function SessionScreen({ state }: { state: AppState }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const plan = useMemo(() => parsePlan(state.plan ?? state.snapshot?.plan), [state.plan, state.snapshot?.plan]);
  const session = state.snapshot?.session ?? state.sessions.find((item) => item.session_id === state.activeSessionId);
  const title = sessionTitle(session);

  useEffect(() => {
    setAutoFollow(true);
    setShowJump(false);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [state.activeSessionId]);

  const messageCount = state.snapshot?.messages.length ?? 0;
  const liveText = state.live.assistants.map((block) => block.text).join('');
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (autoFollow) {
      element.scrollTop = element.scrollHeight;
    } else if (messageCount || liveText.length) {
      setShowJump(true);
    }
  }, [messageCount, liveText, state.pending?.state, autoFollow]);

  useEffect(() => {
    if (!renaming) return;
    setTitleDraft(session?.title ?? '');
  }, [renaming, session?.title]);

  const dateLabel = state.snapshot?.authoritative_at_ms
    ? longDate(state.snapshot.authoritative_at_ms)
    : state.models?.observed_at_ms
      ? longDate(state.models.observed_at_ms)
      : '';

  return (
    <div className="screen session-screen" data-testid="session-screen">
      <header className="header session-header">
        <div className="left-head">
          <button className="icon-btn" aria-label="Back to sessions" onClick={() => controller.go('sessions')}>
            <IconChevron style={{ transform: 'rotate(90deg)' }} />
          </button>
          <div className="head-copy">
            <div className="head-title" data-testid="session-title">{title}</div>
            <div className="head-sub">
              <span className={`status-mark ${state.live.turnId ? 'is-active' : ''}`} />
              {state.activeMissing ? 'Session missing from server' : startedLabel(state.live)}
              {state.runtime?.model ? ` · ${state.runtime.model}` : ''}
              {state.savedOnPhone ? ' · saved on this phone' : ''}
            </div>
          </div>
        </div>
        <div className="head-actions">
          <button className="icon-btn" aria-label="Rename session" onClick={() => setRenaming(true)}>
            <IconEdit />
          </button>
          <button className="icon-btn" aria-label="Open sidebar" onClick={() => controller.openDrawer(true)}>
            <IconMore />
          </button>
        </div>
      </header>
      <ConnectionBanner state={state} />
      {state.activeMissing ? (
        <div className="missing-session" role="alert">
          <strong>This session is no longer on the server.</strong>
          <p>No replacement session was created. Go back and choose an existing session.</p>
          <button className="onboard-secondary" onClick={() => controller.go('sessions')}>Back to sessions</button>
        </div>
      ) : null}
      <div className="session-layout">
        <main className="session-transcript-wrap">
          <div
            className="body-scroll transcript-scroll"
            ref={scrollRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
              setAutoFollow(nearBottom);
              if (nearBottom) setShowJump(false);
            }}
            data-testid="transcript"
          >
            <div className="conversation">
              <div className="date-line">{dateLabel}</div>
              {state.snapshot?.messages.length === 0 && !state.live.turnId && !state.pending ? (
                <EmptyState title="No messages yet.">
                  Send an instruction below. The adapter journals it before dispatch.
                </EmptyState>
              ) : null}
              {state.snapshot?.messages.map((message) => (
                <HistoryRow key={message.index} message={message} />
              ))}
              <PendingCard state={state} />
              {state.live.turnId || state.live.assistants.length || state.live.tools.length || state.live.reasoning ? (
                <div className="live-turn" data-testid="live-turn">
                  <div className="quiet-work active-work">
                    <div className="work-main static">
                      <div className="work-glyph is-live">
                        <Torus size={24} animated={Boolean(state.live.turnId)} />
                      </div>
                      <div className="work-lines">
                        <div className="work-state">
                          {startedLabel(state.live)}
                          {state.live.turnId ? (
                            <>
                              <span className="thinking-dots">…</span>{' '}
                              <Elapsed since={state.live.startedAtMs} />
                            </>
                          ) : null}
                        </div>
                        <div className="work-detail">
                          {state.live.tools.length > 0
                            ? `${state.live.tools.length} tool ${state.live.tools.length === 1 ? 'call' : 'calls'} observed`
                            : state.live.needsReconcile
                              ? 'A stream gap was detected. Snapshot in progress.'
                              : 'Streaming from the server'}
                        </div>
                      </div>
                      <button className="work-action" onClick={() => controller.go('plan')}>Plan</button>
                    </div>
                    <LiveToolList tools={state.live.tools} />
                  </div>
                  <ReasoningBlock state={state} />
                  <PermissionCard state={state} />
                  {state.live.assistants.map((block) => (
                    <article className="chat-message assistant-msg" key={block.id} data-testid="live-assistant-message">
                      <div className="chat-meta">JCode {!block.done ? <span className="stream-caret">streaming</span> : null}</div>
                      <Markdown text={block.text} />
                    </article>
                  ))}
                  {state.live.error ? <p className="inline-error" role="alert">{state.live.error}</p> : null}
                </div>
              ) : null}
              {state.live.recovery ? (
                <div className="recovery-card">
                  <strong>Recovery context from JCode</strong>
                  {state.live.recovery.notice ? <p>{state.live.recovery.notice}</p> : null}
                  <details>
                    <summary>Review continuation</summary>
                    <pre>{state.live.recovery.continuation}</pre>
                  </details>
                  <p className="form-help">
                    The adapter never sends this automatically. You decide whether to continue.
                  </p>
                </div>
              ) : null}
              <div className="followup">
                <div className="line" />
                <span>{state.reconciling ? 'Reconciling with server' : 'Latest activity'}</span>
                <div className="line" />
              </div>
            </div>
          </div>
          {showJump ? (
            <button
              className="jump-new"
              onClick={() => {
                const element = scrollRef.current;
                if (element) element.scrollTop = element.scrollHeight;
                setAutoFollow(true);
                setShowJump(false);
              }}
            >
              ↓ Jump to latest
            </button>
          ) : null}
          <Composer state={state} />
        </main>
        <SessionInspector state={state} plan={plan} />
      </div>
      {renaming ? (
        <Sheet title="Session title" onClose={() => setRenaming(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void controller.renameSession(titleDraft);
              setRenaming(false);
            }}
          >
            <label className="onboard-field">
              Title
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                maxLength={200}
                autoFocus
                placeholder="Session title"
              />
              <span className="field-hint">An explicit title is persisted by JCode and pinned locally, so refresh does not flip it.</span>
            </label>
            <button className="primary-btn" type="submit">Save title</button>
          </form>
        </Sheet>
      ) : null}
      <ModelSheet state={state} />
      <ReasoningSheet state={state} />
      {state.sheet === 'context' ? (
        <Sheet title="Context" onClose={() => controller.openSheet(null)}>
          <ContextDetails context={state.context} />
        </Sheet>
      ) : null}
    </div>
  );
}

function ContextDetails({ context }: { context: ContextView | null }) {
  if (!context) {
    return <p className="inspector-empty">No context telemetry has been reported.</p>;
  }
  return (
    <div className="context-details">
      <div><span>Input tokens</span><strong>{context.input_tokens?.toLocaleString() ?? 'Unknown'}</strong></div>
      <div><span>Output tokens</span><strong>{context.output_tokens?.toLocaleString() ?? 'Unknown'}</strong></div>
      <div><span>Cache read</span><strong>{context.cache_read_input?.toLocaleString() ?? 'Unknown'}</strong></div>
      <div><span>Cache creation</span><strong>{context.cache_creation_input?.toLocaleString() ?? 'Unknown'}</strong></div>
      <div><span>Effective budget</span><strong>{context.effective_budget?.toLocaleString() ?? 'Unknown'}</strong></div>
      <div><span>Provider</span><strong>{context.provider ?? 'Unknown'}</strong></div>
      <div><span>Model</span><strong>{context.model ?? 'Unknown'}</strong></div>
      <div><span>Observed</span><strong>{relativeTime(context.observed_at_ms)}</strong></div>
      <p className="form-help">Source: {context.source}. Missing values are unknown, not zero.</p>
    </div>
  );
}

export function PlanScreen({ state }: { state: AppState }) {
  const plan = useMemo(() => parsePlan(state.plan ?? state.snapshot?.plan), [state.plan, state.snapshot?.plan]);
  return (
    <div className="screen" data-testid="plan-screen">
      <ScreenHeader title="Plan" back="session" menu />
      <main className="body-scroll">
        <div className="view-content">
          <h1 className="page-heading">Execution plan</h1>
          <p className="page-sub">{plan?.title ?? state.snapshot?.session.title ?? 'No plan title reported'}</p>
          {!plan ? (
            <EmptyState title="No plan has been reported.">
              JCode exposes plan state through its todo system. This adapter shows nothing until that
              state is actually returned.
            </EmptyState>
          ) : (
            <>
              <div className="plan-overview">
                <span>
                  <span className="plan-count">
                    {plan.completed} <small>/ {plan.total}</small>
                  </span>{' '}
                  completed
                </span>
                <span>{plan.active ? `Active · ${plan.active.content}` : 'No active step'}</span>
              </div>
              {plan.intention ? <p className="plan-intention">{plan.intention}</p> : null}
              {plan.groups.map((group) => (
                <div className="plan-phase expanded" key={group.name}>
                  <div className="phase-head">
                    <span className="phase-num">{String(group.completed).padStart(2, '0')}</span>
                    <span className="phase-name">{group.name}</span>
                    <span className="phase-meta">{group.completed} / {group.todos.length}</span>
                  </div>
                  <div className="phase-detail">
                    {group.todos.map((todo) => (
                      <div className={`step-item ${todo.status}`} key={todo.id} data-testid="plan-step">
                        <span className={`step-state ${todo.status === 'completed' ? 'done' : ''} ${todo.status === 'in_progress' ? 'active-step' : ''}`}>
                          {todo.status === 'completed' ? <IconCheck size={16} /> : <span className="step-ring" />}
                        </span>
                        <div>
                          <strong>{todo.content}</strong>
                          <small>
                            {todo.status.replace(/_/g, ' ')}
                            {todo.priority ? ` · ${todo.priority}` : ''}
                            {todo.completionConfidence ? ` · ${todo.completionConfidence}` : ''}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="plan-footnote">
                Plan state comes only from the daemon’s todo snapshot. Elapsed time and tool events do
                not invent completion or step order.
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export function ActivityScreen({ state }: { state: AppState }) {
  return (
    <div className="screen" data-testid="activity-screen">
      <ScreenHeader title="Activity" back="session" menu />
      <ConnectionBanner state={state} />
      <main className="body-scroll">
        <div className="view-content">
          <h1 className="page-heading">Activity</h1>
          <p className="page-sub">The underlying work, when you need it.</p>
          <div className="small-heading">OBSERVED · {state.activity.length}</div>
          {state.activity.length === 0 ? (
            <EmptyState title="No activity has been observed.">
              Activity appears only after the adapter receives tool or status events from JCode.
            </EmptyState>
          ) : (
            state.activity.map((item: ActivityItem, index) => (
              <div className="activity-item" key={`${item.at_ms}-${index}`}>
                <div className="activity-item-head">
                  <span>{statusLabel(item.kind)}</span>
                  <span className="mono">{relativeTime(item.at_ms)}</span>
                </div>
                <div className="activity-item-title">{item.title}</div>
                {item.detail ? <code>{item.detail}</code> : null}
              </div>
            ))
          )}
          <p className="activity-note">
            This is the adapter’s observed event record, not a fabricated command history. For
            file-level changes, the adapter has no authoritative report.
          </p>
          <button className="text-link-new" onClick={() => controller.go('changes')}>
            About file changes
          </button>
        </div>
      </main>
    </div>
  );
}
