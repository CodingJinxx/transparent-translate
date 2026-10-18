import { $, browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { configure, freshVault, MOCK_URL, mockStats, openNote, readingText, waitForCacheFile } from '../helpers';

const NOTE = 'Edit.md';
/** Nothing listens here, so connections are refused at once. */
const DEAD_URL = 'http://127.0.0.1:1/v1';

const modeOfActive = () =>
	browser.executeObsidian(({ app, obsidian, plugins }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		return plugins.transparentTranslate.modeOf(view.leaf, view.file!.path);
	});

const switchTo = (mode: 'original' | 'en' | 'de' | 'nl') =>
	browser.executeObsidian(({ app, obsidian, plugins }, m) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		plugins.transparentTranslate.setMode(view.leaf, m);
	}, mode);

describe('Unreachable endpoint', function () {
	before(async function () {
		await freshVault();
	});

	it('does not switch a note that has no translation yet, and says why', async function () {
		await configure({ baseUrl: DEAD_URL });
		await openNote(NOTE, 'preview');
		const before = (await mockStats()).requests;
		await switchTo('en');
		await $('.notice*=cannot be reached').waitForDisplayed({ timeout: 10_000 });
		expect(await modeOfActive()).toBe('original');
		expect(await readingText()).toContain('Das ist der erste Satz.');
		expect((await mockStats()).requests).toBe(before);
	});

	it('switches as soon as the endpoint can be reached again', async function () {
		await configure({ baseUrl: MOCK_URL });
		await switchTo('en');
		await browser.waitUntil(async () => (await readingText()).includes('This is the first sentence.'), { timeoutMsg: 'note was not translated' });
		expect(await modeOfActive()).toBe('en');
		await waitForCacheFile(NOTE);
	});

	it('still switches a translated note while the endpoint is down', async function () {
		await switchTo('original');
		await configure({ baseUrl: DEAD_URL });
		const before = (await mockStats()).requests;
		await switchTo('en');
		await browser.waitUntil(async () => (await readingText()).includes('This is the first sentence.'), { timeoutMsg: 'cached translation was not shown' });
		expect(await modeOfActive()).toBe('en');
		expect((await mockStats()).requests).toBe(before);
		await configure();
	});
});
