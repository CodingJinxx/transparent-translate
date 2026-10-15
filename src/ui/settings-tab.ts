import { normalizePath, Notice, PluginSettingTab, SecretComponent, Setting, type App } from 'obsidian';
import { cleanFolder } from '../core/paths';
import type { DisplayMode } from '../core/types';
import { t } from '../i18n';
import type TransparentTranslatePlugin from '../main';
import { addExcludedFolder, canEditExcludedFiles, isFolderExcluded } from '../obsidian/internals';
import { DEFAULT_SETTINGS, type ConfirmDelete, type EditSessionDefault } from '../settings';
import { GlossaryModal } from './glossary-modal';
import { GuideModal } from './guide-modal';
import { PROVIDER_PRESETS, presetById, type ProviderPresetId } from '../translator/providers';
import { parseExtraBody } from '../translator/llm-translator';

/** Number setting helper: ignores input that is not a finite number in range. */
function numberInput(value: string, min: number, max: number): number | null {
	const n = Number(value);
	return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** One row of the tab: name and description (also what settings search indexes) and how to fill the row. */
interface SettingsRow {
	name: string;
	desc?: string;
	build: (setting: Setting) => unknown;
}

interface SettingsGroup {
	heading?: string;
	rows: SettingsRow[];
}

/**
 * The part of Obsidian 1.13's declarative settings API this tab uses. The
 * plugin is built against the 1.11.4 typings, which do not know it.
 */
interface DeclarativeGroup {
	type: 'group';
	heading?: string;
	items: { name: string; desc?: string; render: (setting: Setting) => void }[];
}

type NumberKey = 'timeoutSeconds' | 'concurrency' | 'maxRetries' | 'batchSize' | 'typingIdleMs' | 'pruneAfterDays' | 'charsPerToken' | 'inputPrice' | 'outputPrice';

/**
 * Settings tab.
 *
 * The tab is described once, as groups of rows. Obsidian 1.13 and later reads
 * `getSettingDefinitions()` (so the settings show up in its settings search
 * and `display()` is not called); older versions, down to the minimum 1.11.4,
 * call `display()`. Both walk the same rows, so they cannot drift apart.
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

	/** Obsidian 1.13+: the declarative description of the tab. */
	getSettingDefinitions(): DeclarativeGroup[] {
		this.containerEl.addClass('tt-settings');
		return this.groups().map((group) => ({
			type: 'group',
			heading: group.heading,
			items: group.rows.map((row) => ({ name: row.name, desc: row.desc, render: (setting: Setting) => this.fillRow(setting, row) })),
		}));
	}

	/** Obsidian before 1.13 (and direct callers such as the tests). */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('tt-settings');
		for (const group of this.groups()) {
			if (group.heading) new Setting(containerEl).setName(group.heading).setHeading();
			for (const row of group.rows) this.fillRow(new Setting(containerEl), row);
		}
	}

	/** Re-renders after a change that adds or removes rows. `update()` exists from 1.13, where `display()` is not used. */
	private refresh(): void {
		const tab = this as unknown as { update?: () => void };
		if (typeof tab.update === 'function') tab.update();
		else this.display();
	}

	private fillRow(setting: Setting, row: SettingsRow): void {
		setting.setName(row.name);
		if (row.desc) setting.setDesc(row.desc);
		row.build(setting);
	}

	private groups(): SettingsGroup[] {
		const mobile = this.plugin.isMobile;
		const groups: SettingsGroup[] = [this.displayGroup()];
		if (!mobile) groups.push(this.providerGroup(), this.translationGroup(), this.editingGroup());
		groups.push(this.glossaryGroup(), this.foldersGroup());
		if (!mobile) groups.push(this.costGroup());
		groups.push(this.advancedGroup());
		return groups;
	}

	/** A paragraph of text between settings. */
	private note(text: string, cls?: string): SettingsRow {
		return { name: '', desc: text, build: (setting) => cls && setting.settingEl.addClass(cls) };
	}

	private displayGroup(): SettingsGroup {
		const rows: SettingsRow[] = [];
		if (this.plugin.isMobile) rows.push(this.note(t('settings.mobile-note')));
		rows.push({
			name: t('settings.guide'),
			desc: t('settings.guide.desc'),
			build: (s) => s.addButton((button) => button.setButtonText(t('settings.guide.button')).setCta().onClick(() => new GuideModal(this.plugin).open())),
		});
		rows.push({
			name: t('settings.default-mode'),
			desc: t('settings.default-mode.desc'),
			build: (s) =>
				s.addDropdown((d) =>
					d
						.addOption('original', t('mode.original'))
						.addOption('en', t('mode.en'))
						.addOption('de', t('mode.de'))
						.setValue(this.settings.defaultMode)
						.onChange(async (value) => {
							this.settings.defaultMode = value as DisplayMode;
							await this.save();
						}),
				),
		});
		rows.push({
			name: t('settings.live-preview'),
			desc: t('settings.live-preview.desc'),
			build: (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(this.settings.livePreview).onChange(async (value) => {
						this.settings.livePreview = value;
						await this.save(true);
					}),
				),
		});
		rows.push({
			name: t('settings.animate'),
			desc: t('settings.animate.desc'),
			build: (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(this.settings.animateTranslations).onChange(async (value) => {
						this.settings.animateTranslations = value;
						await this.save();
					}),
				),
		});
		rows.push({
			name: t('settings.name-mode'),
			desc: t('settings.name-mode.desc'),
			build: (s) =>
				s.addDropdown((d) =>
					d
						.addOption('original', t('mode.original'))
						.addOption('en', t('mode.en'))
						.addOption('de', t('mode.de'))
						.setValue(this.settings.nameMode)
						.onChange((value) => this.plugin.setNameMode(value as DisplayMode)),
				),
		});
		rows.push({
			name: t('settings.name-attachments'),
			desc: t('settings.name-attachments.desc'),
			build: (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(this.settings.nameIncludeAttachments).onChange(async (value) => {
						this.settings.nameIncludeAttachments = value;
						await this.save(true);
					}),
				),
		});
		if (!this.plugin.isMobile) {
			rows.push({
				name: t('settings.status-bar'),
				desc: t('settings.status-bar.desc'),
				build: (s) =>
					s.addToggle((toggle) =>
						toggle.setValue(this.settings.statusBar).onChange(async (value) => {
							this.settings.statusBar = value;
							if (value) this.plugin.createStatusBar();
							else this.plugin.removeStatusBar();
							await this.save();
						}),
					),
			});
		}
		return { rows };
	}

	private providerGroup(): SettingsGroup {
		let baseUrlInput: { setValue(v: string): unknown } | null = null;
		const preset = presetById(this.settings.providerPreset);
		const rows: SettingsRow[] = [this.note(t('settings.privacy'), 'tt-privacy')];

		rows.push({
			name: t('settings.preset'),
			desc: t('settings.preset.desc'),
			build: (s) =>
				s.addDropdown((d) => {
					for (const p of PROVIDER_PRESETS) d.addOption(p.id, p.label);
					d.setValue(this.settings.providerPreset).onChange(async (value) => {
						const next = presetById(value);
						this.settings.providerPreset = value as ProviderPresetId;
						if (next.baseUrl) {
							this.settings.baseUrl = next.baseUrl;
							baseUrlInput?.setValue(next.baseUrl);
						}
						await this.save();
						this.refresh();
					});
				}),
		});

		rows.push({
			name: t('settings.base-url'),
			desc: t('settings.base-url.desc'),
			build: (s) =>
				s.addText((text) => {
					baseUrlInput = text;
					text
						.setPlaceholder(preset.baseUrl || 'https://…/v1')
						.setValue(this.settings.baseUrl)
						.onChange(async (value) => {
							this.settings.baseUrl = value.trim();
							await this.save();
						});
					text.inputEl.addClass('tt-wide-input');
				}),
		});

		rows.push({
			name: t('settings.model'),
			desc: t('settings.model.desc'),
			build: (modelSetting) => {
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
			},
		});

		rows.push({
			name: t('settings.api-key'),
			desc: t('settings.api-key.desc'),
			build: (s) =>
				s.addComponent((controlEl) =>
					new SecretComponent(this.app, controlEl).setValue(this.settings.apiKeySecret).onChange(async (value) => {
						this.settings.apiKeySecret = value;
						await this.save();
					}),
				),
		});

		rows.push({
			name: t('settings.test'),
			desc: t('settings.test.desc'),
			build: (testSetting) => {
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
			},
		});

		rows.push({
			name: t('settings.json-mode'),
			desc: t('settings.json-mode.desc'),
			build: (s) =>
				s.addToggle((toggle) =>
					toggle.setValue(this.settings.jsonMode).onChange(async (value) => {
						this.settings.jsonMode = value;
						await this.save();
					}),
				),
		});
		rows.push({
			name: t('settings.temperature'),
			desc: t('settings.temperature.desc'),
			build: (s) =>
				s.addText((text) =>
					text.setValue(String(this.settings.temperature)).onChange(async (value) => {
						const n = numberInput(value, 0, 2);
						if (n === null) return;
						this.settings.temperature = n;
						await this.save();
					}),
				),
		});
		rows.push({
			name: t('settings.max-tokens'),
			desc: t('settings.max-tokens.desc'),
			build: (s) =>
				s.addText((text) =>
					text.setValue(String(this.settings.maxTokens)).onChange(async (value) => {
						const n = numberInput(value, 0, 1_000_000);
						if (n === null) return;
						this.settings.maxTokens = Math.round(n);
						await this.save();
					}),
				),
		});
		rows.push({
			name: t('settings.extra-headers'),
			desc: t('settings.extra-headers.desc'),
			build: (s) =>
				s.addTextArea((area) =>
					area
						.setPlaceholder('HTTP-Referer: https://example.com')
						.setValue(this.settings.extraHeaders)
						.onChange(async (value) => {
							this.settings.extraHeaders = value;
							await this.save();
						}),
				),
		});
		rows.push({
			name: t('settings.extra-body'),
			desc: t('settings.extra-body.desc'),
			build: (extraBody) => {
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
			},
		});

		rows.push(this.numberRow(t('settings.timeout'), '', 'timeoutSeconds', 5, 600));
		rows.push(this.numberRow(t('settings.concurrency'), '', 'concurrency', 1, 10));
		rows.push(this.numberRow(t('settings.retries'), t('settings.retries.desc'), 'maxRetries', 0, 10));
		rows.push(this.numberRow(t('settings.batch-size'), '', 'batchSize', 1, 200));
		return { heading: t('settings.heading.provider'), rows };
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

	private numberRow(name: string, desc: string, key: NumberKey, min: number, max: number, integer = true): SettingsRow {
		return {
			name,
			desc: desc || undefined,
			build: (setting) =>
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
				}),
		};
	}

	private translationGroup(): SettingsGroup {
		return {
			heading: t('settings.heading.translation'),
			rows: [
				{
					name: t('settings.glossary'),
					desc: t('settings.glossary.desc'),
					build: (s) =>
						s.addTextArea((area) => {
							area.setPlaceholder('Karel')
								.setValue(this.settings.glossary)
								.onChange(async (value) => {
									this.settings.glossary = value;
									await this.save();
								});
							area.inputEl.rows = 5;
						}),
				},
				{
					name: t('settings.wikilink-aliases'),
					desc: t('settings.wikilink-aliases.desc'),
					build: (s) =>
						s.addToggle((toggle) =>
							toggle.setValue(this.settings.translateWikilinkAliases).onChange(async (value) => {
								this.settings.translateWikilinkAliases = value;
								await this.save(true);
							}),
						),
				},
				{
					name: t('settings.abbreviations'),
					desc: t('settings.abbreviations.desc'),
					build: (s) =>
						s.addTextArea((area) => {
							area.setValue(this.settings.abbreviations).onChange(async (value) => {
								this.settings.abbreviations = value;
								await this.save(true);
							});
							area.inputEl.rows = 6;
						}),
				},
				this.numberRow(t('settings.idle'), t('settings.idle.desc'), 'typingIdleMs', 200, 10_000),
			],
		};
	}

	private editingGroup(): SettingsGroup {
		const rows: SettingsRow[] = [
			{
				name: t('settings.session-default'),
				build: (s) =>
					s.addDropdown((d) =>
						d
							.addOption('ask', t('settings.session-default.ask'))
							.addOption('replace', t('settings.session-default.replace'))
							.addOption('original', t('settings.session-default.original'))
							.setValue(this.settings.editSessionDefault)
							.onChange(async (value) => {
								this.settings.editSessionDefault = value as EditSessionDefault;
								await this.save();
							}),
					),
			},
			{
				name: t('settings.apply-on-leave'),
				desc: t('settings.apply-on-leave.desc'),
				build: (s) =>
					s.addToggle((toggle) =>
						toggle.setValue(this.settings.applyOnLeave).onChange(async (value) => {
							this.settings.applyOnLeave = value;
							await this.save();
						}),
					),
			},
			{
				name: t('settings.confirm-delete'),
				build: (s) =>
					s.addDropdown((d) =>
						d
							.addOption('off', t('settings.confirm-delete.off'))
							.addOption('translated', t('settings.confirm-delete.translated'))
							.setValue(this.settings.confirmDelete)
							.onChange(async (value) => {
								this.settings.confirmDelete = value as ConfirmDelete;
								await this.save();
							}),
					),
			},
		];
		const count = Object.keys(this.settings.noteEditPreferences).length;
		if (count > 0) {
			rows.push({
				name: t('settings.reset-note-prefs'),
				desc: t('settings.reset-note-prefs.desc', { count }),
				build: (s) =>
					s.addButton((button) =>
						button.setButtonText(t('settings.reset-note-prefs.button')).onClick(async () => {
							this.settings.noteEditPreferences = {};
							await this.save();
							this.refresh();
						}),
					),
			});
		}
		return { heading: t('settings.heading.editing'), rows };
	}

	private glossaryGroup(): SettingsGroup {
		let pendingFile = this.settings.glossaryFile;
		const rows: SettingsRow[] = [
			this.note(t('settings.glossary-intro')),
			{
				name: t('settings.glossary-manage'),
				desc: t('settings.glossary-manage.desc'),
				build: (s) => s.addButton((button) => button.setButtonText(t('settings.glossary-manage.button')).setCta().onClick(() => new GlossaryModal(this.plugin).open())),
			},
			{
				name: t('settings.glossary-file'),
				desc: t('settings.glossary-file.desc'),
				build: (s) =>
					s
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
								this.refresh();
							}),
						),
			},
		];
		if (!this.plugin.isMobile) {
			rows.push({
				name: t('settings.glossary-auto'),
				desc: t('settings.glossary-auto.desc'),
				build: (s) =>
					s.addToggle((toggle) =>
						toggle.setValue(this.settings.glossaryAutoUpdate).onChange(async (value) => {
							this.settings.glossaryAutoUpdate = value;
							await this.save(true);
						}),
					),
			});
		}
		return { heading: t('settings.heading.glossary'), rows };
	}

	private foldersGroup(): SettingsGroup {
		let pendingFolder = this.settings.cacheFolder;
		const rows: SettingsRow[] = [
			{
				name: t('settings.excluded'),
				desc: t('settings.excluded.desc'),
				build: (s) =>
					s.addTextArea((area) =>
						area
							.setPlaceholder('Private')
							.setValue(this.settings.excludedFolders)
							.onChange(async (value) => {
								this.settings.excludedFolders = value;
								await this.save(true);
							}),
					),
			},
			{
				name: t('settings.include-only'),
				desc: t('settings.include-only.desc'),
				build: (s) =>
					s.addTextArea((area) =>
						area.setValue(this.settings.includeOnlyFolders).onChange(async (value) => {
							this.settings.includeOnlyFolders = value;
							await this.save(true);
						}),
					),
			},
			{
				name: t('settings.cache-folder'),
				desc: t('settings.cache-folder.desc'),
				build: (s) =>
					s
						.addText((text) =>
							text.setValue(this.settings.cacheFolder).onChange((value) => {
								pendingFolder = value;
							}),
						)
						.addButton((button) =>
							button.setButtonText(t('settings.cache-folder.apply')).onClick(async () => {
								await this.moveCacheFolder(pendingFolder);
								this.refresh();
							}),
						),
			},
		];

		if (canEditExcludedFiles(this.app)) {
			const excluded = isFolderExcluded(this.app, this.settings.cacheFolder);
			rows.push({
				name: t('settings.exclude-cache'),
				desc: t('settings.exclude-cache.desc'),
				build: (s) =>
					s.addButton((button) => {
						button.setButtonText(excluded ? t('settings.exclude-cache.done') : t('settings.exclude-cache.button'));
						if (excluded) button.setDisabled(true);
						else
							button.setCta().onClick(() => {
								addExcludedFolder(this.app, this.settings.cacheFolder);
								new Notice(t('notice.exclusion-added', { folder: this.settings.cacheFolder }));
								this.refresh();
							});
					}),
			});
		}
		return { heading: t('settings.heading.folders'), rows };
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

	private costGroup(): SettingsGroup {
		return {
			heading: t('settings.heading.cost'),
			rows: [
				this.note(t('settings.cost.desc')),
				this.numberRow(t('settings.input-price'), '', 'inputPrice', 0, 10_000, false),
				this.numberRow(t('settings.output-price'), '', 'outputPrice', 0, 10_000, false),
				this.numberRow(t('settings.chars-per-token'), '', 'charsPerToken', 1, 20, false),
			],
		};
	}

	private advancedGroup(): SettingsGroup {
		return {
			heading: t('settings.heading.advanced'),
			rows: [
				{
					name: t('settings.prune'),
					desc: t('settings.prune.desc'),
					build: (s) =>
						s
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
							}),
				},
				{
					name: t('settings.debug'),
					desc: t('settings.debug.desc'),
					build: (s) =>
						s.addToggle((toggle) =>
							toggle.setValue(this.settings.debugLogging).onChange(async (value) => {
								this.settings.debugLogging = value;
								await this.save();
							}),
						),
				},
			],
		};
	}
}
