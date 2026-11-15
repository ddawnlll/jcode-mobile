import type { LiveBlock, LiveTool } from './controller';

export type JournalTool = Omit<LiveTool, 'seq' | 'status'> & { status: string };

type TimelineItem =
  | { kind: 'assistant' | 'reasoning'; id: string; seq: number; block: LiveBlock }
  | { kind: 'tool'; id: string; seq: number; tool: LiveTool };

/** Order by the first observed event, even when several arrive in one frame. */
export function orderedTimeline(
  assistants: readonly LiveBlock[],
  reasoning: readonly LiveBlock[],
  tools: readonly LiveTool[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const block of assistants) {
    items.push({ kind: 'assistant', id: `a:${block.id}:${block.seq}`, seq: block.seq, block });
  }
  for (const block of reasoning) {
    items.push({ kind: 'reasoning', id: `r:${block.id}`, seq: block.seq, block });
  }
  for (const tool of tools) {
    items.push({ kind: 'tool', id: `t:${tool.callId}`, seq: tool.seq, tool });
  }
  return items.sort((a, b) => a.seq - b.seq);
}
