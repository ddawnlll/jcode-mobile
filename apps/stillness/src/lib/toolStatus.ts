import type { JournalTool } from './timelineJournal';

// JCode's pinned native implementation emits this exact textual result in
// ToolDone when it adopts a foreground call. The SDK has no structured
// handoff event, so this is a reported handoff, not a current task status.
const HANDOFF_GUIDANCE = 'While this task runs, try to make progress on other useful work that does not depend on its result. If nothing independent remains, wait for completion rather than repeatedly polling. Do not duplicate the running task or change inputs it is still using.';

export function reportedBackgroundTask(name: string, output: string): string | null {
  const match = /^Tool '([^'\n]+)' was moved to background (?:automatically after \d+(?:\.\d+)? seconds|by the user) \(task_id: ([A-Za-z0-9_-]+)\)\.\n\n/.exec(output);
  if (!match || (name !== 'tool result' && name !== match[1])) return null;
  return output.slice(match[0].length) === HANDOFF_GUIDANCE ? match[2] : null;
}

export function toolPresentation(tool: JournalTool, turnActive: boolean, connected: boolean) {
  const taskId = !tool.error && (tool.status === 'done' || tool.status === 'result')
    ? reportedBackgroundTask(tool.name, tool.output)
    : null;
  if (taskId) return { label: 'Moved to background', short: 'Background', kind: 'background', taskId };
  if (tool.status === 'failed' || tool.error) return { label: 'Failed', short: 'Failed', kind: 'failed', taskId: null };
  if (tool.status === 'done') return { label: 'Completed', short: 'Completed', kind: 'done', taskId: null };
  // Historical records lack the native error bit, so a result alone is not
  // evidence that the call succeeded.
  if (tool.status === 'result') return { label: 'Result received', short: 'Result', kind: 'result', taskId: null };
  if (!connected || !turnActive) return { label: 'Unknown / reconciling', short: 'Reconciling', kind: 'unknown', taskId: null };
  // The controller also marks streamed input as running before tool_exec, so
  // this status does not prove that execution has begun.
  if (tool.status === 'running') return { label: 'In progress', short: 'Running', kind: 'running', taskId: null };
  if (tool.status === 'started') return { label: 'Started', short: 'Started', kind: 'started', taskId: null };
  return { label: 'Unknown / reconciling', short: 'Reconciling', kind: 'unknown', taskId: null };
}
