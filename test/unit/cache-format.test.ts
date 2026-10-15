import { describe, expect, it } from 'vitest';
import {
	addReplacedOriginal,
	CACHE_WARNING,
	emptyCache,
	MAX_REPLACED_ORIGINALS,
	parseCache,
	pruneCache,
	serializeCache,
} from '../../src/core/cache-format';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

describe('cache format', () => {
	it('round-trips through serialize and parse', () => {
		const cache = emptyCache();
		cache.sentences[H1] = { lang: 'de', en: 'Hello ⟦1⟧', model: 'm', translatedAt: '2026-10-14T15:00:00Z' };
		addReplacedOriginal(cache, { at: '2026-10-14T15:00:00Z', replacedWith: H2, text: 'Alter Satz.' });
		const text = serializeCache(cache);
		expect(text.startsWith(CACHE_WARNING)).toBe(true);
		expect(parseCache(text)).toEqual(cache);
	});

	it('never contains link or tag syntax for stored placeholder translations', () => {
		const cache = emptyCache();
		cache.sentences[H1] = { en: 'See ⟦1⟧ and ⟦2⟧.' };
		const text = serializeCache(cache);
		expect(text).not.toMatch(/\[\[|(?:^|\s)#\w/);
	});

	it.each([
		['empty file', ''],
		['broken JSON', 'warning\n\n{"sentences": {'],
		['array', '[1,2]'],
	])('returns an empty cache for %s', (_name, content) => {
		expect(parseCache(content)).toEqual(emptyCache());
	});

	it('drops malformed entries and keeps valid ones', () => {
		const content = JSON.stringify({
			version: 2,
			sentences: { [H1]: { en: 'ok', de: 5 }, 'not-a-hash': { en: 'x' }, [H2]: 'string' },
			replacedOriginals: [{ at: 'now', text: 't' }, { bad: true }],
		});
		const cache = parseCache(content);
		expect(cache.sentences).toEqual({ [H1]: { en: 'ok' } });
		expect(cache.replacedOriginals).toEqual([{ at: 'now', text: 't', replacedWith: null }]);
	});

	it('caps the replaced originals history', () => {
		const cache = emptyCache();
		for (let i = 0; i < MAX_REPLACED_ORIGINALS + 10; i++) addReplacedOriginal(cache, { at: String(i), replacedWith: null, text: `t${i}` });
		expect(cache.replacedOriginals).toHaveLength(MAX_REPLACED_ORIGINALS);
		expect(cache.replacedOriginals[0]!.text).toBe('t10');
	});

	it('prunes old unreferenced entries only', () => {
		const cache = emptyCache();
		const now = new Date('2026-10-15T00:00:00Z');
		cache.sentences[H1] = { en: 'live', translatedAt: '2020-01-01T00:00:00Z' };
		cache.sentences[H2] = { en: 'old', translatedAt: '2026-01-01T00:00:00Z' };
		cache.sentences['c'.repeat(64)] = { en: 'recent', translatedAt: '2026-10-14T00:00:00Z' };
		cache.sentences['d'.repeat(64)] = { en: 'undated' };
		const removed = pruneCache(cache, new Set([H1]), now, 30);
		expect(removed).toBe(2);
		expect(Object.keys(cache.sentences).sort()).toEqual([H1, 'c'.repeat(64)]);
	});
});
