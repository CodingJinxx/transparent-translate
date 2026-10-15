/** Display modes. `original` shows the file as it is on disk. */
export type DisplayMode = 'original' | TargetLanguage;

/** Languages the plugin can translate into. */
export type TargetLanguage = 'en' | 'de';

export const TARGET_LANGUAGES: readonly TargetLanguage[] = ['en', 'de'];
export const DISPLAY_MODES: readonly DisplayMode[] = ['original', 'en', 'de'];

export function isTargetLanguage(value: unknown): value is TargetLanguage {
	return value === 'en' || value === 'de';
}

export function isDisplayMode(value: unknown): value is DisplayMode {
	return value === 'original' || isTargetLanguage(value);
}

/** Next mode in the cycle Original → English → German → Original. */
export function nextMode(mode: DisplayMode): DisplayMode {
	const index = DISPLAY_MODES.indexOf(mode);
	return DISPLAY_MODES[(index + 1) % DISPLAY_MODES.length] ?? 'original';
}

export type BlockKind =
	| 'frontmatter'
	| 'code'
	| 'math'
	| 'comment'
	| 'html'
	| 'hr'
	| 'heading'
	| 'paragraph'
	| 'list'
	| 'quote'
	| 'callout'
	| 'table'
	| 'footnote';

/** A Markdown block. Offsets are UTF-16 offsets into the raw file text. */
export interface Block {
	kind: BlockKind;
	/** First line (0-based). */
	startLine: number;
	/** Last line (0-based, inclusive). */
	endLine: number;
	from: number;
	/** End offset, excluding the final line break. */
	to: number;
	translatable: boolean;
}

/**
 * The smallest unit that is translated and cached. `from`/`to` cover only
 * sentence text, never Markdown structure such as `- `, `> ` or `## `.
 */
export interface Sentence {
	from: number;
	to: number;
	/** Exact text of the file in `from..to`. */
	text: string;
	/** SHA-256 of the normalized text, used as the cache key. */
	hash: string;
	/** Text with protected spans replaced by `⟦n⟧` placeholders. */
	masked: string;
	/** Original text of each placeholder, `tokens[0]` is `⟦1⟧`. */
	tokens: string[];
	blockIndex: number;
}

export interface NoteModel {
	text: string;
	blocks: Block[];
	sentences: Sentence[];
	/** Offset of the first character of each line. */
	lineStarts: number[];
}
