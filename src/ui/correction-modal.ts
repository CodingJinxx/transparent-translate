import { FuzzySuggestModal, Modal, Notice, Setting, type TextComponent } from 'obsidian';
import { parseScopeKey } from '../core/glossary-format';
import { scopeChoices, wordsOf } from '../core/glossary-match';
import type { Sentence, TargetLanguage } from '../core/types';
import { t } from '../i18n';
import type TransparentTranslatePlugin from '../main';
import { scopeLabel, scopeValue } from './glossary-labels';

export interface CorrectionRequest {
	path: string;
	sentence: Sentence;
	/** The translation as it is shown now. */
	translation: string;
	target: TargetLanguage;
}

/** Notice with an Undo button for the last glossary change. */
export function glossaryNotice(plugin: TransparentTranslatePlugin, message: string): void {
	const notice = new Notice('', 10000);
	notice.setMessage(
		createFragment((frag) => {
			frag.createSpan({ text: `${message} ` });
			const undo = frag.createEl('button', { cls: 'tt-notice-undo', text: t('notice.undo') });
			undo.addEventListener('click', () => {
				plugin.glossary.undo();
				notice.hide();
			});
		}),
	);
}

/**
 * "Fix translation": select the term in the original, say what it should be
 * (or which translations are wrong) and where that applies. The change goes
 * into the glossary; the note file is never touched.
 */
export class CorrectionModal extends Modal {
	private term = '';
	private replacement = '';
	private hint = '';
	private scopeKey = '';
	private range: [number, number] | null = null;
	private readonly avoided = new Set<number>();
	private termInput: TextComponent | null = null;
	private termWords: string[];
	private translationWords: string[];

	constructor(
		private readonly plugin: TransparentTranslatePlugin,
		private readonly request: CorrectionRequest,
	) {
		super(plugin.app);
		this.termWords = wordsOf(request.sentence.masked);
		this.translationWords = wordsOf(request.translation);
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t('correction.title'));
		contentEl.addClass('tt-correction');

		const quote = (label: string, text: string) => {
			const block = contentEl.createDiv({ cls: 'tt-correction-block' });
			block.createDiv({ cls: 'tt-correction-label', text: label });
			block.createDiv({ cls: 'tt-correction-text', text });
		};
		quote(t('correction.original'), this.request.sentence.text);
		quote(t('correction.translation'), this.request.translation);

		contentEl.createDiv({ cls: 'tt-correction-label', text: t('correction.select-term') });
		const chips = contentEl.createDiv({ cls: 'tt-chips' });
		const termButtons = this.termWords.map((word, index) => {
			const chip = chips.createEl('button', { cls: 'tt-chip', text: word });
			chip.addEventListener('click', () => this.pickTermWord(index, termButtons));
			return chip;
		});
		new Setting(contentEl)
			.setName(t('correction.term'))
			.addText((text) => {
				this.termInput = text;
				text.onChange((value) => {
					this.term = value;
				});
			});
		new Setting(contentEl)
			.setName(t('correction.should-be'))
			.setDesc(t('correction.should-be.desc'))
			.addText((text) => text.onChange((value) => (this.replacement = value)));

		contentEl.createDiv({ cls: 'tt-correction-label', text: t('correction.wrong-words') });
		const wrong = contentEl.createDiv({ cls: 'tt-chips' });
		this.translationWords.forEach((word, index) => {
			const chip = wrong.createEl('button', { cls: 'tt-chip', text: word });
			chip.addEventListener('click', () => {
				if (this.avoided.has(index)) this.avoided.delete(index);
				else this.avoided.add(index);
				chip.toggleClass('is-selected', this.avoided.has(index));
			});
		});

		const ctx = this.plugin.noteContext(this.request.path);
		const choices = scopeChoices(ctx);
		this.scopeKey = scopeValue(choices[0] ?? {});
		new Setting(contentEl)
			.setName(t('correction.scope'))
			.setDesc(t('correction.scope.desc'))
			.addDropdown((dropdown) => {
				for (const scope of choices) dropdown.addOption(scopeValue(scope), scopeLabel(scope));
				dropdown.setValue(this.scopeKey).onChange((value) => (this.scopeKey = value));
			});
		new Setting(contentEl).setName(t('correction.hint')).addText((text) => text.setPlaceholder(t('correction.hint.placeholder')).onChange((value) => (this.hint = value)));

		if (!this.plugin.service.canTranslate) contentEl.createEl('p', { cls: 'setting-item-description', text: t('correction.mobile-note') });

		new Setting(contentEl)
			.addButton((button) => button.setButtonText(t('correction.cancel')).onClick(() => this.close()))
			.addButton((button) => button.setButtonText(t('correction.save')).setCta().onClick(() => this.save()));
	}

	/** Click selects a word; clicking next to the selection extends it to a phrase. */
	private pickTermWord(index: number, buttons: HTMLButtonElement[]): void {
		const range = this.range;
		if (range && index === range[1] + 1) this.range = [range[0], index];
		else if (range && index === range[0] - 1) this.range = [index, range[1]];
		else if (range && range[0] === range[1] && range[0] === index) this.range = null;
		else this.range = [index, index];
		buttons.forEach((button, i) => button.toggleClass('is-selected', this.range !== null && i >= this.range[0] && i <= this.range[1]));
		this.term = this.range ? this.termWords.slice(this.range[0], this.range[1] + 1).join(' ') : '';
		this.termInput?.setValue(this.term);
	}

	private save(): void {
		const term = this.term.trim();
		const to = this.replacement.trim();
		const avoid = [...this.avoided].sort((a, b) => a - b).map((i) => this.translationWords[i]!);
		if (!term) {
			new Notice(t('correction.need-term'));
			return;
		}
		if (!to && avoid.length === 0) {
			new Notice(t('correction.need-change'));
			return;
		}
		const scope = parseScopeKey(this.scopeKey);
		const { target } = this.request;
		const hint = this.hint.trim();
		this.plugin.glossary.batch(() => {
			if (to) this.plugin.glossary.upsert({ kind: 'map', src: term, target, to, scope, ...(hint ? { hint } : {}) });
			if (avoid.length > 0) this.plugin.glossary.upsert({ kind: 'avoid', src: term, target, avoid, scope });
		});
		this.close();
		glossaryNotice(this.plugin, t('correction.saved', { term }));
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Pick one of the translated sentences of a note to correct (keyboard and mobile path). */
export class FixSentenceModal extends FuzzySuggestModal<CorrectionRequest> {
	constructor(
		plugin: TransparentTranslatePlugin,
		private readonly items: CorrectionRequest[],
		private readonly onChoose: (item: CorrectionRequest) => void,
	) {
		super(plugin.app);
		this.setPlaceholder(t('correction.choose-sentence'));
	}

	getItems(): CorrectionRequest[] {
		return this.items;
	}

	getItemText(item: CorrectionRequest): string {
		return `${item.translation}  ←  ${item.sentence.text}`;
	}

	onChooseItem(item: CorrectionRequest): void {
		this.onChoose(item);
	}
}
