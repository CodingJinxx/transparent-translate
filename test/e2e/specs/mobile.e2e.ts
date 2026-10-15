import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { configure, editorValue, freshVault, mockStats, openNote, readingText } from '../helpers';
import { serializeCache, emptyCache } from '../../../src/core/cache-format';
import { sentenceHash } from '../../../src/core/text';
import { emptyNames, serializeNames } from '../../../src/core/names-format';
import { nameKey } from '../../../src/core/names';

const NOTE = 'Edit.md';

describe('Mobile (view-only)', function () {
	before(async function () {
		await freshVault();
		await configure();
		// A cache that was generated on a desktop and synced to this device. Only one sentence is translated.
		const cache = emptyCache();
		cache.sentences[sentenceHash('Das ist der erste Satz.')] = { en: 'This is the first sentence (synced).' };
		await browser.executeObsidian(async ({ app }, content) => {
			await app.vault.createFolder('_Translations').catch(() => undefined);
			await app.vault.create('_Translations/Edit.md', content);
		}, serializeCache(cache));
	});

	it('shows synced translations, falls back to the original, and never calls the API', async function () {
		const before = (await mockStats()).requests;
		await openNote(NOTE, 'preview');
		const canTranslate = await browser.executeObsidian(({ app, obsidian, plugins }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			plugins.transparentTranslate.setMode(view.leaf, 'en');
			return plugins.transparentTranslate.service.canTranslate;
		});
		expect(canTranslate).toBe(false);
		await browser.waitUntil(async () => (await readingText()).includes('This is the first sentence (synced).'));
		expect(await readingText()).toContain('Hier steht ein zweiter Satz.');
		await browser.pause(1000);
		expect((await mockStats()).requests).toBe(before);
	});

	it('blocks typing in translated Live Preview', async function () {
		await openNote(NOTE, 'live');
		await browser.executeObsidian(({ app, obsidian, plugins }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			plugins.transparentTranslate.setMode(view.leaf, 'en');
		});
		const before = await editorValue();
		await browser.executeObsidian(({ app, obsidian }) => {
			const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			editor.focus();
			editor.setCursor(editor.offsetToPos(5));
		});
		await browser.keys('xyz'.split(''));
		await browser.pause(300);
		expect(await editorValue()).toBe(before);
	});

	it('shows synced file names from the cache without requests', async function () {
		const names = emptyNames();
		names.names[nameKey('Edit')] = { src: 'Edit', en: 'Editing' };
		const before = (await mockStats()).requests;
		await browser.executeObsidian(async ({ app, plugins }, content) => {
			await app.vault.create('_Translations/_names.md', content);
			plugins.transparentTranslate.setNameMode('en');
		}, serializeNames(names));
		await openNote(NOTE, 'preview');
		const title = () => browser.executeObsidian(() => document.querySelector('.inline-title')?.textContent ?? '');
		await browser.waitUntil(async () => (await title()) === 'Editing', { timeoutMsg: 'synced name was not shown' });
		await browser.pause(800);
		expect((await mockStats()).requests).toBe(before);
	});
});
