import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';
import { openNote } from '../helpers';

// Own spec file: freshVault() would delete the plugin's files, and re-enabling needs them on disk.
describe('Unload', function () {
	it('removes its header button and status bar item when disabled, and restores them when enabled', async function () {
		await openNote('Informatik/Woche 1 (14.10.-20.10.).md', 'preview');
		const count = () => browser.executeObsidian(() => document.querySelectorAll('.tt-header-action, .tt-status').length);
		await browser.waitUntil(async () => (await count()) > 0, { timeoutMsg: 'header button missing after load' });
		await obsidianPage.disablePlugin('transparent-translate');
		expect(await count()).toBe(0);
		await obsidianPage.enablePlugin('transparent-translate');
		await browser.waitUntil(async () => (await count()) > 0, { timeoutMsg: 'header button did not come back' });
	});
});
