import { create } from 'zustand';

import type {
  HistoryMessage,
  ModelRoute,
  SessionInfo,
  TodoSnapshot,
} from '../protocol/frames';
import type {
  AppearancePreference,
  EffectsPreference,
  ReasoningDisplay,
} from '../../design/themes';

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
  /** Another client's prompt, held until committed history reconciles it. */
  peer?: boolean;
  images?: ComposerImage[];
}

/** One completed assistant message within the live turn. */
export interface ProvisionalBlock {
  id: string;
  text: string;
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

export interface ProjectRecord {
  id: string;
  serverId: string;
  path: string;
  name: string;
  pinned: boolean;
  addedAt: number;
  lastUsedAt: number;
}

export interface SessionConfigState {
  model: string | null;
  effort: string | null;
  efforts: string[];
  effortsByModel: Record<string, string[]>;
  routes: ModelRoute[];
  modelConfirmed: boolean;
  effortConfirmed: boolean;
  source: 'server' | 'default' | 'pending' | 'unknown';
  pendingModel: string | null;
  pendingEffort: string | null;
  applying: boolean;
  error: string | null;
  observedAt: number;
}

export interface ContextSnapshot {
  usedTokens: number | null;
  limitTokens: number | null;
  basis: 'last_request' | 'current_prompt' | 'unknown';
  model: string | null;
  observedAt: number;
  freshness: 'current' | 'stale' | 'unknown';
  source: 'adapter' | 'cached';
}

export interface ChangeRecord {
  key: string;
  callId: string;
  path: string;
  operation: 'edit' | 'write' | 'delete' | 'rename' | 'unknown';
  added?: number;
  removed?: number;
  diff?: string;
  evidence: 'diff' | 'path';
  /** Live tool_done is confirmed; reconstructed history is only an attempt. */
  status?: 'confirmed' | 'attempted';
}

export interface ComposerImage {
  id: string;
  uri: string;
  mediaType: string;
  name: string;
  base64?: string;
  alt?: string;
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
  /** Assistant steps already closed by text_done within this turn. */
  provisionalBlocks: ProvisionalBlock[];
  reasoning: string;
  /** Evidenced thinking phase; separate from ordinary tool work. */
  reasoningPhase: 'none' | 'thinking' | 'working';
  reasoningStartedAt: number | null;
  reasoningDurationSecs: number | null;
  tools: ToolRow[];
  changes: ChangeRecord[];
  config: SessionConfigState;
  context: ContextSnapshot | null;
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
  /** Capabilities the attached adapter actually advertised. */
  capabilities: string[];
  /** Honest notice when oversized media was withheld from reconciliation. */
  imageNotice: string | null;
}

export interface InventoryState {
  sessions: SessionInfo[];
  fetchedAt: number | null;
  loading: boolean;
  error: string | null;
  partial: boolean;
  limit: number;
  includeArchived: boolean;
  pinnedSessionIds: string[];
  projects: ProjectRecord[];
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
    /** Exact adapter build reported by hello_ok/server_info. */
    adapterVersion: string | null;
    /** Features this build implements that the connected adapter omits. */
    capabilityGap: string[];
    serverName: string | null;
    capabilities: string[];
    error: string | null;
    attempt: number;
  };
  inventory: InventoryState;
  conversation: ConversationState;
  appearance: AppearancePreference;
  themeFamily: string;
  effects: EffectsPreference;
  reasoningDisplay: ReasoningDisplay;
  demo: boolean;
  privacyPreview: boolean;
  /** A pairing deep link awaiting consumption by the Connect screen. */
  pendingPairLink: string | null;
  actions: {
    setBootstrap: (value: AppState['bootstrap'], error?: string | null) => void;
    setProfile: (profileId: string | null, deviceName: string) => void;
    setAppearance: (value: AppState['appearance']) => void;
    setThemeFamily: (value: string) => void;
    setEffects: (value: AppState['effects']) => void;
    setReasoningDisplay: (value: AppState['reasoningDisplay']) => void;
    setDemo: (value: boolean) => void;
    setProjects: (value: ProjectRecord[]) => void;
    setPinnedSessions: (value: string[]) => void;
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
  provisionalBlocks: [],
  reasoning: '',
  reasoningPhase: 'none',
  reasoningStartedAt: null,
  reasoningDurationSecs: null,
  tools: [],
  changes: [],
  config: {
    model: null,
    effort: null,
    efforts: [],
    effortsByModel: {},
    routes: [],
    modelConfirmed: false,
    effortConfirmed: false,
    source: 'unknown',
    pendingModel: null,
    pendingEffort: null,
    applying: false,
    error: null,
    observedAt: 0,
  },
  context: null,
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
  capabilities: [],
  imageNotice: null,
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
    adapterVersion: null,
    capabilityGap: [],
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
    pinnedSessionIds: [],
    projects: [],
    pendingRestore: null,
  },
  conversation: emptyConversation,
  appearance: 'system',
  themeFamily: 'tidal',
  effects: 'auto',
  reasoningDisplay: 'compact',
  demo: false,
  privacyPreview: true,
  pendingPairLink: null,
  actions: {
    setBootstrap: (value, error = null) => set({ bootstrap: value, bootstrapError: error }),
    setProfile: (profileId, deviceName) => set({ profileId, deviceName }),
    setAppearance: (value) => set({ appearance: value }),
    setThemeFamily: (value) => set({ themeFamily: value }),
    setEffects: (value) => set({ effects: value }),
    setReasoningDisplay: (value) => set({ reasoningDisplay: value }),
    setDemo: (value) => set({ demo: value }),
    setProjects: (value) => set((state) => ({ inventory: { ...state.inventory, projects: value } })),
    setPinnedSessions: (value) =>
      set((state) => ({ inventory: { ...state.inventory, pinnedSessionIds: value } })),
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
