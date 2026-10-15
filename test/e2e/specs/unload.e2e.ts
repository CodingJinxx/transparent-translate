import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';
import { emptyNames, serializeNames } from '../../../src/core/names-format';
import { nameKey } from '../../../src/core/names';
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

	it('restores translated file names when disabled', async function () {
		const names = emptyNames();
		const stem = 'Woche 1 (14.10.-20.10.)';
		names.names[nameKey(stem)] = { src: stem, en: 'Week 1 (14.10.-20.10.)' };
		await browser.executeObsidian(async ({ app, plugins }, content) => {
			await app.vault.createFolder('_Translations').catch(() => undefined);
			await app.vault.create('_Translations/_names.md', content);
			plugins.transparentTranslate.setNameMode('en');
		}, serializeNames(names));
		const title = () => browser.executeObsidian(() => document.querySelector('.workspace-tab-header.mod-active .workspace-tab-header-inner-title')?.textContent ?? '');
		await browser.waitUntil(async () => (await title()) === 'Week 1 (14.10.-20.10.)', { timeoutMsg: 'tab title was not translated' });
		await obsidianPage.disablePlugin('transparent-translate');
		expect(await title()).toBe(stem);
		await obsidianPage.enablePlugin('transparent-translate');
		await browser.waitUntil(async () => (await title()) === 'Week 1 (14.10.-20.10.)', { timeoutMsg: 'tab title did not come back' });
		await browser.executeObsidian(({ plugins }) => plugins.transparentTranslate.setNameMode('original'));
	});
});
