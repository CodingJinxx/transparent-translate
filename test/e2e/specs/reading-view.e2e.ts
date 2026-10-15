import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { command, configure, freshVault, mockStats, openNote, readFile, readingText, waitForCacheFile } from '../helpers';

const NOTE = 'Informatik/Lektion 1.md';

describe('Reading view', function () {
	before(async function () {
		await freshVault();
		await configure();
	});

	it('shows English and German while the file on disk stays byte-identical', async function () {
		const before = await readFile(NOTE);
		await openNote(NOTE, 'preview');
		await expect(await readingText()).toContain('Heute geht es um die Laufzeit');

		await command('show-english');
		await browser.waitUntil(async () => {
			const text = await readingText();
			return text.includes('Lesson 1: Runtime analysis') && text.includes('Each step costs') && text.includes('Constants drop out');
		}, { timeoutMsg: 'English translation did not appear' });
		const english = await readingText();
		expect(english).toContain('Each step costs');
		expect(english).toContain('Please ask questions via Particify.');
		expect(english).toContain('We count steps, not seconds!');
		expect(english).not.toContain('Heute geht es um');

		// Protected syntax is still rendered as such: math, wikilink, tag.
		const rendered = await browser.executeObsidian(({ app, obsidian }) => {
			const el = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.containerEl.querySelector('.markdown-reading-view')!;
			return {
				math: el.querySelectorAll('mjx-container, .math').length,
				link: [...el.querySelectorAll('a.internal-link')].map((a) => a.textContent),
				tag: [...el.querySelectorAll('a.tag')].map((a) => a.textContent),
				table: el.querySelector('table')?.textContent ?? '',
				callout: el.querySelector('.callout')?.textContent ?? '',
			};
		});
		expect(rendered.math).toBeGreaterThan(0);
		expect(rendered.link).toContain('Woche 1');
		expect(rendered.tag).toContain('#INF-K');
		expect(rendered.table).toContain('Number of steps');
		expect(rendered.callout).toContain('Constants drop out in O notation.');

		await command('show-german');
		await browser.waitUntil(async () => (await readingText()).includes('Wir zählen Schritte, keine Sekunden!'));
		expect(await readingText()).toContain('Heute geht es um die Laufzeit');

		await command('show-original');
		await browser.waitUntil(async () => (await readingText()).includes('We count steps, not seconds!'));

		expect(await readFile(NOTE)).toBe(before);
	});

	it('writes a cache note without links or tags that Obsidian would index', async function () {
		const cache = await waitForCacheFile(NOTE);
		expect(cache.split('\n')[0]).toContain('do not edit');
		expect(cache).not.toContain('[[');
		expect(cache).not.toContain('#INF-K');
		const meta = await browser.executeObsidian(({ app }, p) => {
			const file = app.vault.getFileByPath(`_Translations/${p}`)!;
			const cache = app.metadataCache.getFileCache(file);
			return { links: cache?.links?.length ?? 0, tags: cache?.tags?.length ?? 0 };
		}, NOTE);
		expect(meta).toEqual({ links: 0, tags: 0 });
	});

	it('never requests a cached sentence twice', async function () {
		const before = (await mockStats()).requests;
		await command('show-english');
		await browser.waitUntil(async () => (await readingText()).includes('Lesson 1: Runtime analysis'));
		await command('show-german');
		await browser.waitUntil(async () => (await readingText()).includes('Wir zählen Schritte'));
		await browser.pause(500);
		expect((await mockStats()).requests).toBe(before);
	});

	it('only requests English and mixed sentences when switching to German after English', async function () {
		await freshVault();
		await configure();
		await openNote(NOTE, 'preview');
		await command('show-english');
		await browser.waitUntil(async () => (await readingText()).includes('Constants drop out'));
		const afterEnglish = (await mockStats()).sentences.length;
		await command('show-german');
		await browser.waitUntil(async () => (await readingText()).includes('Wir zählen Schritte'));
		const germanRequests = (await mockStats()).sentences.slice(afterEnglish);
		expect(germanRequests.sort()).toEqual(['Big O', 'Loops multiply the cost, d. h. eine Schleife mit ⟦1⟧ Durchläufen kostet ⟦2⟧ Schritte.', 'We count steps, not seconds!']);
	});

	it('plays the decode animation and settles on the exact translation', async function () {
		await freshVault();
		await configure({ animateTranslations: true });
		await openNote('Edit.md', 'preview');
		await command('show-english');
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.tt-decoding').length > 0), {
			interval: 20,
			timeoutMsg: 'decode animation did not start',
		});
		await browser.waitUntil(async () => browser.execute(() => document.querySelectorAll('.tt-decoding').length === 0), { timeoutMsg: 'animation did not finish' });
		expect(await readingText()).toContain('This is the first sentence. Here is a second sentence.');
		expect(await readingText()).toContain('An item in the list.');
		await configure();
	});

	it('keeps excluded folders untranslated', async function () {
		await configure({ excludedFolders: 'Private' });
		await openNote('Private/Tagebuch.md', 'preview');
		const state = await browser.executeObsidian(({ app, obsidian, plugins }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			plugins.transparentTranslate.setMode(view.leaf, 'en');
			return {
				translatable: plugins.transparentTranslate.isTranslatable('Private/Tagebuch.md'),
				mode: plugins.transparentTranslate.modeOf(view.leaf, 'Private/Tagebuch.md'),
			};
		});
		expect(state).toEqual({ translatable: false, mode: 'original' });
		await configure();
	});
});
