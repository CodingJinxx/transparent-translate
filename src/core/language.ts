import type { TargetLanguage } from './types';

/** Language of an original sentence, as reported by the model or detected locally. */
export type SourceLanguage = TargetLanguage | 'mixed';

export function isSourceLanguage(value: unknown): value is SourceLanguage {
	return value === 'en' || value === 'de' || value === 'mixed';
}

// Short, frequent function words. Words that exist in both languages
// ("in", "an", "so", "was", "will", "man", "die" …) are deliberately left out.
const EN = new Set(
	'the a of and to is are was were be been it this that these those with for on at by from as not but or if then than which who what when where why how have has had do does did can could would should will shall may might must i you he she we they them our your their its my me us there here into about over under after before because while all any some no each very just also only too more most such own same both'.split(
		' ',
	),
);
const DE = new Set(
	'der das dem den des ein eine einer eines einem einen und ist sind war waren sein bin bist hat haben hatte wird werden wurde nicht kein keine mit für auf aus bei nach von zu zum zur über unter vor durch gegen ohne um wie wenn dass weil oder aber auch noch nur schon sehr ich du er sie es wir ihr mich mir dich dir uns euch sich sein seine ihre unser euer diese dieser dieses jede jeder jedes kann können muss müssen soll sollen will wollen darf dürfen man hier dort heute dann also doch mal etwa bitte'.split(
		' ',
	),
);

const WORD = /[\p{L}']+/gu;
const GERMAN_LETTERS = /[äöüßÄÖÜ]/;

/**
 * Combines what the model reported with local detection. Models like to call
 * German text with English terms "mixed"; when local detection is sure about
 * one language, that wins over a "mixed" report.
 */
export function refineLanguage(reported: SourceLanguage | undefined, masked: string): SourceLanguage | undefined {
	if (reported !== 'mixed') return reported;
	return detectLanguage(masked) ?? 'mixed';
}

/**
 * Conservative local language detection for one sentence. Returns a
 * language only when the signal is clear; otherwise null, and the model
 * decides. A wrong answer would leave a sentence untranslated, so it errs on
 * the side of null: any word of the other language makes the result null.
 *
 * `text` should be the masked sentence (links, code, math replaced by placeholders).
 */
export function detectLanguage(text: string): TargetLanguage | null {
	const words = (text.replace(/⟦\d+⟧/g, ' ').match(WORD) ?? []).map((w) => w.toLowerCase());
	if (words.length < 4) return null;
	let en = 0;
	let de = 0;
	for (const word of words) {
		if (EN.has(word)) en++;
		if (DE.has(word)) de++;
	}
	if (GERMAN_LETTERS.test(text)) de += 2;
	// Clear only when one side has at least two hits and the other has none.
	if (en >= 2 && de === 0) return 'en';
	if (de >= 2 && en === 0) return 'de';
	return null;
}
