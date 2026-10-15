import { describe, expect, it, vi } from 'vitest';
import { isNameTranslatable, isTranslatableName, nameKey, parentPath, resolveCollisions, validateNameTranslation, type NameRules } from '../../src/core/names';
import { emptyNames, mergeNames, namesPath, NAMES_FILE, parseNames, pruneNames, serializeNames } from '../../src/core/names-format';
import { CACHE_WARNING } from '../../src/core/cache-format';
import { buildMessages } from '../../src/core/prompt';
import { NameStore } from '../../src/services/name-store';
import { NameService } from '../../src/services/name-service';
import type { CacheBackend } from '../../src/services/cache-store';
import type { TranslateResult, TranslationContext, TranslationItem, Translator } from '../../src/translator/translator';
import type { TargetLanguage } from '../../src/core/types';

const rules: NameRules = { cacheFolder: '_Translations', excludedFolders: [], includeOnlyFolders: [], includeAttachments: false };

describe('name keys and eligibility', () => {
	it('keys names by normalized text', () => {
		expect(nameKey('Meine  Notizen')).toBe(nameKey(' Meine Notizen '));
		expect(nameKey('Notizen')).not.toBe(nameKey('Notes'));
		expect(nameKey('Notizen')).toMatch(/^[0-9a-f]{64}$/);
	});

	it.each([
		['Notizen', true],
		['2024-05-12', false],
		['', false],
		['   ', false],
		['x'.repeat(201), false],
		['日本語', true],
	])('isTranslatableName(%j) = %s', (name, expected) => {
		expect(isTranslatableName(name)).toBe(expected);
	});

	it('excludes the cache folder, excluded folders and attachments', () => {
		expect(isNameTranslatable('Notes/a.md', false, 'md', rules)).toBe(true);
		expect(isNameTranslatable('Notes', true, '', rules)).toBe(true);
		expect(isNameTranslatable('_Translations', true, '', rules)).toBe(false);
		expect(isNameTranslatable('_Translations/Notes/a.md', false, 'md', rules)).toBe(false);
		expect(isNameTranslatable('Private/a.md', false, 'md', { ...rules, excludedFolders: ['Private'] })).toBe(false);
		expect(isNameTranslatable('Private', true, '', { ...rules, excludedFolders: ['Private'] })).toBe(false);
		expect(isNameTranslatable('Bilder/foto.png', false, 'png', rules)).toBe(false);
		expect(isNameTranslatable('Bilder/foto.png', false, 'png', { ...rules, includeAttachments: true })).toBe(true);
	});

	it('with include-only folders only items inside qualify', () => {
		const only = { ...rules, includeOnlyFolders: ['Uni'] };
		expect(isNameTranslatable('Uni', true, '', only)).toBe(true);
		expect(isNameTranslatable('Uni/Info/a.md', false, 'md', only)).toBe(true);
		expect(isNameTranslatable('Privat/a.md', false, 'md', only)).toBe(false);
		expect(isNameTranslatable('Privat', true, '', only)).toBe(false);
	});

	it('finds the parent folder', () => {
		expect(parentPath('a/b/c.md')).toBe('a/b');
		expect(parentPath('c.md')).toBe('');
	});
});

describe('validateNameTranslation', () => {
	it('accepts a plain translation', () => {
		expect(validateNameTranslation('Besprechungsnotizen', 'Meeting notes')).toBe('Meeting notes');
	});

	it('strips quotes and a trailing full stop the source did not have', () => {
		expect(validateNameTranslation('Notizen', '"Notes".')).toBe('Notes');
		expect(validateNameTranslation('Notizen', 'Notes.')).toBe('Notes');
	});

	it('keeps quotes that are part of the source', () => {
		expect(validateNameTranslation('"Alpha"', '"Beta"')).toBe('"Beta"');
	});

	it('rejects empty, multi-line, overlong and path-like output', () => {
		expect(validateNameTranslation('Notizen', '')).toBeNull();
		expect(validateNameTranslation('Notizen', 'Notes\nand more')).toBeNull();
		expect(validateNameTranslation('Notizen', 'x'.repeat(100))).toBeNull();
		expect(validateNameTranslation('Notizen', 'Notes/Archive')).toBeNull();
	});

	it('requires numeric and date prefixes to survive', () => {
		expect(validateNameTranslation('2024-05-12 Besprechung', '2024-05-12 Meeting')).toBe('2024-05-12 Meeting');
		expect(validateNameTranslation('2024-05-12 Besprechung', '12 May Meeting')).toBeNull();
		expect(validateNameTranslation('03_Einführung', '03_Introduction')).toBe('03_Introduction');
		expect(validateNameTranslation('Einführung', '1 Introduction')).toBeNull();
	});

	it('requires glossary terms of the source to stay', () => {
		expect(validateNameTranslation('Karel Aufgaben', 'Karel exercises', ['Karel'])).toBe('Karel exercises');
		expect(validateNameTranslation('Karel Aufgaben', 'Robot exercises', ['Karel'])).toBeNull();
	});
});

describe('resolveCollisions', () => {
	it('keeps unique translations', () => {
		expect(
			resolveCollisions([
				{ real: 'Notizen', display: 'Notes' },
				{ real: 'Aufgaben', display: 'Tasks' },
			]),
		).toEqual(['Notes', 'Tasks']);
	});

	it('reverts siblings that would show the same text, ignoring case', () => {
		expect(
			resolveCollisions([
				{ real: 'Notizen', display: 'Notes' },
				{ real: 'Anmerkungen', display: 'notes' },
				{ real: 'Aufgaben', display: 'Tasks' },
			]),
		).toEqual(['Notizen', 'Anmerkungen', 'Tasks']);
	});

	it('reverts a translation equal to a different sibling real name', () => {
		expect(
			resolveCollisions([
				{ real: 'Notizen', display: 'Notes' },
				{ real: 'Notes', display: 'Notes' },
			]),
		).toEqual(['Notizen', 'Notes']);
	});
});

describe('names cache format', () => {
	const H1 = 'a'.repeat(64);
	const H2 = 'b'.repeat(64);

	it('round-trips through serialize and parse with one entry per line', () => {
		const file = emptyNames();
		file.names[H1] = { src: 'Notizen', lang: 'de', en: 'Notes', translatedAt: '2026-10-15T10:00:00Z' };
		file.names[H2] = { src: 'Aufgaben', de: 'Aufgaben' };
		const text = serializeNames(file);
		expect(text.startsWith(CACHE_WARNING)).toBe(true);
		expect(text.split('\n').filter((l) => l.includes(H1) || l.includes(H2))).toHaveLength(2);
		expect(parseNames(text)).toEqual(file);
	});

	it('serializes an empty cache as valid JSON', () => {
		expect(parseNames(serializeNames(emptyNames()))).toEqual(emptyNames());
	});

	it.each([
		['empty', ''],
		['broken', 'warning {"names": {'],
		['wrong shape', '{"names": []}'],
	])('returns an empty cache for %s', (_n, content) => {
		expect(parseNames(content)).toEqual(emptyNames());
	});

	it('drops entries with bad keys or no source', () => {
		const raw = JSON.stringify({ version: 1, names: { [H1]: { src: 'A', en: 'B' }, nothex: { src: 'x' }, [H2]: { en: 'no src' } } });
		expect(Object.keys(parseNames(raw).names)).toEqual([H1]);
	});

	it('names the file inside the cache folder', () => {
		expect(namesPath('_Translations')).toBe(`_Translations/${NAMES_FILE}`);
		expect(namesPath('/a/b/')).toBe(`a/b/${NAMES_FILE}`);
	});

	it('merges both sides, newer entry wins, languages of both are kept', () => {
		const local = emptyNames();
		const remote = emptyNames();
		local.names[H1] = { src: 'N', en: 'old', translatedAt: '2026-01-01T00:00:00Z' };
		remote.names[H1] = { src: 'N', en: 'new', de: 'neu', translatedAt: '2026-02-01T00:00:00Z' };
		local.names[H2] = { src: 'M', en: 'only local' };
		const merged = mergeNames(local, remote);
		expect(merged.names[H1]).toMatchObject({ en: 'new', de: 'neu' });
		expect(merged.names[H2]?.en).toBe('only local');
	});

	it('prunes unused entries older than the keep period', () => {
		const file = emptyNames();
		file.names[H1] = { src: 'A', en: 'a', translatedAt: '2026-01-01T00:00:00Z' };
		file.names[H2] = { src: 'B', en: 'b', translatedAt: '2026-10-14T00:00:00Z' };
		const removed = pruneNames(file, new Set(), new Date('2026-10-15T00:00:00Z'), 30);
		expect(removed).toBe(1);
		expect(Object.keys(file.names)).toEqual([H2]);
	});
});

describe('names prompt', () => {
	it('uses the names system prompt and heading', () => {
		const messages = buildMessages([{ id: 1, text: 'Notizen' }], 'en', { noteTitle: '', glossary: ['Karel'], jsonMode: false, purpose: 'names', context: ['Located in: Uni'] });
		expect(messages[0]!.content).toContain('names of files and folders');
		expect(messages[0]!.content).toContain('into English');
		expect(messages[1]!.content).toContain('Names (1):');
		expect(messages[1]!.content).toContain('Located in: Uni');
		expect(messages[1]!.content).toContain('<<1>> Notizen');
	});

	it('keeps the sentence prompt by default', () => {
		const messages = buildMessages([{ id: 1, text: 'Hallo.' }], 'de', { noteTitle: 'T', glossary: [], jsonMode: false });
		expect(messages[0]!.content).toContain('translation engine');
		expect(messages[1]!.content).toContain('Sentences (1):');
	});
});

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

class FakeNameTranslator implements Translator {
	calls: Array<{ items: string[]; ctx: TranslationContext }> = [];
	answers: Record<string, string> = { Notizen: 'Notes', Aufgaben: 'Tasks' };
	async translate(items: readonly TranslationItem[], _target: TargetLanguage, ctx: TranslationContext): Promise<TranslateResult> {
		this.calls.push({ items: items.map((i) => i.masked), ctx });
		return {
			items: items.map((i) => ({ ok: true as const, text: this.answers[i.masked] ?? i.masked, lang: 'de' as const })),
			usage: { inputTokens: 1, outputTokens: 1 },
			model: 'fake',
		};
	}
}

function setup(translator: Translator | null = new FakeNameTranslator(), batchSize = 40) {
	const backend = new MemoryBackend();
	const store = new NameStore(backend, { cacheFolder: () => '_Translations', saveDelayMs: 0 });
	const onError = vi.fn();
	const service = new NameService({ store, translator: () => translator, batchSize: () => batchSize, concurrency: () => 2, glossary: () => ['Karel'], onError });
	return { backend, store, service, translator, onError };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('NameStore', () => {
	it('writes the names file once and ignores its own write', async () => {
		const { backend, store } = setup();
		await store.load();
		store.put(nameKey('Notizen'), 'Notizen', 'en', 'Notes');
		store.put(nameKey('Aufgaben'), 'Aufgaben', 'en', 'Tasks');
		await tick();
		expect(backend.writes).toBe(1);
		const content = backend.files.get('_Translations/_names.md')!;
		expect(store.handleExternalChange(content)).toBe(false);
	});

	it('does not overwrite an unread file: it loads and merges first', async () => {
		const { backend, store } = setup();
		const remote = emptyNames();
		remote.names[nameKey('Aufgaben')] = { src: 'Aufgaben', en: 'Tasks' };
		backend.files.set('_Translations/_names.md', serializeNames(remote));
		store.put(nameKey('Notizen'), 'Notizen', 'en', 'Notes');
		await tick();
		const saved = parseNames(backend.files.get('_Translations/_names.md')!);
		expect(Object.keys(saved.names)).toHaveLength(2);
	});

	it('merges an external change while local changes are pending', async () => {
		const { store } = setup();
		await store.load();
		store.put(nameKey('Notizen'), 'Notizen', 'en', 'Notes');
		const remote = emptyNames();
		remote.names[nameKey('Aufgaben')] = { src: 'Aufgaben', en: 'Tasks' };
		expect(store.handleExternalChange(serializeNames(remote))).toBe(true);
		expect(store.get(nameKey('Notizen'))?.en).toBe('Notes');
		expect(store.get(nameKey('Aufgaben'))?.en).toBe('Tasks');
	});
});

describe('NameService', () => {
	it('is pending until the cache is loaded, then missing', async () => {
		const { service } = setup();
		expect(service.display('Notizen', 'en')).toEqual({ kind: 'pending' });
		await tick();
		expect(service.display('Notizen', 'en')).toEqual({ kind: 'missing' });
	});

	it('translates unique names in one request with folder context and caches them', async () => {
		const { service, translator } = setup();
		const fake = translator as FakeNameTranslator;
		await service.translate(
			[
				{ stem: 'Notizen', folder: 'Uni' },
				{ stem: 'Notizen', folder: 'Privat' },
				{ stem: 'Aufgaben', folder: 'Uni' },
			],
			'en',
		);
		expect(fake.calls).toHaveLength(1);
		expect(fake.calls[0]!.items).toEqual(['Notizen', 'Aufgaben']);
		expect(fake.calls[0]!.ctx.purpose).toBe('names');
		expect(fake.calls[0]!.ctx.context).toEqual(['Located in: Uni']);
		expect(service.display('Notizen', 'en')).toEqual({ kind: 'translated', text: 'Notes' });
		// A second request makes no new call.
		await service.translate([{ stem: 'Notizen', folder: 'Uni' }], 'en');
		expect(fake.calls).toHaveLength(1);
	});

	it('stores the original for its own language and treats it as same', async () => {
		const { service } = setup();
		await service.translate([{ stem: 'Notizen', folder: '' }], 'en');
		expect(service.display('Notizen', 'de')).toEqual({ kind: 'same' });
	});

	it('skips names without letters and names already in the target language', async () => {
		const { service, translator } = setup();
		const fake = translator as FakeNameTranslator;
		await service.translate([{ stem: '2024-05-12', folder: '' }], 'en');
		await service.translate([{ stem: 'This is the final plan of the project', folder: '' }], 'en');
		expect(fake.calls).toHaveLength(0);
		expect(service.display('This is the final plan of the project', 'en')).toEqual({ kind: 'same' });
	});

	it('treats an identical answer as same', async () => {
		const { service } = setup();
		await service.translate([{ stem: 'Obsidian', folder: '' }], 'en');
		expect(service.display('Obsidian', 'en')).toEqual({ kind: 'same' });
	});

	it('rejects invalid answers and shows the original (failed)', async () => {
		const { service, translator } = setup();
		(translator as FakeNameTranslator).answers['2024 Plan'] = 'Plan';
		await service.translate([{ stem: '2024 Plan', folder: '' }], 'en');
		expect(service.display('2024 Plan', 'en')).toEqual({ kind: 'failed' });
		service.clearFailures();
		expect(service.display('2024 Plan', 'en')).toEqual({ kind: 'missing' });
	});

	it('reports a failing request once and marks the names failed', async () => {
		const failing: Translator = {
			async translate() {
				throw new Error('boom');
			},
		};
		const { service, onError } = setup(failing);
		await service.translate([{ stem: 'Notizen', folder: '' }, { stem: 'Aufgaben', folder: '' }], 'en');
		expect(onError).toHaveBeenCalledTimes(1);
		expect(service.display('Notizen', 'en')).toEqual({ kind: 'failed' });
	});

	it('makes no request without a translator (mobile) and still shows cached names', async () => {
		const { service, store } = setup(null);
		await store.load();
		store.put(nameKey('Notizen'), 'Notizen', 'en', 'Notes');
		await service.translate([{ stem: 'Aufgaben', folder: '' }], 'en');
		expect(service.display('Notizen', 'en')).toEqual({ kind: 'translated', text: 'Notes' });
		expect(service.display('Aufgaben', 'en')).toEqual({ kind: 'missing' });
	});

	it('splits large requests by batch size', async () => {
		const { service, translator } = setup(new FakeNameTranslator(), 2);
		await service.translate(['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf'].map((stem) => ({ stem, folder: '' })), 'en');
		expect((translator as FakeNameTranslator).calls.map((c) => c.items.length)).toEqual([2, 2, 1]);
	});
});
