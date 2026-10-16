import { browser, expect } from '@wdio/globals';
import { beforeEach, describe, it } from 'mocha';
import { configure, freshVault, mockStats, openNote, readingText } from '../helpers';
import { emptyCache, serializeCache } from '../../../src/core/cache-format';
import { sentenceHash } from '../../../src/core/text';

const NOTE = 'Edit.md';
const FIRST = 'Das ist der erste Satz.';

function cacheWith(translation: string): string {
	const cache = emptyCache();
	cache.sentences[sentenceHash(FIRST)] = { en: translation };
	return serializeCache(cache);
}

async function showEnglishInReading(): Promise<void> {
	await openNote(NOTE, 'preview');
	await browser.executeObsidian(({ app, obsidian, plugins }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		plugins.transparentTranslate.setMode(view.leaf, 'en');
	});
}

/** A translation that reaches the disk from outside the plugin (sync from another device) must show up in an open note. */
describe('Cache files that arrive on disk while a note is open', function () {
	beforeEach(async function () {
		await freshVault();
		// An endpoint that is not there: nothing is translated here, so whatever shows came from the file.
		await configure({ baseUrl: 'http://127.0.0.1:9/v1' });
	});

	it('shows a cache file that changes after the note was opened', async function () {
		await browser.executeObsidian(async ({ app }, content) => {
			await app.vault.createFolder('_Translations').catch(() => undefined);
			await app.vault.create('_Translations/Edit.md', content);
		}, cacheWith('This is the first sentence (old).'));
		await showEnglishInReading();
		await browser.waitUntil(async () => (await readingText()).includes('(old)'), { timeoutMsg: 'the cache file was not shown' });
		await browser.executeObsidian(async ({ app }, content) => {
			await app.vault.modify(app.vault.getFileByPath('_Translations/Edit.md')!, content);
		}, cacheWith('This is the first sentence (new).'));
		await browser.waitUntil(async () => (await readingText()).includes('(new)'), { timeoutMsg: 'a cache file that changed on disk was not shown' });
		expect((await mockStats()).requests).toBe(0);
	});
});
