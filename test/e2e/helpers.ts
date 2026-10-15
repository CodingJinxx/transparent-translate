import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type TransparentTranslatePlugin from '../../src/main';
import type { TransparentTranslateSettings } from '../../src/settings';
import type { MockStats } from './mock-llm';

declare module 'wdio-obsidian-service' {
	interface InstalledPlugins {
		transparentTranslate: TransparentTranslatePlugin;
	}
}

export const PLUGIN = 'transparent-translate';
const port = Number(process.env.TT_MOCK_PORT);
if (!port) throw new Error('TT_MOCK_PORT is not set: run the e2e tests through wdio.conf.mts');
export const MOCK_URL = `http://127.0.0.1:${port}/v1`;

export async function mockStats(): Promise<MockStats> {
	const res = await fetch(`http://127.0.0.1:${port}/__stats`);
	return (await res.json()) as MockStats;
}

export async function resetMock(): Promise<void> {
	await fetch(`http://127.0.0.1:${port}/__reset`);
}

/** Points the plugin at the mock server and applies extra settings. */
export async function configure(extra: Partial<TransparentTranslateSettings> = {}): Promise<void> {
	await browser.executeObsidian(
		async ({ plugins }, url, overrides) => {
			const plugin = plugins.transparentTranslate;
			Object.assign(plugin.settings, {
				providerPreset: 'custom',
				baseUrl: url,
				model: 'mock-small',
				defaultMode: 'original',
				noteEditPreferences: {},
				excludedFolders: '',
				includeOnlyFolders: '',
				...overrides,
			});
			await plugin.saveSettings();
			plugin.refreshAllViews();
		},
		MOCK_URL,
		extra,
	);
}

/** Resets vault files, closes all tabs and forgets in-memory caches. */
export async function freshVault(): Promise<void> {
	await obsidianPage.resetVault();
	await browser.executeObsidian(async ({ app, plugins }) => {
		app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() === 'markdown') leaf.detach();
		});
		const plugin = plugins.transparentTranslate;
		plugin.service.cancelAll();
		plugin.service.clearFailures();
		plugin.store.reset();
		const folder = app.vault.getFolderByPath(plugin.settings.cacheFolder);
		if (folder) await app.vault.delete(folder, true);
	});
	await resetMock();
}

/** Opens a note in Reading view (`preview`) or Live Preview (`live`). */
export async function openNote(path: string, mode: 'preview' | 'live'): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, file, viewMode) => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.setViewState({
				type: 'markdown',
				state: { file, mode: viewMode === 'preview' ? 'preview' : 'source', source: false },
				active: true,
			});
			app.workspace.setActiveLeaf(leaf, { focus: true });
		},
		path,
		mode,
	);
	await browser.pause(300);
}

export async function command(id: string): Promise<void> {
	await browser.executeObsidianCommand(`${PLUGIN}:${id}`);
}

export async function readFile(path: string): Promise<string> {
	return obsidianPage.read(path);
}

export async function editorValue(): Promise<string> {
	return browser.executeObsidian(({ app, obsidian }) => app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor.getValue() ?? '');
}

export async function readingText(): Promise<string> {
	return browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		return view?.containerEl.querySelector('.markdown-reading-view')?.textContent ?? '';
	});
}

/** Waits until the cache file of a note exists and returns its content. */
export async function waitForCacheFile(notePath: string): Promise<string> {
	let content = '';
	await browser.waitUntil(
		async () => {
			content = await browser.executeObsidian(async ({ app }, p) => {
				const file = app.vault.getFileByPath(`_Translations/${p}`);
				return file ? app.vault.read(file) : '';
			}, notePath);
			return content.length > 0;
		},
		{ timeout: 10_000, timeoutMsg: `cache file for ${notePath} was not written` },
	);
	return content;
}
