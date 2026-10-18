import { Modal, Notice, Setting } from 'obsidian';
import { scopeKey, type GlossaryEntry, type GlossaryKind, type GlossaryScope } from '../core/glossary-format';
import { cleanFolder } from '../core/paths';
import type { TargetLanguage } from '../core/types';
import { t } from '../i18n';
import type TransparentTranslatePlugin from '../main';
import { entryLabel, languageLabel, scopeLabel } from './glossary-labels';

type ScopeType = 'vault' | 'folder' | 'note' | 'property' | 'tag';

function scopeType(scope: GlossaryScope): ScopeType {
	if (scope.note) return 'note';
	if (scope.property) return 'property';
	if (scope.tag) return 'tag';
	if (scope.folder) return 'folder';
	return 'vault';
}

function scopeText(scope: GlossaryScope): string {
	if (scope.note) return scope.note;
	if (scope.property) return `${scope.property.key}=${scope.property.value}`;
	if (scope.tag) return scope.tag;
	return scope.folder ?? '';
}

function scopeFrom(type: ScopeType, text: string): GlossaryScope | null {
	const value = text.trim();
	switch (type) {
		case 'vault':
			return {};
		case 'folder':
			return cleanFolder(value) ? { folder: cleanFolder(value) } : null;
		case 'note':
			return value ? { note: value } : null;
		case 'tag':
			return value ? { tag: value.replace(/^#/, '') } : null;
		case 'property': {
			const eq = value.indexOf('=');
			return eq > 0 && eq < value.length - 1 ? { property: { key: value.slice(0, eq).trim(), value: value.slice(eq + 1).trim() } } : null;
		}
	}
}

/** Lists, adds, edits and deletes glossary entries and the subject description of a scope. */
export class GlossaryModal extends Modal {
	private filter = '';
	private editingId: string | null = null;
	private kind: GlossaryKind = 'map';
	private src = '';
	private to = '';
	private hint = '';
	private target: TargetLanguage | '*' = '*';
	private type: ScopeType = 'vault';
	private scopeValue = '';
	private domain = '';
	private unsubscribe: (() => void) | null = null;

	constructor(private readonly plugin: TransparentTranslatePlugin) {
		super(plugin.app);
		// New notes are most often added for the folder of the note that is open.
		const active = plugin.app.workspace.getActiveFile();
		if (active?.parent && !active.parent.isRoot()) {
			this.type = 'folder';
			this.scopeValue = active.parent.path;
		}
	}

	override onOpen(): void {
		this.setTitle(t('glossary.title'));
		this.modalEl.addClass('tt-glossary-modal');
		void this.plugin.glossary.load().then(() => this.render());
		this.unsubscribe = this.plugin.glossary.onChange(() => this.renderList());
		this.render();
	}

	override onClose(): void {
		this.unsubscribe?.();
		this.contentEl.empty();
	}

	private listEl: HTMLElement | null = null;

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', { cls: 'setting-item-description', text: t('glossary.intro') });
		this.renderForm(contentEl);
		this.renderDomain(contentEl);
		new Setting(contentEl).setName(t('glossary.entries')).setHeading();
		new Setting(contentEl).addSearch((search) => search.setPlaceholder(t('glossary.filter')).setValue(this.filter).onChange((value) => {
			this.filter = value;
			this.renderList();
		}));
		this.listEl = contentEl.createDiv({ cls: 'tt-glossary-list' });
		this.renderList();
	}

	private renderForm(el: HTMLElement): void {
		new Setting(el).setName(this.editingId ? t('glossary.edit') : t('glossary.add')).setHeading();
		new Setting(el).setName(t('glossary.kind')).addDropdown((d) =>
			d
				.addOption('map', t('glossary.kind.map'))
				.addOption('avoid', t('glossary.kind.avoid'))
				.addOption('keep', t('glossary.kind.keep'))
				.setValue(this.kind)
				.onChange((value) => {
					this.kind = value as GlossaryKind;
					this.render();
				}),
		);
		new Setting(el).setName(t('glossary.term')).addText((text) => text.setValue(this.src).onChange((value) => (this.src = value)));
		if (this.kind !== 'keep') {
			new Setting(el)
				.setName(this.kind === 'map' ? t('glossary.translation') : t('glossary.wrong'))
				.setDesc(this.kind === 'avoid' ? t('glossary.wrong.desc') : '')
				.addText((text) => text.setValue(this.to).onChange((value) => (this.to = value)));
		}
		new Setting(el).setName(t('glossary.language')).addDropdown((d) =>
			d
				.addOption('*', t('glossary.language.both'))
				.addOption('en', t('mode.en'))
				.addOption('de', t('mode.de'))
				.addOption('nl', t('mode.nl'))
				.setValue(this.target)
				.onChange((value) => (this.target = value as TargetLanguage | '*')),
		);
		new Setting(el)
			.setName(t('glossary.scope'))
			.setDesc(t('glossary.scope.desc'))
			.addDropdown((d) =>
				d
					.addOption('vault', t('glossary.scope.vault'))
					.addOption('folder', t('glossary.scope.folder'))
					.addOption('note', t('glossary.scope.note'))
					.addOption('property', t('glossary.scope.property'))
					.addOption('tag', t('glossary.scope.tag'))
					.setValue(this.type)
					.onChange((value) => {
						this.type = value as ScopeType;
						this.render();
					}),
			)
			.addText((text) => {
				text.setValue(this.scopeValue).onChange((value) => (this.scopeValue = value));
				text.setPlaceholder(this.type === 'property' ? 'course=SYS' : this.type === 'folder' ? 'Uni/Informatik' : this.type === 'tag' ? 'uni' : this.type === 'note' ? 'Folder/Note.md' : '');
				text.setDisabled(this.type === 'vault');
			});
		if (this.kind === 'map') {
			new Setting(el).setName(t('glossary.hint')).setDesc(t('glossary.hint.desc')).addText((text) => text.setValue(this.hint).onChange((value) => (this.hint = value)));
		}
		new Setting(el)
			.addButton((button) =>
				button
					.setButtonText(this.editingId ? t('glossary.save') : t('glossary.add'))
					.setCta()
					.onClick(() => this.saveEntry()),
			)
			.addExtraButton((button) => {
				button.setIcon('x').setTooltip(t('glossary.clear-form')).onClick(() => this.resetForm());
			});
	}

	private renderDomain(el: HTMLElement): void {
		new Setting(el).setName(t('glossary.domain')).setDesc(t('glossary.domain.desc')).setHeading();
		const scope = scopeFrom(this.type, this.scopeValue);
		const existing = scope ? this.plugin.glossary.data.domains[scopeKey(scope)]?.text ?? '' : '';
		this.domain = existing;
		new Setting(el)
			.addTextArea((area) => {
				area.setValue(existing).setPlaceholder(t('glossary.domain.placeholder')).onChange((value) => (this.domain = value));
				area.inputEl.rows = 2;
			})
			.addButton((button) =>
				button.setButtonText(t('glossary.domain.save')).onClick(() => {
					const target = scopeFrom(this.type, this.scopeValue);
					if (!target) {
						new Notice(t('glossary.need-scope'));
						return;
					}
					this.plugin.glossary.setDomain(target, this.domain);
					new Notice(t('glossary.domain.saved'));
				}),
			);
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();
		const filter = this.filter.trim().toLowerCase();
		const rows = this.plugin.glossary
			.entries()
			.filter(({ entry }) => !filter || `${entryLabel(entry)} ${scopeLabel(entry.scope)}`.toLowerCase().includes(filter))
			.sort((a, b) => a.entry.src.localeCompare(b.entry.src));
		if (rows.length === 0) list.createEl('p', { cls: 'setting-item-description', text: t('glossary.empty') });
		for (const { id, entry } of rows) {
			new Setting(list)
				.setName(entryLabel(entry))
				.setDesc(`${languageLabel(entry.target)} · ${scopeLabel(entry.scope)}${entry.hint ? ` · ${entry.hint}` : ''}`)
				.addExtraButton((button) => button.setIcon('pencil').setTooltip(t('glossary.edit')).onClick(() => this.startEdit(id, entry)))
				.addExtraButton((button) =>
					button.setIcon('trash').setTooltip(t('glossary.delete')).onClick(() => {
						this.plugin.glossary.remove(id);
						new Notice(t('glossary.deleted', { term: entry.src }));
					}),
				);
		}
	}

	private startEdit(id: string, entry: GlossaryEntry): void {
		this.editingId = id;
		this.kind = entry.kind;
		this.src = entry.src;
		this.to = entry.kind === 'avoid' ? (entry.avoid ?? []).join(', ') : (entry.to ?? '');
		this.hint = entry.hint ?? '';
		this.target = entry.target;
		this.type = scopeType(entry.scope);
		this.scopeValue = scopeText(entry.scope);
		this.render();
		this.contentEl.scrollTo({ top: 0 });
	}

	private resetForm(): void {
		this.editingId = null;
		this.src = '';
		this.to = '';
		this.hint = '';
		this.render();
	}

	private saveEntry(): void {
		const src = this.src.trim();
		const scope = scopeFrom(this.type, this.scopeValue);
		if (!src) {
			new Notice(t('glossary.need-term'));
			return;
		}
		if (!scope) {
			new Notice(t('glossary.need-scope'));
			return;
		}
		const to = this.to.trim();
		if (this.kind !== 'keep' && !to) {
			new Notice(t('glossary.need-translation'));
			return;
		}
		const store = this.plugin.glossary;
		store.batch(() => {
			if (this.editingId) {
				const old = store.data.entries[this.editingId];
				// A changed term or scope is a different entry: the old one goes away.
				if (old && !old.deleted) store.remove(this.editingId);
			}
			store.upsert({
				kind: this.kind,
				src,
				target: this.target,
				scope,
				...(this.kind === 'map' ? { to } : {}),
				...(this.kind === 'avoid' ? { avoid: to.split(/[,;]/).map((a) => a.trim()).filter((a) => a.length > 0) } : {}),
				...(this.kind === 'map' && this.hint.trim() ? { hint: this.hint.trim() } : {}),
			});
		});
		this.editingId = null;
		this.src = '';
		this.to = '';
		this.hint = '';
		this.render();
		new Notice(t('glossary.saved', { term: src }));
	}
}
