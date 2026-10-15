import { $, $$, browser, expect } from '@wdio/globals';
import { beforeEach, describe, it } from 'mocha';
import { command, configure, editorValue, freshVault, openNote, readFile } from '../helpers';

const NOTE = 'Edit.md';
const ORIGINAL = 'Das ist der erste Satz. Hier steht ein zweiter Satz.\n\n- Ein Punkt in der Liste.\n';

async function showEnglish(): Promise<void> {
	await command('show-english');
	await browser.waitUntil(async () => (await widgetTexts()).length === 3, {
		timeoutMsg: 'translation widgets did not appear',
	});
}

/** Replaces the text of the focused session input by typing, like a user. */
async function typeInSession(text: string): Promise<void> {
	await $('.tt-session .tt-session-input').waitForDisplayed();
	await browser.pause(500);
	await browser.keys(['Control', 'a']);
	await browser.keys(text.split(''));
}

async function widgetTexts(): Promise<string[]> {
	return browser.executeObsidian(() => [...document.querySelectorAll('.workspace-leaf.mod-active .cm-content .tt-sentence')].map((el) => el.textContent ?? ''));
}

async function mode(): Promise<string> {
	return browser.executeObsidian(({ app, obsidian, plugins }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
		return plugins.transparentTranslate.modeOf(view.leaf, view.file!.path);
	});
}

async function setCursor(offset: number): Promise<void> {
	await browser.executeObsidian(({ app, obsidian }, o) => {
		const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
		editor.focus();
		editor.setCursor(editor.offsetToPos(o));
	}, offset);
}

describe('Live Preview', function () {
	beforeEach(async function () {
		await freshVault();
		await configure();
		await openNote(NOTE, 'live');
	});

	it('shows translation widgets without changing the editor text or the file', async function () {
		await showEnglish();
		expect(await widgetTexts()).toEqual(['This is the first sentence.', 'Here is a second sentence.', 'An item in the list.']);
		expect(await editorValue()).toBe(ORIGINAL);
		await command('show-original');
		await browser.waitUntil(async () => (await widgetTexts()).length === 0);
		expect(await readFile(NOTE)).toBe(ORIGINAL);
	});

	it('replaces the original through an edit session, and undo restores it', async function () {
		await showEnglish();
		await $$('.cm-content .tt-sentence')[0]!.click();
		const input = $('.tt-session .tt-session-input');
		await expect(input).toBeDisplayed();
		await expect($('.tt-session-banner')).toHaveText(expect.stringContaining('translation of your German original'));
		await expect($('.tt-session-replaces')).toHaveText(expect.stringContaining('Das ist der erste Satz.'));
		await expect(input).toHaveValue('This is the first sentence.');

		await typeInSession('This is my first sentence.');
		await browser.keys('Enter');
		await browser.waitUntil(async () => (await editorValue()).startsWith('This is my first sentence.'));
		expect(await editorValue()).toBe(ORIGINAL.replace('Das ist der erste Satz.', 'This is my first sentence.'));
		await expect($('.tt-session')).not.toBeExisting();

		// The new English sentence is shown as typed (it is already English) and was not sent for translation.
		await browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor.undo());
		await browser.waitUntil(async () => (await editorValue()) === ORIGINAL, { timeoutMsg: 'undo did not restore the original' });
	});

	it('Escape cancels without touching the file', async function () {
		await showEnglish();
		await $$('.cm-content .tt-sentence')[1]!.click();
		await typeInSession('Something else entirely.');
		await browser.keys('Escape');
		await expect($('.tt-session')).not.toBeExisting();
		expect(await editorValue()).toBe(ORIGINAL);
	});

	it('"Edit German original instead" switches to Original at that sentence', async function () {
		await showEnglish();
		await $$('.cm-content .tt-sentence')[1]!.click();
		await $('.tt-session .tt-session-input').waitForDisplayed();
		await $('button*=Edit German original instead').click();
		await browser.waitUntil(async () => (await mode()) === 'original', { timeoutMsg: 'mode did not switch to original' });
		const cursor = await browser.executeObsidian(({ app, obsidian }) => {
			const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			return editor.posToOffset(editor.getCursor());
		});
		expect(cursor).toBe(ORIGINAL.indexOf('Hier steht'));
		expect(await editorValue()).toBe(ORIGINAL);
	});

	it('types new text at sentence boundaries straight into the file', async function () {
		await showEnglish();
		const end = ORIGINAL.indexOf('\n');
		await setCursor(end);
		await browser.keys(' Neuer Satz.'.split(''));
		await browser.waitUntil(async () => (await editorValue()).includes('Neuer Satz.'));
		expect(await editorValue()).toBe(ORIGINAL.replace('zweiter Satz.', 'zweiter Satz. Neuer Satz.'));
		// While the caret is in it, the new sentence is shown as typed, never as a widget.
		expect(await widgetTexts()).not.toContain('EN: Neuer Satz.');
	});

	it('Ctrl+Shift+Enter is the shortcut for "edit original instead"', async function () {
		await showEnglish();
		await $$('.cm-content .tt-sentence')[0]!.click();
		await $('.tt-session .tt-session-input').waitForDisplayed();
		await browser.pause(500);
		await browser.keys(['Control', 'Shift', 'Enter']);
		await browser.waitUntil(async () => (await mode()) === 'original', { timeoutMsg: 'shortcut did not switch to original' });
		expect(await editorValue()).toBe(ORIGINAL);
	});

	it('deletes a translated sentence without asking and offers Undo', async function () {
		await showEnglish();
		// Notices of earlier tests are still on screen for a while; the Undo button must be this test's.
		await browser.execute(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
		const listStart = ORIGINAL.indexOf('Ein Punkt');
		const listEnd = ORIGINAL.indexOf('Liste.') + 'Liste.'.length;
		await browser.executeObsidian(({ app, obsidian }, from, to) => {
			const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			editor.focus();
			editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(to));
		}, listStart, listEnd);
		await browser.keys('Backspace');
		await browser.waitUntil(async () => !(await editorValue()).includes('Ein Punkt'));
		await expect($('.notice*=Deleted German original sentence')).toBeExisting();
		// Slow machines can swallow the first click while the notice is still animating in: click until it worked.
		await browser.waitUntil(
			async () => {
				if ((await editorValue()) === ORIGINAL) return true;
				const undo = await $('.notice .tt-notice-undo');
				if (await undo.isExisting()) await undo.click().catch(() => undefined);
				await browser.pause(400);
				return (await editorValue()) === ORIGINAL;
			},
			{ timeoutMsg: 'Undo in the notice did not restore the sentence', timeout: 20_000 },
		);
	});

	it('typing over a selected translation opens an edit session instead of writing', async function () {
		await showEnglish();
		const from = ORIGINAL.indexOf('Hier steht');
		const to = ORIGINAL.indexOf('zweiter Satz.') + 'zweiter Satz.'.length;
		await browser.executeObsidian(({ app, obsidian }, a, b) => {
			const editor = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!.editor;
			editor.focus();
			editor.setSelection(editor.offsetToPos(a), editor.offsetToPos(b));
		}, from, to);
		await browser.keys('x');
		await expect($('.tt-session .tt-session-input')).toBeDisplayed();
		expect(await editorValue()).toBe(ORIGINAL);
		await browser.keys('Escape');
	});

	it('animates between all modes and leaves plain editor text behind', async function () {
		await configure({ animateTranslations: true });
		const decoding = () => browser.execute(() => document.querySelectorAll('.workspace-leaf.mod-active .cm-content .tt-decoding').length);
		for (const [i, next] of (['show-german', 'show-english', 'show-original', 'show-german'] as const).entries()) {
			await command(next);
			await browser.waitUntil(async () => (await decoding()) > 0, { interval: 20, timeoutMsg: `no animation when switching with ${next} (step ${i + 1})` });
			// The animation is purely visual: the document never changes.
			expect(await editorValue()).toBe(ORIGINAL);
			await browser.waitUntil(async () => (await decoding()) === 0, { timeoutMsg: 'animation did not finish' });
		}
		// German original: no widgets are left once the animation is over.
		await browser.waitUntil(async () => (await widgetTexts()).length === 0, { timeoutMsg: 'transient widgets were not removed' });
		expect(await readFile(NOTE)).toBe(ORIGINAL);
		await configure();
	});

	it('shows sentences that start with bold text, also on following lines and in bullets', async function () {
		// Obsidian hides the ** markers with its own replace decorations at the start of such a sentence.
		const text = ['**Termin:** Mi um acht Uhr.', '**Folien:** Kapitel null.', '', '- **Vorlesung:** Mi um acht Uhr.', '- **Übung:** Do um neun Uhr.', ''].join('\n');
		await browser.executeObsidian(async ({ app }, content) => {
			await app.vault.create('Bold.md', content);
		}, text);
		await openNote('Bold.md', 'live');
		await command('show-english');
		await browser.waitUntil(async () => (await widgetTexts()).length === 4, { timeoutMsg: 'not every sentence was shown' });
		expect(await widgetTexts()).toEqual(['EN: Termin: Mi um acht Uhr.', 'EN: Folien: Kapitel null.', 'EN: Vorlesung: Mi um acht Uhr.', 'EN: Übung: Do um neun Uhr.']);
		expect(await readFile('Bold.md')).toBe(text);
	});
});
