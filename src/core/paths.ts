/** Path helpers. Paths are vault-relative and use `/`, as in Obsidian. */

export function cleanFolder(folder: string): string {
	return folder
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.replace(/\/{2,}/g, '/');
}

/** True if `path` is `folder` itself or inside it. An empty folder matches nothing. */
export function isInFolder(path: string, folder: string): boolean {
	const f = cleanFolder(folder);
	if (!f) return false;
	return path === f || path.startsWith(`${f}/`);
}

export function cachePathFor(cacheFolder: string, notePath: string): string {
	return `${cleanFolder(cacheFolder)}/${notePath}`;
}

/** Inverse of `cachePathFor`. Returns null for paths outside the cache folder. */
export function notePathForCache(cacheFolder: string, cachePath: string): string | null {
	const prefix = `${cleanFolder(cacheFolder)}/`;
	return cachePath.startsWith(prefix) ? cachePath.slice(prefix.length) : null;
}

export interface FolderRules {
	cacheFolder: string;
	excludedFolders: readonly string[];
	includeOnlyFolders: readonly string[];
}

/** Parses a textarea value (one folder per line) into clean folder paths. */
export function parseFolderList(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map(cleanFolder)
		.filter((f) => f.length > 0);
}

/**
 * Whether a note may be translated. The cache folder is always excluded,
 * because translating translations would loop.
 */
export function isTranslatablePath(path: string, rules: FolderRules): boolean {
	if (!path.toLowerCase().endsWith('.md')) return false;
	if (isInFolder(path, rules.cacheFolder)) return false;
	if (rules.excludedFolders.some((f) => isInFolder(path, f))) return false;
	const include = rules.includeOnlyFolders.filter((f) => cleanFolder(f).length > 0);
	if (include.length > 0 && !include.some((f) => isInFolder(path, f))) return false;
	return true;
}
