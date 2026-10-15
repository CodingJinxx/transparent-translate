import { describe, expect, it } from 'vitest';
import { buildMessages, parseGlossary } from '../../src/core/prompt';
import { cachePathFor, isInFolder, isTranslatablePath, notePathForCache, parseFolderList } from '../../src/core/paths';
import { estimateCost, PROMPT_OVERHEAD_TOKENS } from '../../src/core/estimate';
import { nextMode } from '../../src/core/types';
import { isLocalUrl, presetById, presetForUrl } from '../../src/translator/providers';
import { parseExtraBody, parseHeaderLines } from '../../src/translator/llm-translator';

describe('prompt', () => {
	it('numbers sentences and includes glossary, title and context', () => {
		const [system, user] = buildMessages(
			[
				{ id: 1, text: 'Hallo ⟦1⟧.' },
				{ id: 2, text: 'Zweiter Satz.' },
			],
			'en',
			{ noteTitle: 'Woche 1', glossary: ['Karel', 'BlueJ'], context: ['Vorheriger Satz.'], jsonMode: false },
		);
		expect(system!.content).toContain('into English');
		expect(system!.content).toContain('<<n>>');
		expect(user!.content).toContain('<<1>> Hallo ⟦1⟧.\n<<2>> Zweiter Satz.');
		expect(user!.content).toContain('Karel, BlueJ');
		expect(user!.content).toContain('Note title: Woche 1');
		expect(user!.content).toContain('> Vorheriger Satz.');
	});

	it('asks for JSON in JSON mode', () => {
		const [system] = buildMessages([{ id: 1, text: 'x' }], 'de', { noteTitle: '', glossary: [], jsonMode: true });
		expect(system!.content).toContain('into German');
		expect(system!.content).toContain('"translations"');
	});

	it('parses the glossary setting', () => {
		expect(parseGlossary('Karel\n\n# comment\n BlueJ \r\nParticify')).toEqual(['Karel', 'BlueJ', 'Particify']);
	});
});

describe('paths', () => {
	const rules = { cacheFolder: '_Translations', excludedFolders: ['Private', 'Archiv/Alt'], includeOnlyFolders: [] as string[] };

	it('maps notes to cache files and back', () => {
		expect(cachePathFor('_Translations/', 'Informatik/Woche 1.md')).toBe('_Translations/Informatik/Woche 1.md');
		expect(notePathForCache('_Translations', '_Translations/A/B.md')).toBe('A/B.md');
		expect(notePathForCache('_Translations', 'Other/B.md')).toBeNull();
	});

	it('matches folders exactly, not by prefix', () => {
		expect(isInFolder('Private/x.md', 'Private')).toBe(true);
		expect(isInFolder('Privateer/x.md', 'Private')).toBe(false);
		expect(isInFolder('x.md', '')).toBe(false);
	});

	it('applies exclusions, include-only lists and the cache folder', () => {
		expect(isTranslatablePath('Notes/a.md', rules)).toBe(true);
		expect(isTranslatablePath('Notes/a.canvas', rules)).toBe(false);
		expect(isTranslatablePath('_Translations/Notes/a.md', rules)).toBe(false);
		expect(isTranslatablePath('Private/a.md', rules)).toBe(false);
		expect(isTranslatablePath('Archiv/Alt/a.md', rules)).toBe(false);
		expect(isTranslatablePath('Archiv/Neu/a.md', rules)).toBe(true);
		const only = { ...rules, includeOnlyFolders: ['Informatik'] };
		expect(isTranslatablePath('Informatik/a.md', only)).toBe(true);
		expect(isTranslatablePath('Notes/a.md', only)).toBe(false);
		expect(isTranslatablePath('_Translations/Informatik/a.md', { ...only, includeOnlyFolders: ['_Translations'] })).toBe(false);
	});

	it('parses folder lists', () => {
		expect(parseFolderList(' /A/B/ \n\nC\\D\r\n')).toEqual(['A/B', 'C/D']);
	});
});

describe('estimate', () => {
	it('estimates tokens and cost', () => {
		const e = estimateCost({ characters: 4000, languages: 2, requests: 4, charsPerToken: 4, inputPrice: 1.25, outputPrice: 4.25 });
		expect(e.inputTokens).toBe(2000 + 4 * PROMPT_OVERHEAD_TOKENS);
		expect(e.outputTokens).toBe(2200);
		expect(e.cost).toBeCloseTo((3400 * 1.25 + 2200 * 4.25) / 1e6, 10);
	});

	it('omits the cost when no price is set', () => {
		expect(estimateCost({ characters: 100, languages: 1, requests: 1, charsPerToken: 0 }).cost).toBeUndefined();
	});
});

describe('modes and providers', () => {
	it('cycles Original → English → German', () => {
		expect(nextMode('original')).toBe('en');
		expect(nextMode('en')).toBe('de');
		expect(nextMode('de')).toBe('original');
	});

	it('finds presets', () => {
		expect(presetById('meta').baseUrl).toBe('https://api.meta.ai/v1');
		expect(presetById('nope').id).toBe('custom');
		expect(presetForUrl('http://localhost:1234/v1/').id).toBe('lmstudio');
		expect(isLocalUrl('http://127.0.0.1:1234/v1')).toBe(true);
		expect(isLocalUrl('https://api.openai.com/v1')).toBe(false);
	});

	it('parses extra headers and body', () => {
		expect(parseHeaderLines('X-Title: Notes\nbad line\nHTTP-Referer: https://x.y')).toEqual({ 'X-Title': 'Notes', 'HTTP-Referer': 'https://x.y' });
		expect(parseExtraBody('{"reasoning_effort": "low"}')).toEqual({ reasoning_effort: 'low' });
		expect(parseExtraBody('')).toEqual({});
		expect(parseExtraBody('[1]')).toBeNull();
		expect(parseExtraBody('{bad')).toBeNull();
	});
});
