import { de } from './de';
import type { TargetLanguage } from '../core/types';
import { en, type StringKey } from './en';

export type { StringKey };

type Table = Record<StringKey, string>;

let table: Table = en;

/** Picks the string table from Obsidian's interface language (`getLanguage()`). English is the fallback. */
export function setLanguage(language: string): void {
	table = language.toLowerCase().startsWith('de') ? de : en;
}

/** The language of the interface strings in use. */
export function currentLanguage(): 'de' | 'en' {
	return table === de ? 'de' : 'en';
}

/** Translates a UI string. `{name}` placeholders are replaced from `vars`. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
	const template = table[key] ?? en[key];
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/**
 * Name of the language a translation into `target` was written in. English and
 * German translate into each other; Dutch readers read both, so the original
 * of a Dutch translation can be either.
 */
export function sourceLanguageLabel(target: TargetLanguage): string {
	return t(target === 'nl' ? 'language.source-nl' : `language.${target === 'en' ? 'de' : 'en'}`);
}

/** Same as `sourceLanguageLabel`, as a noun (the interface-language name). */
export function sourceModeLabel(target: TargetLanguage): string {
	return t(target === 'nl' ? 'mode.source-nl' : `mode.${target === 'en' ? 'de' : 'en'}`);
}
