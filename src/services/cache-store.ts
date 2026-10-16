import {
	addReplacedOriginal,
	emptyCache,
	parseCache,
	pruneCache,
	serializeCache,
	type CacheEntry,
	type CacheFile,
	type ReplacedOriginal,
} from '../core/cache-format';
import { cachePathFor } from '../core/paths';
import type { TargetLanguage } from '../core/types';
import { log } from '../log';

/** File access used by the cache. The plugin implements it with the Vault API. */
export interface CacheBackend {
	read(path: string): Promise<string | null>;
	/** Creates the file (and parent folders) or replaces its content atomically. */
	write(path: string, content: string): Promise<void>;
	remove(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	exists(path: string): boolean;
}

export interface CacheStoreOptions {
	cacheFolder: () => string;
	/** Delay before a changed cache is written, so bursts of translations become one write. */
	saveDelayMs: number;
}

type Listener = (notePath: string) => void;

/**
 * In-memory view of the per-note cache files, with debounced writes.
 * Paths passed in are note paths; the store maps them to cache paths.
 */
export class CacheStore {
	private readonly caches = new Map<string, CacheFile>();
	private readonly loading = new Map<string, Promise<CacheFile>>();
	/**
	 * Notes whose cache file has been read (or replaced by what is on disk). A cache that
	 * `ensure()` created for a first `put()` is in `caches` but not here, so the file on disk
	 * is still merged in instead of being hidden behind a new empty cache and overwritten.
	 */
	private readonly fromDisk = new Set<string>();
	private readonly timers = new Map<string, number>();
	/** Last content this store wrote per cache path, to recognize its own modify events. */
	private readonly written = new Map<string, string>();
	private readonly listeners = new Set<Listener>();
	/** Increases whenever the in-memory caches are dropped, so users of the store can forget what they loaded. */
	epoch = 0;

	constructor(
		private readonly backend: CacheBackend,
		private readonly options: CacheStoreOptions,
	) {}

	cachePath(notePath: string): string {
		return cachePathFor(this.options.cacheFolder(), notePath);
	}

	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(notePath: string): void {
		for (const listener of this.listeners) listener(notePath);
	}

	/** The cache if it is already loaded. Never triggers I/O. */
	peek(notePath: string): CacheFile | undefined {
		return this.caches.get(notePath);
	}

	isLoaded(notePath: string): boolean {
		return this.fromDisk.has(notePath);
	}

	/** Loads the cache of a note (once). Missing or unreadable files yield an empty cache. */
	load(notePath: string): Promise<CacheFile> {
		const loaded = this.fromDisk.has(notePath) ? this.caches.get(notePath) : undefined;
		if (loaded) return Promise.resolve(loaded);
		const pending = this.loading.get(notePath);
		if (pending) return pending;
		const promise = (async () => {
			let cache = emptyCache();
			try {
				const content = await this.backend.read(this.cachePath(notePath));
				if (content !== null) cache = parseCache(content);
			} catch (error) {
				log.error('Could not read translation cache', notePath, error);
			}
			// A put() may have happened while loading; keep those entries.
			const raced = this.caches.get(notePath);
			if (raced) {
				Object.assign(cache.sentences, raced.sentences);
				cache.replacedOriginals.push(...raced.replacedOriginals);
			}
			this.caches.set(notePath, cache);
			this.fromDisk.add(notePath);
			this.loading.delete(notePath);
			return cache;
		})();
		this.loading.set(notePath, promise);
		return promise;
	}

	lookup(notePath: string, hash: string, target: TargetLanguage): string | undefined {
		return this.caches.get(notePath)?.sentences[hash]?.[target];
	}

	private ensure(notePath: string): CacheFile {
		let cache = this.caches.get(notePath);
		if (!cache) {
			cache = emptyCache();
			this.caches.set(notePath, cache);
			// Merge whatever is on disk in the background.
			void this.load(notePath);
		}
		return cache;
	}

	put(notePath: string, hash: string, target: TargetLanguage, text: string, meta: Partial<CacheEntry> = {}): void {
		const cache = this.ensure(notePath);
		const entry: CacheEntry = { ...(cache.sentences[hash] ?? {}), ...meta };
		entry[target] = text;
		if (entry.gl && entry.gl.en === undefined && entry.gl.de === undefined) delete entry.gl;
		cache.sentences[hash] = entry;
		this.scheduleSave(notePath);
	}

	/** Removes cached translations for the given hashes (one target or both). */
	forget(notePath: string, hashes: Iterable<string>, target?: TargetLanguage): void {
		const cache = this.caches.get(notePath);
		if (!cache) return;
		for (const hash of hashes) {
			const entry = cache.sentences[hash];
			if (!entry) continue;
			if (target) {
				delete entry[target];
				if (entry.en === undefined && entry.de === undefined) delete cache.sentences[hash];
			} else {
				delete cache.sentences[hash];
			}
		}
		this.scheduleSave(notePath);
	}

	addReplaced(notePath: string, item: ReplacedOriginal): void {
		addReplacedOriginal(this.ensure(notePath), item);
		this.scheduleSave(notePath);
	}

	replaced(notePath: string): ReplacedOriginal[] {
		return this.caches.get(notePath)?.replacedOriginals ?? [];
	}

	/** Removes old entries no longer referenced by the note. */
	prune(notePath: string, liveHashes: ReadonlySet<string>, keepDays: number, now = new Date()): number {
		const cache = this.caches.get(notePath);
		if (!cache) return 0;
		const removed = pruneCache(cache, liveHashes, now, keepDays);
		if (removed > 0) this.scheduleSave(notePath);
		return removed;
	}

	private scheduleSave(notePath: string): void {
		const existing = this.timers.get(notePath);
		if (existing) window.clearTimeout(existing);
		this.timers.set(
			notePath,
			window.setTimeout(() => {
				this.timers.delete(notePath);
				void this.save(notePath);
			}, this.options.saveDelayMs),
		);
	}

	private async save(notePath: string): Promise<void> {
		const cache = this.caches.get(notePath);
		if (!cache) return;
		const path = this.cachePath(notePath);
		const content = serializeCache(cache);
		if (this.written.get(path) === content) return;
		this.written.set(path, content);
		try {
			await this.backend.write(path, content);
			log.debug('Saved translation cache', path);
		} catch (error) {
			this.written.delete(path);
			log.error('Could not write translation cache', path, error);
		}
	}

	/** Writes all pending changes now (on unload). */
	async flush(): Promise<void> {
		const pending = [...this.timers.keys()];
		for (const notePath of pending) {
			window.clearTimeout(this.timers.get(notePath));
			this.timers.delete(notePath);
		}
		await Promise.all(pending.map((notePath) => this.save(notePath)));
	}

	/**
	 * Called when a cache file changed on disk. Ignores the store's own writes;
	 * otherwise (sync from another device) reloads and notifies listeners.
	 */
	async handleExternalChange(notePath: string, content: string): Promise<boolean> {
		const path = this.cachePath(notePath);
		if (this.written.get(path) === content) return false;
		if (this.timers.has(notePath)) {
			// Local changes are pending: merge remote entries into the local cache instead of replacing it.
			const local = this.ensure(notePath);
			const remote = parseCache(content);
			for (const [hash, entry] of Object.entries(remote.sentences)) {
				local.sentences[hash] = { ...entry, ...local.sentences[hash] };
			}
		} else {
			this.caches.set(notePath, parseCache(content));
		}
		this.written.set(path, content);
		this.fromDisk.add(notePath);
		this.emit(notePath);
		return true;
	}

	async renameNote(oldPath: string, newPath: string): Promise<void> {
		const cache = this.caches.get(oldPath);
		const timer = this.timers.get(oldPath);
		if (timer) {
			window.clearTimeout(timer);
			this.timers.delete(oldPath);
		}
		const wasFromDisk = this.fromDisk.delete(oldPath);
		this.caches.delete(oldPath);
		const from = this.cachePath(oldPath);
		const to = this.cachePath(newPath);
		try {
			if (this.backend.exists(from) && !this.backend.exists(to)) await this.backend.rename(from, to);
		} catch (error) {
			log.error('Could not move translation cache', from, to, error);
		}
		if (cache) {
			this.caches.set(newPath, cache);
			if (wasFromDisk) this.fromDisk.add(newPath);
			if (timer) this.scheduleSave(newPath);
		}
	}

	async deleteNote(notePath: string): Promise<void> {
		const timer = this.timers.get(notePath);
		if (timer) window.clearTimeout(timer);
		this.timers.delete(notePath);
		this.caches.delete(notePath);
		this.fromDisk.delete(notePath);
		const path = this.cachePath(notePath);
		this.written.delete(path);
		try {
			if (this.backend.exists(path)) await this.backend.remove(path);
		} catch (error) {
			log.error('Could not delete translation cache', path, error);
		}
	}

	/** Forgets everything in memory (the files are handled by the caller). */
	reset(): void {
		this.epoch++;
		for (const timer of this.timers.values()) window.clearTimeout(timer);
		this.timers.clear();
		this.caches.clear();
		this.fromDisk.clear();
		this.loading.clear();
		this.written.clear();
	}
}
