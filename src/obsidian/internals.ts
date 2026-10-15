import type { App } from 'obsidian';

/**
 * The only place that touches non-public Obsidian API.
 *
 * Obsidian's "Excluded files" list (Settings → Files and links) is stored as
 * the vault config key `userIgnoreFilters`. There is no public API to read or
 * change it, so this uses `vault.getConfig`/`vault.setConfig` behind a narrow
 * type. It runs only when the user selects the "Add exclusion" button.
 */
interface VaultConfigAccess {
	getConfig?(key: string): unknown;
	setConfig?(key: string, value: unknown): void;
}

function configAccess({ vault }: App): VaultConfigAccess {
	return vault as unknown as VaultConfigAccess;
}

export function canEditExcludedFiles(app: App): boolean {
	const vault = configAccess(app);
	return typeof vault.getConfig === 'function' && typeof vault.setConfig === 'function';
}

export function getExcludedFiles(app: App): string[] {
	const value = configAccess(app).getConfig?.('userIgnoreFilters');
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** True if the folder is already covered by an entry of the Excluded files list. */
export function isFolderExcluded(app: App, folder: string): boolean {
	const clean = folder.replace(/\/+$/, '');
	return getExcludedFiles(app).some((entry) => {
		const e = entry.replace(/\/+$/, '');
		return e === clean || clean.startsWith(`${e}/`);
	});
}

export function addExcludedFolder(app: App, folder: string): void {
	const vault = configAccess(app);
	if (!vault.setConfig) return;
	const entries = getExcludedFiles(app);
	const value = `${folder.replace(/\/+$/, '')}/`;
	if (!entries.includes(value)) vault.setConfig('userIgnoreFilters', [...entries, value]);
}
