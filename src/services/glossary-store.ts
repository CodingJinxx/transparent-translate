import {
	cleanText,
	emptyGlossary,
	entryKey,
	MAX_DOMAIN,
	mergeGlossary,
	newEntryId,
	parseGlossary,
	purgeTombstones,
	rewriteScopePaths,
	scopeKey,
	serializeGlossary,
	type GlossaryDomain,
	type GlossaryEntry,
	type GlossaryFile,
	type GlossaryScope,
} from '../core/glossary-format';
import { log } from '../log';
import type { CacheBackend } from './cache-store';

export interface GlossaryStoreOptions {
	/** Vault path of the glossary note. */
	path: () => string;
	saveDelayMs: number;
}

type Listener = () => void;

/** What an operation changed, so it can be undone. `before` undefined means "did not exist". */
type UndoOp = { type: 'entry'; id: string; before?: GlossaryEntry } | { type: 'domain'; key: string; before?: GlossaryDomain };

const UNDO_LIMIT = 20;

/**
 * In-memory view of the glossary note with debounced writes, merge on external
 * change (sync) and an undo stack for corrections made in this session.
 */
export class GlossaryStore {
	private file: GlossaryFile = emptyGlossary();
	private loaded = false;
	private loading: Promise<void> | null = null;
	private timer: number | null = null;
	private written: string | null = null;
	private readonly listeners = new Set<Listener>();
	private readonly undoStack: UndoOp[][] = [];
	private group: UndoOp[] | null = null;
	/** Increases with every change, so memoized lookups know when to recompute. */
	epoch = 0;

	constructor(
		private readonly backend: CacheBackend,
		private readonly options: GlossaryStoreOptions,
	) {}

	get path(): string {
		return this.options.path();
	}

	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed(): void {
		this.epoch++;
		for (const listener of this.listeners) listener();
	}

	isLoaded(): boolean {
		return this.loaded;
	}

	/** The glossary as loaded so far (empty until `load()` finished). Do not modify. */
	get data(): GlossaryFile {
		return this.file;
	}

	load(): Promise<void> {
		if (this.loaded) return Promise.resolve();
		if (this.loading) return this.loading;
		this.loading = (async () => {
			try {
				const content = await this.backend.read(this.path);
				if (content !== null) this.file = mergeGlossary(parseGlossary(content), this.file);
			} catch (error) {
				log.error('Could not read translation glossary', error);
			}
			this.loaded = true;
			this.loading = null;
			this.changed();
		})();
		return this.loading;
	}

	/** Entries that are not deleted, with their ids. */
	entries(): Array<{ id: string; entry: GlossaryEntry }> {
		return Object.entries(this.file.entries)
			.filter(([, entry]) => !entry.deleted)
			.map(([id, entry]) => ({ id, entry }));
	}

	// ---- Changes --------------------------------------------------------

	private record(op: UndoOp): void {
		if (this.group) {
			this.group.push(op);
			return;
		}
		this.pushGroup([op]);
	}

	private pushGroup(ops: UndoOp[]): void {
		if (ops.length === 0) return;
		this.undoStack.push(ops);
		if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
	}

	/** Runs several changes as one undo step. */
	batch(fn: () => void): void {
		if (this.group) {
			fn();
			return;
		}
		this.group = [];
		try {
			fn();
		} finally {
			const ops = this.group;
			this.group = null;
			this.pushGroup(ops);
		}
	}

	/** Adds an entry, or updates the existing one for the same term and scope. Returns its id. */
	upsert(entry: Omit<GlossaryEntry, 'updatedAt' | 'deleted'>, now = new Date()): string {
		const key = entryKey(entry);
		const existing = Object.entries(this.file.entries).find(([, e]) => e.src && entryKey(e) === key);
		const id = existing?.[0] ?? newEntryId();
		this.record({ type: 'entry', id, ...(existing ? { before: existing[1] } : {}) });
		const { to, avoid, hint, match, ...base } = entry;
		this.file.entries[id] = {
			...base,
			...(to !== undefined ? { to } : {}),
			...(avoid !== undefined ? { avoid } : {}),
			...(hint ? { hint } : {}),
			...(match ? { match } : {}),
			updatedAt: now.toISOString(),
		};
		this.touched();
		return id;
	}

	remove(id: string, now = new Date()): void {
		const entry = this.file.entries[id];
		if (!entry || entry.deleted) return;
		this.record({ type: 'entry', id, before: entry });
		this.file.entries[id] = { kind: 'keep', src: '', target: '*', scope: {}, updatedAt: now.toISOString(), deleted: true };
		this.touched();
	}

	setDomain(scope: GlossaryScope, text: string, now = new Date()): void {
		const key = scopeKey(scope);
		const cleaned = cleanText(text, MAX_DOMAIN);
		this.record({ type: 'domain', key, ...(this.file.domains[key] ? { before: this.file.domains[key] } : {}) });
		this.file.domains[key] = { text: cleaned, updatedAt: now.toISOString() };
		this.touched();
	}

	/** Reverts the last change (or group of changes). Returns false if there is nothing to undo. */
	undo(now = new Date()): boolean {
		const ops = this.undoStack.pop();
		if (!ops) return false;
		for (const op of [...ops].reverse()) {
			if (op.type === 'entry') {
				// Restoring an older value still needs a newer timestamp, or a sync would bring the undone one back.
				this.file.entries[op.id] = op.before
					? { ...op.before, updatedAt: now.toISOString() }
					: { kind: 'keep', src: '', target: '*', scope: {}, updatedAt: now.toISOString(), deleted: true };
			} else if (op.before) {
				this.file.domains[op.key] = { ...op.before, updatedAt: now.toISOString() };
			} else {
				this.file.domains[op.key] = { text: '', updatedAt: now.toISOString() };
			}
		}
		this.touched();
		return true;
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	/** A note or folder was renamed or moved: keep the scopes that point at it. */
	renamePaths(from: string, to: string, now = new Date()): void {
		if (rewriteScopePaths(this.file, from, to, now.toISOString())) this.touched();
	}

	private touched(): void {
		this.changed();
		this.scheduleSave();
	}

	// ---- Persistence ----------------------------------------------------

	private scheduleSave(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			void this.save();
		}, this.options.saveDelayMs);
	}

	private async save(): Promise<void> {
		// Never overwrite a file that was not read yet: it may hold entries from another device.
		await this.load();
		purgeTombstones(this.file, new Date());
		const content = serializeGlossary(this.file);
		if (this.written === content) return;
		this.written = content;
		try {
			await this.backend.write(this.path, content);
			log.debug('Saved translation glossary', this.path);
		} catch (error) {
			this.written = null;
			log.error('Could not write translation glossary', this.path, error);
		}
	}

	async flush(): Promise<void> {
		if (this.timer === null) return;
		window.clearTimeout(this.timer);
		this.timer = null;
		await this.save();
	}

	/** The note changed on disk (sync, or edited by hand). Ignores this store's own writes. */
	handleExternalChange(content: string): boolean {
		if (this.written === content) return false;
		const remote = parseGlossary(content);
		this.file = this.timer !== null || !this.loaded ? mergeGlossary(this.file, remote) : remote;
		this.loaded = true;
		this.written = content;
		this.changed();
		return true;
	}

	reset(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.file = emptyGlossary();
		this.loaded = false;
		this.loading = null;
		this.written = null;
		this.undoStack.length = 0;
		this.changed();
	}
}
