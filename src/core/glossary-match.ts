import { cleanText, MAX_DOMAIN, MAX_HINT, MAX_SRC, MAX_TO, parseScopeKey, type GlossaryEntry, type GlossaryFile, type GlossaryScope } from './glossary-format';
import { parentPath } from './names';
import { cleanFolder, isInFolder } from './paths';
import { sha256Hex } from './sha256';
import type { TargetLanguage } from './types';

/** What the glossary needs to know about a note to decide which entries apply. */
export interface NoteContext {
	path: string;
	/** Frontmatter properties, values as lowercase strings. Keys lowercase. */
	properties: Record<string, string[]>;
	/** Tags without `#`, lowercase. */
	tags: string[];
}

export interface ActiveEntry {
	id: string;
	entry: GlossaryEntry;
	rank: number;
}

/** Terms for one translation request, already filtered, ranked and cleaned. */
export interface PromptTerms {
	map: Array<{ src: string; to: string; hint?: string }>;
	avoid: Array<{ src: string; avoid: string[] }>;
	keep: string[];
	domain?: string;
}

/** Most entries sent with one request. */
export const MAX_TERM_LINES = 30;

export function scopeApplies(scope: GlossaryScope, ctx: NoteContext): boolean {
	if (scope.note) return scope.note === ctx.path;
	if (scope.property) return (ctx.properties[scope.property.key.toLowerCase()] ?? []).includes(scope.property.value.toLowerCase());
	if (scope.tag) {
		const tag = scope.tag.replace(/^#/, '').toLowerCase();
		return ctx.tags.some((t) => t === tag || t.startsWith(`${tag}/`));
	}
	if (scope.folder) return isInFolder(ctx.path, scope.folder);
	return true;
}

/** Specificity of a scope: note, then property or tag, then the deepest folder, then the vault. */
export function scopeRank(scope: GlossaryScope): number {
	if (scope.note) return 1000;
	if (scope.property || scope.tag) return 500;
	if (scope.folder) return 100 + cleanFolder(scope.folder).split('/').length;
	return 0;
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Words of a sentence without placeholders. */
export function wordsOf(text: string): string[] {
	return text.normalize('NFC').replace(/⟦\d+⟧/g, ' ').match(WORD) ?? [];
}

function matchMode(entry: GlossaryEntry, termWords: string[]): 'stem' | 'word' {
	if (entry.match) return entry.match;
	return termWords.length === 1 && [...termWords[0]!].length <= 3 ? 'word' : 'stem';
}

/**
 * Whether a term occurs in a sentence. `stem` matches inside words, so
 * "Schein" finds "Scheinkriterien" and "Scheinen". `word` matches whole,
 * case-sensitive words ("LP" does not match "help").
 */
export function termMatches(words: readonly string[], entry: Pick<GlossaryEntry, 'src' | 'match'>): boolean {
	const termWords = wordsOf(entry.src);
	if (termWords.length === 0) return false;
	const mode = matchMode(entry as GlossaryEntry, termWords);
	const lowerWords = words.map((w) => w.toLowerCase());
	const lowerTerm = termWords.map((w) => w.toLowerCase());
	for (let i = 0; i + termWords.length <= words.length; i++) {
		let ok = true;
		for (let j = 0; j < termWords.length && ok; j++) {
			ok = mode === 'word' ? words[i + j] === termWords[j] : lowerWords[i + j]!.includes(lowerTerm[j]!);
		}
		if (ok) return true;
	}
	return false;
}

/** Entries that apply to a note and a target language; for the same term the most specific scope wins. */
export function activeEntries(file: GlossaryFile, ctx: NoteContext, target: TargetLanguage): ActiveEntry[] {
	const best = new Map<string, ActiveEntry>();
	for (const [id, entry] of Object.entries(file.entries)) {
		if (entry.deleted) continue;
		if (entry.target !== '*' && entry.target !== target) continue;
		if (!scopeApplies(entry.scope, ctx)) continue;
		const rank = scopeRank(entry.scope);
		const key = `${entry.kind}\u0000${entry.src.normalize('NFC').toLowerCase()}`;
		const known = best.get(key);
		if (!known || rank > known.rank) best.set(key, { id, entry, rank });
	}
	return [...best.values()];
}

/**
 * The entries that matter for a set of sentences. A shorter term is dropped
 * where a longer one that contains it matches in the same sentence
 * ("Scheinkriterien" wins over "Schein").
 */
export function matchingEntries(active: readonly ActiveEntry[], sentences: readonly string[]): ActiveEntry[] {
	const result = new Map<string, ActiveEntry>();
	for (const sentence of sentences) {
		const words = wordsOf(sentence);
		const hits = active.filter((a) => termMatches(words, a.entry));
		for (const hit of hits) {
			const shadowed = hits.some(
				(other) =>
					other !== hit &&
					other.entry.kind === hit.entry.kind &&
					other.entry.src.length > hit.entry.src.length &&
					other.entry.src.toLowerCase().includes(hit.entry.src.toLowerCase()),
			);
			if (!shadowed) result.set(hit.id, hit);
		}
	}
	return [...result.values()];
}

/** Short fingerprint of the entries that apply to a sentence. Empty when none do. */
export function signatureOf(matches: readonly ActiveEntry[]): string {
	if (matches.length === 0) return '';
	return sha256Hex(
		matches
			.map((m) => `${m.id}:${m.entry.updatedAt}`)
			.sort()
			.join('|'),
	).slice(0, 8);
}

/** Builds the terms for one request from entries that match its sentences. */
export function buildPromptTerms(matches: readonly ActiveEntry[], domain: string | undefined): PromptTerms | undefined {
	const ranked = [...matches].sort((a, b) => b.rank - a.rank || b.entry.src.length - a.entry.src.length);
	const terms: PromptTerms = { map: [], avoid: [], keep: [] };
	let lines = 0;
	for (const { entry } of ranked) {
		const src = cleanText(entry.src, MAX_SRC);
		if (entry.kind === 'keep') {
			terms.keep.push(src);
			continue;
		}
		if (lines >= MAX_TERM_LINES) continue;
		if (entry.kind === 'map' && entry.to) {
			const hint = entry.hint ? cleanText(entry.hint, MAX_HINT) : undefined;
			terms.map.push({ src, to: cleanText(entry.to, MAX_TO), ...(hint ? { hint } : {}) });
			lines++;
		} else if (entry.kind === 'avoid' && entry.avoid) {
			terms.avoid.push({ src, avoid: entry.avoid.map((a) => cleanText(a, MAX_TO)) });
			lines++;
		}
	}
	if (domain) terms.domain = cleanText(domain, MAX_DOMAIN);
	if (terms.map.length === 0 && terms.avoid.length === 0 && terms.keep.length === 0 && !terms.domain) return undefined;
	return terms;
}

/** Domain texts of all scopes that apply to a note, most specific first. */
export function domainFor(file: GlossaryFile, ctx: NoteContext): string | undefined {
	const parts = Object.entries(file.domains)
		.map(([key, domain]) => ({ scope: parseScopeKey(key), text: domain.text }))
		.filter((d) => d.text.trim().length > 0 && scopeApplies(d.scope, ctx))
		.sort((a, b) => scopeRank(b.scope) - scopeRank(a.scope))
		.map((d) => d.text.trim());
	return parts.length > 0 ? parts.join(' ').slice(0, MAX_DOMAIN) : undefined;
}

/** What the translation service needs per note and language. */
export interface TermResolver {
	/** Fingerprint of the entries that apply to this sentence (empty if none). */
	signature(masked: string): string;
	/** Terms to send with a batch of sentences. */
	forBatch(masked: readonly string[]): PromptTerms | undefined;
}

export function createResolver(file: GlossaryFile, ctx: NoteContext, target: TargetLanguage): TermResolver {
	const active = activeEntries(file, ctx, target);
	const domain = domainFor(file, ctx);
	const signatures = new Map<string, string>();
	return {
		signature(masked) {
			if (active.length === 0) return '';
			let sig = signatures.get(masked);
			if (sig === undefined) {
				sig = signatureOf(matchingEntries(active, [masked]));
				signatures.set(masked, sig);
			}
			return sig;
		},
		forBatch(masked) {
			return buildPromptTerms(matchingEntries(active, masked), domain);
		},
	};
}

const SKIPPED_PROPERTIES = new Set(['tags', 'tag', 'aliases', 'alias', 'cssclasses', 'cssclass', 'position']);

/**
 * Scopes a correction can be saved for, most specific first among folders:
 * each parent folder (deepest first), the note, frontmatter properties, tags
 * and the whole vault. The first folder (the note's own) is the default.
 */
export function scopeChoices(ctx: NoteContext): GlossaryScope[] {
	const choices: GlossaryScope[] = [];
	const folders = parentPath(ctx.path).split('/').filter((s) => s.length > 0);
	for (let i = folders.length; i >= 1; i--) choices.push({ folder: folders.slice(0, i).join('/') });
	choices.push({ note: ctx.path });
	let properties = 0;
	for (const [key, values] of Object.entries(ctx.properties)) {
		if (SKIPPED_PROPERTIES.has(key)) continue;
		for (const value of values.slice(0, 3)) {
			if (properties++ < 6 && value.length > 0 && value.length <= 40) choices.push({ property: { key, value } });
		}
	}
	for (const tag of ctx.tags.slice(0, 5)) choices.push({ tag });
	choices.push({});
	return choices;
}
