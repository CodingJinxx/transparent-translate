import { editorInfoField, getLanguage, MarkdownView, Notice, Platform, Plugin, requestUrl, setIcon, TFile, type WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { NoteParser, parseNote } from './core/note';
import { isTranslatablePath, notePathForCache } from './core/paths';
import { sentenceHash } from './core/text';
import { protect } from './core/protect';
import { isTargetLanguage, nextMode, type DisplayMode, type NoteModel, type TargetLanguage } from './core/types';
import type { TranslateHost } from './host';
import { setLanguage, t } from './i18n';
import { log, setDebug } from './log';
import { ModeManager } from './modes';
import { VaultCacheBackend } from './obsidian/vault-backend';
import { CacheStore } from './services/cache-store';
import { TranslationService } from './services/translation-service';
import { DerivedSettings, mergeSettings, type TransparentTranslateSettings } from './settings';
import { LlmTranslator, parseExtraBody, parseHeaderLines, type HttpClient, type LlmConfig } from './translator/llm-translator';
import { registerCommands } from './commands';
import { ConfirmModal } from './ui/confirm-modal';
import { TransparentTranslateSettingTab } from './ui/settings-tab';
import { createReadingViewProcessor } from './views/reading-view';
import { createLivePreviewExtension, refreshEffect, setModeEffect } from './views/live-preview/extension';

/** Obsidian's `requestUrl` avoids CORS and works on every platform. */
const obsidianHttp: HttpClient = async (request) => {
	const response = await requestUrl({ url: request.url, method: request.method, headers: request.headers, body: request.body, throw: false });
	return { status: response.status, text: response.text, headers: response.headers };
};

export default class TransparentTranslatePlugin extends Plugin implements TranslateHost {
	settings!: TransparentTranslateSettings;
	derived!: DerivedSettings;
	store!: CacheStore;
	service!: TranslationService;
	translator: LlmTranslator | null = null;
	readonly isMobile = Platform.isMobile;

	private modes!: ModeManager;
	private readonly parsers = new Map<string, NoteParser>();
	private readonly editorViews = new Set<EditorView>();
	private readonly headerActions = new WeakMap<MarkdownView, HTMLElement>();
	private readonly refreshTimers = new Map<string, number>();
	private statusBarEl: HTMLElement | null = null;
	private lastErrorNotice = { message: '', at: 0 };

	override async onload(): Promise<void> {
		setLanguage(getLanguage());
		await this.loadSettings();

		this.store = new CacheStore(new VaultCacheBackend(this.app), {
			cacheFolder: () => this.settings.cacheFolder,
			saveDelayMs: 1500,
		});
		// Mobile is view-only: no translator, so no requests and no API key.
		if (!this.isMobile) this.translator = new LlmTranslator(() => this.llmConfig(), obsidianHttp);
		this.service = new TranslationService({
			store: this.store,
			translator: () => this.translator,
			batchSize: () => this.settings.batchSize,
			concurrency: () => this.settings.concurrency,
			glossary: () => this.derived.glossary,
			onError: (error) => this.reportError(error),
		});
		this.service.onUpdate((path) => this.scheduleRefresh(path));
		this.modes = new ModeManager(() => this.settings.defaultMode);

		this.registerMarkdownPostProcessor(createReadingViewProcessor(this));
		this.registerEditorExtension(createLivePreviewExtension(this));
		this.addSettingTab(new TransparentTranslateSettingTab(this.app, this));
		registerCommands(this);

		if (this.settings.statusBar) this.createStatusBar();
		this.app.workspace.onLayoutReady(() => {
			this.refreshHeaderActions();
			this.updateStatusBar();
		});
		this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshHeaderActions()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateStatusBar()));
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.refreshHeaderActions();
				this.syncEditorModes();
				this.updateStatusBar();
			}),
		);
		this.registerVaultEvents();
	}

	override onunload(): void {
		this.service.cancelAll();
		void this.store.flush();
		for (const timer of this.refreshTimers.values()) window.clearTimeout(timer);
	}

	// ---- Settings -------------------------------------------------------

	async loadSettings(): Promise<void> {
		this.settings = mergeSettings(await this.loadData());
		this.derived = new DerivedSettings(() => this.settings);
		setDebug(this.settings.debugLogging);
	}

	async saveSettings(): Promise<void> {
		this.derived.invalidate();
		setDebug(this.settings.debugLogging);
		await this.saveData(this.settings);
	}

	/** Re-renders everything after a setting that affects display changed. */
	refreshAllViews(): void {
		this.parsers.clear();
		for (const view of this.editorViews) view.dispatch({ effects: refreshEffect.of(null) });
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') leaf.view.previewMode.rerender(true);
		}
	}

	override async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.refreshAllViews();
	}

	llmConfig(): LlmConfig {
		const s = this.settings;
		const apiKey = s.apiKeySecret ? this.app.secretStorage.getSecret(s.apiKeySecret) : null;
		return {
			baseUrl: s.baseUrl,
			model: s.model,
			apiKey: apiKey && apiKey.length > 0 ? apiKey : null,
			jsonMode: s.jsonMode,
			temperature: s.temperature,
			maxTokens: s.maxTokens,
			extraHeaders: parseHeaderLines(s.extraHeaders),
			extraBody: parseExtraBody(s.extraBody) ?? {},
			timeoutMs: s.timeoutSeconds * 1000,
			maxRetries: s.maxRetries,
		};
	}

	// ---- TranslateHost --------------------------------------------------

	isTranslatable(path: string): boolean {
		return isTranslatablePath(path, this.derived.folderRules);
	}

	parse(path: string, text: string): NoteModel {
		let parser = this.parsers.get(path);
		if (!parser) {
			parser = new NoteParser();
			this.parsers.set(path, parser);
		}
		return parser.parse(text, this.derived.segmentOptions);
	}

	noteTitle(path: string): string {
		const name = path.split('/').pop() ?? path;
		return name.replace(/\.md$/i, '');
	}

	modeOf(leaf: WorkspaceLeaf, path: string | null): DisplayMode {
		return this.modes.get(leaf, path);
	}

	setMode(leaf: WorkspaceLeaf, mode: DisplayMode): void {
		const view = leaf.view instanceof MarkdownView ? leaf.view : null;
		const path = view?.file?.path ?? null;
		if (!view || !path) return;
		if (mode !== 'original' && !this.isTranslatable(path)) {
			new Notice(t('notice.excluded'));
			return;
		}
		this.modes.set(leaf, path, mode);
		this.service.clearFailures(path);

		if (isTargetLanguage(mode)) {
			if (this.service.canTranslate && !this.hasProvider()) new Notice(t('notice.no-provider'));
			// Lazy translation: switching is what triggers the requests for the whole note.
			const note = this.parse(path, view.getViewData());
			this.service.request(path, note, note.sentences, mode, this.noteTitle(path));
			if (this.settings.pruneCache) {
				const live = new Set(note.sentences.map((s) => s.hash));
				void this.store.load(path).then(() => this.store.prune(path, live, this.settings.pruneAfterDays));
			}
		}

		this.updateHeaderAction(view);
		this.updateStatusBar();
		this.syncEditorModes(leaf);
		if (view.getMode() === 'preview') view.previewMode.rerender(true);
	}

	cycleMode(leaf: WorkspaceLeaf): void {
		const view = leaf.view instanceof MarkdownView ? leaf.view : null;
		if (!view?.file) return;
		let mode = nextMode(this.modeOf(leaf, view.file.path));
		if (mode !== 'original' && !this.isTranslatable(view.file.path)) mode = 'original';
		this.setMode(leaf, mode);
	}

	hasProvider(): boolean {
		return this.settings.baseUrl.trim().length > 0 && this.settings.model.trim().length > 0;
	}

	findMarkdownView(path: string, el?: HTMLElement): MarkdownView | null {
		const candidates: MarkdownView[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) candidates.push(leaf.view);
		}
		if (candidates.length <= 1) return candidates[0] ?? null;
		if (el?.isConnected) {
			const owner = candidates.find((v) => v.containerEl.contains(el));
			if (owner) return owner;
		}
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active && candidates.includes(active)) return active;
		return candidates.find((v) => v.getMode() === 'preview') ?? candidates[0] ?? null;
	}

	registerEditorView(view: EditorView): void {
		this.editorViews.add(view);
	}

	unregisterEditorView(view: EditorView): void {
		this.editorViews.delete(view);
	}

	/** Sends the current mode of each leaf to its editor. */
	private syncEditorModes(onlyLeaf?: WorkspaceLeaf): void {
		for (const view of this.editorViews) {
			const info = view.state.field(editorInfoField, false);
			if (!(info instanceof MarkdownView)) continue;
			if (onlyLeaf && info.leaf !== onlyLeaf) continue;
			view.dispatch({ effects: setModeEffect.of(this.modes.get(info.leaf, info.file?.path ?? null)) });
		}
	}

	recordReplacement(path: string, oldText: string, newText: string, target: TargetLanguage): void {
		// What was typed is already in the target language: seed the cache so it is not requested.
		const typed = parseNote(newText, this.derived.segmentOptions);
		const now = new Date().toISOString();
		for (const s of typed.sentences) this.store.put(path, s.hash, target, s.masked, { lang: target, translatedAt: now });
		if (typed.sentences.length === 0 && newText.trim()) {
			const masked = protect(newText, this.derived.segmentOptions.protect).masked;
			this.store.put(path, sentenceHash(newText), target, masked, { lang: target, translatedAt: now });
		}
		this.store.addReplaced(path, { at: now, replacedWith: typed.sentences[0]?.hash ?? null, text: oldText });
	}

	recordDeletion(path: string, texts: string[], target: TargetLanguage, editorView: EditorView): void {
		const now = new Date().toISOString();
		for (const text of texts) this.store.addReplaced(path, { at: now, replacedWith: null, text });
		const source = t(`language.${target === 'en' ? 'de' : 'en'}`);
		const message = texts.length === 1 ? t('notice.deleted-sentence', { language: source }) : t('notice.deleted-sentences', { count: texts.length, language: source });
		const notice = new Notice('', 8000);
		notice.setMessage(
			createFragment((frag) => {
				frag.createSpan({ text: `${message} ` });
				const undo = frag.createEl('button', { cls: 'tt-notice-undo', text: t('notice.undo') });
				undo.addEventListener('click', () => {
					const leaf = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view instanceof MarkdownView && l.view.file?.path === path);
					const view = leaf?.view instanceof MarkdownView ? leaf.view : null;
					view?.editor.undo();
					editorView.focus();
					notice.hide();
				});
			}),
		);
	}

	confirmDelete(count: number, target: TargetLanguage): Promise<boolean> {
		const source = t(`language.${target === 'en' ? 'de' : 'en'}`);
		return new ConfirmModal(this.app, {
			title: t('confirm-delete.title'),
			body: t('confirm-delete.body', { count, source }),
			confirm: t('confirm-delete.delete'),
			cancel: t('confirm-delete.cancel'),
			warning: true,
		}).ask();
	}

	setNoteEditPreference(path: string, preference: 'replace' | 'original'): void {
		this.settings.noteEditPreferences[path] = preference;
		void this.saveSettings();
	}

	// ---- Refresh after new translations ---------------------------------

	private scheduleRefresh(path: string): void {
		if (this.refreshTimers.has(path)) return;
		this.refreshTimers.set(
			path,
			window.setTimeout(() => {
				this.refreshTimers.delete(path);
				this.refreshPath(path);
			}, 200),
		);
	}

	private refreshPath(path: string): void {
		for (const view of this.editorViews) {
			const info = view.state.field(editorInfoField, false);
			if (info?.file?.path === path) view.dispatch({ effects: refreshEffect.of(null) });
		}
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== path) continue;
			if (view.getMode() === 'preview' && isTargetLanguage(this.modes.get(leaf, path))) view.previewMode.rerender(true);
		}
		this.updateStatusBar();
	}

	private reportError(error: Error): void {
		const now = Date.now();
		// One notice per distinct message every 15 seconds.
		if (error.message === this.lastErrorNotice.message && now - this.lastErrorNotice.at < 15_000) return;
		this.lastErrorNotice = { message: error.message, at: now };
		log.error('Translation failed', error);
		new Notice(t('notice.translation-error', { error: error.message }), 8000);
	}

	// ---- Header action and status bar -----------------------------------

	refreshHeaderActions(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (!this.headerActions.has(view)) {
				const action = view.addAction('languages', t('command.cycle'), () => this.cycleMode(view.leaf));
				action.addClass('tt-header-action');
				this.headerActions.set(view, action);
			}
			this.updateHeaderAction(view);
		}
	}

	private updateHeaderAction(view: MarkdownView): void {
		const action = this.headerActions.get(view);
		if (!action) return;
		const path = view.file?.path ?? null;
		const mode = this.modes.get(view.leaf, path);
		const translatable = path !== null && this.isTranslatable(path);
		action.toggleClass('tt-hidden', !translatable);
		action.dataset.ttMode = t(`mode.short.${mode}`);
		action.toggleClass('is-translated', mode !== 'original');
		action.setAttr('aria-label', t('action.tooltip', { mode: t(`mode.${mode}`) }));
	}

	createStatusBar(): void {
		if (this.statusBarEl || this.isMobile) return;
		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass('tt-status', 'mod-clickable');
		this.registerDomEvent(this.statusBarEl, 'click', () => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) this.cycleMode(view.leaf);
		});
		this.updateStatusBar();
	}

	removeStatusBar(): void {
		this.statusBarEl?.remove();
		this.statusBarEl = null;
	}

	updateStatusBar(): void {
		const el = this.statusBarEl;
		if (!el) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const path = view?.file?.path ?? null;
		if (!view || !path || !this.isTranslatable(path)) {
			el.addClass('tt-hidden');
			return;
		}
		el.removeClass('tt-hidden');
		const mode = this.modes.get(view.leaf, path);
		el.empty();
		const icon = el.createSpan({ cls: 'tt-status-icon' });
		setIcon(icon, 'languages');
		(['original', 'en', 'de'] as const).forEach((m, i) => {
			if (i > 0) el.createSpan({ cls: 'tt-status-sep', text: '·' });
			el.createSpan({ cls: m === mode ? 'tt-status-mode is-active' : 'tt-status-mode', text: t(`mode.short.${m}`) });
		});
		el.setAttr(
			'aria-label',
			mode === 'original' ? t('status.tooltip.original') : t('status.tooltip.translated', { language: t(`mode.${mode}`) }),
		);
		el.setAttr('data-tooltip-position', 'top');
	}

	// ---- Vault events -----------------------------------------------------

	private registerVaultEvents(): void {
		const cacheNote = (path: string) => notePathForCache(this.settings.cacheFolder, path);

		const onCacheChange = async (file: TFile) => {
			const notePath = cacheNote(file.path);
			if (!notePath) return;
			await this.store.handleExternalChange(notePath, await this.app.vault.read(file));
		};

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file instanceof TFile && cacheNote(file.path)) void onCacheChange(file);
				}),
			);
		});
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && cacheNote(file.path)) void onCacheChange(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				if (cacheNote(oldPath) || cacheNote(file.path)) return;
				this.parsers.delete(oldPath);
				this.service.forgetNote(oldPath);
				void this.store.renameNote(oldPath, file.path);
				const preference = this.settings.noteEditPreferences[oldPath];
				if (preference) {
					delete this.settings.noteEditPreferences[oldPath];
					this.settings.noteEditPreferences[file.path] = preference;
					void this.saveSettings();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile) || file.extension !== 'md' || cacheNote(file.path)) return;
				this.parsers.delete(file.path);
				this.service.forgetNote(file.path);
				void this.store.deleteNote(file.path);
			}),
		);
	}
}
