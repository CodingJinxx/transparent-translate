/**
 * Protects syntax the model must never change by replacing it with numbered
 * placeholders (`⟦1⟧`, `⟦2⟧`, …). After translation the placeholders are
 * restored from the original text.
 *
 * Implemented as a scanner instead of one large regex, so that no lookbehind
 * is needed (lookbehind breaks on older iOS versions).
 */

export const PLACEHOLDER_OPEN = '⟦';
export const PLACEHOLDER_CLOSE = '⟧';

export interface ProtectOptions {
	/** Translate the alias of `[[target|alias]]`. When false the whole link is protected. */
	translateWikilinkAliases: boolean;
}

export const DEFAULT_PROTECT_OPTIONS: ProtectOptions = { translateWikilinkAliases: false };

interface Piece {
	origFrom: number;
	origTo: number;
	maskedFrom: number;
	maskedTo: number;
	token: boolean;
}

export interface MaskedText {
	masked: string;
	tokens: string[];
	pieces: Piece[];
}

/** A protected span. `kind` only matters for debugging and tests. */
interface Span {
	from: number;
	to: number;
}

type Matcher = (text: string, i: number, opts: ProtectOptions) => Span[] | null;

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

function isSpace(ch: string | undefined): boolean {
	return ch === undefined || /\s/.test(ch);
}

const matchPlaceholderChar: Matcher = (text, i) =>
	text[i] === PLACEHOLDER_OPEN || text[i] === PLACEHOLDER_CLOSE ? [{ from: i, to: i + 1 }] : null;

const matchComment: Matcher = (text, i) => {
	if (!text.startsWith('%%', i)) return null;
	const close = text.indexOf('%%', i + 2);
	return [{ from: i, to: close === -1 ? text.length : close + 2 }];
};

const matchInlineCode: Matcher = (text, i) => {
	if (text[i] !== '`') return null;
	let n = 0;
	while (text[i + n] === '`') n++;
	const fence = '`'.repeat(n);
	let search = i + n;
	while (search < text.length) {
		const close = text.indexOf(fence, search);
		if (close === -1) break;
		// The closing run must have exactly n backticks.
		if (text[close + n] !== '`') return [{ from: i, to: close + n }];
		search = close + n;
		while (text[search] === '`') search++;
	}
	return null;
};

const matchMath: Matcher = (text, i) => {
	if (text[i] !== '$') return null;
	if (text[i + 1] === '$') {
		const close = text.indexOf('$$', i + 2);
		return close === -1 ? null : [{ from: i, to: close + 2 }];
	}
	if (isSpace(text[i + 1])) return null;
	for (let j = i + 1; j < text.length; j++) {
		const ch = text[j];
		if (ch === '\\') {
			j++;
			continue;
		}
		if (ch === '\n') return null;
		if (ch === '$') {
			if (isSpace(text[j - 1])) return null;
			if (/\d/.test(text[j + 1] ?? '')) return null;
			return [{ from: i, to: j + 1 }];
		}
	}
	return null;
};

const matchEscape: Matcher = (text, i) => {
	if (text[i] !== '\\' || i + 1 >= text.length) return null;
	return /[!-/:-@[-`{-~]/.test(text[i + 1] ?? '') ? [{ from: i, to: i + 2 }] : null;
};

const matchWikilink: Matcher = (text, i, opts) => {
	const embed = text.startsWith('![[', i);
	if (!embed && !text.startsWith('[[', i)) return null;
	const start = embed ? i + 3 : i + 2;
	const close = text.indexOf(']]', start);
	if (close === -1) return null;
	const inner = text.slice(start, close);
	if (inner.includes('\n')) return null;
	const pipe = inner.indexOf('|');
	if (embed || pipe === -1 || !opts.translateWikilinkAliases || pipe === inner.length - 1) {
		return [{ from: i, to: close + 2 }];
	}
	const aliasStart = start + pipe + 1;
	return [
		{ from: i, to: aliasStart },
		{ from: close, to: close + 2 },
	];
};

/** Finds the index of the `)` closing the `(` at `open`, allowing one level of nested parentheses. */
function findClosingParen(text: string, open: number): number {
	let depth = 0;
	for (let j = open; j < text.length; j++) {
		const ch = text[j];
		if (ch === '\\') {
			j++;
			continue;
		}
		if (ch === '\n') return -1;
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) return j;
		}
	}
	return -1;
}

const matchMarkdownLink: Matcher = (text, i) => {
	const image = text[i] === '!' && text[i + 1] === '[';
	if (!image && text[i] !== '[') return null;
	const open = image ? i + 1 : i;
	if (text[open + 1] === '^') {
		// Footnote reference [^id].
		const close = text.indexOf(']', open);
		return close === -1 ? null : [{ from: i, to: close + 1 }];
	}
	let close = -1;
	for (let j = open + 1; j < text.length; j++) {
		const ch = text[j];
		if (ch === '\\') {
			j++;
			continue;
		}
		if (ch === '\n' || ch === '[') return null;
		if (ch === ']') {
			close = j;
			break;
		}
	}
	if (close === -1) return null;
	let end = -1;
	if (text[close + 1] === '(') end = findClosingParen(text, close + 1);
	else if (text[close + 1] === '[') {
		const refClose = text.indexOf(']', close + 2);
		end = refClose === -1 ? -1 : refClose;
	}
	if (end === -1) return null;
	if (image || close === open + 1) return [{ from: i, to: end + 1 }];
	return [
		{ from: i, to: open + 1 },
		{ from: close, to: end + 1 },
	];
};

const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/y;
const AUTOLINK = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]+|[^<>\s@]+@[^<>\s]+)>/y;

const matchAngle: Matcher = (text, i) => {
	if (text[i] !== '<') return null;
	for (const re of [AUTOLINK, HTML_TAG]) {
		re.lastIndex = i;
		const m = re.exec(text);
		if (m) return [{ from: i, to: i + m[0].length }];
	}
	return null;
};

const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>]+/y;

const matchBareUrl: Matcher = (text, i) => {
	if (text[i] !== 'h' && text[i] !== 'w') return null;
	if (isWordChar(text[i - 1])) return null;
	BARE_URL.lastIndex = i;
	const m = BARE_URL.exec(text);
	if (!m) return null;
	let url = m[0];
	// Trailing punctuation belongs to the sentence, not the URL.
	for (;;) {
		const last = url[url.length - 1];
		if (last === undefined) break;
		if ('.,;:!?\'"*_~'.includes(last)) {
			url = url.slice(0, -1);
			continue;
		}
		if (last === ')') {
			const opens = url.split('(').length - 1;
			const closes = url.split(')').length - 1;
			if (closes > opens) {
				url = url.slice(0, -1);
				continue;
			}
		}
		break;
	}
	return url.length > 'www.'.length ? [{ from: i, to: i + url.length }] : null;
};

const TAG_BODY = /[\p{L}\p{N}_\-/]+/uy;

const matchTag: Matcher = (text, i) => {
	if (text[i] !== '#') return null;
	const prev = text[i - 1];
	if (prev !== undefined && !/[\s(,;]/.test(prev)) return null;
	TAG_BODY.lastIndex = i + 1;
	const m = TAG_BODY.exec(text);
	if (!m || /^\d+$/.test(m[0])) return null;
	return [{ from: i, to: i + 1 + m[0].length }];
};

const BLOCK_ID = /\^[A-Za-z0-9-]+\s*$/y;

const matchBlockId: Matcher = (text, i) => {
	if (text[i] !== '^' || !isSpace(text[i - 1])) return null;
	BLOCK_ID.lastIndex = i;
	const m = BLOCK_ID.exec(text);
	return m ? [{ from: i, to: i + m[0].trimEnd().length }] : null;
};

const matchInlineFootnote: Matcher = (text, i) => {
	if (text[i] !== '^' || text[i + 1] !== '[') return null;
	const close = text.indexOf(']', i + 2);
	return close === -1 ? null : [{ from: i, to: close + 1 }];
};

const matchHighlight: Matcher = (text, i) => (text.startsWith('==', i) ? [{ from: i, to: i + 2 }] : null);

const MATCHERS: Matcher[] = [
	matchPlaceholderChar,
	matchComment,
	matchInlineCode,
	matchMath,
	matchEscape,
	matchWikilink,
	matchInlineFootnote,
	matchMarkdownLink,
	matchAngle,
	matchBareUrl,
	matchTag,
	matchBlockId,
	matchHighlight,
];

/** Returns the protected spans of `text`, sorted and non-overlapping. */
export function findProtectedSpans(text: string, opts: ProtectOptions = DEFAULT_PROTECT_OPTIONS): Span[] {
	const spans: Span[] = [];
	let i = 0;
	while (i < text.length) {
		let matched: Span[] | null = null;
		for (const matcher of MATCHERS) {
			matched = matcher(text, i, opts);
			if (matched) break;
		}
		if (matched && matched.length > 0) {
			spans.push(...matched);
			i = matched[matched.length - 1]!.to;
		} else {
			i++;
		}
	}
	return spans;
}

export function placeholder(n: number): string {
	return `${PLACEHOLDER_OPEN}${n}${PLACEHOLDER_CLOSE}`;
}

/** Replaces protected spans in `text` with placeholders numbered from 1. */
export function protect(text: string, opts: ProtectOptions = DEFAULT_PROTECT_OPTIONS): MaskedText {
	const spans = findProtectedSpans(text, opts);
	const tokens: string[] = [];
	const pieces: Piece[] = [];
	let masked = '';
	let pos = 0;
	const pushText = (to: number) => {
		if (to <= pos) return;
		pieces.push({ origFrom: pos, origTo: to, maskedFrom: masked.length, maskedTo: masked.length + (to - pos), token: false });
		masked += text.slice(pos, to);
		pos = to;
	};
	for (const span of spans) {
		pushText(span.from);
		tokens.push(text.slice(span.from, span.to));
		const ph = placeholder(tokens.length);
		pieces.push({ origFrom: span.from, origTo: span.to, maskedFrom: masked.length, maskedTo: masked.length + ph.length, token: true });
		masked += ph;
		pos = span.to;
	}
	pushText(text.length);
	return { masked, tokens, pieces };
}

/**
 * Maps an offset in the masked text back to the original text. Offsets inside
 * a placeholder snap to the start (`bias < 0`) or end (`bias > 0`) of its span.
 */
export function maskedToOriginal(m: MaskedText, offset: number, bias: -1 | 1): number {
	for (const piece of m.pieces) {
		if (offset < piece.maskedFrom || offset > piece.maskedTo) continue;
		if (piece.token) {
			if (offset === piece.maskedFrom) return piece.origFrom;
			if (offset === piece.maskedTo) return piece.origTo;
			return bias < 0 ? piece.origFrom : piece.origTo;
		}
		return piece.origFrom + (offset - piece.maskedFrom);
	}
	return offset <= 0 ? 0 : (m.pieces[m.pieces.length - 1]?.origTo ?? 0);
}

const PLACEHOLDER_RE = /⟦\s*(\d+)\s*⟧/g;

/** Placeholder numbers in order of appearance. */
export function placeholderIds(text: string): number[] {
	const ids: number[] = [];
	for (const m of text.matchAll(PLACEHOLDER_RE)) ids.push(Number(m[1]));
	return ids;
}

/** True if `translated` contains each placeholder 1..count exactly once and nothing else. */
export function placeholdersValid(translated: string, count: number): boolean {
	const ids = placeholderIds(translated);
	if (ids.length !== count) return false;
	const seen = new Set(ids);
	if (seen.size !== count) return false;
	for (let n = 1; n <= count; n++) if (!seen.has(n)) return false;
	return true;
}

/** Normalizes placeholders the model may have padded with spaces (`⟦ 1 ⟧` → `⟦1⟧`). */
export function tidyPlaceholders(text: string): string {
	return text.replace(PLACEHOLDER_RE, (_m, n: string) => placeholder(Number(n)));
}

/** Replaces placeholders with their original text. Unknown placeholders are left as they are. */
export function restore(masked: string, tokens: readonly string[]): string {
	return masked.replace(PLACEHOLDER_RE, (match, n: string) => tokens[Number(n) - 1] ?? match);
}
