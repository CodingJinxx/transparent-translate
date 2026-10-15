import { normalizePath, Notice, PluginSettingTab, SecretComponent, Setting, type App } from 'obsidian';
import { cleanFolder } from '../core/paths';
import type { DisplayMode } from '../core/types';
import { t } from '../i18n';
import type TransparentTranslatePlugin from '../main';
import { addExcludedFolder, canEditExcludedFiles, isFolderExcluded } from '../obsidian/internals';
import { DEFAULT_SETTINGS, type ConfirmDelete, type EditSessionDefault } from '../settings';
import { GlossaryModal } from './glossary-modal';
import { PROVIDER_PRESETS, presetById, type ProviderPresetId } from '../translator/providers';
import { parseExtraBody } from '../translator/llm-translator';

/** Number setting helper: ignores input that is not a finite number in range. */
function numberInput(value: string, min: number, max: number): number | null {
	const n = Number(value);
	return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/**
 * Settings tab. The declarative settings API (getSettingDefinitions, used for
 * settings search) needs Obsidian 1.13; this plugin supports 1.11.4 and later,
 * so it keeps the classic display() API for now.
 */
export class TransparentTranslateSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TransparentTranslatePlugin,
	) {
		super(app, plugin);
	}

	private get settings() {
		return this.plugin.settings;
	}

	private async save(refreshViews = false): Promise<void> {
		await this.plugin.saveSettings();
		if (refreshViews) this.plugin.refreshAllViews();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('tt-settings');

		if (this.plugin.isMobile) {
			containerEl.createEl('p', { cls: 'setting-item-description', text: t('settings.mobile-note') });
		}

		this.displaySection();
		if (!this.plugin.isMobile) {
			this.providerSection();
			this.translationSection();
			this.editingSection();
		}
		this.glossarySection();
		this.foldersSection();
		if (!this.plugin.isMobile) this.costSection();
		this.advancedSection();
	}

	private displaySection(): void {
		const el = this.containerEl;
		new Setting(el)
			.setName(t('settings.default-mode'))
			.setDesc(t('settings.default-mode.desc'))
			.addDropdown((d) =>
				d
					.addOption('original', t('mode.original'))
					.addOption('en', t('mode.en'))
					.addOption('de', t('mode.de'))
					.setValue(this.settings.defaultMode)
					.onChange(async (value) => {
						this.settings.defaultMode = value as DisplayMode;
						await this.save();
					}),
			);
		new Setting(el)
			.setName(t('settings.live-preview'))
			.setDesc(t('settings.live-preview.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.livePreview).onChange(async (value) => {
					this.settings.livePreview = value;
					await this.save(true);
				}),
			);
		new Setting(el)
			.setName(t('settings.animate'))
			.setDesc(t('settings.animate.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.animateTranslations).onChange(async (value) => {
					this.settings.animateTranslations = value;
					await this.save();
				}),
			);
		new Setting(el)
			.setName(t('settings.name-mode'))
			.setDesc(t('settings.name-mode.desc'))
			.addDropdown((d) =>
				d
					.addOption('original', t('mode.original'))
					.addOption('en', t('mode.en'))
					.addOption('de', t('mode.de'))
					.setValue(this.settings.nameMode)
					.onChange((value) => this.plugin.setNameMode(value as DisplayMode)),
			);
		new Setting(el)
			.setName(t('settings.name-attachments'))
			.setDesc(t('settings.name-attachments.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.nameIncludeAttachments).onChange(async (value) => {
					this.settings.nameIncludeAttachments = value;
					await this.save(true);
				}),
			);
		if (!this.plugin.isMobile) {
			new Setting(el)
				.setName(t('settings.status-bar'))
				.setDesc(t('settings.status-bar.desc'))
				.addToggle((toggle) =>
					toggle.setValue(this.settings.statusBar).onChange(async (value) => {
						this.settings.statusBar = value;
						if (value) this.plugin.createStatusBar();
						else this.plugin.removeStatusBar();
						await this.save();
					}),
				);
		}
	}

	private providerSection(): void {
		const el = this.containerEl;
		new Setting(el).setName(t('settings.heading.provider')).setHeading();
		el.createEl('p', { cls: 'setting-item-description tt-privacy', text: t('settings.privacy') });

		let baseUrlInput: { setValue(v: string): unknown } | null = null;
		const preset = presetById(this.settings.providerPreset);

		new Setting(el)
			.setName(t('settings.preset'))
			.setDesc(t('settings.preset.desc'))
			.addDropdown((d) => {
				for (const p of PROVIDER_PRESETS) d.addOption(p.id, p.label);
				d.setValue(this.settings.providerPreset).onChange(async (value) => {
					const next = presetById(value);
					this.settings.providerPreset = value as ProviderPresetId;
					if (next.baseUrl) {
						this.settings.baseUrl = next.baseUrl;
						baseUrlInput?.setValue(next.baseUrl);
					}
					await this.save();
					this.display();
				});
			});

		new Setting(el)
			.setName(t('settings.base-url'))
			.setDesc(t('settings.base-url.desc'))
			.addText((text) => {
				baseUrlInput = text;
				text
					.setPlaceholder(preset.baseUrl || 'https://…/v1')
					.setValue(this.settings.baseUrl)
					.onChange(async (value) => {
						this.settings.baseUrl = value.trim();
						await this.save();
					});
				text.inputEl.addClass('tt-wide-input');
			});

		// Build the setting first: its callbacks below need `modelSetting` to exist.
		const modelSetting = new Setting(el).setName(t('settings.model')).setDesc(t('settings.model.desc'));
		modelSetting.controlEl.addClass('tt-model-control');
		modelSetting.addText((text) => {
			text
				.setPlaceholder(preset.modelHint)
				.setValue(this.settings.model)
				.onChange(async (value) => {
					this.settings.model = value.trim();
					await this.save();
				});
			const fetchButton = modelSetting.controlEl.createEl('button', { text: t('settings.fetch-models') });
			fetchButton.addEventListener('click', () => void this.fetchModels(fetchButton, modelSetting.controlEl, (id) => {
				text.setValue(id);
			}));
		});

		new Setting(el)
			.setName(t('settings.api-key'))
			.setDesc(t('settings.api-key.desc'))
			.addComponent((controlEl) =>
				new SecretComponent(this.app, controlEl).setValue(this.settings.apiKeySecret).onChange(async (value) => {
					this.settings.apiKeySecret = value;
					await this.save();
				}),
			);

		const testSetting = new Setting(el).setName(t('settings.test')).setDesc(t('settings.test.desc'));
		const result = testSetting.descEl.createDiv({ cls: 'tt-test-result' });
		testSetting.addButton((button) =>
			button.setButtonText(t('settings.test.button')).onClick(async () => {
				if (!this.plugin.translator) return;
				button.setDisabled(true);
				result.removeClass('mod-success', 'mod-warning');
				result.setText(t('settings.test.running'));
				try {
					const r = await this.plugin.translator.testConnection();
					result.addClass('mod-success');
					result.setText(t('settings.test.ok', { text: r.text, ms: r.ms, input: r.usage.inputTokens, output: r.usage.outputTokens }));
				} catch (error) {
					result.addClass('mod-warning');
					result.setText(t('settings.test.failed', { error: (error as Error).message }));
				} finally {
					button.setDisabled(false);
				}
			}),
		);


		new Setting(el)
			.setName(t('settings.json-mode'))
			.setDesc(t('settings.json-mode.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.jsonMode).onChange(async (value) => {
					this.settings.jsonMode = value;
					await this.save();
				}),
			);
		new Setting(el)
			.setName(t('settings.temperature'))
			.setDesc(t('settings.temperature.desc'))
			.addText((text) =>
				text.setValue(String(this.settings.temperature)).onChange(async (value) => {
					const n = numberInput(value, 0, 2);
					if (n === null) return;
					this.settings.temperature = n;
					await this.save();
				}),
			);
		new Setting(el)
			.setName(t('settings.max-tokens'))
			.setDesc(t('settings.max-tokens.desc'))
			.addText((text) =>
				text.setValue(String(this.settings.maxTokens)).onChange(async (value) => {
					const n = numberInput(value, 0, 1_000_000);
					if (n === null) return;
					this.settings.maxTokens = Math.round(n);
					await this.save();
				}),
			);
		new Setting(el)
			.setName(t('settings.extra-headers'))
			.setDesc(t('settings.extra-headers.desc'))
			.addTextArea((area) =>
				area
					.setPlaceholder('HTTP-Referer: https://example.com')
					.setValue(this.settings.extraHeaders)
					.onChange(async (value) => {
						this.settings.extraHeaders = value;
						await this.save();
					}),
			);
		const extraBody = new Setting(el).setName(t('settings.extra-body')).setDesc(t('settings.extra-body.desc'));
		const extraBodyError = extraBody.descEl.createDiv({ cls: 'tt-input-error' });
		extraBody.addTextArea((area) =>
			area
				.setPlaceholder('{"reasoning_effort": "low"}')
				.setValue(this.settings.extraBody)
				.onChange(async (value) => {
					if (parseExtraBody(value) === null) {
						extraBodyError.setText(t('settings.extra-body.invalid'));
						return;
					}
					extraBodyError.setText('');
					this.settings.extraBody = value;
					await this.save();
				}),
		);

		this.numberSetting(t('settings.timeout'), '', 'timeoutSeconds', 5, 600);
		this.numberSetting(t('settings.concurrency'), '', 'concurrency', 1, 10);
		this.numberSetting(t('settings.retries'), t('settings.retries.desc'), 'maxRetries', 0, 10);
		this.numberSetting(t('settings.batch-size'), '', 'batchSize', 1, 200);
	}

	/** Fills a dropdown next to the model field from `GET /models`. The text field keeps working without it. */
	private async fetchModels(button: HTMLButtonElement, controlEl: HTMLElement, setText: (id: string) => void): Promise<void> {
		if (!this.plugin.translator) return;
		button.setText(t('settings.fetch-models.loading'));
		button.disabled = true;
		try {
			const models = await this.plugin.translator.listModels();
			if (models.length === 0) {
				new Notice(t('settings.fetch-models.none'));
				return;
			}
			controlEl.querySelector('select.tt-model-select')?.remove();
			const select = controlEl.createEl('select', { cls: 'dropdown tt-model-select' });
			select.createEl('option', { text: t('settings.fetch-models.choose'), value: '' });
			for (const id of models) select.createEl('option', { text: id, value: id });
			select.value = models.includes(this.settings.model) ? this.settings.model : '';
			select.addEventListener('change', () => {
				if (!select.value) return;
				this.settings.model = select.value;
				setText(select.value);
				void this.save();
			});
		} catch (error) {
			new Notice(t('settings.fetch-models.failed', { error: (error as Error).message }));
		} finally {
			button.setText(t('settings.fetch-models'));
			button.disabled = false;
		}
	}

	private numberSetting(
		name: string,
		desc: string,
		key: 'timeoutSeconds' | 'concurrency' | 'maxRetries' | 'batchSize' | 'typingIdleMs' | 'pruneAfterDays' | 'charsPerToken' | 'inputPrice' | 'outputPrice',
		min: number,
		max: number,
		integer = true,
	): void {
		const setting = new Setting(this.containerEl).setName(name);
		if (desc) setting.setDesc(desc);
		setting.addText((text) => {
			text.inputEl.type = 'number';
			text.inputEl.addClass('tt-number-input');
			text.setPlaceholder(String(DEFAULT_SETTINGS[key]))
				.setValue(String(this.settings[key]))
				.onChange(async (value) => {
					const n = numberInput(value, min, max);
					if (n === null) return;
					this.settings[key] = integer ? Math.round(n) : n;
					await this.save();
				});
		});
	}

	private translationSection(): void {
		const el = this.containerEl;
		new Setting(el).setName(t('settings.heading.translation')).setHeading();
		new Setting(el)
			.setName(t('settings.glossary'))
			.setDesc(t('settings.glossary.desc'))
			.addTextArea((area) => {
				area.setPlaceholder('Karel')
					.setValue(this.settings.glossary)
					.onChange(async (value) => {
						this.settings.glossary = value;
						await this.save();
					});
				area.inputEl.rows = 5;
			});
		new Setting(el)
			.setName(t('settings.wikilink-aliases'))
			.setDesc(t('settings.wikilink-aliases.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.translateWikilinkAliases).onChange(async (value) => {
					this.settings.translateWikilinkAliases = value;
					await this.save(true);
				}),
			);
		new Setting(el)
			.setName(t('settings.abbreviations'))
			.setDesc(t('settings.abbreviations.desc'))
			.addTextArea((area) => {
				area.setValue(this.settings.abbreviations).onChange(async (value) => {
					this.settings.abbreviations = value;
					await this.save(true);
				});
				area.inputEl.rows = 6;
			});
		this.numberSetting(t('settings.idle'), t('settings.idle.desc'), 'typingIdleMs', 200, 10_000);
	}

	private editingSection(): void {
		const el = this.containerEl;
		new Setting(el).setName(t('settings.heading.editing')).setHeading();
		new Setting(el).setName(t('settings.session-default')).addDropdown((d) =>
			d
				.addOption('ask', t('settings.session-default.ask'))
				.addOption('replace', t('settings.session-default.replace'))
				.addOption('original', t('settings.session-default.original'))
				.setValue(this.settings.editSessionDefault)
				.onChange(async (value) => {
					this.settings.editSessionDefault = value as EditSessionDefault;
					await this.save();
				}),
		);
		new Setting(el)
			.setName(t('settings.apply-on-leave'))
			.setDesc(t('settings.apply-on-leave.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.applyOnLeave).onChange(async (value) => {
					this.settings.applyOnLeave = value;
					await this.save();
				}),
			);
		new Setting(el).setName(t('settings.confirm-delete')).addDropdown((d) =>
			d
				.addOption('off', t('settings.confirm-delete.off'))
				.addOption('translated', t('settings.confirm-delete.translated'))
				.setValue(this.settings.confirmDelete)
				.onChange(async (value) => {
					this.settings.confirmDelete = value as ConfirmDelete;
					await this.save();
				}),
		);
		const count = Object.keys(this.settings.noteEditPreferences).length;
		if (count > 0) {
			new Setting(el)
				.setName(t('settings.reset-note-prefs'))
				.setDesc(t('settings.reset-note-prefs.desc', { count }))
				.addButton((button) =>
					button.setButtonText(t('settings.reset-note-prefs.button')).onClick(async () => {
						this.settings.noteEditPreferences = {};
						await this.save();
						this.display();
					}),
				);
		}
	}

	private glossarySection(): void {
		const el = this.containerEl;
		new Setting(el).setName(t('settings.heading.glossary')).setHeading();
		el.createEl('p', { cls: 'setting-item-description', text: t('settings.glossary-intro') });
		new Setting(el)
			.setName(t('settings.glossary-manage'))
			.setDesc(t('settings.glossary-manage.desc'))
			.addButton((button) => button.setButtonText(t('settings.glossary-manage.button')).setCta().onClick(() => new GlossaryModal(this.plugin).open()));
		let pendingFile = this.settings.glossaryFile;
		new Setting(el)
			.setName(t('settings.glossary-file'))
			.setDesc(t('settings.glossary-file.desc'))
			.addText((text) => text.setValue(this.settings.glossaryFile).onChange((value) => (pendingFile = value)))
			.addButton((button) =>
				button.setButtonText(t('settings.glossary-file.apply')).onClick(async () => {
					const next = normalizePath(pendingFile.trim());
					if (!next || next === this.settings.glossaryFile) return;
					await this.plugin.glossary.flush();
					this.settings.glossaryFile = next.endsWith('.md') ? next : `${next}.md`;
					this.plugin.glossary.reset();
					await this.save(true);
					await this.plugin.glossary.load();
					this.display();
				}),
			);
		if (!this.plugin.isMobile) {
			new Setting(el)
				.setName(t('settings.glossary-auto'))
				.setDesc(t('settings.glossary-auto.desc'))
				.addToggle((toggle) =>
					toggle.setValue(this.settings.glossaryAutoUpdate).onChange(async (value) => {
						this.settings.glossaryAutoUpdate = value;
						await this.save(true);
					}),
				);
		}
	}

	private foldersSection(): void {
		const el = this.containerEl;
		new Setting(el).setName(t('settings.heading.folders')).setHeading();
		new Setting(el)
			.setName(t('settings.excluded'))
			.setDesc(t('settings.excluded.desc'))
			.addTextArea((area) =>
				area
					.setPlaceholder('Private')
					.setValue(this.settings.excludedFolders)
					.onChange(async (value) => {
						this.settings.excludedFolders = value;
						await this.save(true);
					}),
			);
		new Setting(el)
			.setName(t('settings.include-only'))
			.setDesc(t('settings.include-only.desc'))
			.addTextArea((area) =>
				area.setValue(this.settings.includeOnlyFolders).onChange(async (value) => {
					this.settings.includeOnlyFolders = value;
					await this.save(true);
				}),
			);

		let pendingFolder = this.settings.cacheFolder;
		new Setting(el)
			.setName(t('settings.cache-folder'))
			.setDesc(t('settings.cache-folder.desc'))
			.addText((text) =>
				text.setValue(this.settings.cacheFolder).onChange((value) => {
					pendingFolder = value;
				}),
			)
			.addButton((button) =>
				button.setButtonText(t('settings.cache-folder.apply')).onClick(async () => {
					await this.moveCacheFolder(pendingFolder);
					this.display();
				}),
			);

		if (canEditExcludedFiles(this.app)) {
			const excluded = isFolderExcluded(this.app, this.settings.cacheFolder);
			new Setting(el)
				.setName(t('settings.exclude-cache'))
				.setDesc(t('settings.exclude-cache.desc'))
				.addButton((button) => {
					button.setButtonText(excluded ? t('settings.exclude-cache.done') : t('settings.exclude-cache.button'));
					if (excluded) button.setDisabled(true);
					else
						button.setCta().onClick(() => {
							addExcludedFolder(this.app, this.settings.cacheFolder);
							new Notice(t('notice.exclusion-added', { folder: this.settings.cacheFolder }));
							this.display();
						});
				});
		}
	}

	private async moveCacheFolder(value: string): Promise<void> {
		const next = cleanFolder(value) ? normalizePath(cleanFolder(value)) : '';
		const current = this.settings.cacheFolder;
		if (!next || next === current) return;
		if (this.app.vault.getAbstractFileByPath(next)) {
			new Notice(t('notice.cache-folder-exists', { folder: next }));
			return;
		}
		try {
			await this.plugin.store.flush();
			await this.plugin.nameStore.flush();
			const folder = this.app.vault.getFolderByPath(current);
			if (folder) {
				const parent = next.includes('/') ? next.slice(0, next.lastIndexOf('/')) : '';
				if (parent && !this.app.vault.getFolderByPath(parent)) await this.app.vault.createFolder(parent);
				await this.app.fileManager.renameFile(folder, next);
			}
			this.plugin.store.reset();
			this.plugin.nameStore.reset();
			this.plugin.names.reset();
			this.settings.cacheFolder = next;
			await this.save(true);
			new Notice(t('notice.cache-moved', { folder: next }));
		} catch (error) {
			new Notice(t('notice.cache-move-failed', { error: (error as Error).message }));
		}
	}

	private costSection(): void {
		const el = this.containerEl;
		new Setting(el).setName(t('settings.heading.cost')).setHeading();
		el.createEl('p', { cls: 'setting-item-description', text: t('settings.cost.desc') });
		this.numberSetting(t('settings.input-price'), '', 'inputPrice', 0, 10_000, false);
		this.numberSetting(t('settings.output-price'), '', 'outputPrice', 0, 10_000, false);
		this.numberSetting(t('settings.chars-per-token'), '', 'charsPerToken', 1, 20, false);
	}

	private advancedSection(): void {
		const el = this.containerEl;
		new Setting(el).setName(t('settings.heading.advanced')).setHeading();
		new Setting(el)
			.setName(t('settings.prune'))
			.setDesc(t('settings.prune.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.pruneCache).onChange(async (value) => {
					this.settings.pruneCache = value;
					await this.save();
				}),
			)
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.addClass('tt-number-input');
				text.setValue(String(this.settings.pruneAfterDays)).onChange(async (value) => {
					const n = numberInput(value, 0, 3650);
					if (n === null) return;
					this.settings.pruneAfterDays = Math.round(n);
					await this.save();
				});
			});
		new Setting(el)
			.setName(t('settings.debug'))
			.setDesc(t('settings.debug.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.debugLogging).onChange(async (value) => {
					this.settings.debugLogging = value;
					await this.save();
				}),
			);
	}
}
