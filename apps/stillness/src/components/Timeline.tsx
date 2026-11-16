/**
 * Single chronological conversation timeline.
 *
 * History messages and live events render through the same rail: reasoning
 * segments, tool calls (start → input → exec → done in observed order), and
 * assistant text. Every block carries a stable key and its own copy control.
 *
 * Tool cards are presentation only. JCode's source `intent` is shown verbatim
 * when reported; otherwise the card names the tool family and describes only
 * fields that were actually observed.
 */
import {
  Suspense,
  lazy,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentType } from 'react';
import type { HistoryMessageView } from '../lib/protocol';
import { orderedTimeline } from '../lib/timelineJournal';
import type { JournalTool } from '../lib/timelineJournal';
import { toolPresentation } from '../lib/toolStatus';
import type { LiveState } from '../lib/controller';
import {
  analyzeToolOutput,
  classifyDiffLine,
  describeToolCall,
  diffStats,
  groupHistory,
  looksLikeDiff,
} from '../lib/toolLabels';
import type { ToolDescriptor, ToolFamily, ToolOutputFacts } from '../lib/toolLabels';
import { PagedText, TEXT_PAGE_CHARS } from './PagedText';
import {
  IconChevron,
  IconEdit,
  IconFile,
  IconFilePlus,
  IconFolder,
  IconGlobe,
  IconLayers,
  IconList,
  IconSearch,
  IconServer,
  IconSparkles,
  IconTerminal,
  IconWrench,
} from './Icons';
import { CopyButton } from './ui';
import { Torus } from './Torus';

const RichMarkdown = lazy(async () => ({ default: (await import('./RichMarkdown')).RichMarkdown }));
const HISTORY_PAGE = 32;

const FAMILY_ICON: Record<ToolFamily, ComponentType<{ size?: number; className?: string }>> = {
  bash: IconTerminal,
  read: IconFile,
  write: IconFilePlus,
  edit: IconEdit,
  apply_patch: IconEdit,
  search: IconSearch,
  find: IconFolder,
  web_search: IconGlobe,
  web_fetch: IconGlobe,
  plan: IconList,
  subagent: IconSparkles,
  mcp: IconServer,
  batch: IconLayers,
  other: IconWrench,
};

const FILE_FAMILIES = new Set<ToolFamily>(['read', 'write', 'edit', 'apply_patch']);

function DiffText({ text }: { text: string }) {
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <pre className="diff-block tool-diff">
      <code>
        {lines.map((line, index) => {
          const kind = classifyDiffLine(line);
          return (
            <span key={index} className={`diff-line diff-${kind}`}>
              {line.length ? line : '\u00a0'}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

function ToolFamilyIcon({ family }: { family: ToolFamily }) {
  const Icon = FAMILY_ICON[family] ?? IconWrench;
  return (
    <span className={`tool-family-icon is-${family}`} aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

function SectionHead({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-section-head">
      <span className="small-heading flush">{label}</span>
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} icon />
    </div>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <pre className="tool-command" aria-label="Exact command">
      <code>{command}</code>
    </pre>
  );
}

function PathRow({ path }: { path: string }) {
  return (
    <div className="tool-path-row">
      <IconFile size={14} className="tool-path-icon" />
      <code className="tool-path">{path}</code>
      <CopyButton value={path} label="Copy full path" icon />
    </div>
  );
}

function ExitMeta({ facts, shown }: { facts: ToolOutputFacts; shown: boolean }) {
  if (!shown) return null;
  return (
    <div className="tool-meta-row">
      <span className="tool-meta-label">Exit</span>
      {facts.exitCode == null ? (
        <span className="tool-exit is-unknown">not reported</span>
      ) : (
        <span className={`tool-exit ${facts.exitCode === 0 ? 'is-ok' : 'is-error'}`}>
          {facts.exitCode}
        </span>
      )}
      {facts.hasAnsi ? <span className="tool-meta-note">ANSI escapes stripped in view</span> : null}
      {facts.truncated ? <span className="tool-meta-note">source output is truncated</span> : null}
    </div>
  );
}

function FileResult({
  facts,
  streaming,
  label,
}: {
  facts: ToolOutputFacts;
  streaming: boolean;
  label: string;
}) {
  if (!facts.summary && !facts.diff) return null;
  return (
    <div className="tool-section">
      <SectionHead label={label} value={facts.display || facts.summary} />
      {facts.summary ? (
        <PagedText className="tool-payload tool-result-text" text={facts.summary} streaming={streaming} />
      ) : null}
      {facts.diff ? (
        <>
          <div className="tool-diff-head">
            <span className="tool-diff-stat is-add">+{diffStats(facts.diff).added}</span>
            <span className="tool-diff-stat is-remove">−{diffStats(facts.diff).removed}</span>
            <span className="tool-diff-kind">source diff</span>
          </div>
          <DiffText text={facts.diff} />
        </>
      ) : null}
    </div>
  );
}

function EditPreview({ descriptor }: { descriptor: ToolDescriptor }) {
  if (!descriptor.edits.length) {
    if (descriptor.oldText == null && descriptor.newText == null) return null;
    return (
      <div className="tool-section">
        <SectionHead
          label="Requested change"
          value={`${descriptor.oldText ?? ''}\n→\n${descriptor.newText ?? ''}`}
        />
        <DiffText
          text={[
            ...(descriptor.oldText ?? '').replace(/\n$/, '').split('\n').map((line) => `-${line}`),
            ...(descriptor.newText ?? '').replace(/\n$/, '').split('\n').map((line) => `+${line}`),
          ].join('\n')}
        />
      </div>
    );
  }
  return (
    <div className="tool-section">
      <div className="tool-section-head">
        <span className="small-heading flush">
          Requested change{descriptor.edits.length > 1 ? `s · ${descriptor.edits.length}` : ''}
        </span>
        <CopyButton
          value={descriptor.edits
            .map((edit, index) => [
              descriptor.edits.length > 1 ? `Edit ${index + 1}` : 'Edit',
              `- ${edit.oldText}`,
              `+ ${edit.newText}`,
            ].join('\n'))
            .join('\n\n')}
          label="Copy requested changes"
          icon
        />
      </div>
      {descriptor.edits.map((edit, index) => (
        <div className="tool-edit-block" key={index}>
          {descriptor.edits.length > 1 ? <span className="tool-edit-label">Edit {index + 1}</span> : null}
          <DiffText
            text={[
              ...edit.oldText.replace(/\n$/, '').split('\n').map((line) => `-${line}`),
              ...edit.newText.replace(/\n$/, '').split('\n').map((line) => `+${line}`),
            ].join('\n')}
          />
        </div>
      ))}
    </div>
  );
}

function RawDetails({ tool, descriptor }: { tool: JournalTool; descriptor: ToolDescriptor }) {
  const rawInput = tool.input || '';
  return (
    <details className="tool-raw-details">
      <summary>Raw details</summary>
      <div className="tool-raw-facts">
        <span>tool</span>
        <code>{tool.name}</code>
        <span>input</span>
        <code>{descriptor.parseState}</code>
        <span>status</span>
        <code>{tool.status}</code>
      </div>
      <SectionHead label="Exact input" value={rawInput || '(empty)'} />
      <PagedText className="tool-payload tool-raw-input" text={rawInput || '(empty)'} />
    </details>
  );
}

function ToolCallCardView({
  tool,
  parsedInput,
  onUserExpand,
  turnActive = false,
  connected = false,
}: {
  tool: JournalTool;
  parsedInput?: unknown;
  onUserExpand?: () => void;
  turnActive?: boolean;
  connected?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const headRef = useRef<HTMLButtonElement>(null);
  const anchorTop = useRef<number | null>(null);
  const bodyId = useId();
  const descriptor = useMemo(
    () => describeToolCall(tool.name, tool.input, parsedInput),
    [tool.name, tool.input, parsedInput],
  );
  const facts = useMemo(() => analyzeToolOutput(tool.output), [tool.output]);
  const presentation = toolPresentation(tool, turnActive, connected);
  const effectiveStatus = presentation.kind;
  const prettyInput = useMemo(() => {
    if (!open || !tool.input) return '';
    try {
      return JSON.stringify(JSON.parse(tool.input), null, 2);
    } catch {
      return tool.input;
    }
  }, [open, tool.input]);
  const copyValue = () => [tool.name, tool.input && `INPUT\n${tool.input}`, tool.output && `OUTPUT\n${tool.output}`, tool.error]
    .filter(Boolean)
    .join('\n\n');

  const primary = descriptor.intentPreview
    ?? (FILE_FAMILIES.has(descriptor.family) && descriptor.basename
      ? descriptor.basename
      : descriptor.familyLabel);
  const secondaryParts: string[] = [];
  if (FILE_FAMILIES.has(descriptor.family) && descriptor.basename) {
    secondaryParts.push(descriptor.basename);
    if (descriptor.intentPreview) secondaryParts.push(descriptor.familyLabel);
    if (descriptor.directoryHint) secondaryParts.push(descriptor.directoryHint);
  } else if (descriptor.summary && descriptor.summary !== primary) {
    if (descriptor.intentPreview) secondaryParts.push(descriptor.familyLabel);
    secondaryParts.push(descriptor.summary);
  }
  if (presentation.taskId) secondaryParts.push(`task ${presentation.taskId}`);
  const secondary = secondaryParts.filter(Boolean).join(' · ');

  const isBash = descriptor.family === 'bash';
  const isFile = FILE_FAMILIES.has(descriptor.family);
  const outputSettled = presentation.kind !== 'running' && presentation.kind !== 'started';
  const hasStructuredDetails = Boolean(
    descriptor.path
    || descriptor.command
    || descriptor.content != null
    || descriptor.edits.length
    || descriptor.patch
    || descriptor.summary
    || tool.output
    || tool.error,
  );

  useLayoutEffect(() => {
    const before = anchorTop.current;
    anchorTop.current = null;
    if (before == null) return;
    const head = headRef.current;
    if (!head?.isConnected) return;
    const scroll = head.closest('.transcript-scroll') as HTMLElement | null;
    if (!scroll) return;
    scroll.scrollTop += head.getBoundingClientRect().top - before;
  }, [open]);

  const toggle = () => {
    const opening = !open;
    if (opening) onUserExpand?.();
    anchorTop.current = headRef.current?.getBoundingClientRect().top ?? null;
    setOpen(opening);
  };

  return (
    <div className={`timeline-item tool-item is-${effectiveStatus}`}>
      <span className="timeline-marker" aria-hidden="true" />
      <div className={`timeline-body tool-card ${effectiveStatus}`} data-testid="tool-card">
        <div className="tool-card-head">
          <button
            ref={headRef}
            type="button"
            className="tool-expand"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${descriptor.familyLabel}${descriptor.intent ? `: ${descriptor.intent}` : ''}`}
            onClick={toggle}
          >
            <ToolFamilyIcon family={descriptor.family} />
            <span className="tool-headings">
              <span className="tool-primary" data-testid="tool-intent">{primary}</span>
              {secondary ? <span className="tool-secondary">{secondary}</span> : null}
            </span>
            <IconChevron size={15} className={`tool-chevron ${open ? 'is-open' : ''}`} />
          </button>
          <span
            className={`tool-status is-${effectiveStatus}`}
            title={presentation.label}
            role="status"
            aria-live="polite"
            aria-label={presentation.label}
          >
            {presentation.short}
          </span>
          <CopyButton value={copyValue} label="Copy tool call" icon />
        </div>
        {open ? (
          <div className="tool-card-body" id={bodyId}>
            <p className="tool-provenance">
              {descriptor.intent
                ? 'Intent supplied by JCode.'
                : `No intent was supplied; showing observed fields for ${descriptor.raw}.`}
            </p>

            {descriptor.path ? <PathRow path={descriptor.path} /> : null}
            {descriptor.cwd && descriptor.cwd !== descriptor.directory ? (
              <div className="tool-path-row is-muted">
                <span className="tool-meta-label">cwd</span>
                <code className="tool-path">{descriptor.cwd}</code>
                <CopyButton value={descriptor.cwd} label="Copy working directory" icon />
              </div>
            ) : null}

            {isBash && descriptor.command ? (
              <div className="tool-section">
                <SectionHead label="Command" value={descriptor.command} />
                <CommandBlock command={descriptor.command} />
              </div>
            ) : null}

            {descriptor.family === 'write' && descriptor.content != null ? (
              <div className="tool-section">
                <div className="tool-section-head">
                  <span className="small-heading flush">
                    Requested content · {descriptor.content.split('\n').length} lines · {descriptor.content.length} B
                  </span>
                  <CopyButton value={descriptor.content} label="Copy requested content" icon />
                </div>
                <PagedText className="tool-payload tool-content-preview" text={descriptor.content || '(empty file)'} />
              </div>
            ) : null}

            {descriptor.family === 'edit' ? <EditPreview descriptor={descriptor} /> : null}

            {descriptor.family === 'apply_patch' && descriptor.patch ? (
              <div className="tool-section">
                <SectionHead label="Patch" value={descriptor.patch} />
                <DiffText text={descriptor.patch} />
              </div>
            ) : null}

            {descriptor.family === 'read' && tool.output ? (
              <div className="tool-section">
                <SectionHead label="File content" value={facts.display} />
                <PagedText
                  className="tool-payload tool-terminal-output is-read"
                  text={facts.display}
                  streaming={!outputSettled}
                />
              </div>
            ) : null}

            {isBash && tool.output ? (
              <div className="tool-section">
                <div className="tool-section-head">
                  <span className="small-heading flush">
                    Output · {facts.summary.split('\n').length} lines{facts.diff ? ' · source diff attached' : ''}
                  </span>
                  <CopyButton value={facts.display} label="Copy output" icon />
                </div>
                {facts.summary ? (
                  <pre className="tool-terminal-output">
                    <code>{facts.summary}</code>
                  </pre>
                ) : null}
                {facts.diff ? <DiffText text={facts.diff} /> : null}
                <ExitMeta facts={facts} shown={outputSettled} />
              </div>
            ) : null}

            {isFile && descriptor.family !== 'read' && tool.output ? (
              <FileResult facts={facts} streaming={!outputSettled} label="Result" />
            ) : null}

            {!isBash && !isFile && prettyInput ? (
              <div className="tool-section">
                <SectionHead label="Input" value={prettyInput} />
                <PagedText className="tool-payload" text={prettyInput} streaming={!outputSettled} />
              </div>
            ) : null}

            {!isBash && !isFile && tool.output ? (
              <div className="tool-section">
                <SectionHead label="Output" value={facts.display} />
                {facts.diff && looksLikeDiff(facts.diff) ? (
                  <DiffText text={facts.diff} />
                ) : (
                  <PagedText className="tool-payload" text={facts.summary || facts.display} streaming={!outputSettled} />
                )}
              </div>
            ) : null}

            {tool.error ? (
              <p className="inline-error" role="alert">
                {tool.error}
              </p>
            ) : null}

            {!hasStructuredDetails ? (
              <p className="form-help">No payload was reported for this call.</p>
            ) : null}

            <RawDetails tool={tool} descriptor={descriptor} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ToolCallCard = memo(
  ToolCallCardView,
  (previous, next) =>
    previous.turnActive === next.turnActive &&
    previous.connected === next.connected &&
    previous.parsedInput === next.parsedInput &&
    previous.tool.callId === next.tool.callId &&
    previous.tool.name === next.tool.name &&
    previous.tool.input === next.tool.input &&
    previous.tool.output === next.tool.output &&
    previous.tool.error === next.tool.error &&
    previous.tool.status === next.tool.status,
);

export const ReasoningSegment = memo(function ReasoningSegment({
  text,
  done,
  visibility,
  onUserExpand,
}: {
  text: string;
  done: boolean;
  visibility: 'compact' | 'hidden' | 'expanded';
  onUserExpand?: () => void;
}) {
  const [open, setOpen] = useState(visibility === 'expanded');
  const headRef = useRef<HTMLButtonElement>(null);
  const anchorTop = useRef<number | null>(null);
  useEffect(() => {
    setOpen(visibility === 'expanded');
  }, [visibility]);
  useLayoutEffect(() => {
    const before = anchorTop.current;
    anchorTop.current = null;
    if (before == null) return;
    const head = headRef.current;
    if (!head?.isConnected) return;
    const scroll = head.closest('.transcript-scroll') as HTMLElement | null;
    if (!scroll) return;
    scroll.scrollTop += head.getBoundingClientRect().top - before;
  }, [open]);
  const toggle = () => {
    if (!open) onUserExpand?.();
    anchorTop.current = headRef.current?.getBoundingClientRect().top ?? null;
    setOpen((value) => !value);
  };
  if (visibility === 'hidden') return null;
  return (
    <div className={`timeline-item reasoning-item ${done ? 'is-done' : 'is-live'}`}>
      <span className="timeline-marker" aria-hidden="true" />
      <div className="timeline-body reasoning-block">
        <div className="reasoning-head">
          <button
            ref={headRef}
            type="button"
            className="reasoning-toggle"
            aria-expanded={open}
            onClick={toggle}
          >
            <span className="reasoning-mark" aria-hidden="true">
              <Torus size={14} animated={!done} />
            </span>
            <span>Reasoning</span>
            <small role="status" aria-live="polite">{done ? 'complete' : 'thinking'}</small>
            <IconChevron size={14} className={`tool-chevron ${open ? 'is-open' : ''}`} />
          </button>
          <CopyButton value={text} label="Copy reasoning" icon />
        </div>
        {open ? (
          <PagedText className="reasoning-copy" text={text} streaming={!done} />
        ) : (
          <p className="reasoning-preview">{text.slice(0, 240).replace(/\s+/g, ' ').slice(0, 150)}</p>
        )}
      </div>
    </div>
  );
});

const AssistantBlock = memo(function AssistantBlock({
  text,
  streaming,
  testId,
}: {
  text: string;
  streaming: boolean;
  testId?: string;
}) {
  const plain = <PagedText streaming={streaming} text={text} className="chat-text" />;
  return (
    <article
      className={`chat-message assistant-msg timeline-assistant ${streaming ? 'is-streaming' : ''}`}
      data-testid={testId}
    >
      <div className="chat-meta">
        <span>JCode {streaming ? <span className="stream-caret">streaming</span> : null}</span>
        <CopyButton value={text} label="Copy message" icon />
      </div>
      {streaming || text.length > TEXT_PAGE_CHARS ? plain : (
        <Suspense fallback={plain}><RichMarkdown text={text} /></Suspense>
      )}
    </article>
  );
});

const UserMessage = memo(function UserMessage({ content }: { content: string }) {
  return (
    <article className="chat-message user-msg" data-testid="user-message">
      <div className="chat-meta">
        <span>You</span>
        <CopyButton value={content} label="Copy message" icon />
      </div>
      <PagedText className="chat-text" text={content} />
    </article>
  );
});

const HistoryToolCard = memo(function HistoryToolCard({
  message,
  fallbackId,
  onUserExpand,
}: {
  message: HistoryMessageView;
  fallbackId: string;
  onUserExpand?: () => void;
}) {
  const inputText = useMemo(() => {
    if (message.tool_input == null) return '';
    try {
      return JSON.stringify(message.tool_input);
    } catch {
      return '';
    }
  }, [message.tool_input]);
  return (
    <div className="timeline">
      <ToolCallCard
        tool={{
          callId: message.tool_call_id ?? fallbackId,
          name: message.tool_name ?? 'tool result',
          input: inputText,
          output: message.content ?? '',
          error: null,
          status: 'result',
        }}
        parsedInput={message.tool_input ?? undefined}
        onUserExpand={onUserExpand}
      />
    </div>
  );
});

export const HistoryTimeline = memo(function HistoryTimeline({
  messages,
  onUserExpand,
}: {
  messages: HistoryMessageView[];
  onUserExpand?: () => void;
}) {
  const entries = useMemo(() => groupHistory(messages), [messages]);
  const [visible, setVisible] = useState(HISTORY_PAGE);
  const anchor = useRef<{ element: Element; top: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const hidden = Math.max(0, entries.length - visible);

  useLayoutEffect(() => {
    const saved = anchor.current;
    anchor.current = null;
    if (!saved?.element.isConnected) return;
    const scroll = saved.element.closest('.transcript-scroll');
    if (scroll) scroll.scrollTop += saved.element.getBoundingClientRect().top - saved.top;
  }, [visible]);

  const showEarlier = () => {
    const element = list.current?.firstElementChild;
    if (element) anchor.current = { element, top: element.getBoundingClientRect().top };
    setVisible((count) => count + HISTORY_PAGE);
  };

  return (
    <>
      {hidden > 0 ? <button type="button" className="history-more" onClick={showEarlier}>Show earlier messages</button> : null}
      <div ref={list} className="history-items">
        {entries.slice(hidden).map((entry) => (
          <div className="history-item" key={entry.key}>
            <HistoryEntry entry={entry} onUserExpand={onUserExpand} />
          </div>
        ))}
      </div>
    </>
  );
});

const HistoryEntry = memo(function HistoryEntry({
  entry,
  onUserExpand,
}: {
  entry: ReturnType<typeof groupHistory>[number];
  onUserExpand?: () => void;
}) {
  if (entry.kind === 'user') return <UserMessage content={entry.content} />;
  if (entry.kind === 'assistant') {
    return <AssistantBlock text={entry.content} streaming={false} testId="assistant-message" />;
  }
  if (entry.kind === 'tool') {
    return <HistoryToolCard message={entry.message} fallbackId={entry.key} onUserExpand={onUserExpand} />;
  }
  return (
    <article className="chat-message">
      <div className="chat-meta">
        <span>{entry.role}</span>
        <CopyButton value={entry.content} label="Copy message" icon />
      </div>
      <PagedText className="chat-text" text={entry.content} />
    </article>
  );
});

export function LiveTimeline({
  live,
  visibility,
  connected,
  onUserExpand,
}: {
  live: LiveState;
  visibility: 'compact' | 'hidden' | 'expanded';
  connected: boolean;
  onUserExpand?: () => void;
}) {
  const items = useMemo(
    () => orderedTimeline(live.assistants, live.reasoning, live.tools),
    [live.assistants, live.reasoning, live.tools],
  );

  if (!items.length) return null;
  return (
    <div className="timeline live-timeline" data-testid="live-timeline">
      {items.map((item) => {
        if (item.kind === 'reasoning') {
          return (
            <ReasoningSegment
              key={item.id}
              text={item.block.text}
              done={item.block.done}
              visibility={visibility}
              onUserExpand={onUserExpand}
            />
          );
        }
        if (item.kind === 'tool') {
          return (
            <ToolCallCard
              key={item.id}
              tool={item.tool}
              onUserExpand={onUserExpand}
              turnActive={Boolean(live.turnId) || live.daemonRunning}
              connected={connected}
            />
          );
        }
        if (!item.block.text) return null;
        return (
          <AssistantBlock
            key={item.id}
            text={item.block.text}
            streaming={!item.block.done}
            testId="live-assistant-message"
          />
        );
      })}
    </div>
  );
}
