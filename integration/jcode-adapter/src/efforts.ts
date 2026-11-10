/**
 * Canonical reasoning-effort ladders, ported from
 * jcode-provider-core/src/reasoning.rs at JCode v0.99.1.
 *
 * The adapter must expose the same ladder the daemon/TUI exposes. A generic
 * Anthropic list is wrong: older or manual-thinking Claude models reject
 * `xhigh`/`max`, and models without effort support must return an empty list.
 */

const OPENAI_SELECTABLE_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'swarm',
];

const OPENROUTER_SELECTABLE_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'swarm',
];

const DEEPSEEK_SELECTABLE_EFFORTS = ['none', 'low', 'medium', 'high', 'max', 'swarm'];

interface AnthropicCaps {
  outputEffort: boolean;
  adaptiveThinking: boolean;
  manualThinking: boolean;
  xhighEffort: boolean;
  maxEffort: boolean;
}

function caps(options: Partial<AnthropicCaps> = {}): AnthropicCaps {
  return {
    outputEffort: false,
    adaptiveThinking: false,
    manualThinking: false,
    xhighEffort: false,
    maxEffort: false,
    ...options,
  };
}

const ANTHROPIC_FULL = caps({
  outputEffort: true,
  adaptiveThinking: true,
  xhighEffort: true,
  maxEffort: true,
});
const ANTHROPIC_EFFORT_NO_XHIGH = caps({
  outputEffort: true,
  adaptiveThinking: true,
  maxEffort: true,
});
const ANTHROPIC_MANUAL_WITH_EFFORT = caps({ outputEffort: true, manualThinking: true });
const ANTHROPIC_MANUAL_ONLY = caps({ manualThinking: true });

function stripOneMillionSuffix(model: string): string {
  return model.replace(/\[1m\]$/i, '');
}

function stripDateSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '');
}

function normalizedClaudeKey(model: string): string {
  return stripDateSuffix(stripOneMillionSuffix(model.trim()).toLowerCase().replace(/\./g, '-'));
}

function parseClaudeFamilyVersion(base: string): { family: string | null; version: [number, number] | null } {
  let family: string | null = null;
  const numbers: number[] = [];
  for (const segment of base.split('-')) {
    if (segment === 'claude') continue;
    if (/^\d+$/.test(segment)) {
      if (numbers.length < 2) numbers.push(Number(segment));
    } else if (family === null && /^[a-z]+$/.test(segment)) {
      family = segment;
    }
  }
  if (numbers.length === 0) return { family, version: null };
  return { family, version: [numbers[0], numbers[1] ?? 0] };
}

function atLeast(version: [number, number], major: number, minor: number): boolean {
  return version[0] > major || (version[0] === major && version[1] >= minor);
}

/** Port of `anthropic_reasoning_caps` at the pinned daemon version. */
export function anthropicReasoningCaps(model: string): AnthropicCaps {
  const base = normalizedClaudeKey(model);
  if (!base.startsWith('claude')) return caps();
  if (base.includes('mythos')) return ANTHROPIC_EFFORT_NO_XHIGH;
  const { family, version } = parseClaudeFamilyVersion(base);
  if (!version) return caps();
  switch (family) {
    case 'opus':
      if (atLeast(version, 4, 7)) return ANTHROPIC_FULL;
      if (version[0] === 4 && version[1] === 6) return ANTHROPIC_EFFORT_NO_XHIGH;
      if (version[0] === 4 && version[1] === 5) return ANTHROPIC_MANUAL_WITH_EFFORT;
      return caps();
    case 'sonnet':
      if (atLeast(version, 5, 0)) return ANTHROPIC_FULL;
      if (version[0] === 4 && version[1] === 6) return ANTHROPIC_EFFORT_NO_XHIGH;
      if (version[0] === 3 && version[1] === 7) return ANTHROPIC_MANUAL_ONLY;
      return caps();
    default:
      return atLeast(version, 5, 0) ? ANTHROPIC_FULL : caps();
  }
}

function anthropicLadder(model: string): string[] {
  const caps = anthropicReasoningCaps(model);
  if (!caps.outputEffort && !caps.manualThinking) return [];
  const efforts = ['none', 'low', 'medium', 'high'];
  if (caps.xhighEffort) efforts.push('xhigh');
  if (caps.maxEffort) efforts.push('max');
  efforts.push('swarm');
  return efforts;
}

/**
 * Same ordered ladder JCode exposes to its own remote TUI. Identities the
 * daemon does not recognize stay an empty ladder, never a guess.
 */
export function inferredEfforts(
  providerName: string | null,
  modelName: string | null,
): string[] {
  const provider = (providerName ?? '').toLowerCase();
  const model = (modelName ?? '').toLowerCase();

  if (provider.includes('openrouter')) return [...OPENROUTER_SELECTABLE_EFFORTS];
  if (provider.includes('deepseek') || model.includes('deepseek')) {
    return [...DEEPSEEK_SELECTABLE_EFFORTS];
  }
  if (provider.includes('z.ai') || provider === 'zai' || model.startsWith('glm-')) {
    return [...OPENAI_SELECTABLE_EFFORTS];
  }

  const openaiModel =
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4') ||
    model.startsWith('o5');

  if (provider.includes('openai-compatible')) {
    return openaiModel ? [...OPENAI_SELECTABLE_EFFORTS] : [];
  }

  const anthropic =
    provider.includes('anthropic') || provider.includes('claude') || model.startsWith('claude-');
  if (anthropic) return anthropicLadder(modelName ?? '');

  if (provider.includes('openai') || provider.includes('codex') || openaiModel) {
    return [...OPENAI_SELECTABLE_EFFORTS];
  }
  return [];
}

/** Stable per-model ladders for the picker; only models with a ladder appear. */
export function effortLadders(
  providerName: string | null,
  models: string[],
): Record<string, string[]> {
  const ladders: Record<string, string[]> = {};
  for (const model of models) {
    const ladder = inferredEfforts(providerName, model);
    if (ladder.length) ladders[model] = ladder;
  }
  return ladders;
}
