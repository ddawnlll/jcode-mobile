/**
 * Human labels for tool calls. The raw tool name is always kept beside the
 * label so the UI never hides what actually ran.
 */
import type { HistoryMessageView } from './protocol';

export interface ToolDescriptor {
  /** Human intent label, e.g. "Read file". */
  label: string;
  /** One-line observed argument summary. Empty when nothing parseable. */
  summary: string;
  /** Exact tool name from the event. */
  raw: string;
}

const INTENTS: Array<[RegExp, string]> = [
  [/^(bash|shell|exec|run|terminal|sh)$/, 'Run command'],
  [/^(read|read_file|cat|open_file|view_file)$/, 'Read file'],
  [/^(write|write_file|create_file|create)$/, 'Write file'],
  [/^(edit|edit_file|apply_patch|patch|str_replace|multiedit)$/, 'Edit file'],
  [/^(grep|rg|search_code|code_search)$/, 'Search code'],
  [/^(glob|find_files|list_files|ls|file_search)$/, 'Find files'],
  [/^(web_search|websearch|search_web|tavily_search|google)$/, 'Search web'],
  [/^(web_fetch|webfetch|fetch|browse|url_open)$/, 'Fetch page'],
  [/^(task|todo|todo_write|plan|update_plan|todowrite)$/, 'Update plan'],
  [/^(agent|subagent|spawn_agent|delegate)$/, 'Delegate task'],
  [/^(mcp|mcp_tool)$/, 'Call MCP tool'],
];

function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^mcp__/, '')
    .replace(/^functions\./, '')
    .replace(/[^a-z0-9_]+/g, '_');
}

/** Longest matching family wins so "web_search" is not read as "search". */
export function toolIntent(name: string): string {
  const value = normalize(name);
  if (!value) return 'Tool call';
  let best: string | null = null;
  let bestLength = 0;
  for (const [pattern, label] of INTENTS) {
    for (const candidate of value.split('_')) {
      if (pattern.test(candidate) && candidate.length > bestLength) {
        best = label;
        bestLength = candidate.length;
      }
    }
    if (pattern.test(value)) return label;
  }
  if (best) return best;
  return name.trim() ? name.trim().replace(/[_-]+/g, ' ') : 'Tool call';
}

function firstString(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function parseInput(input: string | null | undefined): unknown {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function clampText(value: string, max = 120): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

export function describeToolCall(
  name: string,
  input: string | null | undefined,
  parsed?: unknown,
): ToolDescriptor {
  const raw = name?.trim() || 'tool';
  const label = toolIntent(name);
  const payload = parsed ?? parseInput(input);
  const normalized = normalize(name);
  let summary = '';

  if (/(bash|shell|exec|run|terminal)/.test(normalized)) {
    summary = firstString(payload, ['command', 'cmd', 'script']) ?? '';
  } else if (/(read|write|edit|patch|view|open_file|create_file)/.test(normalized)) {
    summary = firstString(payload, ['file_path', 'path', 'filename', 'file']) ?? '';
  } else if (/(grep|search_code|code_search)/.test(normalized)) {
    const pattern = firstString(payload, ['pattern', 'query', 'regex']);
    const path = firstString(payload, ['path', 'glob', 'include']);
    summary = [pattern, path].filter(Boolean).join(' in ');
  } else if (/(web_search|websearch|search_web|web_fetch|fetch|browse)/.test(normalized)) {
    summary = firstString(payload, ['query', 'url', 'q']) ?? '';
  } else if (/(task|todo|plan)/.test(normalized)) {
    summary = firstString(payload, ['content', 'title', 'description', 'summary']) ?? '';
  } else {
    summary = firstString(payload, ['description', 'query', 'path', 'command', 'content', 'name']) ?? '';
  }

  return { label, summary: clampText(summary), raw };
}

export type DiffKind = 'add' | 'remove' | 'hunk' | 'context' | 'meta';

export function looksLikeDiff(value: string): boolean {
  if (!value) return false;
  return (
    /^diff --git /m.test(value) ||
    /^@@ -\d+/m.test(value) ||
    (/^\+\+\+ /m.test(value) && /^--- /m.test(value))
  );
}

export function classifyDiffLine(line: string): DiffKind {
  if (/^(\+\+\+|---|diff --git|index |new file|deleted file|similarity index)/.test(line)) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

/** Groups consecutive assistant chunks into one bubble for history replay. */
export type HistoryEntry =
  | { kind: 'user'; key: string; content: string }
  | { kind: 'assistant'; key: string; content: string }
  | { kind: 'tool'; key: string; message: HistoryMessageView }
  | { kind: 'other'; key: string; role: string; content: string };

export function groupHistory(messages: HistoryMessageView[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const message of messages) {
    const last = entries[entries.length - 1];
    if (message.role === 'assistant') {
      const content = (message.content ?? '').trim();
      if (!content) continue;
      if (last && last.kind === 'assistant') {
        last.content = `${last.content}\n\n${content}`;
      } else {
        entries.push({ kind: 'assistant', key: `assistant-${message.index}`, content });
      }
      continue;
    }
    if (message.role === 'user') {
      entries.push({ kind: 'user', key: `user-${message.index}`, content: message.content ?? '' });
      continue;
    }
    if (message.role === 'tool') {
      entries.push({ kind: 'tool', key: `tool-${message.index}`, message });
      continue;
    }
    if ((message.content ?? '').trim()) {
      entries.push({
        kind: 'other',
        key: `other-${message.index}`,
        role: message.role,
        content: message.content,
      });
    }
  }
  return entries;
}
