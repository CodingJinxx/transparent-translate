import { $, $$, browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { command, configure, freshVault, mockStats, openNote, readingText, waitForCacheFile } from '../helpers';

const exists = (path: string) => browser.executeObsidian(({ app }, p) => app.vault.getAbstractFileByPath(p) !== null, path);

describe('Housekeeping and settings', function () {
	before(async function () {
		await freshVault();
		await configure();
	});

	it('moves and deletes the cache file together with its note', async function () {
		await openNote('Edit.md', 'preview');
		await command('show-english');
		await browser.waitUntil(async () => (await readingText()).includes('This is the first sentence.'));
		await waitForCacheFile('Edit.md');

		await browser.executeObsidian(async ({ app }) => {
			await app.vault.createFolder('Moved');
			await app.fileManager.renameFile(app.vault.getFileByPath('Edit.md')!, 'Moved/Edited.md');
		});
		await browser.waitUntil(async () => await exists('_Translations/Moved/Edited.md'), { timeoutMsg: 'cache was not moved' });
		expect(await exists('_Translations/Edit.md')).toBe(false);

		await browser.executeObsidian(async ({ app }) => {
			await app.fileManager.trashFile(app.vault.getFileByPath('Moved/Edited.md')!);
		});
		await browser.waitUntil(async () => !(await exists('_Translations/Moved/Edited.md')), { timeoutMsg: 'cache was not deleted' });
	});

	it('renders the settings tab and tests the connection', async function () {
		// Obsidian 1.14 shows settings in its own window, so drive the tab through its container element.
		type Tab = { id: string; containerEl: HTMLElement; display(): void };
		const tabInfo = await browser.executeObsidian(({ app }) => {
			const tab = (app as unknown as { setting: { pluginTabs: Tab[] } }).setting.pluginTabs.find((t) => t.id === 'transparent-translate')!;
			tab.display();
			const el = tab.containerEl;
			return {
				names: [...el.querySelectorAll('.setting-item-name')].map((n) => n.textContent),
				privacy: el.querySelector('.tt-privacy')?.textContent ?? '',
			};
		});
		expect(tabInfo.names).toEqual(expect.arrayContaining(['API key', 'Model', 'Base URL', 'Test connection', 'Excluded folders', 'Cache folder']));
		expect(tabInfo.privacy).toContain('sent to the endpoint');

		const before = (await mockStats()).requests;
		const click = (label: string) =>
			browser.executeObsidian(({ app }, text) => {
				const tab = (app as unknown as { setting: { pluginTabs: Tab[] } }).setting.pluginTabs.find((t) => t.id === 'transparent-translate')!;
				const button = [...tab.containerEl.querySelectorAll('button')].find((b) => b.textContent === text);
				button?.click();
				return Boolean(button);
			}, label);
		const query = (selector: string) =>
			browser.executeObsidian(({ app }, sel) => {
				const tab = (app as unknown as { setting: { pluginTabs: Tab[] } }).setting.pluginTabs.find((t) => t.id === 'transparent-translate')!;
				return tab.containerEl.querySelector(sel)?.textContent ?? null;
			}, selector);

		expect(await click('Test')).toBe(true);
		await browser.waitUntil(async () => ((await query('.tt-test-result')) ?? '').includes('Good morning'), { timeoutMsg: 'test connection did not succeed' });
		expect((await mockStats()).requests).toBe(before + 1);

		expect(await click('Fetch models')).toBe(true);
		await browser.waitUntil(async () => ((await query('select.tt-model-select')) ?? '').includes('mock-large'), { timeoutMsg: 'models were not fetched' });

		expect(await click('Add exclusion')).toBe(true);
		const excluded = await browser.executeObsidian(({ app }) => (app.vault as unknown as { getConfig(k: string): unknown }).getConfig('userIgnoreFilters'));
		expect(excluded).toContain('_Translations/');
	});

	it('describes the settings for Obsidian settings search and renders them from that description', async function () {
		type Item = { name: string; desc?: string };
		type Group = { type: string; heading?: string; items: Item[] };
		type Tab = { id: string; containerEl: HTMLElement; update?: () => void; getSettingDefinitions(): Group[] };
		const info = await browser.executeObsidian(({ app }) => {
			const tab = (app as unknown as { setting: { pluginTabs: Tab[] } }).setting.pluginTabs.find((t) => t.id === 'transparent-translate')!;
			const groups = tab.getSettingDefinitions();
			return { names: groups.flatMap((g) => g.items.map((i) => i.name)), headings: groups.map((g) => g.heading ?? ''), declarative: typeof tab.update === 'function' };
		});
		expect(info.names).toEqual(expect.arrayContaining(['API key', 'Model', 'Test connection', 'Cache folder', 'Default display language']));
		expect(info.headings).toEqual(expect.arrayContaining(['Translation provider', 'Glossary']));
		if (!info.declarative) return; // Obsidian before 1.13 renders the same rows through display().

		// 1.13+: open the tab so Obsidian renders it from the definitions, and use a row that builds on its description.
		await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
			setting.open();
			setting.openTabById('transparent-translate');
		});
		const rendered = () =>
			browser.executeObsidian(({ app }) => {
				const tab = (app as unknown as { setting: { activeTab: { id: string; containerEl: HTMLElement } } }).setting.activeTab;
				if (tab.id !== 'transparent-translate') return [];
				return [...tab.containerEl.querySelectorAll('.setting-item-name')].map((n) => n.textContent ?? '');
			});
		await browser.waitUntil(async () => (await rendered()).includes('API key'), { timeoutMsg: 'the declarative settings tab did not render' });
		const before = (await mockStats()).requests;
		await browser.executeObsidian(({ app }) => {
			const tab = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab;
			[...tab.containerEl.querySelectorAll('button')].find((b) => b.textContent === 'Test')?.click();
		});
		await browser.waitUntil(
			async () =>
				browser.executeObsidian(({ app }) => {
					const tab = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab;
					return (tab.containerEl.querySelector('.tt-test-result')?.textContent ?? '').includes('Good morning');
				}),
			{ timeoutMsg: 'test connection result was not shown in the declarative tab' },
		);
		expect((await mockStats()).requests).toBe(before + 1);
		await browser.executeObsidian(({ app }) => (app as unknown as { setting: { close(): void } }).setting.close());
	});

	it('never stores the API key in data.json', async function () {
		const data = await browser.executeObsidian(async ({ app }) => {
			app.secretStorage.setSecret('tt-test-key', 'sk-test-not-real-1234567890');
			return true;
		});
		expect(data).toBe(true);
		await configure({ apiKeySecret: 'tt-test-key' });
		const saved = JSON.stringify(await browser.executeObsidian(async ({ plugins }) => plugins.transparentTranslate.loadData()));
		expect(saved).toContain('"apiKeySecret":"tt-test-key"');
		expect(saved).not.toContain('sk-test-not-real');

		await openNote('Informatik/Woche 1 (14.10.-20.10.).md', 'preview');
		await command('show-english');
		await browser.waitUntil(async () => (await mockStats()).authorization.some((a) => a === 'Bearer sk-test-not-real-1234567890'), {
			timeoutMsg: 'key from secret storage was not sent',
		});
		await configure({ apiKeySecret: '' });
	});

	it('opens the user guide with its sections', async function () {
		await command('open-guide');
		await $('.tt-guide-modal').waitForDisplayed();
		const items = await browser.execute(() => [...document.querySelectorAll('.tt-guide-nav-item')].map((el) => el.textContent));
		expect(items.length).toBeGreaterThanOrEqual(8);
		expect(items[0]).toBe('Welcome');
		expect(await $('.tt-guide-body h2').getText()).toBe('Welcome');

		await $$('.tt-guide-nav-item')[1]!.click();
		await browser.waitUntil(async () => (await $('.tt-guide-body h2').getText()) === 'Set up', { timeoutMsg: 'second section was not shown' });
		expect(await $('.tt-guide-body').getText()).toContain('Guten Morgen');
		// The footer is rebuilt after every section; click until the next section shows.
		await browser.waitUntil(
			async () => {
				if ((await $('.tt-guide-body h2').getText()) === items[2]) return true;
				await $('.tt-guide-footer button.mod-cta').click().catch(() => undefined);
				await browser.pause(300);
				return (await $('.tt-guide-body h2').getText()) === items[2];
			},
			{ timeoutMsg: 'Next did not advance', timeout: 20_000 },
		);
		await browser.keys('Escape');
		await browser.waitUntil(async () => !(await $('.tt-guide-modal').isExisting()), { timeoutMsg: 'guide did not close' });
	});
});
