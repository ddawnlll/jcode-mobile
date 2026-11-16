/**
 * Tool-call presentation derived only from fields JCode actually reported.
 *
 * JCode adds a required `intent` string to every tool input schema. That
 * source-backed label is preferred. When it is absent we show a deterministic
 * tool-family label plus an observed argument summary; we never invent a goal
 * or attribute a guessed purpose to the model.
 *
 * Execution state stays in `toolStatus.ts`. This module only turns raw input,
 * paths, commands and result text into a readable presentation.
 */
import type { HistoryMessageView } from './protocol';

export type ToolFamily =
  | 'bash'
  | 'read'
  | 'write'
  | 'edit'
  | 'apply_patch'
  | 'search'
  | 'find'
  | 'web_search'
  | 'web_fetch'
  | 'plan'
  | 'subagent'
  | 'mcp'
  | 'batch'
  | 'other';

export type InputParseState = 'empty' | 'complete' | 'partial' | 'invalid';

export interface ToolEdit {
  oldText: string;
  newText: string;
  replaceAll: boolean;
}

export interface ToolDescriptor {
  /** Primary collapsed label: source intent, else the family label. */
  label: string;
  /** Deterministic tool-family label, e.g. "Run command". */
  familyLabel: string;
  /** One-line observed argument summary. Empty when nothing was parseable. */
  summary: string;
  /** Exact tool name from the event. */
  raw: string;
  family: ToolFamily;
  /** Source-backed input.intent, unmodified. Null when the source omitted it. */
  intent: string | null;
  /** Redacted, compact form for the collapsed row. */
  intentPreview: string | null;
  /** Exact path from the input, when one was reported. */
  path: string | null;
  /** Basename of `path`; safe for a filename-first card. */
  basename: string | null;
  /** Full directory portion of `path`, when present. */
  directory: string | null;
  /** Last two directory segments, for duplicate-basename disambiguation. */
  directoryHint: string | null;
  command: string | null;
  cwd: string | null;
  content: string | null;
  edits: ToolEdit[];
  oldText: string | null;
  newText: string | null;
  patch: string | null;
  query: string | null;
  parseState: InputParseState;
}

export interface ToolOutputFacts {
  /** ANSI-stripped display text. Raw output is never modified. */
  display: string;
  /** Authoritative diff JCode attached to a file-mutating result, if any. */
  diff: string | null;
  /** Human summary before the attached diff block. */
  summary: string;
  exitCode: number | null;
  hasAnsi: boolean;
  truncated: boolean;
}

interface FamilyRule {
  family: ToolFamily;
  label: string;
  names: string[];
}

const FAMILIES: FamilyRule[] = [
  {
    family: 'bash',
    label: 'Run command',
    names: ['bash', 'shell', 'shell_exec', 'exec', 'run', 'terminal', 'sh', 'command', 'run_command'],
  },
  {
    family: 'read',
    label: 'Read file',
    names: ['read', 'read_file', 'file_read', 'cat', 'open_file', 'view_file'],
  },
  {
    family: 'write',
    label: 'Write file',
    names: ['write', 'write_file', 'file_write', 'create_file', 'create'],
  },
  {
    family: 'edit',
    label: 'Edit file',
    names: ['edit', 'edit_file', 'file_edit', 'str_replace', 'replace', 'replace_in_file'],
  },
  {
    family: 'apply_patch',
    label: 'Apply patch',
    names: ['apply_patch', 'applypatch', 'patch'],
  },
  {
    family: 'search',
    label: 'Search code',
    names: ['agentgrep', 'grep', 'file_grep', 'search_code', 'code_search', 'search', 'rg'],
  },
  {
    family: 'find',
    label: 'Find files',
    names: ['glob', 'find_files', 'list_files', 'ls', 'file_glob', 'file_search', 'find'],
  },
  {
    family: 'web_search',
    label: 'Search web',
    names: ['web_search', 'websearch', 'search_web', 'tavily_search', 'google'],
  },
  {
    family: 'web_fetch',
    label: 'Fetch page',
    names: ['web_fetch', 'webfetch', 'fetch', 'browse', 'url_open'],
  },
  {
    family: 'plan',
    label: 'Update plan',
    names: ['todo', 'todo_write', 'todowrite', 'todo_read', 'todoread', 'todos', 'plan', 'update_plan'],
  },
  {
    family: 'subagent',
    label: 'Delegate task',
    names: ['task', 'task_runner', 'subagent', 'agent', 'communicate', 'spawn_agent', 'launch_agent'],
  },
  {
    family: 'batch',
    label: 'Batch calls',
    names: ['batch', 'parallel'],
  },
];

const FAMILY_BY_NAME = new Map<string, FamilyRule>();
for (const rule of FAMILIES) {
  for (const name of rule.names) FAMILY_BY_NAME.set(name, rule);
}

const PATH_KEYS = ['file_path', 'path', 'filename', 'file', 'target_file'];
const COMMAND_KEYS = ['command', 'cmd', 'script'];
const CWD_KEYS = ['cwd', 'working_dir', 'workdir'];
const CONTENT_KEYS = ['content', 'file_text', 'text'];
const PATCH_KEYS = ['patch_text', 'patch', 'diff'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeToolName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  if (/^mcp(?:(?:__|\.)|_tool$|$)/i.test(trimmed)) return 'mcp';
  return trimmed
    .replace(/^functions\./i, '')
    .replace(/^tools?\./i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function familyOf(name: string): { family: ToolFamily; label: string } {
  const normalized = normalizeToolName(name);
  if (!normalized) return { family: 'other', label: 'Tool call' };
  if (normalized === 'mcp') return { family: 'mcp', label: 'Call MCP tool' };
  const rule = FAMILY_BY_NAME.get(normalized);
  if (rule) return { family: rule.family, label: rule.label };
  // Providers occasionally suffix a canonical name (`bash_1`, `read_file_v2`).
  // Accept that only when the prefix is an exact known tool name.
  for (const [candidate, match] of FAMILY_BY_NAME) {
    if (normalized.startsWith(`${candidate}_`) && normalized.length > candidate.length + 1) {
      return { family: match.family, label: match.label };
    }
  }
  return {
    family: 'other',
    label: (name ?? '').trim().replace(/[_-]+/g, ' ') || 'Tool call',
  };
}

/** Longest matching family wins so "web_search" is not read as "search". */
export function toolIntent(name: string): string {
  const value = (name ?? '').trim();
  if (!value) return 'Tool call';
  return familyOf(value).label;
}

function firstString(payload: unknown, keys: string[]): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function stringValue(payload: unknown, keys: string[]): string | null {
  const record = asRecord(payload);
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * Extract a complete JSON string field from possibly-incomplete streamed JSON.
 * This is deliberately narrow: it never guesses at an unterminated value, and
 * JSON.parse validates escapes before use.
 */
export function partialJsonString(source: string, key: string): string | null {
  if (!source.includes(`"${key}"`)) return null;
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
  const match = pattern.exec(source);
  if (!match) return null;
  try {
    const value = JSON.parse(`"${match[1]}"`);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function parseInput(input: string | null | undefined): { value: unknown; state: InputParseState } {
  if (!input) return { value: null, state: 'empty' };
  const trimmed = input.trim();
  if (!trimmed) return { value: null, state: 'empty' };
  try {
    return { value: JSON.parse(trimmed), state: 'complete' };
  } catch {
    return {
      value: null,
      state: /^[{[]/.test(trimmed) ? 'partial' : 'invalid',
    };
  }
}

function stripWindowsNamespace(path: string): string {
  return path.replace(/^\\\\\?\\/, '');
}

/** POSIX and Windows basename without rewriting the reported path. */
export function pathParts(path: string | null): {
  path: string | null;
  basename: string | null;
  directory: string | null;
  directoryHint: string | null;
} {
  if (!path) return { path: null, basename: null, directory: null, directoryHint: null };
  const value = stripWindowsNamespace(path.trim());
  if (!value) return { path: null, basename: null, directory: null, directoryHint: null };
  const withoutTrailer = value.length > 1 ? value.replace(/[\\/]+$/, '') : value;
  const at = Math.max(withoutTrailer.lastIndexOf('/'), withoutTrailer.lastIndexOf('\\'));
  const basename = at >= 0 ? withoutTrailer.slice(at + 1) : withoutTrailer;
  const directory = at > 0 ? withoutTrailer.slice(0, at) : at === 0 ? '/' : null;
  const segments = directory?.split(/[\\/]+/).filter(Boolean) ?? [];
  const directoryHint = segments.length
    ? `…/${segments.slice(-2).join('/')}`
    : null;
  return {
    path: value,
    basename: basename || null,
    directory,
    directoryHint,
  };
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/((?:password|passwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1[redacted]'],
  [/(--(?:password|passwd|token|secret|api-key|access-key)(?:=|\s+))\S+/gi, '$1[redacted]'],
  [/((?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+)\S+/gi, '$1[redacted]'],
  [/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, '[redacted]'],
];

/** Redact common credential shapes from one-line previews only. */
export function redactSecrets(value: string): string {
  let result = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function clampText(value: string, max = 160): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function firstLine(value: string | null, max = 160): string {
  if (!value) return '';
  return clampText(value.split(/\r?\n/, 1)[0] ?? '', max);
}

function editsFromInput(payload: unknown): ToolEdit[] {
  const record = asRecord(payload);
  if (!record) return [];
  const edits: ToolEdit[] = [];
  const array = record.edits;
  if (Array.isArray(array)) {
    for (const entry of array) {
      const edit = asRecord(entry);
      if (!edit) continue;
      const oldText = typeof edit.old_string === 'string' ? edit.old_string : null;
      const newText = typeof edit.new_string === 'string' ? edit.new_string : null;
      if (oldText == null || newText == null) continue;
      edits.push({
        oldText,
        newText,
        replaceAll: edit.replace_all === true,
      });
    }
  }
  if (!edits.length) {
    const oldText = typeof record.old_string === 'string' ? record.old_string : null;
    const newText = typeof record.new_string === 'string' ? record.new_string : null;
    if (oldText != null && newText != null) {
      edits.push({ oldText, newText, replaceAll: record.replace_all === true });
    }
  }
  return edits;
}

function patchPath(patch: string): string | null {
  const match = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/m.exec(patch);
  return match?.[1]?.trim() || null;
}

function patchText(payload: unknown, raw: string): string | null {
  const fromPayload = firstString(payload, PATCH_KEYS);
  if (fromPayload) return fromPayload;
  if (/^\*\*\* Begin Patch/m.test(raw)) return raw;
  return null;
}

function observedSummary(
  family: ToolFamily,
  payload: unknown,
  rawInput: string,
  parts: ReturnType<typeof pathParts>,
  command: string | null,
): string {
  const record = asRecord(payload);
  if (family === 'bash') return firstLine(command);
  if (family === 'read' || family === 'write' || family === 'edit' || family === 'apply_patch') {
    return parts.basename ?? '';
  }
  if (family === 'search' || family === 'find') {
    const pattern =
      firstString(payload, ['pattern', 'query', 'regex']) ??
      partialJsonString(rawInput, 'pattern') ??
      partialJsonString(rawInput, 'query');
    const scope =
      firstString(payload, ['path', 'glob', 'include', 'directory']) ??
      partialJsonString(rawInput, 'path') ??
      partialJsonString(rawInput, 'glob');
    return [pattern, scope].filter(Boolean).join(' in ');
  }
  if (family === 'web_search') {
    return firstString(payload, ['query', 'q', 'search_query']) ?? '';
  }
  if (family === 'web_fetch') {
    return firstString(payload, ['url', 'query']) ?? '';
  }
  if (family === 'plan') {
    return firstString(payload, ['content', 'title', 'description', 'summary']) ?? '';
  }
  if (family === 'subagent') {
    return firstString(payload, ['description', 'label', 'prompt', 'task', 'title']) ?? '';
  }
  if (family === 'mcp') {
    return firstString(payload, ['description', 'query', 'summary', 'name']) ?? '';
  }
  if (family === 'batch') {
    const subcalls = record && Array.isArray(record.calls) ? record.calls.length : 0;
    return subcalls ? `${subcalls} subcalls` : '';
  }
  return firstString(payload, ['description', 'query', 'path', 'command', 'content', 'name']) ?? '';
}

/**
 * Build the presentation descriptor. `parsed` lets callers pass an already
 * parsed history input without stringifying it again.
 */
export function describeToolCall(
  name: string,
  input: string | null | undefined,
  parsed?: unknown,
): ToolDescriptor {
  const raw = (name ?? '').trim() || 'tool';
  const { family, label: familyLabel } = familyOf(raw);
  const sourceInput = input ?? '';
  // A write can stream megabytes of file content. Reparse the full payload on
  // every delta only once it looks complete; until then, extract the small
  // source fields we need from a bounded window.
  const completeish =
    sourceInput.length <= 256 * 1024 || /[}\]]\s*$/.test(sourceInput);
  const parsedInput = parsed !== undefined
    ? { value: parsed, state: 'complete' as const }
    : completeish
      ? parseInput(sourceInput)
      : { value: null, state: 'partial' as const };
  const payload = parsedInput.value;
  const searchable =
    sourceInput.length > 64 * 1024
      ? `${sourceInput.slice(0, 64 * 1024)}\n${sourceInput.slice(-4096)}`
      : sourceInput;
  const payloadRecord = asRecord(payload);

  const intent =
    (typeof payloadRecord?.intent === 'string'
      ? (payloadRecord.intent as string).trim()
      : '') ||
    partialJsonString(searchable, 'intent')?.trim() ||
    null;

  let command =
    firstString(payload, COMMAND_KEYS) ??
    partialJsonString(searchable, 'command') ??
    partialJsonString(searchable, 'cmd');
  if (family === 'bash' && !command && parsedInput.state === 'invalid') {
    command = sourceInput.trim() || null;
  }
  const patch = patchText(payload, sourceInput);
  const path =
    firstString(payload, PATH_KEYS) ??
    partialJsonString(searchable, 'file_path') ??
    partialJsonString(searchable, 'path') ??
    (patch ? patchPath(patch) : null);
  const parts = pathParts(path);
  const content = stringValue(payload, CONTENT_KEYS);
  const edits = editsFromInput(payload);
  const oldText = edits[0]?.oldText ?? stringValue(payload, ['old_string']);
  const newText = edits[0]?.newText ?? stringValue(payload, ['new_string']);
  const cwd =
    firstString(payload, CWD_KEYS) ??
    partialJsonString(searchable, 'cwd') ??
    partialJsonString(searchable, 'working_dir');
  const query =
    firstString(payload, ['query', 'pattern', 'url', 'q']) ??
    partialJsonString(searchable, 'query') ??
    partialJsonString(searchable, 'pattern');

  const summary = clampText(redactSecrets(observedSummary(family, payload, searchable, parts, command)));
  const intentPreview = intent ? clampText(redactSecrets(intent), 200) : null;

  return {
    label: intent ?? familyLabel,
    familyLabel,
    summary,
    raw,
    family,
    intent,
    intentPreview,
    path: parts.path,
    basename: parts.basename,
    directory: parts.directory,
    directoryHint: parts.directoryHint,
    command,
    cwd,
    content,
    edits,
    oldText,
    newText,
    patch,
    query,
    parseState: parsedInput.state,
  };
}

/** Remove terminal control sequences for display only. */
export function stripAnsi(value: string): string {
  let output = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x1b) {
      const next = value[i + 1];
      if (next === '[') {
        i += 2;
        while (i < value.length && !(value[i] >= '@' && value[i] <= '~')) i += 1;
      } else if (next === ']') {
        i += 1;
        while (i < value.length && value[i] !== '\u0007') {
          if (value[i] === '\u001b' && value[i + 1] === '\\') {
            i += 1;
            break;
          }
          i += 1;
        }
      }
      continue;
    }
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) continue;
    output += value[i];
  }
  return output;
}

function parseExitCode(output: string): number | null {
  const patterns = [
    /(?:^|\n)\s*Exit code:\s*(-?\d+)\s*$/,
    /---\s*Command finished with exit code:\s*(-?\d+)\s*---/,
    /Command exited with code\s*(-?\d+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match) return Number(match[1]);
  }
  return null;
}

/** JCode appends its exit footer to text results; show it once as metadata. */
function withoutExitFooter(output: string, exitCode: number | null): string {
  if (exitCode == null) return output;
  return output
    .replace(/\n+Exit code:\s*-?\d+\s*$/, '')
    .replace(/\n*---\s*Command finished with exit code:\s*-?\d+\s*---\s*$/, '')
    .replace(/\n*Command exited with code\s*-?\d+\s*$/, '')
    .trimEnd();
}

function splitAttachedDiff(output: string): { summary: string; diff: string | null } {
  const match = /\n*File diff:\n```diff\n([\s\S]*?)```\s*$/.exec(output);
  if (match) {
    return {
      summary: output.slice(0, match.index).replace(/\s+$/, ''),
      diff: match[1].replace(/\s+$/, ''),
    };
  }
  if ((/^--- /m.test(output) && /^\+\+\+ /m.test(output) && /^@@ /m.test(output))) {
    return { summary: '', diff: output };
  }
  return { summary: output, diff: null };
}

/** Source facts for the expanded tool card. */
export function analyzeToolOutput(output: string): ToolOutputFacts {
  const display = stripAnsi(output ?? '');
  const exitCode = parseExitCode(display);
  const { summary, diff } = splitAttachedDiff(withoutExitFooter(display, exitCode));
  return {
    display,
    diff,
    summary: summary.replace(/\n*File diff:\n```diff\n[\s\S]*?```\s*$/, '').trimEnd(),
    exitCode,
    hasAnsi: (output ?? '').includes('\u001b'),
    truncated: /\.\.\. \(output truncated\)|more lines \(use /.test(display),
  };
}

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
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
