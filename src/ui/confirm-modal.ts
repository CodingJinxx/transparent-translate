import { Modal, Setting, type App } from 'obsidian';

export interface ConfirmOptions {
	title: string;
	body: string;
	confirm: string;
	cancel: string;
	warning?: boolean;
}

/** A small yes/no modal. `ask()` resolves to true only when confirmed. */
export class ConfirmModal extends Modal {
	private resolve: (value: boolean) => void = () => {};
	private decided = false;

	constructor(
		app: App,
		private readonly options: ConfirmOptions,
	) {
		super(app);
	}

	ask(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	override onOpen(): void {
		this.setTitle(this.options.title);
		this.contentEl.createEl('p', { text: this.options.body });
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(this.options.cancel).onClick(() => {
					this.decide(false);
				}),
			)
			.addButton((button) => {
				button.setButtonText(this.options.confirm).onClick(() => this.decide(true));
				if (this.options.warning) button.setWarning();
				else button.setCta();
			});
	}

	private decide(value: boolean): void {
		this.decided = true;
		this.resolve(value);
		this.close();
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.resolve(false);
	}
}
