import type { TargetLanguage } from '../core/types';

export interface TranslationItem {
	/** Sentence text with protected spans replaced by `⟦n⟧`. */
	masked: string;
	/** Number of placeholders in `masked`. */
	placeholderCount: number;
}

export interface TranslationContext {
	noteTitle: string;
	glossary: readonly string[];
	/** Masked surrounding text for context, never translated. */
	context?: readonly string[];
}

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
}

/** One result per input item: the masked translation, or an error message. */
export type ItemResult = { ok: true; text: string } | { ok: false; error: string };

export interface TranslateResult {
	items: ItemResult[];
	usage: TokenUsage;
	model: string;
}

/**
 * A translation backend. v1 has one implementation (`LlmTranslator`), but
 * the interface keeps the rest of the plugin independent of it.
 */
export interface Translator {
	translate(items: readonly TranslationItem[], target: TargetLanguage, ctx: TranslationContext, signal?: AbortSignal): Promise<TranslateResult>;
}

export class TranslatorError extends Error {
	constructor(
		message: string,
		readonly kind: 'config' | 'auth' | 'rate-limit' | 'http' | 'network' | 'timeout' | 'format' | 'aborted',
		readonly status?: number,
	) {
		super(message);
		this.name = 'TranslatorError';
	}
}
