/**
 * Single chronological conversation timeline.
 *
 * History messages and live events render through the same rail: reasoning
 * segments, tool calls (start → input → exec → done in observed order), and
 * assistant text. Every block carries a stable key and its own copy control.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import type { HistoryMessageView } from '../lib/protocol';
import type { JournalTool, TimelineItem } from '../lib/timelineJournal';
import { TimelineJournal } from '../lib/timelineJournal';
import type { LiveState } from '../lib/controller';
import { classifyDiffLine, describeToolCall, groupHistory, looksLikeDiff } from '../lib/toolLabels';
import { useRafValue } from './motion';
import { RichMarkdown } from './RichMarkdown';
import { IconChevron } from './Icons';
import { CopyButton } from './ui';

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
  status,
}: {
  tool: JournalTool;
  status?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => parseInput(tool.input), [tool.input]);
  const descriptor = useMemo(
    () => describeToolCall(tool.name, tool.input, parsed),
    [tool.name, tool.input, parsed],
  );
  const prettyInput = parsed ? JSON.stringify(parsed, null, 2) : tool.input;
  const effectiveStatus = status ?? tool.status;
  const copyValue = [tool.name, tool.input && `INPUT\n${tool.input}`, tool.output && `OUTPUT\n${tool.output}`, tool.error]
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
          <span className="tool-status">{effectiveStatus}</span>
          <CopyButton value={copyValue} label="Copy tool call" icon />
        </div>
        <div className="tool-raw">
          <code>{descriptor.raw}</code>
          {tool.input ? <span className="tool-arg-count">input observed</span> : null}
        </div>
        {open ? (
          <div className="tool-card-body">
            {prettyInput ? (
              <div>
                <div className="tool-section-head">
                  <span className="small-heading flush">INPUT</span>
                  <CopyButton value={prettyInput} label="Copy tool input" icon />
                </div>
                <pre>{prettyInput}</pre>
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
                {looksLikeDiff(tool.output) ? (
                  <DiffText text={tool.output} />
                ) : (
                  <pre>{tool.output}</pre>
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
    previous.status === next.status &&
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
          <div className="reasoning-copy">{text}</div>
        ) : (
          <p className="reasoning-preview">{text.replace(/\s+/g, ' ').slice(0, 150)}</p>
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
  // Batch token deltas to one render per animation frame.
  const batched = useRafValue(text);
  return (
    <article className="chat-message assistant-msg timeline-assistant" data-testid={testId}>
      <div className="chat-meta">
        <span>JCode {streaming ? <span className="stream-caret">streaming</span> : null}</span>
        <CopyButton value={batched} label="Copy message" icon />
      </div>
      <RichMarkdown text={batched} />
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
      <div className="chat-text preserve">{content}</div>
    </article>
  );
});

export const HistoryTimeline = memo(function HistoryTimeline({
  messages,
}: {
  messages: HistoryMessageView[];
}) {
  const entries = useMemo(() => groupHistory(messages), [messages]);
  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === 'user') {
          return <UserMessage key={entry.key} content={entry.content} />;
        }
        if (entry.kind === 'assistant') {
          return (
            <AssistantBlock
              key={entry.key}
              text={entry.content}
              streaming={false}
              testId="assistant-message"
            />
          );
        }
        if (entry.kind === 'tool') {
          const message = entry.message;
          return (
            <div className="timeline" key={entry.key}>
              <ToolCallCard
                tool={{
                  callId: message.tool_call_id ?? entry.key,
                  name: message.tool_name ?? 'tool result',
                  input: message.tool_input ? JSON.stringify(message.tool_input, null, 2) : '',
                  output: message.content ?? '',
                  error: null,
                  status: 'done',
                }}
              />
            </div>
          );
        }
        return (
          <article className="chat-message" key={entry.key}>
            <div className="chat-meta">
              <span>{entry.role}</span>
              <CopyButton value={entry.content} label="Copy message" icon />
            </div>
            <div className="chat-text preserve">{entry.content}</div>
          </article>
        );
      })}
    </>
  );
});

export function LiveTimeline({
  live,
  visibility,
}: {
  live: LiveState;
  visibility: 'compact' | 'hidden' | 'expanded';
}) {
  const journal = useMemo(() => new TimelineJournal(), [live.turnId ?? live.finishedTurnId ?? 'idle']);
  // Re-derives only when the live state object changes; idempotent for repeats.
  const items: TimelineItem[] = useMemo(
    () =>
      journal.observe({
        turnId: live.turnId,
        finishedTurnId: live.finishedTurnId,
        assistants: live.assistants,
        reasoning: live.reasoning,
        tools: live.tools,
      }),
    [journal, live],
  );

  if (!items.length) return null;
  return (
    <div className="timeline live-timeline" data-testid="live-timeline">
      {items.map((item) => {
        if (item.kind === 'reasoning') {
          return (
            <ReasoningSegment
              key={item.id}
              text={item.text}
              done={item.done}
              visibility={visibility}
            />
          );
        }
        if (item.kind === 'tool') {
          return <ToolCallCard key={item.id} tool={item.tool} />;
        }
        return (
          <AssistantBlock
            key={item.id}
            text={item.text}
            streaming={!item.done}
            testId="live-assistant-message"
          />
        );
      })}
    </div>
  );
}
