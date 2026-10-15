import type { SentenceDisplay } from '../core/compose';
import { placeholdersValid, restore } from '../core/protect';
import { normalizeSentence } from '../core/text';
import { detectLanguage, refineLanguage } from '../core/language';
import type { NoteModel, Sentence, TargetLanguage } from '../core/types';
import type { Translator } from '../translator/translator';
import { TranslatorError } from '../translator/translator';
import { log } from '../log';
import type { TermResolver } from '../core/glossary-match';
import type { CacheStore } from './cache-store';

export interface TranslationServiceDeps {
	store: CacheStore;
	/** Null on mobile, where translations are never generated. */
	translator: () => Translator | null;
	batchSize: () => number;
	concurrency: () => number;
	glossary: () => readonly string[];
	/** Called once per failed request (not per sentence). */
	onError: (error: Error) => void;
	/** Learned terminology that applies to a note, if the glossary has any entries. */
	terms?: (notePath: string, target: TargetLanguage) => TermResolver | null;
	/** Request translations again when the glossary changed (default on). */
	autoUpdate?: () => boolean;
}

export interface TranslateOutcome {
	translated: number;
	failed: number;
}

type Listener = (notePath: string) => void;

const MAX_CONTEXT_CHARS = 1200;

/** Limits how many requests run at once. The limit is read on every acquire. */
class Semaphore {
	private active = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly limit: () => number) {}

	async run<T>(task: () => Promise<T>): Promise<T> {
		if (this.active >= Math.max(1, this.limit())) {
			await new Promise<void>((resolve) => this.queue.push(resolve));
		}
		this.active++;
		try {
			return await task();
		} finally {
			this.active--;
			this.queue.shift()?.();
		}
	}
}

function key(notePath: string, target: TargetLanguage): string {
	return `${target}\u0000${notePath}`;
}

/**
 * Decides what each sentence displays and queues translation requests for
 * sentences that are not cached yet. Translation is lazy: nothing is
 * requested until a view asks for a translated display.
 */
export class TranslationService {
	private readonly inflight = new Map<string, Set<string>>();
	private readonly failures = new Map<string, Map<string, string>>();
	private readonly loadsRequested = new Set<string>();
	private loadsEpoch = 0;
	private readonly listeners = new Set<Listener>();
	private readonly semaphore: Semaphore;
	private controller = new AbortController();

	constructor(private readonly deps: TranslationServiceDeps) {
		this.semaphore = new Semaphore(deps.concurrency);
		deps.store.onChange((notePath) => this.emit(notePath));
	}

	onUpdate(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(notePath: string): void {
		for (const listener of this.listeners) listener(notePath);
	}

	get canTranslate(): boolean {
		return this.deps.translator() !== null;
	}

	/** Valid cached translation (masked) for a sentence, if any. */
	private cached(notePath: string, sentence: Sentence, target: TargetLanguage): string | undefined {
		const masked = this.deps.store.lookup(notePath, sentence.hash, target);
		if (masked === undefined || !placeholdersValid(masked, sentence.tokens.length)) return undefined;
		return masked;
	}

	/**
	 * True if the sentence is known to be written in `target` already, so it
	 * never needs a request: either the model reported its language earlier
	 * (while translating it into the other language), or local detection is sure.
	 */
	private alreadyInTarget(notePath: string, sentence: Sentence, target: TargetLanguage): boolean {
		const lang = this.deps.store.peek(notePath)?.sentences[sentence.hash]?.lang;
		if (lang !== undefined && lang !== 'mixed') return lang === target;
		return detectLanguage(sentence.masked) === target;
	}

	private resolver(notePath: string, target: TargetLanguage): TermResolver | null {
		return this.deps.terms?.(notePath, target) ?? null;
	}

	/** True if the glossary entries that apply to the sentence changed since it was translated. */
	private isOutdated(notePath: string, sentence: Sentence, target: TargetLanguage): boolean {
		const resolver = this.resolver(notePath, target);
		if (!resolver) return false;
		if (this.failures.get(key(notePath, target))?.has(sentence.hash)) return false;
		const cached = this.deps.store.lookup(notePath, sentence.hash, target);
		// A translation that equals the original was never changed by terminology.
		if (cached !== undefined && normalizeSentence(cached) === normalizeSentence(sentence.masked)) return false;
		const stored = this.deps.store.peek(notePath)?.sentences[sentence.hash]?.gl?.[target] ?? '';
		return resolver.signature(sentence.masked) !== stored;
	}

	/** What a sentence should show in `target` mode right now. Synchronous. */
	display(notePath: string, sentence: Sentence, target: TargetLanguage): SentenceDisplay {
		if (this.loadsEpoch !== this.deps.store.epoch) {
			// The store dropped its caches (cache cleared or moved): request loads again.
			this.loadsEpoch = this.deps.store.epoch;
			this.loadsRequested.clear();
		}
		if (!this.deps.store.isLoaded(notePath)) {
			if (!this.loadsRequested.has(notePath)) {
				this.loadsRequested.add(notePath);
				void this.deps.store.load(notePath).then(() => this.emit(notePath));
			}
			return { kind: 'pending' };
		}
		const masked = this.cached(notePath, sentence, target);
		if (masked !== undefined) {
			if (normalizeSentence(masked) === normalizeSentence(sentence.masked)) return { kind: 'same' };
			const outdated = (this.deps.autoUpdate?.() ?? true) && this.isOutdated(notePath, sentence, target);
			return { kind: 'translated', text: restore(masked, sentence.tokens), ...(outdated ? { outdated: true } : {}) };
		}
		if (this.alreadyInTarget(notePath, sentence, target)) return { kind: 'same' };
		if (this.inflight.get(key(notePath, target))?.has(sentence.hash)) return { kind: 'pending' };
		if (this.failures.get(key(notePath, target))?.has(sentence.hash)) return { kind: 'failed' };
		return { kind: 'missing' };
	}

	failureReason(notePath: string, hash: string, target: TargetLanguage): string | undefined {
		return this.failures.get(key(notePath, target))?.get(hash);
	}

	/** Forget failures so the next request retries them (e.g. on a mode switch). */
	clearFailures(notePath?: string): void {
		if (notePath === undefined) {
			this.failures.clear();
			return;
		}
		for (const k of [...this.failures.keys()]) if (k.endsWith(`\u0000${notePath}`)) this.failures.delete(k);
	}

	/** Fire-and-forget: translate whatever is missing. Safe to call on every render. */
	request(notePath: string, note: NoteModel, sentences: readonly Sentence[], target: TargetLanguage, noteTitle: string): void {
		if (!this.canTranslate) return;
		void this.translate(notePath, note, sentences, target, noteTitle).catch((error: unknown) => log.error(error));
	}

	/** Translates missing sentences and resolves when they are done. */
	async translate(
		notePath: string,
		note: NoteModel,
		sentences: readonly Sentence[],
		target: TargetLanguage,
		noteTitle: string,
		signal?: AbortSignal,
		/** Also translate sentences whose glossary entries changed. Default: the auto-update setting. */
		includeOutdated = this.deps.autoUpdate?.() ?? true,
	): Promise<TranslateOutcome> {
		const outcome: TranslateOutcome = { translated: 0, failed: 0 };
		if (!this.canTranslate) return outcome;
		const wasLoaded = this.deps.store.isLoaded(notePath);
		await this.deps.store.load(notePath);
		// Views that were waiting for the cache (showing sentences as pending) need to redraw.
		if (!wasLoaded) this.emit(notePath);

		const k = key(notePath, target);
		const inflight = this.inflight.get(k) ?? new Set<string>();
		this.inflight.set(k, inflight);
		const failed = this.failures.get(k);
		const todo: Sentence[] = [];
		const seen = new Set<string>();
		for (const s of sentences) {
			if (seen.has(s.hash) || inflight.has(s.hash) || failed?.has(s.hash)) continue;
			if (this.alreadyInTarget(notePath, s, target)) continue;
			if (this.cached(notePath, s, target) !== undefined && !(includeOutdated && this.isOutdated(notePath, s, target))) continue;
			seen.add(s.hash);
			todo.push(s);
		}
		if (todo.length === 0) return outcome;
		for (const s of todo) inflight.add(s.hash);
		this.emit(notePath);

		const size = Math.max(1, this.deps.batchSize());
		const batches: Sentence[][] = [];
		for (let i = 0; i < todo.length; i += size) batches.push(todo.slice(i, i + size));

		await Promise.all(
			batches.map((batch) =>
				this.semaphore.run(async () => {
					const result = await this.runBatch(notePath, note, batch, target, noteTitle, signal);
					outcome.translated += result.translated;
					outcome.failed += result.failed;
				}),
			),
		);
		return outcome;
	}

	private context(note: NoteModel, batch: readonly Sentence[]): string[] {
		const inBatch = new Set(batch.map((s) => s.hash));
		const blocks = new Set(batch.map((s) => s.blockIndex));
		const context: string[] = [];
		let length = 0;
		for (const s of note.sentences) {
			if (!blocks.has(s.blockIndex) || inBatch.has(s.hash)) continue;
			if (length + s.masked.length > MAX_CONTEXT_CHARS) break;
			context.push(s.masked);
			length += s.masked.length;
		}
		return context;
	}

	private async runBatch(
		notePath: string,
		note: NoteModel,
		batch: readonly Sentence[],
		target: TargetLanguage,
		noteTitle: string,
		signal?: AbortSignal,
	): Promise<TranslateOutcome> {
		const k = key(notePath, target);
		const outcome: TranslateOutcome = { translated: 0, failed: 0 };
		const translator = this.deps.translator();
		const combined = signal ? anySignal([signal, this.controller.signal]) : this.controller.signal;
		const failures = this.failures.get(k) ?? new Map<string, string>();
		const resolver = this.resolver(notePath, target);
		try {
			if (!translator) throw new TranslatorError('No translator', 'config');
			const result = await translator.translate(
				batch.map((s) => ({ masked: s.masked, placeholderCount: s.tokens.length })),
				target,
				{
					noteTitle,
					glossary: this.deps.glossary(),
					context: this.context(note, batch),
					...(resolver ? { terms: resolver.forBatch(batch.map((s) => s.masked)) } : {}),
				},
				combined,
			);
			const translatedAt = new Date().toISOString();
			batch.forEach((s, i) => {
				const item = result.items[i];
				if (item?.ok) {
					const same = normalizeSentence(item.text) === normalizeSentence(s.masked);
					const lang = refineLanguage(item.lang, s.masked) ?? (same ? target : undefined);
					// Already in the target language: keep the original wording, whatever the model wrote.
					const text = lang === target ? s.masked : item.text;
					// The original is the display text for its own language: no request needed later.
					if (lang === 'en' || lang === 'de') {
						if (lang !== target) this.deps.store.put(notePath, s.hash, lang, s.masked);
					}
					const signature = resolver?.signature(s.masked) ?? '';
					const gl = { ...this.deps.store.peek(notePath)?.sentences[s.hash]?.gl };
					if (signature) gl[target] = signature;
					else delete gl[target];
					this.deps.store.put(notePath, s.hash, target, text, {
						model: result.model,
						translatedAt,
						gl,
						...(lang ? { lang } : {}),
					});
					outcome.translated++;
				} else {
					failures.set(s.hash, item?.error ?? 'unknown error');
					outcome.failed++;
				}
			});
			log.debug(`Translated ${outcome.translated}/${batch.length} sentences of ${notePath} into ${target}`, result.usage);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			if (!(err instanceof TranslatorError && err.kind === 'aborted')) {
				for (const s of batch) failures.set(s.hash, err.message);
				this.deps.onError(err);
			}
			outcome.failed += batch.length;
		} finally {
			if (failures.size > 0) this.failures.set(k, failures);
			const inflight = this.inflight.get(k);
			for (const s of batch) inflight?.delete(s.hash);
			this.emit(notePath);
		}
		return outcome;
	}

	/** Drops cached translations so the next display re-requests them. */
	retranslate(notePath: string, sentences: readonly Sentence[], target?: TargetLanguage): void {
		this.clearFailures(notePath);
		this.deps.store.forget(
			notePath,
			sentences.map((s) => s.hash),
			target,
		);
		this.emit(notePath);
	}

	/** Cancels every running request (on unload or when settings change). */
	cancelAll(): void {
		this.controller.abort();
		this.controller = new AbortController();
		this.inflight.clear();
	}

	forgetNote(notePath: string): void {
		this.loadsRequested.delete(notePath);
		this.clearFailures(notePath);
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
