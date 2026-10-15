import { scopeKey, type GlossaryEntry, type GlossaryScope } from '../core/glossary-format';
import { t } from '../i18n';

/** Readable name of a scope, e.g. "Folder: Uni/Informatik". */
export function scopeLabel(scope: GlossaryScope): string {
	if (scope.note) return `${t('glossary.scope.note')}: ${scope.note}`;
	if (scope.property) return `${t('glossary.scope.property')}: ${scope.property.key} = ${scope.property.value}`;
	if (scope.tag) return `${t('glossary.scope.tag')}: #${scope.tag.replace(/^#/, '')}`;
	if (scope.folder) return `${t('glossary.scope.folder')}: ${scope.folder}`;
	return t('glossary.scope.vault');
}

export function languageLabel(target: GlossaryEntry['target']): string {
	return target === '*' ? t('glossary.language.both') : t(`mode.${target}`);
}

/** One line describing an entry: "Schein → course credit". */
export function entryLabel(entry: GlossaryEntry): string {
	if (entry.kind === 'map') return `${entry.src} → ${entry.to ?? ''}`;
	if (entry.kind === 'avoid') return `${entry.src} ≠ ${(entry.avoid ?? []).join(' / ')}`;
	return `${entry.src} (${t('glossary.kind.keep')})`;
}

/** Scope as a stable select value. */
export function scopeValue(scope: GlossaryScope): string {
	return scopeKey(scope);
}
