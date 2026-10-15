import { sha256Hex } from './sha256';

/** Whitespace-insensitive, Unicode-normalized form of a sentence, used for hashing. */
export function normalizeSentence(text: string): string {
	return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

const hashMemo = new Map<string, string>();
const HASH_MEMO_LIMIT = 20000;

/** Cache key of a sentence. Memoized, because editors rehash on every keystroke. */
export function sentenceHash(text: string): string {
	const normalized = normalizeSentence(text);
	const memo = hashMemo.get(normalized);
	if (memo !== undefined) return memo;
	const hash = sha256Hex(normalized);
	if (hashMemo.size >= HASH_MEMO_LIMIT) hashMemo.clear();
	hashMemo.set(normalized, hash);
	return hash;
}

/** True if the string contains at least one letter in any script. */
export function hasLetters(text: string): boolean {
	return /\p{L}/u.test(text);
}

/** Offsets of the first character of every line. Handles `\n` and `\r\n`. */
export function computeLineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return starts;
}

/** End offset of line `line`, excluding the line break (`\n` or `\r\n`). */
export function lineEnd(text: string, lineStarts: number[], line: number): number {
	const next = lineStarts[line + 1];
	if (next === undefined) return text.length;
	let end = next - 1;
	if (end > 0 && text.charCodeAt(end - 1) === 13) end--;
	return end;
}

export function lineText(text: string, lineStarts: number[], line: number): string {
	return text.slice(lineStarts[line] ?? text.length, lineEnd(text, lineStarts, line));
}
