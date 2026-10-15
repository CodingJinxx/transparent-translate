import { describe, expect, it, vi } from 'vitest';
import { CacheStore, type CacheBackend } from '../../src/services/cache-store';
import { TranslationService } from '../../src/services/translation-service';
import { parseNote } from '../../src/core/note';
import { composeRange } from '../../src/core/compose';
import { parseCache, serializeCache, emptyCache } from '../../src/core/cache-format';
import type { TranslateResult, Translator, TranslationItem } from '../../src/translator/translator';
import { TranslatorError } from '../../src/translator/translator';
import type { TargetLanguage } from '../../src/core/types';

class MemoryBackend implements CacheBackend {
	files = new Map<string, string>();
	writes = 0;
	async read(path: string) {
		return this.files.get(path) ?? null;
	}
	async write(path: string, content: string) {
		this.writes++;
		this.files.set(path, content);
	}
	async remove(path: string) {
		this.files.delete(path);
	}
	async rename(from: string, to: string) {
		this.files.set(to, this.files.get(from)!);
		this.files.delete(from);
	}
	exists(path: string) {
		return this.files.has(path);
	}
}

/** Fake translator: uppercases text and records every request. */
class FakeTranslator implements Translator {
	calls: TranslationItem[][] = [];
	fail: Error | null = null;
	async translate(items: readonly TranslationItem[], _target: TargetLanguage): Promise<TranslateResult> {
		this.calls.push([...items]);
		if (this.fail) throw this.fail;
		return {
			items: items.map((i) => ({ ok: true as const, text: i.masked.startsWith('Already') ? i.masked : i.masked.toUpperCase() })),
			usage: { inputTokens: 1, outputTokens: 1 },
			model: 'fake',
		};
	}
}

function setup(opts: { translator?: FakeTranslator | null; batchSize?: number } = {}) {
	const backend = new MemoryBackend();
	const store = new CacheStore(backend, { cacheFolder: () => '_Translations', saveDelayMs: 0 });
	const translator = opts.translator === undefined ? new FakeTranslator() : opts.translator;
	const onError = vi.fn();
	const service = new TranslationService({
		store,
		translator: () => translator,
		batchSize: () => opts.batchSize ?? 40,
		concurrency: () => 2,
		glossary: () => ['Karel'],
		onError,
	});
	return { backend, store, translator, service, onError };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('CacheStore', () => {
	it('writes the cache file through the backend and ignores its own writes', async () => {
		const { backend, store } = setup();
		await store.load('Notes/a.md');
		store.put('Notes/a.md', 'a'.repeat(64), 'en', 'Hello');
		await flush();
		const content = backend.files.get('_Translations/Notes/a.md');
		expect(content).toBeDefined();
		expect(parseCache(content!).sentences['a'.repeat(64)]).toMatchObject({ en: 'Hello' });
		const listener = vi.fn();
		store.onChange(listener);
		expect(await store.handleExternalChange('Notes/a.md', content!)).toBe(false);
		expect(listener).not.toHaveBeenCalled();
	});

	it('reloads when another device changed the cache file', async () => {
		const { store } = setup();
		await store.load('a.md');
		const remote = emptyCache();
		remote.sentences['b'.repeat(64)] = { de: 'Hallo' };
		const listener = vi.fn();
		store.onChange(listener);
		expect(await store.handleExternalChange('a.md', serializeCache(remote))).toBe(true);
		expect(store.lookup('a.md', 'b'.repeat(64), 'de')).toBe('Hallo');
		expect(listener).toHaveBeenCalledWith('a.md');
	});

	it('moves and deletes cache files with their notes', async () => {
		const { backend, store } = setup();
		store.put('old.md', 'a'.repeat(64), 'en', 'x');
		await flush();
		await store.renameNote('old.md', 'Folder/new.md');
		expect(backend.exists('_Translations/old.md')).toBe(false);
		expect(backend.exists('_Translations/Folder/new.md')).toBe(true);
		expect(store.lookup('Folder/new.md', 'a'.repeat(64), 'en')).toBe('x');
		await store.deleteNote('Folder/new.md');
		expect(backend.exists('_Translations/Folder/new.md')).toBe(false);
	});

	it('batches bursts of changes into one write', async () => {
		const backend = new MemoryBackend();
		const store = new CacheStore(backend, { cacheFolder: () => '_Translations', saveDelayMs: 20 });
		await store.load('a.md');
		for (let i = 0; i < 10; i++) store.put('a.md', String(i).repeat(64), 'en', `t${i}`);
		await new Promise((r) => setTimeout(r, 40));
		expect(backend.writes).toBe(1);
	});
});

describe('TranslationService', () => {
	const source = 'Erster Satz. Zweiter Satz.\n\n- Already English.\n- Mit [[Link]] drin.';

	it('translates lazily, caches by hash and composes the display', async () => {
		const { service, translator } = setup();
		const note = parseNote(source);
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(translator!.calls).toHaveLength(1);
		expect(translator!.calls[0]!.map((i) => i.masked)).toEqual(['Erster Satz.', 'Zweiter Satz.', 'Already English.', 'Mit ⟦1⟧ drin.']);

		const composed = composeRange(source, 0, source.length, note.sentences, (s) => service.display('n.md', s, 'en'));
		expect(composed.text).toBe('ERSTER SATZ. ZWEITER SATZ.\n\n- Already English.\n- MIT [[Link]] DRIN.');
		expect(service.display('n.md', note.sentences[2]!, 'en')).toEqual({ kind: 'same' });
	});

	it('re-requests only the edited sentence', async () => {
		const { service, translator } = setup();
		const note = parseNote(source);
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		const edited = parseNote(source.replace('Zweiter Satz.', 'Zweiter, geänderter Satz.'));
		await service.translate('n.md', edited, edited.sentences, 'en', 'n');
		expect(translator!.calls).toHaveLength(2);
		expect(translator!.calls[1]!.map((i) => i.masked)).toEqual(['Zweiter, geänderter Satz.']);
	});

	it('does not request anything for reordered paragraphs', async () => {
		const { service, translator } = setup();
		const note = parseNote(source);
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		const reordered = parseNote('- Mit [[Link]] drin.\n- Already English.\n\nZweiter Satz. Erster Satz.');
		await service.translate('n.md', reordered, reordered.sentences, 'en', 'n');
		expect(translator!.calls).toHaveLength(1);
	});

	it('splits large notes into batches', async () => {
		const { service, translator } = setup({ batchSize: 2 });
		const note = parseNote(source);
		await service.translate('n.md', note, note.sentences, 'de', 'n');
		expect(translator!.calls.map((c) => c.length)).toEqual([2, 2]);
	});

	it('reports pending while a request runs and failed after an error', async () => {
		const translator = new FakeTranslator();
		translator.fail = new TranslatorError('Authentication failed (401)', 'auth', 401);
		const { service, onError } = setup({ translator });
		const note = parseNote('Hallo Welt.');
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(service.display('n.md', note.sentences[0]!, 'en')).toEqual({ kind: 'failed' });
		expect(service.failureReason('n.md', note.sentences[0]!.hash, 'en')).toContain('401');
		expect(onError).toHaveBeenCalledTimes(1);

		// Failures are not retried automatically, only after clearFailures().
		translator.fail = null;
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(translator.calls).toHaveLength(1);
		service.clearFailures('n.md');
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(service.display('n.md', note.sentences[0]!, 'en')).toEqual({ kind: 'translated', text: 'HALLO WELT.' });
	});

	it('never translates without a translator (mobile) and shows cached text only', async () => {
		const { service, store } = setup({ translator: null });
		const note = parseNote('Hallo Welt. Zweiter Satz.');
		store.put('n.md', note.sentences[0]!.hash, 'en', 'Hello world.');
		expect(service.canTranslate).toBe(false);
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(service.display('n.md', note.sentences[0]!, 'en')).toEqual({ kind: 'translated', text: 'Hello world.' });
		expect(service.display('n.md', note.sentences[1]!, 'en')).toEqual({ kind: 'missing' });
	});

	it('ignores cached translations whose placeholders do not match', async () => {
		const { service, store } = setup({ translator: null });
		const note = parseNote('Siehe [[A]] und [[B]].');
		await store.load('n.md');
		store.put('n.md', note.sentences[0]!.hash, 'en', 'See ⟦1⟧.');
		expect(service.display('n.md', note.sentences[0]!, 'en')).toEqual({ kind: 'missing' });
	});

	it('never requests sentences that are clearly in the target language already', async () => {
		const { service, translator } = setup();
		const note = parseNote('This is the first sentence of the note. Das ist der zweite Satz.');
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(translator!.calls[0]!.map((i) => i.masked)).toEqual(['Das ist der zweite Satz.']);
		expect(service.display('n.md', note.sentences[0]!, 'en')).toEqual({ kind: 'same' });
	});

	it('uses the language the model reported to skip the other direction', async () => {
		const backend = new MemoryBackend();
		const store = new CacheStore(backend, { cacheFolder: () => '_Translations', saveDelayMs: 0 });
		const calls: string[][] = [];
		const translator: Translator = {
			async translate(items, target) {
				calls.push(items.map((i) => `${target}:${i.masked}`));
				return {
					items: items.map((i) => ({ ok: true as const, text: `[${target}] ${i.masked}`, lang: 'de' as const })),
					usage: { inputTokens: 0, outputTokens: 0 },
					model: 'fake',
				};
			},
		};
		const service = new TranslationService({ store, translator: () => translator, batchSize: () => 40, concurrency: () => 1, glossary: () => [], onError: () => {} });
		// Too short for local detection: only the model knows it is German.
		const note = parseNote('Kurzer Satz.');
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(service.display('n.md', note.sentences[0]!, 'en')).toEqual({ kind: 'translated', text: '[en] Kurzer Satz.' });
		await service.translate('n.md', note, note.sentences, 'de', 'n');
		expect(calls).toEqual([['en:Kurzer Satz.']]);
		expect(service.display('n.md', note.sentences[0]!, 'de')).toEqual({ kind: 'same' });
	});

	it('retranslate drops cached entries', async () => {
		const { service, translator } = setup();
		const note = parseNote('Hallo Welt.');
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		service.retranslate('n.md', note.sentences, 'en');
		await service.translate('n.md', note, note.sentences, 'en', 'n');
		expect(translator!.calls).toHaveLength(2);
	});
});
