import type { TargetLanguage } from './types';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface PromptItem {
	/** 1-based number used in the `<<n>>` markers. */
	id: number;
	/** Sentence with protected spans replaced by placeholders. */
	text: string;
}

export interface PromptContext {
	noteTitle: string;
	/** Terms that must not be translated. */
	glossary: readonly string[];
	/** Surrounding text (already masked) to help with ambiguous sentences. Not translated. */
	context?: readonly string[];
	jsonMode: boolean;
	/** What the items are. `names` switches to the file and folder name prompt. */
	purpose?: 'sentences' | 'names';
}

export const LANGUAGE_NAMES: Record<TargetLanguage, string> = {
	en: 'English',
	de: 'German',
};

export function systemPrompt(target: TargetLanguage, jsonMode: boolean): string {
	const language = LANGUAGE_NAMES[target];
	const output = jsonMode
		? [
				'Return a JSON object {"translations": [...]} whose array holds exactly one object per input sentence, in input order.',
				'Each object is {"lang": "<language of the INPUT sentence: en, de or mixed>", "text": "<translation>"}.',
				'Example: {"translations": [{"lang": "de", "text": "Good morning."}, {"lang": "en", "text": "See you."}]}',
			].join('\n')
		: [
				'Return exactly one line per input sentence: the marker, the language of the INPUT sentence in curly braces ({en}, {de} or {mixed}), then the translation.',
				'Use the same numbers as the input, in order. Output nothing else: no preamble, no notes, no code fences.',
				'Example for the input "<<1>> Guten Morgen." and "<<2>> See you.":',
				'<<1>> {de} Good morning.',
				'<<2>> {en} See you.',
			].join('\n');
	return [
		`You are a translation engine for personal Markdown notes. Translate each numbered sentence into ${language}.`,
		'Rules:',
		'- Translate only. Do not rewrite, summarise, explain, add or omit anything. Keep the tone and the meaning, including the meaning of typos.',
		`- Input may mix German and English. Output everything in ${language}. Text that is already in ${language} stays exactly as it is.`,
		'- Placeholders like ⟦1⟧ stand for links, code, math or tags. Copy every placeholder of a sentence unchanged into that sentence\'s translation, exactly once each. Never add placeholders.',
		'- Keep Markdown inline formatting (**bold**, *italic*, ~~strike~~) and punctuation style.',
		'- Keep the glossary terms exactly as written.',
		'- Each input sentence becomes exactly one output sentence. Never merge or split sentences.',
		output,
	].join('\n');
}

/** System prompt for file and folder names (display-only titles, no placeholders). */
export function namesSystemPrompt(target: TargetLanguage, jsonMode: boolean): string {
	const language = LANGUAGE_NAMES[target];
	const output = jsonMode
		? [
				'Return a JSON object {"translations": [...]} whose array holds exactly one object per input name, in input order.',
				'Each object is {"lang": "<language of the INPUT name: en, de or mixed>", "text": "<translation>"}.',
			].join('\n')
		: [
				'Return exactly one line per input name: the marker, the language of the INPUT name in curly braces ({en}, {de} or {mixed}), then the translation.',
				'Use the same numbers as the input, in order. Output nothing else: no preamble, no notes, no code fences.',
				'Example for the input "<<1>> 2024-05 Besprechungsnotizen" and "<<2>> Project plan":',
				'<<1>> {de} 2024-05 Meeting notes',
				'<<2>> {en} Project plan',
			].join('\n');
	return [
		`You translate the names of files and folders in a personal notes vault into ${language}. Each numbered line is one name.`,
		'Rules:',
		'- Translate only. Produce a short title, not a sentence: no quotes, no trailing punctuation, no explanation.',
		'- Keep the casing style and separators of the original (Title Case, snake_case, kebab-case, lower case).',
		'- Keep leading numbers, dates and ordering prefixes exactly as written, including their separators.',
		'- Keep version numbers, acronyms, product names, proper nouns and code-like tokens unchanged.',
		`- Names already in ${language} stay exactly as they are.`,
		'- Keep the glossary terms exactly as written.',
		'- Each input name becomes exactly one output name. Never merge or split names.',
		output,
	].join('\n');
}

export function userPrompt(items: readonly PromptItem[], target: TargetLanguage, ctx: PromptContext): string {
	const parts: string[] = [];
	parts.push(`Target language: ${LANGUAGE_NAMES[target]}`);
	if (ctx.noteTitle) parts.push(`Note title: ${ctx.noteTitle}`);
	if (ctx.glossary.length > 0) parts.push(`Glossary (never translate): ${ctx.glossary.join(', ')}`);
	if (ctx.context && ctx.context.length > 0) {
		parts.push('Context (for reference only, do not translate or output):');
		parts.push(ctx.context.map((c) => `> ${c}`).join('\n'));
	}
	parts.push(`${ctx.purpose === 'names' ? 'Names' : 'Sentences'} (${items.length}):`);
	parts.push(items.map((item) => `<<${item.id}>> ${item.text}`).join('\n'));
	return parts.join('\n\n');
}

export function buildMessages(items: readonly PromptItem[], target: TargetLanguage, ctx: PromptContext): ChatMessage[] {
	return [
		{ role: 'system', content: ctx.purpose === 'names' ? namesSystemPrompt(target, ctx.jsonMode) : systemPrompt(target, ctx.jsonMode) },
		{ role: 'user', content: userPrompt(items, target, ctx) },
	];
}

/** Parses the glossary setting: one term per line, `#` starts a comment line. */
export function parseGlossary(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0 && !l.startsWith('#'));
}
