import type { SessionSummary } from './protocol';

export function sessionTitle(session: Pick<SessionSummary, 'title' | 'session_id'> | null | undefined): string {
  return session?.title?.trim() || 'Untitled session';
}

export function shortId(value: string | null | undefined): string {
  if (!value) return 'unknown';
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-4)}` : value;
}

export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '';
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  if (diff < 45_000) return 'Now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h`;
  if (diff < 48 * 60 * 60_000) return 'Yesterday';
  if (diff < 7 * 24 * 60 * 60_000) {
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null) return 'unknown';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusLabel(status: string): string {
  const value = status.trim();
  if (!value) return 'Status unknown';
  return value.replace(/_/g, ' ');
}

export function isRunning(status: string): boolean {
  return ['running', 'generating', 'working', 'thinking', 'tool_running', 'streaming'].includes(status);
}

export function providerLabel(runtime: { provider?: string | null; model?: string | null } | null): string {
  if (!runtime?.provider && !runtime?.model) return 'Provider unknown';
  return [runtime.provider, runtime.model].filter(Boolean).join(' · ');
}

export interface PlanTodo {
  id: string;
  content: string;
  status: string;
  group: string;
  priority?: string;
  blockedBy?: string[];
  completionConfidence?: string;
}

export interface PlanGroup {
  name: string;
  todos: PlanTodo[];
  completed: number;
}

export interface ParsedPlan {
  title: string | null;
  intention: string | null;
  todos: PlanTodo[];
  groups: PlanGroup[];
  completed: number;
  total: number;
  active: PlanTodo | null;
}

interface RawTodo {
  id?: string;
  content?: string;
  status?: string;
  group?: string;
  lane?: string;
  priority?: string;
  blocked_by?: string[];
  completion_confidence?: string;
}

export function parsePlan(raw: unknown): ParsedPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { todos?: RawTodo[]; plan?: { title?: string; user_intention?: string } };
  if (!Array.isArray(record.todos) || record.todos.length === 0) return null;
  const todos: PlanTodo[] = record.todos
    .filter((todo) => typeof todo.content === 'string' && todo.content.trim().length > 0)
    .map((todo, index) => ({
      id: todo.id ?? `todo-${index}`,
      content: todo.content!.trim(),
      status: todo.status ?? 'pending',
      group: (todo.group ?? todo.lane ?? 'Work').trim() || 'Work',
      priority: todo.priority,
      blockedBy: todo.blocked_by,
      completionConfidence: todo.completion_confidence,
    }));
  if (!todos.length) return null;
  const groups: PlanGroup[] = [];
  const byName = new Map<string, PlanGroup>();
  for (const todo of todos) {
    let group = byName.get(todo.group);
    if (!group) {
      group = { name: todo.group, todos: [], completed: 0 };
      byName.set(todo.group, group);
      groups.push(group);
    }
    group.todos.push(todo);
    if (todo.status === 'completed') group.completed += 1;
  }
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  return {
    title: record.plan?.title?.trim() || null,
    intention: record.plan?.user_intention?.trim() || null,
    todos,
    groups,
    completed,
    total: todos.length,
    active: todos.find((todo) => todo.status === 'in_progress') ?? null,
  };
}

export function operationLabel(state: string | null | undefined): string {
  switch (state) {
    case 'staged':
      return 'Draft saved on this phone';
    case 'reserved':
      return 'Reserved on the server';
    case 'dispatching':
      return 'Sending to server';
    case 'accepted':
      return 'Sent to server · bridge acknowledged';
    case 'rejected':
      return 'Rejected by server';
    case 'unknown':
      return 'Delivery unconfirmed';
    case 'observed_in_history':
      return 'Seen in server history';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

export function agentStateLabel(state: {
  turnId: string | null;
  status: string;
  phase: string;
  operationId: string | null;
}): string {
  if (state.phase) return state.phase;
  if (state.turnId) return state.status === 'dispatching' ? 'Sending' : state.status === 'accepted' ? 'Accepted' : state.status;
  return state.status && state.status !== 'idle' ? state.status : 'Ready';
}
