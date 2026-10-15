import type { Sentence } from './types';

/** How one sentence should be displayed. */
export type SentenceDisplay =
	/** Show this text instead of the original. */
	| { kind: 'translated'; text: string }
	/** The translation equals the original (sentence already in the target language). */
	| { kind: 'same' }
	/** Translation requested but not available yet. */
	| { kind: 'pending' }
	/** Translation failed validation or the request failed. */
	| { kind: 'failed' }
	/** No translation in the cache and none will be requested (e.g. on mobile). */
	| { kind: 'missing' };

export interface ComposeResult {
	text: string;
	translated: number;
	pending: number;
	failed: number;
	missing: number;
}

export interface ComposeOptions {
	/**
	 * Wrap sentences that are shown in the original language in an inline HTML
	 * span with this class prefix (`<prefix>-pending` etc.), so the reading view
	 * can style them. Leave undefined for plain text output (clipboard, editor).
	 */
	markerClassPrefix?: string;
}

/**
 * Builds the display text of `source[from..to]` by replacing each sentence
 * with its translation. Everything outside sentences (Markdown structure,
 * code, math, links) is copied unchanged.
 */
export function composeRange(
	source: string,
	from: number,
	to: number,
	sentences: readonly Sentence[],
	display: (sentence: Sentence) => SentenceDisplay,
	opts: ComposeOptions = {},
): ComposeResult {
	const result: ComposeResult = { text: '', translated: 0, pending: 0, failed: 0, missing: 0 };
	let pos = from;
	const ordered = sentences.filter((s) => s.from >= from && s.to <= to).sort((a, b) => a.from - b.from);
	for (const sentence of ordered) {
		if (sentence.from < pos) continue;
		result.text += source.slice(pos, sentence.from);
		const d = display(sentence);
		switch (d.kind) {
			case 'translated':
				result.text += d.text;
				result.translated++;
				break;
			case 'same':
				result.text += sentence.text;
				break;
			default:
				result[d.kind]++;
				result.text += opts.markerClassPrefix
					? `<span class="${opts.markerClassPrefix}-${d.kind}">${sentence.text}</span>`
					: sentence.text;
		}
		pos = sentence.to;
	}
	result.text += source.slice(pos, to);
	return result;
}
