import { MarkdownView, Notice } from 'obsidian';
import { normalizeSentence } from './core/text';
import { isTargetLanguage, type DisplayMode } from './core/types';
import { t } from './i18n';
import type TransparentTranslatePlugin from './main';
import { BulkTranslateModal, FolderSuggestModal } from './ui/bulk-translate';
import { ConfirmModal } from './ui/confirm-modal';
import { RestoreOriginalModal } from './ui/restore-modal';

/** Registers all commands. No default hotkeys: users bind their own. */
export function registerCommands(plugin: TransparentTranslatePlugin): void {
	const activeView = () => plugin.app.workspace.getActiveViewOfType(MarkdownView);

	const modeCommand = (id: string, name: string, mode: DisplayMode) =>
		plugin.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = activeView();
				if (!view?.file) return false;
				if (mode !== 'original' && !plugin.isTranslatable(view.file.path)) return false;
				if (!checking) plugin.setMode(view.leaf, mode);
				return true;
			},
		});

	modeCommand('show-original', t('command.show-original'), 'original');
	modeCommand('show-english', t('command.show-english'), 'en');
	modeCommand('show-german', t('command.show-german'), 'de');

	plugin.addCommand({
		id: 'cycle-display-language',
		name: t('command.cycle'),
		checkCallback: (checking) => {
			const view = activeView();
			if (!view?.file) return false;
			if (!checking) plugin.cycleMode(view.leaf);
			return true;
		},
	});

	plugin.addCommand({
		id: 'retranslate-note',
		name: t('command.retranslate'),
		checkCallback: (checking) => {
			const view = activeView();
			if (plugin.isMobile || !view?.file || !plugin.isTranslatable(view.file.path)) return false;
			if (checking) return true;
			const path = view.file.path;
			const note = plugin.parse(path, view.getViewData());
			plugin.service.retranslate(path, note.sentences);
			new Notice(t('notice.retranslating'));
			const mode = plugin.modeOf(view.leaf, path);
			if (isTargetLanguage(mode)) plugin.service.request(path, note, note.sentences, mode, plugin.noteTitle(path));
			return true;
		},
	});

	plugin.addCommand({
		id: 'clear-note-cache',
		name: t('command.clear-note-cache'),
		checkCallback: (checking) => {
			const view = activeView();
			if (!view?.file) return false;
			if (checking) return true;
			const path = view.file.path;
			plugin.service.forgetNote(path);
			void plugin.store.deleteNote(path).then(() => {
				new Notice(t('notice.cache-cleared-note'));
				plugin.refreshAllViews();
			});
			return true;
		},
	});

	plugin.addCommand({
		id: 'clear-all-cache',
		name: t('command.clear-all-cache'),
		callback: async () => {
			const folder = plugin.app.vault.getFolderByPath(plugin.settings.cacheFolder);
			const ok = await new ConfirmModal(plugin.app, {
				title: t('confirm-clear.title'),
				body: t('confirm-clear.body', { folder: plugin.settings.cacheFolder }),
				confirm: t('confirm-clear.confirm'),
				cancel: t('confirm-delete.cancel'),
				warning: true,
			}).ask();
			if (!ok) return;
			plugin.service.cancelAll();
			plugin.service.clearFailures();
			plugin.store.reset();
			if (folder) await plugin.app.fileManager.trashFile(folder);
			new Notice(t('notice.cache-cleared-all'));
			plugin.refreshAllViews();
		},
	});

	plugin.addCommand({
		id: 'translate-folder',
		name: t('command.translate-folder'),
		checkCallback: (checking) => {
			if (plugin.isMobile) return false;
			if (checking) return true;
			if (!plugin.hasProvider()) {
				new Notice(t('notice.no-provider'));
				return true;
			}
			new FolderSuggestModal(plugin, (folder) => new BulkTranslateModal(plugin, folder).open()).open();
			return true;
		},
	});

	plugin.addCommand({
		id: 'copy-original-text',
		name: t('command.copy-original'),
		editorCheckCallback: (checking, editor) => {
			if (checking) return true;
			const text = editor.somethingSelected() ? editor.getSelection() : editor.getValue();
			void navigator.clipboard.writeText(text).then(() => new Notice(t('notice.copied-original')));
			return true;
		},
	});

	plugin.addCommand({
		id: 'restore-replaced-original',
		name: t('command.restore-original'),
		editorCheckCallback: (checking, editor, ctx) => {
			const file = ctx.file;
			if (!file || plugin.isMobile) return false;
			if (checking) return true;
			void plugin.store.load(file.path).then(() => {
				const items = plugin.store.replaced(file.path);
				if (items.length === 0) {
					new Notice(t('notice.no-replaced'));
					return;
				}
				new RestoreOriginalModal(plugin.app, items, (item) => {
					const note = plugin.parse(file.path, editor.getValue());
					const replacing = item.replacedWith ? note.sentences.find((s) => s.hash === item.replacedWith) : undefined;
					if (replacing) {
						editor.replaceRange(item.text, editor.offsetToPos(replacing.from), editor.offsetToPos(replacing.to));
						new Notice(t('notice.restored'));
					} else if (note.sentences.some((s) => normalizeSentence(s.text) === normalizeSentence(item.text))) {
						new Notice(t('notice.restored'));
					} else {
						void navigator.clipboard.writeText(item.text).then(() => new Notice(t('notice.restore-copied')));
					}
				}).open();
			});
			return true;
		},
	});

	plugin.addCommand({
		id: 'prune-translation-cache',
		name: t('command.prune-cache'),
		callback: async () => {
			const prefix = `${plugin.settings.cacheFolder}/`;
			const files = plugin.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
			let removed = 0;
			for (const cacheFile of files) {
				const notePath = cacheFile.path.slice(prefix.length);
				const note = plugin.app.vault.getFileByPath(notePath);
				if (!note) {
					await plugin.store.deleteNote(notePath);
					continue;
				}
				const model = plugin.parse(notePath, await plugin.app.vault.cachedRead(note));
				await plugin.store.load(notePath);
				removed += plugin.store.prune(notePath, new Set(model.sentences.map((s) => s.hash)), plugin.settings.pruneAfterDays);
			}
			new Notice(t('notice.pruned', { count: removed }));
		},
	});
}
