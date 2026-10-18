import { FuzzySuggestModal, Modal, Notice, Setting, type TFile, type TFolder } from 'obsidian';
import { estimateCost } from '../core/estimate';
import { isInFolder } from '../core/paths';
import { TARGET_LANGUAGES, type NoteModel, type Sentence, type TargetLanguage } from '../core/types';
import { t } from '../i18n';
import type TransparentTranslatePlugin from '../main';

type TargetChoice = TargetLanguage | 'both';

interface Plan {
	notes: Array<{ file: TFile; note: NoteModel; missing: Partial<Record<TargetLanguage, Sentence[]>> }>;
	sentences: number;
	characters: number;
	requests: number;
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	constructor(
		private readonly plugin: TransparentTranslatePlugin,
		private readonly onChoose: (folder: TFolder) => void,
	) {
		super(plugin.app);
		this.setPlaceholder(t('bulk.choose-folder'));
	}

	getItems(): TFolder[] {
		const cache = this.plugin.settings.cacheFolder;
		return this.app.vault.getAllFolders(true).filter((f) => !isInFolder(f.path, cache));
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? '/' : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}

/**
 * Counts what a folder translation would send, shows a rough token and cost
 * estimate and asks for confirmation before anything is requested.
 */
export class BulkTranslateModal extends Modal {
	private choice: TargetChoice = 'both';
	private summaryEl!: HTMLElement;
	private startButton: HTMLButtonElement | null = null;
	private plan: Plan | null = null;
	private planToken = 0;

	constructor(
		private readonly plugin: TransparentTranslatePlugin,
		private readonly folder: TFolder,
	) {
		super(plugin.app);
	}

	private targets(): TargetLanguage[] {
		return this.choice === 'both' ? [...TARGET_LANGUAGES] : [this.choice];
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t('bulk.title', { folder: this.folder.isRoot() ? '/' : this.folder.path }));
		new Setting(contentEl).setName(t('bulk.target')).addDropdown((dropdown) =>
			dropdown
				.addOption('both', t('bulk.target-both'))
				.addOption('en', t('mode.en'))
				.addOption('de', t('mode.de'))
				.addOption('nl', t('mode.nl'))
				.setValue(this.choice)
				.onChange((value) => {
					this.choice = value as TargetChoice;
					void this.computePlan();
				}),
		);
		this.summaryEl = contentEl.createDiv({ cls: 'tt-bulk-summary' });
		contentEl.createEl('p', { cls: 'tt-bulk-privacy', text: t('bulk.privacy', { endpoint: this.plugin.settings.baseUrl }) });
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(t('bulk.cancel')).onClick(() => this.close()))
			.addButton((button) => {
				this.startButton = button.buttonEl;
				button
					.setButtonText(t('bulk.start'))
					.setCta()
					.setDisabled(true)
					.onClick(() => {
						const plan = this.plan;
						this.close();
						if (plan) void this.run(plan);
					});
			});
		void this.computePlan();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private async computePlan(): Promise<void> {
		const token = ++this.planToken;
		this.plan = null;
		this.startButton?.setAttr('disabled', 'true');
		this.summaryEl.setText(t('bulk.counting'));

		const plugin = this.plugin;
		const targets = this.targets();
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((f) => (this.folder.isRoot() || isInFolder(f.path, this.folder.path)) && plugin.isTranslatable(f.path));
		const plan: Plan = { notes: [], sentences: 0, characters: 0, requests: 0 };
		const batch = Math.max(1, plugin.settings.batchSize);
		for (const file of files) {
			const note = plugin.parse(file.path, await this.app.vault.cachedRead(file));
			await plugin.store.load(file.path);
			const missing: Partial<Record<TargetLanguage, Sentence[]>> = {};
			let any = false;
			for (const target of targets) {
				const list = note.sentences.filter((s) => {
					const kind = plugin.service.display(file.path, s, target).kind;
					return kind !== 'translated' && kind !== 'same';
				});
				if (list.length === 0) continue;
				missing[target] = list;
				any = true;
				plan.sentences += list.length;
				plan.characters += list.reduce((n, s) => n + s.masked.length, 0);
				plan.requests += Math.ceil(list.length / batch);
			}
			if (any) plan.notes.push({ file, note, missing });
			if (token !== this.planToken) return;
		}
		if (token !== this.planToken) return;
		this.plan = plan;
		this.renderSummary(plan);
	}

	private renderSummary(plan: Plan): void {
		const el = this.summaryEl;
		el.empty();
		if (plan.notes.length === 0) {
			el.createEl('p', { text: t('bulk.nothing') });
			return;
		}
		const s = this.plugin.settings;
		const estimate = estimateCost({
			characters: plan.characters,
			languages: 1,
			requests: plan.requests,
			charsPerToken: s.charsPerToken,
			inputPrice: s.inputPrice,
			outputPrice: s.outputPrice,
		});
		const fmt = (n: number) => n.toLocaleString();
		el.createEl('p', { text: t('bulk.summary', { notes: fmt(plan.notes.length), sentences: fmt(plan.sentences) }) });
		el.createEl('p', { text: t('bulk.tokens', { input: fmt(estimate.inputTokens), output: fmt(estimate.outputTokens) }) });
		el.createEl('p', {
			text: estimate.cost !== undefined ? t('bulk.cost', { cost: estimate.cost < 0.01 ? '0.01' : estimate.cost.toFixed(2) }) : t('bulk.no-price'),
			cls: estimate.cost !== undefined ? 'tt-bulk-cost' : 'tt-bulk-hint',
		});
		this.startButton?.removeAttribute('disabled');
	}

	private async run(plan: Plan): Promise<void> {
		const plugin = this.plugin;
		const controller = new AbortController();
		const total = plan.notes.length;
		let done = 0;
		let failed = 0;
		const notice = new Notice('', 0);
		const update = () =>
			notice.setMessage(
				createFragment((frag) => {
					frag.createSpan({ text: `${t('bulk.progress', { done, total })} ` });
					const stop = frag.createEl('button', { cls: 'tt-notice-undo', text: t('bulk.stop') });
					stop.addEventListener('click', () => controller.abort());
				}),
			);
		update();
		for (const { file, note, missing } of plan.notes) {
			if (controller.signal.aborted) break;
			for (const target of Object.keys(missing) as TargetLanguage[]) {
				if (controller.signal.aborted) break;
				const outcome = await plugin.service.translate(file.path, note, missing[target] ?? [], target, plugin.noteTitle(file.path), controller.signal);
				failed += outcome.failed;
			}
			done++;
			update();
		}
		notice.hide();
		new Notice(controller.signal.aborted ? t('bulk.cancelled', { done }) : t('bulk.done', { notes: done, failed }), 8000);
	}
}
