import { MarkdownView, Notice, TFile } from 'obsidian';
import { nameKey } from './core/names';
import { normalizeSentence } from './core/text';
import { isTargetLanguage, type DisplayMode, type TargetLanguage } from './core/types';
import { t } from './i18n';
import type TransparentTranslatePlugin from './main';
import { BulkTranslateModal, FolderSuggestModal } from './ui/bulk-translate';
import { ConfirmModal } from './ui/confirm-modal';
import { CorrectionModal, FixSentenceModal, type CorrectionRequest } from './ui/correction-modal';
import { GlossaryModal } from './ui/glossary-modal';
import { GuideModal } from './ui/guide-modal';
import { TermReviewModal } from './ui/term-review-modal';
import type { ReviewPair } from './core/term-review';
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

	const nameCommand = (id: string, name: string, mode: DisplayMode) =>
		plugin.addCommand({ id, name, callback: () => plugin.setNameMode(mode) });
	nameCommand('names-original', t('command.names-original'), 'original');
	nameCommand('names-english', t('command.names-english'), 'en');
	nameCommand('names-german', t('command.names-german'), 'de');

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
			plugin.nameStore.reset();
			plugin.names.reset();
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
			void plugin.endpoint.check().then((reachable) => {
				if (!reachable) new Notice(t('notice.endpoint-unreachable-short'), 8000);
				else new FolderSuggestModal(plugin, (folder) => new BulkTranslateModal(plugin, folder).open()).open();
			});
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
		id: 'open-guide',
		name: t('command.open-guide'),
		callback: () => new GuideModal(plugin).open(),
	});

	// ---- Glossary -------------------------------------------------------

	plugin.addCommand({
		id: 'manage-glossary',
		name: t('command.manage-glossary'),
		callback: () => new GlossaryModal(plugin).open(),
	});

	/** The note in the active view with its translated mode, if it shows a translation. */
	const translatedNote = (view: MarkdownView | null): { path: string; mode: TargetLanguage; view: MarkdownView } | null => {
		if (!view?.file || !plugin.isTranslatable(view.file.path)) return null;
		const mode = plugin.modeOf(view.leaf, view.file.path);
		return isTargetLanguage(mode) ? { path: view.file.path, mode, view } : null;
	};

	plugin.addCommand({
		id: 'fix-translation',
		name: t('command.fix-translation'),
		checkCallback: (checking) => {
			const current = translatedNote(activeView());
			if (!current) return false;
			if (checking) return true;
			const note = plugin.parse(current.path, current.view.getViewData());
			const items: CorrectionRequest[] = [];
			for (const sentence of note.sentences) {
				const display = plugin.service.display(current.path, sentence, current.mode);
				if (display.kind === 'translated') items.push({ path: current.path, sentence, translation: display.text, target: current.mode });
			}
			if (items.length === 0) {
				new Notice(t('correction.none'));
				return true;
			}
			new FixSentenceModal(plugin, items, (item) => new CorrectionModal(plugin, item).open()).open();
			return true;
		},
	});

	plugin.addCommand({
		id: 'update-outdated',
		name: t('command.update-outdated'),
		checkCallback: (checking) => {
			const current = translatedNote(activeView());
			if (!current || !plugin.service.canTranslate) return false;
			if (checking) return true;
			const note = plugin.parse(current.path, current.view.getViewData());
			void plugin.glossary.load().then(async () => {
				new Notice(t('notice.updating-outdated'));
				plugin.service.clearFailures(current.path);
				const outcome = await plugin.service.translate(current.path, note, note.sentences, current.mode, plugin.noteTitle(current.path), undefined, true);
				new Notice(outcome.translated + outcome.failed === 0 ? t('notice.nothing-outdated') : t('notice.updated-outdated', { count: outcome.translated }));
			});
			return true;
		},
	});

	plugin.addCommand({
		id: 'review-terms',
		name: t('command.review-terms'),
		checkCallback: (checking) => {
			const current = translatedNote(activeView());
			if (!current || !plugin.translator) return false;
			if (checking) return true;
			void reviewTerms(plugin, current.path, current.mode, current.view.getViewData());
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
				if (cacheFile.path === plugin.nameStore.path) continue;
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
			if (plugin.settings.nameMode !== 'original' || plugin.nameStore.size > 0) {
				await plugin.nameStore.load();
				const live = new Set<string>();
				for (const entry of plugin.app.vault.getAllLoadedFiles()) {
					if (entry.path === '/') continue;
					live.add(nameKey(entry instanceof TFile ? entry.basename : entry.name));
				}
				removed += plugin.nameStore.prune(live, plugin.settings.pruneAfterDays);
			}
			new Notice(t('notice.pruned', { count: removed }));
		},
	});
}

/** Asks the model which terms of the translation were a judgment call and lets the user settle them. */
async function reviewTerms(plugin: TransparentTranslatePlugin, path: string, mode: TargetLanguage, text: string): Promise<void> {
	const translator = plugin.translator;
	if (!translator) return;
	await plugin.store.load(path);
	const note = plugin.parse(path, text);
	const pairs: ReviewPair[] = [];
	const seen = new Set<string>();
	for (const sentence of note.sentences) {
		const translation = plugin.store.lookup(path, sentence.hash, mode);
		if (translation === undefined || seen.has(sentence.hash) || normalizeSentence(translation) === normalizeSentence(sentence.masked)) continue;
		seen.add(sentence.hash);
		pairs.push({ source: sentence.masked, translation });
	}
	if (pairs.length === 0) {
		new Notice(t('review.no-translations'));
		return;
	}
	if (!(await plugin.endpoint.check())) {
		new Notice(t('notice.endpoint-unreachable-short'), 8000);
		return;
	}
	new Notice(t('review.running'));
	try {
		await plugin.glossary.load();
		const known = plugin.glossary.entries().map(({ entry }) => entry.src);
		const { terms } = await translator.reviewTerms(pairs, mode, known);
		if (terms.length === 0) {
			new Notice(t('review.none'));
			return;
		}
		new TermReviewModal(plugin, path, mode, terms).open();
	} catch (error) {
		new Notice(t('notice.translation-error', { error: (error as Error).message }), 8000);
	}
}
