import { detectLanguage, refineLanguage } from '../core/language';
import { isTranslatableName, nameKey, validateNameTranslation } from '../core/names';
import { normalizeSentence } from '../core/text';
import type { TargetLanguage } from '../core/types';
import { log } from '../log';
import { TranslatorError, type Translator } from '../translator/translator';
import type { NameStore } from './name-store';

export interface NameServiceDeps {
	store: NameStore;
	/** Null on mobile, where translations are never generated. */
	translator: () => Translator | null;
	batchSize: () => number;
	concurrency: () => number;
	glossary: () => readonly string[];
	/** Called once per failed request (not per name). */
	onError: (error: Error) => void;
}

export type NameDisplay =
	| { kind: 'translated'; text: string }
	/** The original is already right (same language, or nothing to translate). */
	| { kind: 'same' }
	| { kind: 'pending' }
	| { kind: 'missing' }
	| { kind: 'failed' };

export interface NameRequest {
	/** Name without extension. */
	stem: string;
	/** Folder the name lives in, used as context for the model. */
	folder: string;
}

const MAX_CONTEXT_CHARS = 1200;

/** Limits how many requests run at once. */
class Semaphore {
	private active = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly limit: () => number) {}

	async run<T>(task: () => Promise<T>): Promise<T> {
		if (this.active >= Math.max(1, this.limit())) await new Promise<void>((resolve) => this.queue.push(resolve));
		this.active++;
		try {
			return await task();
		} finally {
			this.active--;
			this.queue.shift()?.();
		}
	}
}

/**
 * Decides what a file or folder name displays and requests translations for
 * names that are not cached. Like note translation it is lazy: only names a
 * view asks for are requested, and each distinct name once.
 */
export class NameService {
	private readonly inflight = new Set<string>();
	private readonly failures = new Map<string, string>();
	private readonly listeners = new Set<() => void>();
	private readonly semaphore: Semaphore;
	private controller = new AbortController();
	private loadRequested = false;

	constructor(private readonly deps: NameServiceDeps) {
		this.semaphore = new Semaphore(deps.concurrency);
		deps.store.onChange(() => this.emit());
	}

	onUpdate(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	get canTranslate(): boolean {
		return this.deps.translator() !== null;
	}

	private k(hash: string, target: TargetLanguage): string {
		return `${target}\u0000${hash}`;
	}

	/** Valid cached translation of a name, if any. */
	private cached(stem: string, hash: string, target: TargetLanguage): string | undefined {
		const entry = this.deps.store.get(hash);
		if (!entry || normalizeSentence(entry.src) !== normalizeSentence(stem)) return undefined;
		return entry[target];
	}

	private alreadyInTarget(stem: string, hash: string, target: TargetLanguage): boolean {
		const lang = this.deps.store.get(hash)?.lang;
		if (lang !== undefined && lang !== 'mixed') return lang === target;
		return detectLanguage(stem) === target;
	}

	/** What a name shows in `target` mode right now. Synchronous. */
	display(stem: string, target: TargetLanguage): NameDisplay {
		if (!isTranslatableName(stem)) return { kind: 'same' };
		if (!this.deps.store.isLoaded()) {
			if (!this.loadRequested) {
				this.loadRequested = true;
				void this.deps.store.load().then(() => this.emit());
			}
			return { kind: 'pending' };
		}
		const hash = nameKey(stem);
		const cached = this.cached(stem, hash, target);
		if (cached !== undefined) {
			return normalizeSentence(cached) === normalizeSentence(stem) ? { kind: 'same' } : { kind: 'translated', text: cached };
		}
		if (this.alreadyInTarget(stem, hash, target)) return { kind: 'same' };
		const key = this.k(hash, target);
		if (this.inflight.has(key)) return { kind: 'pending' };
		if (this.failures.has(key)) return { kind: 'failed' };
		return { kind: 'missing' };
	}

	/** Forgets failures so the next request retries them (e.g. when the names mode changes). */
	clearFailures(): void {
		this.failures.clear();
	}

	/** Fire-and-forget: translate whatever is missing. Safe to call repeatedly. */
	request(items: readonly NameRequest[], target: TargetLanguage): void {
		if (!this.canTranslate) return;
		void this.translate(items, target).catch((error: unknown) => log.error(error));
	}

	/** Translates missing names and resolves when they are done. */
	async translate(items: readonly NameRequest[], target: TargetLanguage, signal?: AbortSignal): Promise<{ translated: number; failed: number }> {
		const outcome = { translated: 0, failed: 0 };
		if (!this.canTranslate) return outcome;
		await this.deps.store.load();

		const todo: Array<NameRequest & { hash: string }> = [];
		const seen = new Set<string>();
		for (const item of items) {
			if (!isTranslatableName(item.stem)) continue;
			const hash = nameKey(item.stem);
			const key = this.k(hash, target);
			if (seen.has(hash) || this.inflight.has(key) || this.failures.has(key)) continue;
			if (this.cached(item.stem, hash, target) !== undefined || this.alreadyInTarget(item.stem, hash, target)) continue;
			seen.add(hash);
			todo.push({ ...item, hash });
		}
		if (todo.length === 0) return outcome;
		for (const item of todo) this.inflight.add(this.k(item.hash, target));
		this.emit();

		const size = Math.max(1, this.deps.batchSize());
		const batches: Array<typeof todo> = [];
		for (let i = 0; i < todo.length; i += size) batches.push(todo.slice(i, i + size));
		await Promise.all(
			batches.map((batch) =>
				this.semaphore.run(async () => {
					const result = await this.runBatch(batch, target, signal);
					outcome.translated += result.translated;
					outcome.failed += result.failed;
				}),
			),
		);
		return outcome;
	}

	private context(batch: ReadonlyArray<NameRequest>): string[] {
		const folders = [...new Set(batch.map((b) => b.folder))].filter((f) => f.length > 0);
		const lines: string[] = [];
		let length = 0;
		for (const folder of folders) {
			const line = `Located in: ${folder}`;
			if (length + line.length > MAX_CONTEXT_CHARS) break;
			lines.push(line);
			length += line.length;
		}
		return lines;
	}

	private async runBatch(batch: ReadonlyArray<NameRequest & { hash: string }>, target: TargetLanguage, signal?: AbortSignal): Promise<{ translated: number; failed: number }> {
		const outcome = { translated: 0, failed: 0 };
		const translator = this.deps.translator();
		const combined = signal ? anySignal([signal, this.controller.signal]) : this.controller.signal;
		const glossary = this.deps.glossary();
		try {
			if (!translator) throw new TranslatorError('No translator', 'config');
			const result = await translator.translate(
				batch.map((b) => ({ masked: b.stem, placeholderCount: 0 })),
				target,
				{ noteTitle: '', glossary, context: this.context(batch), purpose: 'names' },
				combined,
			);
			const translatedAt = new Date().toISOString();
			batch.forEach((b, i) => {
				const item = result.items[i];
				const key = this.k(b.hash, target);
				const text = item?.ok ? validateNameTranslation(b.stem, item.text, glossary) : null;
				if (item?.ok && text !== null) {
					const same = normalizeSentence(text) === normalizeSentence(b.stem);
					const lang = refineLanguage(item.lang, b.stem) ?? (same ? target : undefined);
					// The original is the display text for its own language: no request needed later.
					if (lang && lang !== 'mixed' && lang !== target) this.deps.store.put(b.hash, b.stem, lang, b.stem);
					this.deps.store.put(b.hash, b.stem, target, lang === target ? b.stem : text, { model: result.model, translatedAt, ...(lang ? { lang } : {}) });
					outcome.translated++;
				} else {
					this.failures.set(key, item?.ok ? 'Invalid name translation' : (item?.error ?? 'unknown error'));
					outcome.failed++;
				}
			});
			log.debug(`Translated ${outcome.translated}/${batch.length} names into ${target}`, result.usage);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			if (!(err instanceof TranslatorError && err.kind === 'aborted')) {
				for (const b of batch) this.failures.set(this.k(b.hash, target), err.message);
				this.deps.onError(err);
			}
			outcome.failed += batch.length;
		} finally {
			for (const b of batch) this.inflight.delete(this.k(b.hash, target));
			this.emit();
		}
		return outcome;
	}

	/** Cancels every running request (on unload or when settings change). */
	cancelAll(): void {
		this.controller.abort();
		this.controller = new AbortController();
		this.inflight.clear();
	}

	/** Forgets state tied to the loaded cache (after the cache was cleared). */
	reset(): void {
		this.cancelAll();
		this.failures.clear();
		this.loadRequested = false;
	}
}

function anySignal(signals: AbortSignal[]): AbortSignal {
	const controller = new AbortController();
	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort();
			break;
		}
		signal.addEventListener('abort', () => controller.abort(), { once: true });
	}
	return controller.signal;
}
