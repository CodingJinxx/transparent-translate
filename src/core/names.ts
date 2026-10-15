import { cleanFolder, isInFolder, type FolderRules } from './paths';
import { hasLetters, normalizeSentence, sentenceHash } from './text';

/**
 * Helpers for translating file and folder names. Only the display changes:
 * the real names on disk are never touched. A name is translated without its
 * extension and is keyed by its text alone, so identical names in different
 * folders are translated once and renaming or moving needs no migration.
 */

/** Cache key of a file or folder name (without extension). */
export function nameKey(stem: string): string {
	return sentenceHash(stem);
}

/** Longest name that is sent to the model. Longer names keep their original. */
export const MAX_NAME_LENGTH = 200;

/** True if the name contains something worth translating. */
export function isTranslatableName(stem: string): boolean {
	const trimmed = stem.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH && hasLetters(trimmed);
}

export interface NameRules extends FolderRules {
	/** Also translate the names of non-Markdown files (images, PDFs …). */
	includeAttachments: boolean;
}

/**
 * Whether the name of a file or folder may be translated. The cache folder is
 * always excluded. With include-only folders, only items inside them qualify
 * (their parents keep their names).
 */
export function isNameTranslatable(path: string, isFolder: boolean, extension: string, rules: NameRules): boolean {
	if (isInFolder(path, rules.cacheFolder)) return false;
	if (rules.excludedFolders.some((f) => isInFolder(path, f))) return false;
	const include = rules.includeOnlyFolders.filter((f) => cleanFolder(f).length > 0);
	if (include.length > 0 && !include.some((f) => isInFolder(path, f))) return false;
	if (!isFolder && extension.toLowerCase() !== 'md' && !rules.includeAttachments) return false;
	return true;
}

/** Leading number or date, e.g. `2024-05-12 ` or `03_`, which a translation must keep. */
function numericPrefix(text: string): string {
	return /^\d[\d._\-/ ]*/.exec(text)?.[0].trim() ?? '';
}

const QUOTES = /^["'“”„‚‘’`«»]+|["'“”„‚‘’`«»]+$/g;

/**
 * Checks and cleans a translated name. Returns null when the output cannot be
 * a name (the original is then shown), so one bad answer never produces a
 * strange label.
 */
export function validateNameTranslation(source: string, output: string, glossary: readonly string[] = []): string | null {
	if (/[\r\n]/.test(output.trim())) return null;
	let text = normalizeSentence(output);
	// Models like to wrap titles in quotes or end them with a full stop.
	const sourceQuoted = source.replace(QUOTES, '') !== source;
	const sourceDot = source.trim().endsWith('.');
	for (let pass = 0; pass < 2; pass++) {
		if (!sourceQuoted) text = text.replace(QUOTES, '');
		if (!sourceDot) text = text.replace(/\.+$/, '');
	}
	text = text.trim();
	if (text.length === 0 || text.length > source.length * 3 + 20) return null;
	if (/[\\/]/.test(text) && !/[\\/]/.test(source)) return null;
	if (numericPrefix(source) !== numericPrefix(text)) return null;
	const lower = text.toLowerCase();
	const src = source.toLowerCase();
	for (const term of glossary) {
		const t = term.toLowerCase();
		if (t.length > 0 && src.includes(t) && !lower.includes(t)) return null;
	}
	return text;
}

export interface SiblingName {
	real: string;
	display: string;
}

/**
 * Names must stay unambiguous within a folder. If two siblings would show the
 * same text (ignoring case), or a translation equals another sibling's real
 * name, the affected items keep their original. Returns the final display
 * text for each input, in order.
 */
export function resolveCollisions(siblings: readonly SiblingName[]): string[] {
	const shown = new Map<string, number>();
	const reals = new Set<string>();
	for (const s of siblings) {
		const key = s.display.toLowerCase();
		shown.set(key, (shown.get(key) ?? 0) + 1);
		reals.add(s.real.toLowerCase());
	}
	return siblings.map((s) => {
		if (s.display === s.real) return s.real;
		const key = s.display.toLowerCase();
		const clash = (shown.get(key) ?? 0) > 1 || (reals.has(key) && key !== s.real.toLowerCase());
		return clash ? s.real : s.display;
	});
}

/** The folder part of a vault path (`a/b/c.md` → `a/b`, root → empty string). */
export function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}
