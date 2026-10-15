import { emptyNames, mergeNames, namesPath, parseNames, pruneNames, serializeNames, type NameEntry, type NamesFile } from '../core/names-format';
import type { TargetLanguage } from '../core/types';
import { log } from '../log';
import type { CacheBackend } from './cache-store';

export interface NameStoreOptions {
	cacheFolder: () => string;
	/** Delay before changed names are written, so bursts of translations become one write. */
	saveDelayMs: number;
}

type Listener = () => void;

/** In-memory view of the names cache (`_names.md`) with debounced writes. */
export class NameStore {
	private file: NamesFile = emptyNames();
	private loaded = false;
	private loading: Promise<void> | null = null;
	private timer: number | null = null;
	/** Last content this store wrote, to recognize its own modify events. */
	private written: string | null = null;
	private readonly listeners = new Set<Listener>();

	constructor(
		private readonly backend: CacheBackend,
		private readonly options: NameStoreOptions,
	) {}

	get path(): string {
		return namesPath(this.options.cacheFolder());
	}

	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	isLoaded(): boolean {
		return this.loaded;
	}

	/** Loads the names cache (once). A missing or unreadable file yields an empty cache. */
	load(): Promise<void> {
		if (this.loaded) return Promise.resolve();
		if (this.loading) return this.loading;
		this.loading = (async () => {
			try {
				const content = await this.backend.read(this.path);
				if (content !== null) {
					// Entries added while loading are newer than the file: keep them.
					this.file = mergeNames(parseNames(content), this.file);
				}
			} catch (error) {
				log.error('Could not read names cache', error);
			}
			this.loaded = true;
			this.loading = null;
		})();
		return this.loading;
	}

	get(hash: string): NameEntry | undefined {
		return this.file.names[hash];
	}

	get size(): number {
		return Object.keys(this.file.names).length;
	}

	put(hash: string, src: string, target: TargetLanguage, text: string, meta: Partial<NameEntry> = {}): void {
		const entry: NameEntry = { ...(this.file.names[hash] ?? { src }), ...meta, src };
		entry[target] = text;
		this.file.names[hash] = entry;
		this.scheduleSave();
	}

	prune(live: ReadonlySet<string>, keepDays: number, now = new Date()): number {
		const removed = pruneNames(this.file, live, now, keepDays);
		if (removed > 0) this.scheduleSave();
		return removed;
	}

	/** Forgets one name (both languages), so it is requested again. */
	forget(hash: string): void {
		if (this.file.names[hash]) {
			delete this.file.names[hash];
			this.scheduleSave();
		}
	}

	private scheduleSave(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.save();
		}, this.options.saveDelayMs);
	}

	private async save(): Promise<void> {
		// Never overwrite a file that was not read yet: it may hold names from another device.
		await this.load();
		const content = serializeNames(this.file);
		if (this.written === content) return;
		this.written = content;
		try {
			await this.backend.write(this.path, content);
			log.debug('Saved names cache', this.path);
		} catch (error) {
			this.written = null;
			log.error('Could not write names cache', this.path, error);
		}
	}

	/** Writes pending changes now (on unload). */
	async flush(): Promise<void> {
		if (this.timer === null) return;
		window.clearTimeout(this.timer);
		this.timer = null;
		await this.save();
	}

	/** Called when the names file changed on disk. Ignores the store's own writes. */
	handleExternalChange(content: string): boolean {
		if (this.written === content) return false;
		const remote = parseNames(content);
		this.file = this.timer !== null || !this.loaded ? mergeNames(this.file, remote) : remote;
		this.loaded = true;
		this.written = content;
		this.emit();
		return true;
	}

	/** Forgets everything in memory (the file is handled by the caller). */
	reset(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.file = emptyNames();
		this.loaded = false;
		this.loading = null;
		this.written = null;
	}
}
