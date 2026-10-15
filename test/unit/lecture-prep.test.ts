import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/core/note';
import { refineLanguage } from '../../src/core/language';
import { CacheStore, type CacheBackend } from '../../src/services/cache-store';
import { TranslationService } from '../../src/services/translation-service';
import type { TranslateResult, Translator, TranslationItem } from '../../src/translator/translator';
import type { TargetLanguage } from '../../src/core/types';
import { fixture } from './helpers';

/** A lecture preparation note with bold lead-ins, links, code and callouts (anonymized). */
const source = fixture('lecture-prep.md');
const note = parseNote(source);
const count = (text: string, part: string) => text.split(part).length - 1;

describe('lecture preparation note: sentence splitting', () => {
	it('keeps every sentence balanced: no half-open bold spans, no lone closing markers', () => {
		for (const s of note.sentences) {
			expect(count(s.masked, '**') % 2, s.masked).toBe(0);
			expect(/^\*\*\s/.test(s.masked), s.masked).toBe(false);
		}
	});

	it('keeps a bold lead-in that ends in a period together, and splits the rest off', () => {
		const texts = note.sentences.map((s) => s.masked);
		expect(texts).toContain('**SW und HW gehören zusammen (Folien 4–6).**');
		expect(texts).toContain('**Fortschritt (Folie 30).**');
		expect(texts).toContain('Software abstrahiert von der Hardware, Hardware optimiert technische Werte (Takt, Latenz, Durchsatz, Leistungsaufnahme).');
	});

	it('starts a new sentence at a link or code span that follows a full stop', () => {
		const texts = note.sentences.map((s) => s.masked);
		expect(texts).toContain('Der Rest von Kapitel 1 steht in ⟦1⟧.');
		expect(texts).toContain('⟦1⟧ liegt gerade nicht im Ordner ⟦2⟧, der Kapitel-1-Teil unten stammt aus der Freitags-Notiz.');
	});

	it('never loses or duplicates text: sentences come back in document order without overlap', () => {
		let end = 0;
		for (const s of note.sentences) {
			expect(s.from).toBeGreaterThanOrEqual(end);
			expect(source.slice(s.from, s.to)).toBe(s.text);
			end = s.to;
		}
	});
});

describe('language reports', () => {
	it('lets clear local detection override "mixed" for German with English terms', () => {
		expect(refineLanguage('mixed', 'Anmeldung über CampusPortal ist Voraussetzung für den Modulabschluss.')).toBe('de');
		expect(refineLanguage('mixed', '**Software:** GNU-Toolchain, Java VM, SimTool; unter Windows WSL, Cygwin oder Linux-VM.')).toBe('de');
		expect(refineLanguage('mixed', 'Loops multiply the cost, d. h. eine Schleife kostet viel.')).toBe('mixed');
		expect(refineLanguage('en', 'Das ist ein Satz.')).toBe('en');
		expect(refineLanguage(undefined, 'Das ist ein Satz.')).toBeUndefined();
	});
});

class MemoryBackend implements CacheBackend {
	files = new Map<string, string>();
	async read(path: string) {
		return this.files.get(path) ?? null;
	}
	async write(path: string, content: string) {
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

/** A model that tags every German sentence "mixed" and rewrites it, like the one in the bug report. */
class MixedTaggingTranslator implements Translator {
	requests: string[] = [];
	async translate(items: readonly TranslationItem[], target: TargetLanguage): Promise<TranslateResult> {
		this.requests.push(...items.map((i) => i.masked));
		return {
			items: items.map((i) => ({ ok: true as const, text: target === 'de' ? i.masked.replace("Moore's Law", 'Mooresches Gesetz') : `EN: ${i.masked}`, lang: 'mixed' as const })),
			usage: { inputTokens: 1, outputTokens: 1 },
			model: 'fake',
		};
	}
}

describe('German-in-German with a model that says "mixed"', () => {
	it('keeps the original wording when the language is clearly German', async () => {
		const store = new CacheStore(new MemoryBackend(), { cacheFolder: () => '_Translations', saveDelayMs: 0 });
		const translator = new MixedTaggingTranslator();
		const service = new TranslationService({ store, translator: () => translator, batchSize: () => 100, concurrency: () => 1, glossary: () => [], onError: () => undefined });
		const sentence = note.sentences.find((s) => s.masked.startsWith('**Ausblick:**'))!;

		await service.translate('Notes/a.md', note, [sentence], 'en', 'Test');
		const entry = store.peek('Notes/a.md')!.sentences[sentence.hash]!;
		expect(entry.lang).toBe('de');
		// Switching to German needs no request and shows the original, not the model's rewrite.
		const before = translator.requests.length;
		expect(service.display('Notes/a.md', sentence, 'de')).toEqual({ kind: 'same' });
		await service.translate('Notes/a.md', note, [sentence], 'de', 'Test');
		expect(translator.requests.length).toBe(before);
	});

	it('stores the original wording even if a request for German was made before the language was known', async () => {
		const store = new CacheStore(new MemoryBackend(), { cacheFolder: () => '_Translations', saveDelayMs: 0 });
		const translator = new MixedTaggingTranslator();
		const service = new TranslationService({ store, translator: () => translator, batchSize: () => 100, concurrency: () => 1, glossary: () => [], onError: () => undefined });
		// Short sentences are not detected locally, so they are sent; the model's "mixed" must not win over detection.
		const sentence = note.sentences.find((s) => s.masked.startsWith('**Ausblick:**'))!;
		// Simulate the old cache state: reported as mixed, no local override.
		await store.load('Notes/b.md');
		store.put('Notes/b.md', sentence.hash, 'en', 'x', { lang: 'mixed' });
		expect(service.display('Notes/b.md', sentence, 'de')).toEqual({ kind: 'same' });
	});
});

describe('after the cache was cleared', () => {
	it('loads the note cache again instead of staying pending forever', async () => {
		const store = new CacheStore(new MemoryBackend(), { cacheFolder: () => '_Translations', saveDelayMs: 0 });
		const service = new TranslationService({ store, translator: () => null, batchSize: () => 10, concurrency: () => 1, glossary: () => [], onError: () => undefined });
		const sentence = note.sentences[3]!;
		expect(service.display('a.md', sentence, 'de').kind).toBe('pending');
		await store.load('a.md');
		expect(service.display('a.md', sentence, 'de').kind).not.toBe('pending');

		store.reset();
		expect(service.display('a.md', sentence, 'de').kind).toBe('pending');
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(store.isLoaded('a.md')).toBe(true);
		expect(service.display('a.md', sentence, 'de').kind).not.toBe('pending');
	});
});
