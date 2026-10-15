import { $, browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { configure, freshVault, mockStats, openNote, readingText, readFile } from '../helpers';

const NOTE = 'Uni/Kurs.md';
const CONTENT = ['Der Schein ist wichtig.', '', 'Hier steht ein anderer Satz.', ''].join('\n');
const GLOSSARY = 'Translation glossary.md';

/** Sets the display language of the open note through the plugin (as the command does). */
const setMode = (mode: 'original' | 'en' | 'de') =>
	browser.executeObsidian(({ app, obsidian, plugins }, m) => {
		const view = app.workspace.getLeavesOfType('markdown').map((l) => l.view).find((v) => v instanceof obsidian.MarkdownView)!;
		plugins.transparentTranslate.setMode(view.leaf, m);
	}, mode);

/** Runs a change on the glossary store inside Obsidian. */
const glossary = <T>(fn: (store: import('../../../src/services/glossary-store').GlossaryStore) => T): Promise<T> =>
	browser.executeObsidian(({ plugins }, source) => {
		const run = new Function('store', `return (${source})(store)`) as (store: unknown) => unknown;
		return run(plugins.transparentTranslate.glossary);
	}, fn.toString()) as Promise<T>;

const waitForText = (text: string) => browser.waitUntil(async () => (await readingText()).includes(text), { timeoutMsg: `Reading view never showed "${text}"`, timeout: 15_000 });

describe('Glossary', function () {
	before(async function () {
		await freshVault();
		await configure();
		await browser.executeObsidian(async ({ app }, content) => {
			await app.vault.createFolder('Uni');
			await app.vault.create('Uni/Kurs.md', content);
		}, CONTENT);
		await openNote(NOTE, 'preview');
	});

	it('sends a new mapping with the sentences it applies to and updates only those', async function () {
		await setMode('en');
		await waitForText('EN: Der Schein ist wichtig.');
		await waitForText('EN: Hier steht ein anderer Satz.');
		const before = await mockStats();

		await glossary((store) => store.upsert({ kind: 'map', src: 'Schein', target: 'en', to: 'course credit', scope: { folder: 'Uni' } }));
		await waitForText('EN: Der course credit ist wichtig.');
		const after = await mockStats();

		// Only the sentence that contains the term was requested again, with the terminology in the prompt.
		expect(after.requests).toBe(before.requests + 1);
		expect(after.sentences.slice(before.sentences.length)).toEqual(['Der Schein ist wichtig.']);
		expect(after.prompts.at(-1)).toContain('- Schein → course credit');
		expect(await readingText()).toContain('EN: Hier steht ein anderer Satz.');
		expect(await readFile(NOTE)).toBe(CONTENT);
	});

	it('stores the glossary in a note outside the cache folder that is never translated', async function () {
		await browser.waitUntil(async () => (await readFile(GLOSSARY).catch(() => '')).includes('course credit'), { timeoutMsg: 'glossary note was not written' });
		const translatable = await browser.executeObsidian(({ plugins }, path) => plugins.transparentTranslate.isTranslatable(path), GLOSSARY);
		expect(translatable).toBe(false);
	});

	it('ignores entries for other folders and languages', async function () {
		const before = (await mockStats()).requests;
		await glossary((store) => {
			store.upsert({ kind: 'map', src: 'Schein', target: 'en', to: 'receipt', scope: { folder: 'Privat' } });
			store.upsert({ kind: 'map', src: 'Schein', target: 'de', to: 'Beleg', scope: {} });
		});
		await browser.pause(1200);
		expect((await mockStats()).requests).toBe(before);
		expect(await readingText()).toContain('EN: Der course credit ist wichtig.');
	});

	it('undo restores the earlier translation', async function () {
		// The last two changes were the entries above; undo them first, then the mapping.
		await glossary((store) => {
			store.undo();
			store.undo();
		});
		await glossary((store) => store.undo());
		await waitForText('EN: Der Schein ist wichtig.');
		expect(await readingText()).not.toContain('course credit');
	});

	it('offers "Fix translation" on right-click and saves what is entered', async function () {
		await $('span.tt-t').click({ button: 'right' });
		await $('.menu-item-title=Fix translation…').waitForDisplayed();
		await $('.menu-item-title=Fix translation…').click();
		await $('.tt-correction').waitForDisplayed();

		const chipTexts = await browser.execute(() => [...document.querySelectorAll('.tt-correction .tt-chips')[0]!.querySelectorAll('.tt-chip')].map((c) => c.textContent));
		expect(chipTexts).toEqual(['Der', 'Schein', 'ist', 'wichtig']);

		await browser.execute(() => {
			const chips = document.querySelectorAll('.tt-correction .tt-chips')[0]!.querySelectorAll<HTMLButtonElement>('.tt-chip');
			chips[1]!.click();
			const inputs = document.querySelectorAll<HTMLInputElement>('.tt-correction input[type="text"]');
			inputs[1]!.value = 'credit';
			inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await $('.tt-correction button.mod-cta').click();

		await waitForText('EN: Der credit ist wichtig.');
		const entry = await glossary((store) => store.entries().map((e) => ({ src: e.entry.src, to: e.entry.to, scope: e.entry.scope, target: e.entry.target })));
		// The default scope is the folder of the note.
		expect(entry).toEqual([{ src: 'Schein', to: 'credit', scope: { folder: 'Uni' }, target: 'en' }]);
		expect(await readFile(NOTE)).toBe(CONTENT);
	});

	it('shows the new mapping when switching to Live Preview and back', async function () {
		await openNote(NOTE, 'live');
		await setMode('en');
		await browser.waitUntil(
			async () => (await browser.executeObsidian(() => [...document.querySelectorAll('.workspace-leaf.mod-active .cm-content .tt-sentence')].map((e) => e.textContent))).includes('EN: Der credit ist wichtig.'),
			{ timeoutMsg: 'Live Preview did not show the mapped term' },
		);
		await $('.cm-content .tt-sentence').click({ button: 'right' });
		await $('.menu-item-title=Fix translation…').waitForDisplayed();
		await browser.keys('Escape');
		await setMode('original');
		expect(await readFile(NOTE)).toBe(CONTENT);
	});
});
