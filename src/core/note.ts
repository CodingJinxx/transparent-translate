import type { NoteModel, Sentence } from './types';
import { parseBlocks } from './blocks';
import { blockUnits, DEFAULT_ABBREVIATIONS, splitSentences, type SegmentOptions } from './sentences';
import { computeLineStarts, hasLetters, sentenceHash } from './text';
import { DEFAULT_PROTECT_OPTIONS, protect } from './protect';

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
	protect: DEFAULT_PROTECT_OPTIONS,
	abbreviations: DEFAULT_ABBREVIATIONS,
};

const PLACEHOLDER_ONLY = /⟦\d+⟧/g;

/** Parses a note into blocks and translatable sentences. Pure and deterministic. */
export function parseNote(text: string, opts: SegmentOptions = DEFAULT_SEGMENT_OPTIONS): NoteModel {
	const lineStarts = computeLineStarts(text);
	const blocks = parseBlocks(text, lineStarts);
	const sentences: Sentence[] = [];
	blocks.forEach((block, blockIndex) => {
		for (const unit of blockUnits(text, lineStarts, block)) {
			for (const range of splitSentences(text, unit, opts)) {
				const sentenceText = text.slice(range.from, range.to);
				const masked = protect(sentenceText, opts.protect);
				// Nothing to translate in a sentence made only of links, tags or math.
				if (!hasLetters(masked.masked.replace(PLACEHOLDER_ONLY, ''))) continue;
				sentences.push({
					from: range.from,
					to: range.to,
					text: sentenceText,
					hash: sentenceHash(sentenceText),
					masked: masked.masked,
					tokens: masked.tokens,
					blockIndex,
				});
			}
		}
	});
	return { text, blocks, sentences, lineStarts };
}

/** Sentences that overlap the half-open range `from..to`. */
export function sentencesInRange(note: NoteModel, from: number, to: number): Sentence[] {
	return note.sentences.filter((s) => s.to > from && s.from < to);
}

/** Sentences inside lines `startLine..endLine` (inclusive). */
export function sentencesInLines(note: NoteModel, startLine: number, endLine: number): Sentence[] {
	const from = note.lineStarts[startLine] ?? note.text.length;
	const to = note.lineStarts[endLine + 1] ?? note.text.length + 1;
	return note.sentences.filter((s) => s.from >= from && s.from < to);
}

/** Small cache so repeated renders of the same text do not reparse it. */
export class NoteParser {
	private lastText: string | null = null;
	private lastModel: NoteModel | null = null;
	private lastOpts: SegmentOptions | null = null;

	parse(text: string, opts: SegmentOptions): NoteModel {
		if (this.lastModel && this.lastText === text && this.lastOpts === opts) return this.lastModel;
		this.lastModel = parseNote(text, opts);
		this.lastText = text;
		this.lastOpts = opts;
		return this.lastModel;
	}
}
