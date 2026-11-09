import { create } from 'zustand';

import type { HistoryMessage, SessionInfo, TodoSnapshot } from '../protocol/frames';

export type ConnectionState =
  | 'cached'
  | 'connecting'
  | 'reconciling'
  | 'current'
  | 'reconnecting'
  | 'offline'
  | 'pair_again'
  | 'incompatible';

export type DeliveryState =
  | 'draft'
  | 'sending'
  | 'sent_to_server'
  | 'accepted'
  | 'queued'
  | 'added'
  | 'unconfirmed'
  | 'rejected';

export interface DeliveryRecord {
  clientMessageId: string;
  content: string;
  state: DeliveryState;
  messageIndex?: number;
  error?: string;
  createdAt: number;
  guidance?: boolean;
}

export interface ToolRow {
  callId: string;
  name: string;
  /** Reconstructed from persisted history, not a live event. */
  historical?: boolean;
  input?: unknown;
  output?: string;
  error?: string | null;
  truncated?: boolean;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  completedAt?: number;
}

export interface ExecutionState {
  kind: 'working' | 'ready' | 'stopped' | 'unknown';
  label: string;
  detail?: string;
  observedAt: number;
  turnId: number;
  /** Server-reported provider phase, e.g. "retrying (2/4)". */
  phase?: string;
}

export interface ConversationState {
  serverId: string | null;
  sessionId: string | null;
  attachmentId: string | null;
  session: SessionInfo | null;
  title: string;
  workingDir: string | null;
  messages: HistoryMessage[];
  totalMessages: number;
  baseIndex: number;
  /** Oldest loaded committed message; loader asks below this. */
  loadingOlder: boolean;
  hasOlder: boolean;
  provisionalText: string;
  reasoning: string;
  tools: ToolRow[];
  execution: ExecutionState;
  delivery: DeliveryRecord[];
  pendingSoftInterrupts: number;
  plan: { state: TodoSnapshot; observedAt: number } | null;
  planLoading: boolean;
  /** First unseen committed index and an authoritative count when known. */
  seam: { index: number | null; count: number | null } | null;
  hasNewActivity: boolean;
  historyFreshness: { status: 'none' | 'cached' | 'authoritative'; observedAt: number };
  interrupted: boolean;
  recovery: { continuation_message: string; reconnect_notice?: string } | null;
  lastError: string | null;
}

export interface InventoryState {
  sessions: SessionInfo[];
  fetchedAt: number | null;
  loading: boolean;
  error: string | null;
  partial: boolean;
  limit: number;
  includeArchived: boolean;
  /** Archived session ids recently restored, for undo. */
  pendingRestore: { session: SessionInfo; at: number } | null;
}

export interface AppState {
  bootstrap: 'loading' | 'ready' | 'failed';
  bootstrapError: string | null;
  profileId: string | null;
  deviceName: string;
  connection: {
    state: ConnectionState;
    /** Last network check, successful or not. Drives "Last checked". */
    lastCheckedAt: number | null;
    /** Last confirmed contact with the daemon. */
    lastContactAt: number | null;
    serverLabel: string;
    host: string;
    daemonVersion: string | null;
    serverName: string | null;
    capabilities: string[];
    error: string | null;
    attempt: number;
  };
  inventory: InventoryState;
  conversation: ConversationState;
  appearance: 'system' | 'light' | 'night';
  privacyPreview: boolean;
  /** A pairing deep link awaiting consumption by the Connect screen. */
  pendingPairLink: string | null;
  actions: {
    setBootstrap: (value: AppState['bootstrap'], error?: string | null) => void;
    setProfile: (profileId: string | null, deviceName: string) => void;
    setAppearance: (value: AppState['appearance']) => void;
    setPrivacyPreview: (value: boolean) => void;
    setPendingPairLink: (value: string | null) => void;
  };
}

const emptyConversation: ConversationState = {
  serverId: null,
  sessionId: null,
  attachmentId: null,
  session: null,
  title: '',
  workingDir: null,
  messages: [],
  totalMessages: 0,
  baseIndex: 0,
  loadingOlder: false,
  hasOlder: false,
  provisionalText: '',
  reasoning: '',
  tools: [],
  execution: { kind: 'unknown', label: 'Status unavailable', observedAt: 0, turnId: 0 },
  delivery: [],
  pendingSoftInterrupts: 0,
  plan: null,
  planLoading: false,
  seam: null,
  hasNewActivity: false,
  historyFreshness: { status: 'none', observedAt: 0 },
  interrupted: false,
  recovery: null,
  lastError: null,
};

export const useAppStore = create<AppState>()((set) => ({
  bootstrap: 'loading',
  bootstrapError: null,
  profileId: null,
  deviceName: '',
  connection: {
    state: 'cached',
    lastCheckedAt: null,
    lastContactAt: null,
    serverLabel: '',
    host: '',
    daemonVersion: null,
    serverName: null,
    capabilities: [],
    error: null,
    attempt: 0,
  },
  inventory: {
    sessions: [],
    fetchedAt: null,
    loading: false,
    error: null,
    partial: false,
    limit: 50,
    includeArchived: false,
    pendingRestore: null,
  },
  conversation: emptyConversation,
  appearance: 'system',
  privacyPreview: true,
  pendingPairLink: null,
  actions: {
    setBootstrap: (value, error = null) => set({ bootstrap: value, bootstrapError: error }),
    setProfile: (profileId, deviceName) => set({ profileId, deviceName }),
    setAppearance: (value) => set({ appearance: value }),
    setPrivacyPreview: (value) => set({ privacyPreview: value }),
    setPendingPairLink: (value) => set({ pendingPairLink: value }),
  },
}));

export const appActions = () => useAppStore.getState().actions;

/** Non-React access for the controller. */
export const store = {
  get: () => useAppStore.getState(),
  setState: useAppStore.setState,
  subscribe: useAppStore.subscribe,
};

export function resetConversation(patch: Partial<ConversationState> = {}): ConversationState {
  return { ...emptyConversation, ...patch };
}
