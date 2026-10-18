import { isSourceLanguage } from './language';
import { TARGET_LANGUAGES, type TargetLanguage } from './types';
import { CACHE_WARNING } from './cache-format';

/**
 * Format of the names cache (`<cache folder>/_names.md`): the same warning
 * line plus JSON as the note caches, with one entry per line so the file stays
 * easy to diff and to sync. Entries are keyed by the hash of the name.
 */

export const NAMES_VERSION = 1;
export const NAMES_FILE = '_names.md';

export interface NameEntry extends Partial<Record<TargetLanguage, string>> {
	/** The original name, for debugging and as a sanity check on read. */
	src: string;
	lang?: TargetLanguage | 'mixed';
	model?: string;
	translatedAt?: string;
}

export interface NamesFile {
	version: number;
	names: Record<string, NameEntry>;
}

export function emptyNames(): NamesFile {
	return { version: NAMES_VERSION, names: {} };
}

export function namesPath(cacheFolder: string): string {
	const folder = cacheFolder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	return folder ? `${folder}/${NAMES_FILE}` : NAMES_FILE;
}

export function serializeNames(file: NamesFile): string {
	const lines = Object.entries(file.names).map(([hash, entry]) => `\t\t${JSON.stringify(hash)}: ${JSON.stringify(entry)}`);
	const body = lines.length > 0 ? `\n${lines.join(',\n')}\n\t` : '';
	return `${CACHE_WARNING}\n\n{\n\t"version": ${file.version},\n\t"names": {${body}}\n}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeEntry(value: unknown): NameEntry | null {
	if (!isRecord(value) || typeof value.src !== 'string') return null;
	const entry: NameEntry = { src: value.src };
	if (isSourceLanguage(value.lang)) entry.lang = value.lang;
	for (const language of TARGET_LANGUAGES) {
		const text = value[language];
		if (typeof text === 'string') entry[language] = text;
	}
	if (typeof value.model === 'string') entry.model = value.model;
	if (typeof value.translatedAt === 'string') entry.translatedAt = value.translatedAt;
	return entry;
}

/** Parses the names cache. Never throws: unreadable content yields an empty cache. */
export function parseNames(content: string): NamesFile {
	const start = content.indexOf('{');
	if (start === -1) return emptyNames();
	let raw: unknown;
	try {
		raw = JSON.parse(content.slice(start));
	} catch {
		return emptyNames();
	}
	const file = emptyNames();
	if (!isRecord(raw) || !isRecord(raw.names)) return file;
	for (const [hash, value] of Object.entries(raw.names)) {
		const entry = sanitizeEntry(value);
		if (entry && /^[0-9a-f]{64}$/.test(hash)) file.names[hash] = entry;
	}
	return file;
}

function timeOf(entry: NameEntry): number {
	const at = entry.translatedAt ? Date.parse(entry.translatedAt) : 0;
	return Number.isFinite(at) ? at : 0;
}

/**
 * Union of two name caches (e.g. after sync). For the same name, translations
 * of both sides are kept and the more recent entry wins where they overlap.
 */
export function mergeNames(local: NamesFile, remote: NamesFile): NamesFile {
	const merged = emptyNames();
	for (const hash of new Set([...Object.keys(local.names), ...Object.keys(remote.names)])) {
		const a = local.names[hash];
		const b = remote.names[hash];
		if (a && b) {
			const [older, newer] = timeOf(a) <= timeOf(b) ? [a, b] : [b, a];
			merged.names[hash] = { ...older, ...newer };
		} else {
			merged.names[hash] = (a ?? b)!;
		}
	}
	return merged;
}

/** Removes entries not in `live` that were translated more than `keepDays` ago. Returns the count. */
export function pruneNames(file: NamesFile, live: ReadonlySet<string>, now: Date, keepDays: number): number {
	const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
	let removed = 0;
	for (const [hash, entry] of Object.entries(file.names)) {
		if (live.has(hash)) continue;
		if (timeOf(entry) > cutoff) continue;
		delete file.names[hash];
		removed++;
	}
	return removed;
}
