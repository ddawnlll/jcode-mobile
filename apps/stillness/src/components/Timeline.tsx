/**
 * Single chronological conversation timeline.
 *
 * History messages and live events render through the same rail: reasoning
 * segments, tool calls (start → input → exec → done in observed order), and
 * assistant text. Every block carries a stable key and its own copy control.
 */
import { Suspense, lazy, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HistoryMessageView } from '../lib/protocol';
import { orderedTimeline } from '../lib/timelineJournal';
import type { JournalTool } from '../lib/timelineJournal';
import { toolPresentation } from '../lib/toolStatus';
import type { LiveState } from '../lib/controller';
import { classifyDiffLine, describeToolCall, groupHistory, looksLikeDiff } from '../lib/toolLabels';
import { PagedText, TEXT_PAGE_CHARS } from './PagedText';
import { IconChevron } from './Icons';
import { CopyButton } from './ui';

const RichMarkdown = lazy(async () => ({ default: (await import('./RichMarkdown')).RichMarkdown }));
const HISTORY_PAGE = 32;

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

function parseInput(input: string): unknown {
  if (input.length > 4096) return null;
  const value = input.trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function ToolCallCardView({
  tool,
  turnActive = false,
  connected = false,
}: {
  tool: JournalTool;
  turnActive?: boolean;
  connected?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseInput(tool.input), [tool.input]);
  const descriptor = useMemo(
    () => describeToolCall(tool.name, tool.input.slice(0, 4096), parsed),
    [tool.name, tool.input, parsed],
  );
  const prettyInput = open && parsed ? JSON.stringify(parsed, null, 2) : tool.input;
  const presentation = toolPresentation(tool, turnActive, connected);
  const effectiveStatus = presentation.kind;
  const copyValue = () => [tool.name, tool.input && `INPUT\n${tool.input}`, tool.output && `OUTPUT\n${tool.output}`, tool.error]
    .filter(Boolean)
    .join('\n\n');

  return (
    <div className={`timeline-item tool-item is-${effectiveStatus}`}>
      <span className="timeline-marker" aria-hidden="true" />
      <div className={`timeline-body tool-card ${effectiveStatus}`}>
        <div className="tool-card-head">
          <button
            type="button"
            className="tool-expand"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${descriptor.label}`}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="tool-dot" aria-hidden="true" />
            <span className="tool-intent">{descriptor.label}</span>
            {descriptor.summary ? <span className="tool-summary">{descriptor.summary}</span> : null}
            <IconChevron size={15} className={`tool-chevron ${open ? 'is-open' : ''}`} />
          </button>
          <span className="tool-status">{presentation.label}</span>
          <CopyButton value={copyValue} label="Copy tool call" icon />
        </div>
        <div className="tool-raw">
          <code>{descriptor.raw}</code>
          {tool.input ? <span className="tool-arg-count">input observed</span> : null}
          {presentation.taskId ? <span>Task {presentation.taskId} · current task status unknown</span> : null}
        </div>
        {open ? (
          <div className="tool-card-body">
            {prettyInput ? (
              <div>
                <div className="tool-section-head">
                  <span className="small-heading flush">INPUT</span>
                  <CopyButton value={prettyInput} label="Copy tool input" icon />
                </div>
                <PagedText className="tool-payload" text={prettyInput} streaming={effectiveStatus === "running"} />
              </div>
            ) : null}
            {tool.error ? (
              <p className="inline-error" role="alert">
                {tool.error}
              </p>
            ) : null}
            {tool.output ? (
              <div>
                <div className="tool-section-head">
                  <span className="small-heading flush">OUTPUT</span>
                  <CopyButton value={tool.output} label="Copy tool output" icon />
                </div>
                {tool.output.length <= TEXT_PAGE_CHARS && looksLikeDiff(tool.output) ? (
                  <DiffText text={tool.output} />
                ) : (
                  <PagedText className="tool-payload" text={tool.output} />
                )}
              </div>
            ) : null}
            {!prettyInput && !tool.output && !tool.error ? (
              <p className="form-help">No payload was reported for this call.</p>
            ) : null}
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
}: {
  text: string;
  done: boolean;
  visibility: 'compact' | 'hidden' | 'expanded';
}) {
  const [open, setOpen] = useState(visibility === 'expanded');
  useEffect(() => {
    setOpen(visibility === 'expanded');
  }, [visibility]);
  if (visibility === 'hidden') return null;
  return (
    <div className="timeline-item reasoning-item">
      <span className="timeline-marker" aria-hidden="true" />
      <div className="timeline-body reasoning-block">
        <div className="reasoning-head">
          <button
            type="button"
            className="reasoning-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span>Reasoning</span>
            <small>{done ? 'complete' : 'streaming'}</small>
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
    <article className="chat-message assistant-msg timeline-assistant" data-testid={testId}>
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

export const HistoryTimeline = memo(function HistoryTimeline({
  messages,
}: {
  messages: HistoryMessageView[];
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
            <HistoryEntry entry={entry} />
          </div>
        ))}
      </div>
    </>
  );
});

const HistoryEntry = memo(function HistoryEntry({ entry }: { entry: ReturnType<typeof groupHistory>[number] }) {
  if (entry.kind === 'user') return <UserMessage content={entry.content} />;
  if (entry.kind === 'assistant') {
    return <AssistantBlock text={entry.content} streaming={false} testId="assistant-message" />;
  }
  if (entry.kind === 'tool') {
    const message = entry.message;
    return (
      <div className="timeline">
        <ToolCallCard tool={{
          callId: message.tool_call_id ?? entry.key,
          name: message.tool_name ?? 'tool result',
          input: message.tool_input ? JSON.stringify(message.tool_input) : '',
          output: message.content ?? '',
          error: null,
          status: 'result',
        }} />
      </div>
    );
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
}: {
  live: LiveState;
  visibility: 'compact' | 'hidden' | 'expanded';
  connected: boolean;
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
            />
          );
        }
        if (item.kind === 'tool') {
          return (
            <ToolCallCard
              key={item.id}
              tool={item.tool}
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
