import { Modal, Notice, Setting } from 'obsidian';
import { parseScopeKey } from '../core/glossary-format';
import { scopeChoices } from '../core/glossary-match';
import type { ReviewTerm } from '../core/term-review';
import type { TargetLanguage } from '../core/types';
import { t } from '../i18n';
import type TransparentTranslatePlugin from '../main';
import { glossaryNotice } from './correction-modal';
import { scopeLabel, scopeValue } from './glossary-labels';

interface Decision {
	/** `skip`, `chosen`, `alt:<n>`, `custom` or `keep`. */
	choice: string;
	custom: string;
}

/**
 * Lists the terms the model was unsure about, with its alternatives. The user
 * settles each one (or skips it); decisions become glossary entries.
 */
export class TermReviewModal extends Modal {
	private readonly decisions: Decision[];
	private scopeKey: string;

	constructor(
		private readonly plugin: TransparentTranslatePlugin,
		private readonly path: string,
		private readonly target: TargetLanguage,
		private readonly terms: ReviewTerm[],
	) {
		super(plugin.app);
		this.decisions = terms.map(() => ({ choice: 'skip', custom: '' }));
		this.scopeKey = scopeValue(scopeChoices(plugin.noteContext(path))[0] ?? {});
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t('review.title'));
		contentEl.createEl('p', { cls: 'setting-item-description', text: t('review.intro') });

		this.terms.forEach((term, index) => {
			const decision = this.decisions[index]!;
			const setting = new Setting(contentEl).setName(`${term.src} → ${term.chosen}`).setDesc(term.why ?? '');
			setting.addDropdown((dropdown) => {
				dropdown.addOption('skip', t('review.skip'));
				dropdown.addOption('chosen', t('review.keep-chosen', { translation: term.chosen }));
				term.alternatives.forEach((alt, i) => {
					dropdown.addOption(`alt:${i}`, alt);
				});
				dropdown.addOption('custom', t('review.custom'));
				dropdown.addOption('keep', t('review.never-translate'));
				dropdown.setValue(decision.choice).onChange((value) => (decision.choice = value));
			});
			setting.addText((text) => text.setPlaceholder(t('review.custom.placeholder')).onChange((value) => (decision.custom = value)));
		});

		const choices = scopeChoices(this.plugin.noteContext(this.path));
		new Setting(contentEl)
			.setName(t('correction.scope'))
			.setDesc(t('correction.scope.desc'))
			.addDropdown((dropdown) => {
				for (const scope of choices) dropdown.addOption(scopeValue(scope), scopeLabel(scope));
				dropdown.setValue(this.scopeKey).onChange((value) => (this.scopeKey = value));
			});
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(t('correction.cancel')).onClick(() => this.close()))
			.addButton((button) => button.setButtonText(t('review.apply')).setCta().onClick(() => this.apply()));
	}

	private apply(): void {
		const scope = parseScopeKey(this.scopeKey);
		const { target } = this;
		let count = 0;
		this.plugin.glossary.batch(() => {
			this.terms.forEach((term, index) => {
				const { choice, custom } = this.decisions[index]!;
				if (choice === 'skip') return;
				if (choice === 'keep') {
					this.plugin.glossary.upsert({ kind: 'keep', src: term.src, target: '*', scope });
					count++;
					return;
				}
				let to = term.chosen;
				if (choice.startsWith('alt:')) to = term.alternatives[Number(choice.slice(4))] ?? term.chosen;
				if (choice === 'custom') to = custom.trim();
				if (!to) return;
				this.plugin.glossary.upsert({ kind: 'map', src: term.src, target, to, scope });
				// Choosing something else also rules out what the translation used before.
				if (to.toLowerCase() !== term.chosen.toLowerCase()) {
					this.plugin.glossary.upsert({ kind: 'avoid', src: term.src, target, avoid: [term.chosen], scope });
				}
				count++;
			});
		});
		this.close();
		if (count === 0) new Notice(t('review.nothing'));
		else glossaryNotice(this.plugin, t('review.applied', { count }));
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
