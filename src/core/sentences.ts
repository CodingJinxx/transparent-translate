import type { Block } from './types';
import { lineEnd, lineText } from './text';
import { maskedToOriginal, protect, type ProtectOptions } from './protect';

/** A range of plain text inside a block, without Markdown prefixes. */
export interface Unit {
	from: number;
	to: number;
}

export const DEFAULT_ABBREVIATIONS: readonly string[] = [
	// German
	'z. B.', 'z.B.', 'd. h.', 'd.h.', 'u. a.', 'u.a.', 'bzw.', 'usw.', 'ca.', 'evtl.', 'ggf.', 'inkl.', 'etc.',
	'vgl.', 'sog.', 'Nr.', 'Bsp.', 'bspw.', 'S.', 'Abb.', 'Kap.', 'Jh.', 'v. a.', 'u. U.', 'o. ä.', 'Mio.', 'Mrd.',
	// English
	'e.g.', 'i.e.', 'vs.', 'cf.', 'approx.', 'Fig.', 'No.', 'p.', 'pp.', 'Mr.', 'Mrs.', 'Ms.', 'St.',
	// Both
	'Dr.', 'Prof.', 'Hr.', 'Fr.', 'Jan.', 'Feb.', 'Aug.', 'Sept.', 'Okt.', 'Oct.', 'Nov.', 'Dez.', 'Dec.',
];

const LIST_PREFIX = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[.\]\s+)?/;
const QUOTE_PREFIX = /^(?:\s{0,3}>\s?)+/;
const CALLOUT_HEADER = /^\[![^\]]+\][+-]?\s*/;
const HEADING_PREFIX = /^\s{0,3}#{1,6}\s+/;
const HEADING_SUFFIX = /\s+#+\s*$/;
const FOOTNOTE_PREFIX = /^\[\^[^\]]+\]:\s*/;

function trimmedRange(text: string, from: number, to: number): Unit | null {
	while (from < to && /\s/.test(text[from] ?? '')) from++;
	while (to > from && /\s/.test(text[to - 1] ?? '')) to--;
	return to > from ? { from, to } : null;
}

/** Length of the Markdown prefix that precedes the content of a line inside a block. */
function prefixLength(block: Block, line: string, isFirstLine: boolean): number {
	let consumed = 0;
	let rest = line;
	const take = (re: RegExp) => {
		const m = re.exec(rest);
		if (!m) return false;
		consumed += m[0].length;
		rest = rest.slice(m[0].length);
		return true;
	};

	switch (block.kind) {
		case 'heading':
			take(HEADING_PREFIX);
			break;
		case 'list':
			if (!take(LIST_PREFIX)) take(/^\s+/);
			break;
		case 'quote':
		case 'callout':
			take(QUOTE_PREFIX);
			if (block.kind === 'callout' && isFirstLine) take(CALLOUT_HEADER);
			if (!take(LIST_PREFIX)) take(HEADING_PREFIX);
			break;
		case 'footnote':
			if (!take(FOOTNOTE_PREFIX)) take(/^\s+/);
			break;
		default:
			break;
	}
	return consumed;
}

/** Splits a table row into cell ranges. Escaped pipes (`\|`) do not split. */
function tableCells(text: string, from: number, to: number): Unit[] {
	const cells: Unit[] = [];
	let cellStart = from;
	for (let i = from; i < to; i++) {
		const ch = text[i];
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch === '|') {
			const cell = trimmedRange(text, cellStart, i);
			if (cell) cells.push(cell);
			cellStart = i + 1;
		}
	}
	const last = trimmedRange(text, cellStart, to);
	if (last) cells.push(last);
	return cells;
}

/** Text ranges inside a block that contain translatable prose. */
export function blockUnits(text: string, lineStarts: number[], block: Block): Unit[] {
	if (!block.translatable) return [];
	const units: Unit[] = [];
	for (let n = block.startLine; n <= block.endLine; n++) {
		const start = lineStarts[n] ?? text.length;
		const end = lineEnd(text, lineStarts, n);
		if (block.kind === 'table') {
			// The second line of a table is the |---|---| separator.
			if (n === block.startLine + 1) continue;
			units.push(...tableCells(text, start, end));
			continue;
		}
		const content = lineText(text, lineStarts, n);
		let unitEnd = end;
		if (block.kind === 'heading') {
			const suffix = HEADING_SUFFIX.exec(content);
			if (suffix) unitEnd = start + suffix.index;
		}
		const range = trimmedRange(text, start + prefixLength(block, content, n === block.startLine), unitEnd);
		if (range) units.push(range);
	}
	return units;
}

export interface SegmentOptions {
	protect: ProtectOptions;
	abbreviations: readonly string[];
}

type Segmenter = (text: string) => number[];

/** Sentence start offsets of `text`, using `Intl.Segmenter` when available. */
function defaultSegmenter(): Segmenter {
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
		return (text) => Array.from(segmenter.segment(text), (s) => s.index);
	}
	return fallbackSegmenter;
}

/** Simple splitter for runtimes without `Intl.Segmenter`. No lookbehind. */
export function fallbackSegmenter(text: string): number[] {
	const starts = [0];
	const re = /[.!?]+["'”’)\]]*\s+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const next = m.index + m[0].length;
		if (next < text.length) starts.push(next);
	}
	return starts;
}

let segmenter: Segmenter | null = null;

/**
 * True if the boundary between `previous` and `next` falls inside or right
 * after an abbreviation, e.g. "Das ist z." | "B. bei Karel" or "Dr." | "Müller".
 */
function abbreviationAtBoundary(previous: string, next: string, abbreviations: readonly string[]): boolean {
	const window = previous + next.slice(0, 16);
	const boundary = previous.trimEnd().length;
	for (const abbr of abbreviations) {
		let idx = window.indexOf(abbr, Math.max(0, boundary - abbr.length));
		while (idx !== -1 && idx < boundary) {
			const before = window[idx - 1];
			const startsWord = before === undefined || /[\s(]/.test(before);
			if (startsWord && idx + abbr.length >= boundary) return true;
			idx = window.indexOf(abbr, idx + 1);
		}
	}
	const head = previous.trimEnd();
	// Initials ("J. Doe").
	if (/(?:^|\s)\p{Lu}\.$/u.test(head)) return true;
	// Dates ("am 14. Oktober", "14. 10. 2026"). Other numbers ("Absatz 12. It…") end a sentence.
	return /(?:^|\s)\d{1,2}\.$/.test(head) && DATE_CONTINUATION.test(next.trimStart());
}

const DATE_CONTINUATION =
	/^(?:\d|Jan|Feb|M[aä]r|Apr|Ma[iy]|Jun|Jul|Aug|Sep|O[ck]t|Nov|De[cz])/;

/** Splits a unit into sentence ranges (absolute offsets). */
export function splitSentences(text: string, unit: Unit, opts: SegmentOptions): Unit[] {
	const unitText = text.slice(unit.from, unit.to);
	const masked = protect(unitText, opts.protect);
	segmenter ??= defaultSegmenter();
	const starts = segmenter(masked.masked);

	// Merge segments that were split after an abbreviation or before a lowercase continuation.
	const merged: number[] = [];
	for (let k = 0; k < starts.length; k++) {
		const start = starts[k]!;
		const prevStart = merged[merged.length - 1];
		if (prevStart !== undefined) {
			const previous = masked.masked.slice(prevStart, start);
			const next = masked.masked.slice(start, starts[k + 1] ?? masked.masked.length);
			const nextChar = next.trimStart()[0] ?? '';
			if (abbreviationAtBoundary(previous, next, opts.abbreviations) || /\p{Ll}/u.test(nextChar)) continue;
		}
		merged.push(start);
	}

	const sentences: Unit[] = [];
	for (let k = 0; k < merged.length; k++) {
		const maskedFrom = merged[k]!;
		const maskedTo = merged[k + 1] ?? masked.masked.length;
		const from = unit.from + maskedToOriginal(masked, maskedFrom, -1);
		const to = unit.from + maskedToOriginal(masked, maskedTo, -1);
		const range = trimmedRange(text, from, to);
		if (range) sentences.push(range);
	}
	return sentences;
}

/** For tests: swap the segmenter (e.g. to exercise the fallback). */
export function setSegmenterForTesting(fn: Segmenter | null): void {
	segmenter = fn;
}
