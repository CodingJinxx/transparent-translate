export type ProviderPresetId = 'lmstudio' | 'openai' | 'openrouter' | 'meta' | 'custom';

export interface ProviderPreset {
	id: ProviderPresetId;
	label: string;
	baseUrl: string;
	/** A model id suggestion shown as placeholder text. Never used as a default. */
	modelHint: string;
	/** Whether the endpoint runs on the user's machine (affects only the privacy note). */
	local: boolean;
	needsKey: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
	{ id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', modelHint: 'qwen2.5-7b-instruct', local: true, needsKey: false },
	{ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelHint: 'gpt-4.1-mini', local: false, needsKey: true },
	{ id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelHint: 'meta-llama/llama-3.3-70b-instruct', local: false, needsKey: true },
	{ id: 'meta', label: 'Meta Model API', baseUrl: 'https://api.meta.ai/v1', modelHint: 'muse-spark-1.3', local: false, needsKey: true },
	{ id: 'custom', label: 'Custom', baseUrl: '', modelHint: 'model-id', local: false, needsKey: false },
];

export function presetById(id: string): ProviderPreset {
	return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!;
}

/** Guesses the preset for a base URL, for display only. */
export function presetForUrl(baseUrl: string): ProviderPreset {
	const clean = baseUrl.replace(/\/+$/, '');
	return PROVIDER_PRESETS.find((p) => p.baseUrl && p.baseUrl === clean) ?? presetById('custom');
}

export function isLocalUrl(baseUrl: string): boolean {
	return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[^/]+\.local)(?::\d+)?(?:\/|$)/i.test(baseUrl.trim());
}
