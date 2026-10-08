/**
 * AI providers an administrator can configure. Anthropic is called with its own SDK; the others
 * through the OpenAI-compatible API they all offer, at the base URL below (which can be changed,
 * for example for a provider's China region).
 */
export const AI_PROVIDER_KINDS = ['anthropic', 'openai_compatible'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export interface AiProviderPreset {
  id: string;
  label: string;
  kind: AiProviderKind;
  /** Empty for "custom": the administrator enters it. */
  baseUrl: string;
  /** A sensible model to start with; empty when the provider's catalogue is the better guide. */
  defaultModel: string;
  keyPlaceholder: string;
}

export const AI_PROVIDER_PRESETS = [
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-opus-5-5', keyPlaceholder: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', kind: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', defaultModel: '', keyPlaceholder: 'sk-…' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai_compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: '', keyPlaceholder: 'AIza…' },
  { id: 'qwen', label: 'Qwen (Alibaba Cloud Model Studio)', kind: 'openai_compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', defaultModel: '', keyPlaceholder: 'sk-…' },
  { id: 'kimi', label: 'Kimi (Moonshot AI)', kind: 'openai_compatible', baseUrl: 'https://api.moonshot.ai/v1', defaultModel: '', keyPlaceholder: 'sk-…' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai_compatible', baseUrl: 'https://api.deepseek.com/v1', defaultModel: '', keyPlaceholder: 'sk-…' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: '', keyPlaceholder: 'sk-or-…' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', kind: 'openai_compatible', baseUrl: '', defaultModel: '', keyPlaceholder: 'API key' },
] as const satisfies readonly AiProviderPreset[];

export type AiProviderPresetId = (typeof AI_PROVIDER_PRESETS)[number]['id'];
export const AI_PROVIDER_PRESET_IDS = AI_PROVIDER_PRESETS.map((p) => p.id) as [AiProviderPresetId, ...AiProviderPresetId[]];

/** Whether an API agent is meant to work (the runner starts it) or not. */
export const API_AGENT_STATES = ['stopped', 'running'] as const;
export type ApiAgentState = (typeof API_AGENT_STATES)[number];

/** Default limits for a new API agent. */
export const API_AGENT_DEFAULTS = { dailyTokenLimit: 2_000_000, maxTurnsPerStep: 60 } as const;

export function aiProviderPreset(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((p) => p.id === id);
}
