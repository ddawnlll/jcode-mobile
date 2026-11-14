/**
 * Chronological journal for a live turn.
 *
 * The controller exposes reasoning as one accumulated string, assistant blocks
 * as an array, and tools as an array. Individually they preserve no shared
 * order. This journal records the order in which those slices first appear in
 * observed state, so the UI can render reasoning segments, tool calls and
 * assistant text in true observed order instead of three parallel blocks.
 *
 * It is deterministic for a given sequence of snapshots and is safe to call on
 * every render: repeated observations of the same state are idempotent.
 */

export interface JournalTool {
  callId: string;
  name: string;
  input: string;
  output: string;
  error: string | null;
  status: string;
}

export interface JournalSource {
  turnId: string | null;
  finishedTurnId: string | null;
  assistants: Array<{ id: string; text: string; done: boolean }>;
  reasoning: string;
  tools: JournalTool[];
}

export type TimelineItem =
  | { kind: 'assistant'; id: string; text: string; done: boolean }
  | { kind: 'reasoning'; id: string; text: string; done: boolean }
  | { kind: 'tool'; id: string; tool: JournalTool };

function cloneItem(item: TimelineItem): TimelineItem {
  if (item.kind === 'tool') return { ...item, tool: { ...item.tool } };
  return { ...item };
}

export class TimelineJournal {
  private turnKey = '';
  private items: TimelineItem[] = [];
  private seen = new Map<string, TimelineItem>();
  private reasoningSeq = 0;
  private reasoningOpen = false;
  private lastReasoningLength = 0;

  reset() {
    this.turnKey = '';
    this.items = [];
    this.seen.clear();
    this.reasoningSeq = 0;
    this.reasoningOpen = false;
    this.lastReasoningLength = 0;
  }

  observe(source: JournalSource): TimelineItem[] {
    const key = source.turnId ?? source.finishedTurnId ?? (source.assistants.length || source.tools.length ? 'live' : '');
    if (key !== this.turnKey) {
      this.reset();
      this.turnKey = key;
    }

    for (const block of source.assistants) {
      const id = `assistant:${block.id}`;
      const existing = this.seen.get(id);
      if (existing && existing.kind === 'assistant') {
        existing.text = block.text;
        existing.done = block.done;
        continue;
      }
      this.closeReasoning();
      const item: TimelineItem = { kind: 'assistant', id, text: block.text, done: block.done };
      this.items.push(item);
      this.seen.set(id, item);
    }

    for (const tool of source.tools) {
      const id = `tool:${tool.callId}`;
      const existing = this.seen.get(id);
      if (existing && existing.kind === 'tool') {
        existing.tool = { ...tool };
        continue;
      }
      this.closeReasoning();
      const item: TimelineItem = { kind: 'tool', id, tool: { ...tool } };
      this.items.push(item);
      this.seen.set(id, item);
    }

    const reasoning = source.reasoning ?? '';
    if (reasoning.length > 0) {
      if (reasoning.length > this.lastReasoningLength) {
        const last = this.items[this.items.length - 1];
        if (this.reasoningOpen && last && last.kind === 'reasoning') {
          last.text = reasoning;
        } else {
          const item: TimelineItem = {
            kind: 'reasoning',
            id: `reasoning:${++this.reasoningSeq}`,
            text: reasoning,
            done: false,
          };
          this.items.push(item);
          this.seen.set(item.id, item);
          this.reasoningOpen = true;
        }
      } else if (reasoning.length < this.lastReasoningLength) {
        // A shrinking string is a reset, not a new segment.
        this.reasoningOpen = false;
      }
      this.lastReasoningLength = reasoning.length;
    }

    if (!source.turnId && source.finishedTurnId) this.closeReasoning();
    return this.items.map(cloneItem);
  }

  private closeReasoning() {
    if (!this.reasoningOpen) return;
    const last = this.items[this.items.length - 1];
    if (last && last.kind === 'reasoning') last.done = true;
    this.reasoningOpen = false;
  }
}
