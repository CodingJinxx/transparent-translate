/**
 * Rough cost estimate for bulk translation. Deliberately simple: the point is
 * to avoid surprises, not to match the provider's bill.
 */

export interface EstimateInput {
	/** Characters of sentence text that need translating, per target language. */
	characters: number;
	/** Number of target languages. */
	languages: number;
	/** Number of requests, for the fixed prompt overhead. */
	requests: number;
	charsPerToken: number;
	/** USD per million tokens. Zero or undefined means unknown. */
	inputPrice?: number;
	outputPrice?: number;
}

export interface Estimate {
	inputTokens: number;
	outputTokens: number;
	/** Undefined when no price is configured. */
	cost?: number;
}

/** Approximate tokens of the system prompt and per-request framing. */
export const PROMPT_OVERHEAD_TOKENS = 350;

export function estimateCost(input: EstimateInput): Estimate {
	const charsPerToken = input.charsPerToken > 0 ? input.charsPerToken : 4;
	const textTokens = Math.ceil(input.characters / charsPerToken) * input.languages;
	const inputTokens = textTokens + input.requests * PROMPT_OVERHEAD_TOKENS;
	// Output is about as long as the input text, plus the <<n>> markers.
	const outputTokens = Math.ceil(textTokens * 1.1);
	const priced = (input.inputPrice ?? 0) > 0 || (input.outputPrice ?? 0) > 0;
	const estimate: Estimate = { inputTokens, outputTokens };
	if (priced) {
		estimate.cost = (inputTokens * (input.inputPrice ?? 0) + outputTokens * (input.outputPrice ?? 0)) / 1_000_000;
	}
	return estimate;
}
