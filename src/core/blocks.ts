import type { Block, BlockKind } from './types';
import { computeLineStarts, lineEnd, lineText } from './text';

/**
 * Splits a note into Markdown blocks. Frontmatter, code, math, comments, HTML
 * and rules are never translated. Lists, tables, quotes and callouts are kept
 * as one block each so their structure stays intact.
 */

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE = /^\s{0,3}>/;
const CALLOUT = /^\s{0,3}>\s*\[![^\]]+\]/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const HTML_BLOCK = /^\s{0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)/;
const FOOTNOTE_DEF = /^\[\^[^\]]+\]:/;
const INDENTED_CODE = /^(?: {4}|\t)/;

function isBlank(line: string): boolean {
	return line.trim().length === 0;
}

export function parseBlocks(text: string, lineStarts: number[] = computeLineStarts(text)): Block[] {
	const blocks: Block[] = [];
	const lineCount = lineStarts.length;
	const line = (n: number) => lineText(text, lineStarts, n);
	const push = (kind: BlockKind, startLine: number, endLine: number, translatable: boolean) => {
		blocks.push({
			kind,
			startLine,
			endLine,
			from: lineStarts[startLine] ?? text.length,
			to: lineEnd(text, lineStarts, endLine),
			translatable,
		});
	};

	let i = 0;

	// Frontmatter only counts at the very start of the file.
	if (lineCount > 1 && line(0).trimEnd() === '---') {
		for (let j = 1; j < lineCount; j++) {
			const l = line(j).trimEnd();
			if (l === '---' || l === '...') {
				push('frontmatter', 0, j, false);
				i = j + 1;
				break;
			}
		}
	}

	let previousBlank = true;
	while (i < lineCount) {
		const current = line(i);

		if (isBlank(current)) {
			previousBlank = true;
			i++;
			continue;
		}

		const start = i;
		const fence = FENCE_OPEN.exec(current);
		if (fence) {
			const marker = fence[1]!;
			let end = lineCount - 1;
			for (let j = i + 1; j < lineCount; j++) {
				const trimmed = line(j).trim();
				if (trimmed.startsWith(marker[0]!.repeat(marker.length)) && /^[`~]+$/.test(trimmed)) {
					end = j;
					break;
				}
			}
			push('code', start, end, false);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		const trimmed = current.trim();
		if (trimmed.startsWith('$$')) {
			let end = i;
			if (!(trimmed.length >= 4 && trimmed.endsWith('$$'))) {
				end = lineCount - 1;
				for (let j = i + 1; j < lineCount; j++) {
					if (line(j).includes('$$')) {
						end = j;
						break;
					}
				}
			}
			push('math', start, end, false);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		if (trimmed.startsWith('%%') && (trimmed === '%%' || trimmed.indexOf('%%', 2) === -1)) {
			let end = lineCount - 1;
			for (let j = i + 1; j < lineCount; j++) {
				if (line(j).includes('%%')) {
					end = j;
					break;
				}
			}
			push('comment', start, end, false);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		if (previousBlank && INDENTED_CODE.test(current) && !LIST_ITEM.test(current)) {
			let end = i;
			while (end + 1 < lineCount && (INDENTED_CODE.test(line(end + 1)) || isBlank(line(end + 1)))) end++;
			while (end > i && isBlank(line(end))) end--;
			push('code', start, end, false);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		if (HEADING.test(current)) {
			push('heading', start, start, true);
			i++;
			previousBlank = false;
			continue;
		}

		if (HR.test(current)) {
			push('hr', start, start, false);
			i++;
			previousBlank = false;
			continue;
		}

		if (current.includes('|') && i + 1 < lineCount && TABLE_SEPARATOR.test(line(i + 1)) && line(i + 1).includes('-')) {
			let end = i + 1;
			while (end + 1 < lineCount && !isBlank(line(end + 1)) && line(end + 1).includes('|')) end++;
			push('table', start, end, true);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		if (QUOTE.test(current)) {
			let end = i;
			while (end + 1 < lineCount && QUOTE.test(line(end + 1))) end++;
			push(CALLOUT.test(current) ? 'callout' : 'quote', start, end, true);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		if (LIST_ITEM.test(current)) {
			let end = i;
			while (end + 1 < lineCount) {
				const next = line(end + 1);
				if (isBlank(next)) break;
				if (LIST_ITEM.test(next) || /^\s+\S/.test(next)) {
					end++;
					continue;
				}
				break;
			}
			push('list', start, end, true);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		if (HTML_BLOCK.test(current)) {
			let end = i;
			while (end + 1 < lineCount && !isBlank(line(end + 1))) end++;
			push('html', start, end, false);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		if (FOOTNOTE_DEF.test(current)) {
			let end = i;
			while (end + 1 < lineCount && /^\s+\S/.test(line(end + 1))) end++;
			push('footnote', start, end, true);
			i = end + 1;
			previousBlank = false;
			continue;
		}

		// Paragraph: runs until a blank line or the start of another block.
		let end = i;
		while (end + 1 < lineCount) {
			const next = line(end + 1);
			if (isBlank(next)) break;
			const nextTrimmed = next.trim();
			if (
				FENCE_OPEN.test(next) ||
				HEADING.test(next) ||
				QUOTE.test(next) ||
				LIST_ITEM.test(next) ||
				HR.test(next) ||
				nextTrimmed.startsWith('$$') ||
				nextTrimmed === '%%'
			) {
				break;
			}
			end++;
		}
		push('paragraph', start, end, true);
		i = end + 1;
		previousBlank = false;
	}

	return blocks;
}
