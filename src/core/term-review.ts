import { cleanText, MAX_SRC, MAX_TO } from './glossary-format';
import { LANGUAGE_NAMES, type ChatMessage } from './prompt';
import type { TargetLanguage } from './types';

/**
 * "Review terms": one request that asks the model which terms of a finished
 * translation were a judgment call, so the user can settle them once.
 */

export interface ReviewPair {
	/** Source sentence (placeholders for links and code). */
	source: string;
	translation: string;
}

export interface ReviewTerm {
	/** The term as written in the source text. */
	src: string;
	/** How the translation rendered it. */
	chosen: string;
	alternatives: string[];
	why?: string;
}

export const MAX_REVIEW_TERMS = 15;
/** Sentence pairs sent for one review (characters of source and translation together). */
export const MAX_REVIEW_CHARS = 9000;

export function buildReviewMessages(pairs: readonly ReviewPair[], target: TargetLanguage, knownTerms: readonly string[]): ChatMessage[] {
	const language = LANGUAGE_NAMES[target];
	const system = [
		`You review a translation into ${language} of personal notes. Find the terms whose translation is a judgment call: subject-specific vocabulary, institutional or bureaucratic terms, abbreviations, words with several senses, and terms that the translation renders differently in different places.`,
		'Skip names of people and products, numbers, dates and ordinary words.',
		`Return only JSON: {"terms": [{"src": "...", "chosen": "how the translation renders it", "alternatives": ["...", "..."], "why": "at most 12 words"}]}`,
		`At most ${MAX_REVIEW_TERMS} terms, the most uncertain first. "src" must be written exactly as in the source text. "alternatives" has 2 or 3 other translations that would be reasonable. Output nothing but the JSON.`,
	].join('\n');
	const lines: string[] = [`Target language: ${language}`];
	if (knownTerms.length > 0) lines.push(`Already decided (do not list): ${knownTerms.join(', ')}`);
	lines.push('Source ⇒ translation:');
	let used = 0;
	pairs.forEach((pair, i) => {
		const line = `<<${i + 1}>> ${pair.source} ⇒ ${pair.translation}`;
		if (used + line.length > MAX_REVIEW_CHARS) return;
		used += line.length;
		lines.push(line);
	});
	return [
		{ role: 'system', content: system },
		{ role: 'user', content: lines.join('\n') },
	];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses the model's answer. Anything unusable yields no terms. A term whose
 * source text does not occur in the note is dropped, so the model cannot
 * invent entries.
 */
export function parseReviewOutput(content: string, sources: readonly string[]): ReviewTerm[] {
	const start = content.indexOf('{');
	const end = content.lastIndexOf('}');
	if (start === -1 || end <= start) return [];
	let raw: unknown;
	try {
		raw = JSON.parse(content.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!isRecord(raw) || !Array.isArray(raw.terms)) return [];
	const haystack = sources.join('\n').normalize('NFC').toLowerCase();
	const seen = new Set<string>();
	const terms: ReviewTerm[] = [];
	for (const item of raw.terms) {
		if (!isRecord(item) || typeof item.src !== 'string' || typeof item.chosen !== 'string') continue;
		const src = cleanText(item.src, MAX_SRC);
		const chosen = cleanText(item.chosen, MAX_TO);
		if (!src || !chosen || !haystack.includes(src.normalize('NFC').toLowerCase())) continue;
		const key = src.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const alternatives = (Array.isArray(item.alternatives) ? item.alternatives : [])
			.filter((a): a is string => typeof a === 'string')
			.map((a) => cleanText(a, MAX_TO))
			.filter((a, i, all) => a.length > 0 && a.toLowerCase() !== chosen.toLowerCase() && all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i)
			.slice(0, 3);
		const why = typeof item.why === 'string' ? cleanText(item.why, 120) : '';
		terms.push({ src, chosen, alternatives, ...(why ? { why } : {}) });
		if (terms.length >= MAX_REVIEW_TERMS) break;
	}
	return terms;
}
