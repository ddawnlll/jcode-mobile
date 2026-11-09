import type { HistoryMessage, MessageImage, SessionInfo } from '../protocol/frames';
import type { ContextSnapshot, ProjectRecord, ToolRow } from '../state/store';
import demoImage from './demo-image.json';

export const DEMO_SERVER_ID = 'preview';
export const DEMO_SESSION_ID = 'preview-reconnect';

const image: MessageImage = {
  media_type: demoImage.media_type,
  data: demoImage.base64,
  alt: 'A teal preview panel with a soft ring',
  label: 'reconnect-preview.png',
  source: 'user_prompt',
};

export const demoProjects: ProjectRecord[] = [
  {
    id: 'preview-jcode',
    serverId: DEMO_SERVER_ID,
    path: '/srv/workspace/jcode-mobile',
    name: 'jcode-mobile',
    pinned: true,
    addedAt: Date.now() - 86_400_000,
    lastUsedAt: Date.now() - 3_600_000,
  },
  {
    id: 'preview-api',
    serverId: DEMO_SERVER_ID,
    path: '/srv/workspace/adapter',
    name: 'adapter',
    pinned: false,
    addedAt: Date.now() - 172_800_000,
    lastUsedAt: Date.now() - 7_200_000,
  },
];

export const demoSessions: SessionInfo[] = [
  {
    session_id: DEMO_SESSION_ID,
    title: 'Reconnect path review',
    working_dir: '/srv/workspace/jcode-mobile',
    status: 'running',
    saved: true,
    save_label: 'Reconnect',
    updated_at_ms: Date.now() - 90_000,
    last_active_at_ms: Date.now() - 90_000,
    live_state: 'working',
  },
  {
    session_id: 'preview-adapter',
    title: 'Adapter contract hardening',
    working_dir: '/srv/workspace/adapter',
    status: 'idle',
    updated_at_ms: Date.now() - 5_400_000,
    last_active_at_ms: Date.now() - 5_400_000,
    live_state: 'ready',
  },
  {
    session_id: 'preview-docs',
    title: 'Release notes',
    working_dir: '/srv/workspace/jcode-mobile',
    status: 'idle',
    saved: true,
    save_label: 'Release',
    updated_at_ms: Date.now() - 86_400_000,
    last_active_at_ms: Date.now() - 86_400_000,
  },
  {
    session_id: 'preview-tools',
    title: 'Tool renderer corpus',
    working_dir: '/srv/workspace/jcode-mobile',
    status: 'idle',
    updated_at_ms: Date.now() - 172_800_000,
    last_active_at_ms: Date.now() - 172_800_000,
  },
];

export const demoMessages: HistoryMessage[] = [
  {
    index: 0,
    role: 'user',
    content:
      'Review the reconnect path. I want the phone to return to the exact session without cancelling the turn.',
    images: [image],
  },
  {
    index: 1,
    role: 'assistant',
    content: `## What I checked

The return path keeps **server identity**, **session identity**, and the local reading anchor separate. Navigation never issues \`cancel\`.

- [x] Attach with \`continue_on_disconnect: true\`
- [x] Restore the exact session
  - Draft is scoped by server and session
  - Reading position is the first visible committed message
- [ ] Verify a stale 401 after reconnect

| Surface | Evidence | State |
| --- | --- | --- |
| Continuation | subscribe frame | Verified |
| Draft | SQLite row | Verified |
| Seam | bookmark fingerprint | Verified |

> The daemon owns the turn. The phone only observes and returns.

Inline math: the retry budget is $b = 2^n$ with $n \\le 4$, and the closed form for the settled delay is \\(d_n = d_0 2^n\\).

$$
\\sum_{k=0}^{4} d_0 2^k = d_0 (2^5 - 1)
$$

A footnote reference[^1] and a link to the [adapter contract](https://example.invalid/adapter).

[^1]: The adapter never retries a prompt after an ambiguous write.

\`\`\`ts
export function fence(frame: Frame, attachment: string, turn: number) {
  return frame.attachment_id === attachment && frame.turn_id >= turn;
}
\`\`\`

\`\`\`diff
- await send(frame);
+ await send(frame, { continueOnDisconnect: true });
\`\`\``,
  },
  {
    index: 2,
    role: 'tool',
    content: 'read src/core/app-controller.ts',
    tool_data: {
      id: 'call_demo_read',
      name: 'read_file',
      input: { path: 'src/core/app-controller.ts', limit: 120 },
    },
  },
  {
    index: 3,
    role: 'tool',
    content: 'edit src/core/app-controller.ts',
    tool_data: {
      id: 'call_demo_edit',
      name: 'edit_file',
      input: {
        path: 'src/core/app-controller.ts',
        patch:
          '@@ -1750,6 +1750,8 @@\n-  async send(content: string)\n+  async send(content: string, images: ComposerImage[] = [])\n+    if (!trimmed && images.length === 0) return',
      },
    },
  },
  {
    index: 4,
    role: 'assistant',
    content:
      'The edit keeps the existing delivery ledger. A prompt with an image is still one client message id, so an ambiguous write remains **Delivery unconfirmed** and is never retried automatically.',
  },
];

export const demoTools: ToolRow[] = [
  {
    callId: 'call_demo_read',
    name: 'read_file',
    input: { path: 'src/core/app-controller.ts', limit: 120 },
    output: 'Read 120 lines. The reconnect path keeps the attachment identity stable.',
    state: 'done',
    startedAt: Date.now() - 22_000,
    completedAt: Date.now() - 21_600,
  },
  {
    callId: 'call_demo_edit',
    name: 'edit_file',
    input: {
      path: 'src/core/app-controller.ts',
      patch:
        '@@ -1750,6 +1750,8 @@\n-  async send(content: string)\n+  async send(content: string, images: ComposerImage[] = [])\n+    if (!trimmed && images.length === 0) return',
    },
    output: 'Applied 2 insertions and 1 deletion.',
    state: 'done',
    startedAt: Date.now() - 21_000,
    completedAt: Date.now() - 20_500,
  },
  {
    callId: 'call_demo_test',
    name: 'bash',
    input: { command: 'bun run typecheck && bun run adapter:test' },
    output: 'typecheck pass\nadapter tests 12 pass',
    state: 'running',
    startedAt: Date.now() - 4_000,
  },
];

export const demoContext: ContextSnapshot = {
  usedTokens: 48_600,
  limitTokens: 128_000,
  basis: 'last_request',
  model: 'claude-sonnet-preview',
  observedAt: Date.now() - 90_000,
  freshness: 'current',
  source: 'adapter',
};

export const demoReasoning = `The user is asking about the reconnect path. I should separate transport loss from daemon death, then verify the exact session is reattached with continuation enabled. The draft and bookmark are scoped, so the test should reopen the same session.`;
