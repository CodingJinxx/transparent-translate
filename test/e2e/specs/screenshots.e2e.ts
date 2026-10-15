/**
 * Generates the README screenshots from the test vault (no private notes).
 * Run with `npm run screenshots`. Not part of the normal e2e run.
 */
import { $, $$, browser } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { command, configure, freshVault, openNote, readingText } from '../helpers';

const OUT = 'docs/images';

async function hideNoise(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		app.workspace.leftSplit?.collapse();
		app.workspace.rightSplit?.collapse();
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	});
}

describe('README screenshots', function () {
	before(async function () {
		// Electron does not support setWindowSize over WebDriver: resize the window from inside.
		await browser.execute(() => window.resizeTo(1100, 760));
		await freshVault();
		await configure({ animateTranslations: false });
	});

	it('original and English reading view', async function () {
		await openNote('Informatik/Lektion 1.md', 'preview');
		await hideNoise();
		await browser.pause(400);
		await browser.saveScreenshot(`${OUT}/reading-original.png`);
		await command('show-english');
		await browser.waitUntil(async () => (await readingText()).includes('Constants drop out'));
		await hideNoise();
		await browser.pause(600);
		await browser.saveScreenshot(`${OUT}/reading-english.png`);
	});

	it('edit session in Live Preview', async function () {
		await openNote('Edit.md', 'live');
		await command('show-english');
		await browser.waitUntil(async () => (await $$('.cm-content .tt-sentence').length) === 3);
		await $$('.cm-content .tt-sentence')[0]!.click();
		await $('.tt-session .tt-session-input').waitForDisplayed();
		await browser.pause(300);
		await browser.keys(['End']);
		await browser.keys(' Edited.'.split(''));
		await hideNoise();
		await browser.pause(300);
		await browser.saveScreenshot(`${OUT}/edit-session.png`);
		await browser.keys('Escape');
	});
});
