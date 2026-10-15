import { browser, expect } from '@wdio/globals';
import { before, describe, it } from 'mocha';
import { configure, freshVault, mockStats, openNote, PLUGIN } from '../helpers';

const NOTE = 'Informatik/Lektion 1.md';

/** All vault paths, to prove that nothing was renamed. */
const vaultPaths = (): Promise<string[]> =>
	browser.executeObsidian(({ app }) =>
		app.vault
			.getAllLoadedFiles()
			.filter((f) => !f.path.startsWith('_Translations'))
			.map((f) => f.path)
			.sort(),
	);

const fileText = (path: string): Promise<string> =>
	browser.executeObsidian(async ({ app }, p) => {
		const file = app.vault.getFileByPath(p);
		return file ? app.vault.read(file) : '';
	}, path);

/** Text of an explorer row, or null if the row is not rendered. */
const explorerLabel = (path: string): Promise<string | null> =>
	browser.executeObsidian(({ app }, p) => {
		const view = app.workspace.getLeavesOfType('file-explorer')[0]?.view as unknown as { containerEl: HTMLElement } | undefined;
		const row = view?.containerEl.querySelector(`[data-path="${p}"]`);
		return row?.querySelector('.nav-file-title-content, .nav-folder-title-content')?.textContent ?? null;
	}, path);

const activeLabels = (): Promise<{ tab: string; header: string; inline: string; crumb: string; tabAria: string }> =>
	browser.executeObsidian(({ app, obsidian }) => {
		const view = app.workspace.getLeavesOfType('markdown').map((l) => l.view).find((v) => v instanceof obsidian.MarkdownView)!;
		const leaf = view.leaf as unknown as { tabHeaderEl: HTMLElement; tabHeaderInnerTitleEl: HTMLElement };
		const text = (sel: string) => view.containerEl.querySelector(sel)?.textContent ?? '';
		return {
			tab: leaf.tabHeaderInnerTitleEl.textContent ?? '',
			tabAria: leaf.tabHeaderEl.getAttribute('aria-label') ?? '',
			header: text('.view-header-title'),
			inline: text('.inline-title'),
			crumb: text('.view-header-breadcrumb'),
		};
	});

const setNameMode = (mode: 'original' | 'en' | 'de'): Promise<void> =>
	browser.executeObsidianCommand(`${PLUGIN}:names-${mode === 'original' ? 'original' : mode === 'en' ? 'english' : 'german'}`);

/** Opens the explorer and unfolds the folder of `path`. */
const reveal = (path: string): Promise<void> =>
	browser.executeObsidian(async ({ app }, p) => {
		await app.commands.executeCommandById('file-explorer:open');
		const view = app.workspace.getLeavesOfType('file-explorer')[0]!.view as unknown as { revealInFolder(f: unknown): void };
		view.revealInFolder(app.vault.getAbstractFileByPath(p));
		await new Promise((resolve) => setTimeout(resolve, 400));
	}, path);

describe('File and folder names', function () {
	let pathsBefore: string[] = [];
	let bytesBefore = '';

	before(async function () {
		await freshVault();
		await configure();
		pathsBefore = await vaultPaths();
		bytesBefore = await fileText(NOTE);
		await reveal(NOTE);
	});

	it('shows translated names in the explorer and never renames or edits files', async function () {
		expect(await explorerLabel('Informatik')).toBe('Informatik');
		await setNameMode('en');
		await browser.waitUntil(async () => (await explorerLabel('Informatik')) === 'Computer science', { timeoutMsg: 'folder name was not translated' });
		await browser.waitUntil(async () => (await explorerLabel(NOTE)) === 'Lesson 1', { timeoutMsg: 'file name was not translated' });

		expect(await vaultPaths()).toEqual(pathsBefore);
		expect(await fileText(NOTE)).toBe(bytesBefore);

		// The names cache is a visible, syncable note in the cache folder.
		await browser.waitUntil(async () => (await fileText('_Translations/_names.md')).includes('Computer science'), { timeoutMsg: 'names cache was not written' });
	});

	it('does not request names twice', async function () {
		const requests = (await mockStats()).requests;
		await browser.executeObsidian(async ({ app }) => {
			const view = app.workspace.getLeavesOfType('file-explorer')[0]!.view as unknown as { containerEl: HTMLElement };
			const title = view.containerEl.querySelector<HTMLElement>('.nav-folder-title[data-path="Informatik"]')!;
			title.click();
			await new Promise((resolve) => setTimeout(resolve, 200));
			title.click();
			await new Promise((resolve) => setTimeout(resolve, 600));
		});
		expect(await explorerLabel(NOTE)).toBe('Lesson 1');
		expect((await mockStats()).requests).toBe(requests);
	});

	it('translates tab, header, inline title and breadcrumb of the open note', async function () {
		await openNote(NOTE, 'live');
		await browser.waitUntil(async () => (await activeLabels()).inline === 'Lesson 1', { timeoutMsg: 'inline title was not translated' });
		expect(await activeLabels()).toEqual({ tab: 'Lesson 1', tabAria: 'Lesson 1', header: 'Lesson 1', inline: 'Lesson 1', crumb: 'Computer science' });
		expect(await vaultPaths()).toEqual(pathsBefore);
	});

	it('shows the real name while renaming from the inline title, and never renames by itself', async function () {
		const during = await browser.executeObsidian(async ({ app, obsidian }) => {
			const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView)!;
			const inline = view.containerEl.querySelector<HTMLElement>('.inline-title')!;
			inline.focus();
			await new Promise((resolve) => setTimeout(resolve, 200));
			const text = inline.textContent;
			inline.blur();
			await new Promise((resolve) => setTimeout(resolve, 400));
			return { text, after: inline.textContent, path: view.file?.path };
		});
		expect(during.text).toBe('Lektion 1');
		expect(during.path).toBe(NOTE);
		expect(during.after).toBe('Lesson 1');
		expect(await vaultPaths()).toEqual(pathsBefore);
	});

	it('shows the real name while renaming from the explorer, and committing it renames nothing', async function () {
		const during = await browser.executeObsidian(async ({ app }, p) => {
			const view = app.workspace.getLeavesOfType('file-explorer')[0]!.view as unknown as {
				containerEl: HTMLElement;
				startRenameFile(file: unknown): void;
			};
			view.startRenameFile(app.vault.getFileByPath(p));
			await new Promise((resolve) => setTimeout(resolve, 300));
			const content = view.containerEl.querySelector<HTMLElement>(`[data-path="${p}"] .nav-file-title-content`)!;
			return { text: content.textContent, editable: content.getAttribute('contenteditable') };
		}, NOTE);
		expect(during.editable).not.toBeNull();
		expect(during.text).toBe('Lektion 1');
		await browser.keys('Enter');
		await browser.pause(500);
		expect(await vaultPaths()).toEqual(pathsBefore);
		await browser.waitUntil(async () => (await explorerLabel(NOTE)) === 'Lesson 1', { timeoutMsg: 'name was not translated again after renaming' });
	});

	it('shows German names and falls back to the original for unknown ones', async function () {
		await setNameMode('de');
		// The folder name is German already, so the model reports it as such and the original is shown.
		await browser.waitUntil(async () => (await explorerLabel(NOTE)) === 'Lektion 1', { timeoutMsg: 'English names were not removed' });
		expect(await explorerLabel('Informatik')).toBe('Informatik');
		expect(await vaultPaths()).toEqual(pathsBefore);
	});

	it('restores every label when switched back to the original', async function () {
		await setNameMode('original');
		await browser.waitUntil(async () => (await explorerLabel('Informatik')) === 'Informatik', { timeoutMsg: 'folder name was not restored' });
		expect(await explorerLabel(NOTE)).toBe('Lektion 1');
		expect(await activeLabels()).toEqual({ tab: 'Lektion 1', tabAria: 'Lektion 1', header: 'Lektion 1', inline: 'Lektion 1', crumb: 'Informatik' });
	});
});
