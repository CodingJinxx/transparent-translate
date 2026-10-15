import { SuggestModal, type App } from 'obsidian';
import type { ReplacedOriginal } from '../core/cache-format';
import { t } from '../i18n';

/** Lets the user pick a replaced original (newest first). */
export class RestoreOriginalModal extends SuggestModal<ReplacedOriginal> {
	constructor(
		app: App,
		private readonly items: readonly ReplacedOriginal[],
		private readonly onChoose: (item: ReplacedOriginal) => void,
	) {
		super(app);
		this.setPlaceholder(t('restore.placeholder'));
	}

	getSuggestions(query: string): ReplacedOriginal[] {
		const q = query.toLowerCase();
		return [...this.items].reverse().filter((item) => item.text.toLowerCase().includes(q));
	}

	renderSuggestion(item: ReplacedOriginal, el: HTMLElement): void {
		const date = new Date(item.at);
		const when = Number.isNaN(date.getTime()) ? item.at : date.toLocaleString();
		el.createDiv({ text: item.text, cls: 'tt-restore-text' });
		el.createEl('small', { text: when, cls: 'tt-restore-date' });
	}

	onChooseSuggestion(item: ReplacedOriginal): void {
		this.onChoose(item);
	}
}
