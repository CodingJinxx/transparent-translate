import { normalizePath, type App, TFile } from 'obsidian';
import type { CacheBackend } from '../services/cache-store';

/**
 * Cache file access through the Vault API (never the adapter), as the plugin
 * guidelines require. Updates go through `Vault.process()` so they are atomic.
 */
export class VaultCacheBackend implements CacheBackend {
	constructor(private readonly app: App) {}

	private file(path: string): TFile | null {
		return this.app.vault.getFileByPath(normalizePath(path));
	}

	exists(path: string): boolean {
		return this.file(path) !== null;
	}

	async read(path: string): Promise<string | null> {
		const file = this.file(path);
		return file ? this.app.vault.read(file) : null;
	}

	async write(path: string, content: string): Promise<void> {
		const normalized = normalizePath(path);
		const existing = this.file(normalized);
		if (existing) {
			await this.app.vault.process(existing, () => content);
			return;
		}
		await this.ensureFolder(parentOf(normalized));
		try {
			await this.app.vault.create(normalized, content);
		} catch (error) {
			// Created concurrently (e.g. by sync): update instead.
			const created = this.file(normalized);
			if (!created) throw error;
			await this.app.vault.process(created, () => content);
		}
	}

	async remove(path: string): Promise<void> {
		const file = this.file(path);
		if (file) await this.app.fileManager.trashFile(file);
	}

	async rename(from: string, to: string): Promise<void> {
		const file = this.file(from);
		if (!file) return;
		const target = normalizePath(to);
		await this.ensureFolder(parentOf(target));
		await this.app.fileManager.renameFile(file, target);
	}

	async ensureFolder(folder: string): Promise<void> {
		if (!folder || folder === '/') return;
		if (this.app.vault.getFolderByPath(folder)) return;
		await this.ensureFolder(parentOf(folder));
		try {
			await this.app.vault.createFolder(folder);
		} catch (error) {
			if (!this.app.vault.getFolderByPath(folder)) throw error;
		}
	}
}

function parentOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}
