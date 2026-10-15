import { Component, MarkdownRenderer, Modal, Platform, Setting, type DropdownComponent } from 'obsidian';
import { splitGuide, type GuideSection } from '../core/guide';
import guideDe from '../../docs/guide.de.md';
import guideEn from '../../docs/guide.en.md';
import { currentLanguage, t } from '../i18n';
import type TransparentTranslatePlugin from '../main';

const REPOSITORY = 'https://github.com/CodingJinxx/transparent-translate#readme';

/** The user guide (docs/guide.*.md, bundled with the plugin) with a section list on the side. */
export class GuideModal extends Modal {
	private readonly sections: GuideSection[];
	private index = 0;
	private readonly component = new Component();
	private navEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private footerEl!: HTMLElement;
	/** On phones the section list is a dropdown: there is no room for a side list. */
	private dropdown: DropdownComponent | null = null;

	constructor(plugin: TransparentTranslatePlugin) {
		super(plugin.app);
		this.sections = splitGuide(currentLanguage() === 'de' ? guideDe : guideEn);
	}

	override onOpen(): void {
		this.component.load();
		this.setTitle(t('guide.title'));
		this.modalEl.addClass('tt-guide-modal');
		const layout = this.contentEl.createDiv({ cls: 'tt-guide' });
		this.navEl = layout.createDiv({ cls: 'tt-guide-nav' });
		const main = layout.createDiv({ cls: 'tt-guide-main' });
		this.bodyEl = main.createDiv({ cls: 'tt-guide-body markdown-rendered' });
		this.footerEl = main.createDiv({ cls: 'tt-guide-footer' });

		if (Platform.isMobile) {
			new Setting(this.navEl).addDropdown((dropdown) => {
				this.dropdown = dropdown;
				this.sections.forEach((section, i) => {
					dropdown.addOption(String(i), section.title);
				});
				dropdown.onChange((value) => void this.show(Number(value)));
			});
		} else {
			this.sections.forEach((section, i) => {
				const button = this.navEl.createEl('button', { cls: 'tt-guide-nav-item', text: section.title });
				button.addEventListener('click', () => void this.show(i));
			});
		}
		void this.show(0);
	}

	private async show(index: number): Promise<void> {
		this.index = Math.max(0, Math.min(index, this.sections.length - 1));
		const section = this.sections[this.index];
		if (!section) return;
		this.navEl.querySelectorAll('.tt-guide-nav-item').forEach((el, i) => el.toggleClass('is-active', i === this.index));
		this.dropdown?.setValue(String(this.index));

		this.bodyEl.empty();
		this.bodyEl.createEl('h2', { text: section.title });
		await MarkdownRenderer.render(this.app, section.body, this.bodyEl, '', this.component);
		this.bodyEl.scrollTo({ top: 0 });

		this.footerEl.empty();
		new Setting(this.footerEl)
			.addButton((button) => button.setButtonText(t('guide.previous')).setDisabled(this.index === 0).onClick(() => void this.show(this.index - 1)))
			.addButton((button) =>
				button
					.setButtonText(t('guide.next'))
					.setCta()
					.setDisabled(this.index === this.sections.length - 1)
					.onClick(() => void this.show(this.index + 1)),
			);
		this.footerEl.createEl('a', { text: t('guide.online'), href: REPOSITORY, cls: 'tt-guide-online' });
	}

	override onClose(): void {
		this.component.unload();
		this.contentEl.empty();
	}
}
