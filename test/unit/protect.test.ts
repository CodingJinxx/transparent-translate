import { describe, expect, it } from 'vitest';
import {
	findProtectedSpans,
	maskedToOriginal,
	placeholdersValid,
	protect,
	restore,
	tidyPlaceholders,
} from '../../src/core/protect';

const tokensOf = (text: string, translateWikilinkAliases = false) => protect(text, { translateWikilinkAliases }).tokens;

describe('protect', () => {
	it.each([
		['inline code', 'Use `npm run build` now.', ['`npm run build`']],
		['double backtick code', 'Use ``a ` b`` now.', ['``a ` b``']],
		['inline math', 'Cost is $3n + 2$ steps.', ['$3n + 2$']],
		['display math inline', 'See $$x^2$$ here.', ['$$x^2$$']],
		['wikilink', 'Siehe [[Woche 1]] dazu.', ['[[Woche 1]]']],
		['embed', 'Bild ![[diagram.png|300]] hier.', ['![[diagram.png|300]]']],
		['tag', 'Kurs #INF-K und #vorlesung/teil-1.', ['#INF-K', '#vorlesung/teil-1']],
		['block id', 'Fragen stellen. ^frage1', ['^frage1']],
		['footnote ref', 'Text[^1] here.', ['[^1]']],
		['inline footnote', 'Text^[Notiz] here.', ['^[Notiz]']],
		['comment', 'A %%hidden%% word.', ['%%hidden%%']],
		['highlight markers', 'Ein ==wichtiges== Wort.', ['==', '==']],
		['html tag', 'Line<br>break and <span class="x">text</span>.', ['<br>', '<span class="x">', '</span>']],
		['autolink', 'Mail <mailto:a@b.de> or <https://x.y>.', ['<mailto:a@b.de>', '<https://x.y>']],
		['bare url', 'Go to https://example.com/a_(b). Then stop.', ['https://example.com/a_(b)']],
		['www url', 'Visit www.example.org, then leave.', ['www.example.org']],
		['escape', 'A \\| pipe and \\*star.', ['\\|', '\\*']],
		['image', 'Pic ![alt](a.png) here.', ['![alt](a.png)']],
		['placeholder lookalike', 'Weird ⟦ char.', ['⟦']],
	])('protects %s', (_name, text, expected) => {
		expect(tokensOf(text)).toEqual(expected);
	});

	it('keeps markdown link text translatable', () => {
		const m = protect('Read [the docs](https://x.y/a (b)) now.');
		expect(m.masked).toBe('Read ⟦1⟧the docs⟦2⟧ now.');
		expect(m.tokens).toEqual(['[', '](https://x.y/a (b))']);
	});

	it('keeps wikilink aliases translatable only when enabled', () => {
		expect(protect('Siehe [[Woche 1|erste Woche]].').masked).toBe('Siehe ⟦1⟧.');
		const m = protect('Siehe [[Woche 1|erste Woche]].', { translateWikilinkAliases: true });
		expect(m.masked).toBe('Siehe ⟦1⟧erste Woche⟦2⟧.');
	});

	it.each([
		['money', 'It costs $5 and $10 today.'],
		['number heading hash', 'Item #1 is done.'],
		['hash in word', 'C# is a language.'],
		['caret in math-less text', 'x ^ y'],
		['unclosed code', 'A ` lonely backtick.'],
		['unclosed link', 'An [unclosed bracket.'],
	])('does not protect %s', (_name, text) => {
		expect(findProtectedSpans(text)).toEqual([]);
	});

	it('trims trailing punctuation from bare URLs', () => {
		expect(tokensOf('See https://a.de/x.')).toEqual(['https://a.de/x']);
		expect(tokensOf('(see https://a.de/x)')).toEqual(['https://a.de/x']);
	});

	it.each([
		'Plain text without anything.',
		'Mixed $a$ `b` [[c|d]] #e ==f== [g](h) https://i.j ^k',
		'Edge ⟦1⟧ placeholders ⟦ ⟧ in source.',
	])('round-trips: %s', (text) => {
		const m = protect(text, { translateWikilinkAliases: true });
		expect(restore(m.masked, m.tokens)).toBe(text);
	});

	it('maps masked offsets back to the original text', () => {
		const text = 'Ab $x$ cd.';
		const m = protect(text);
		expect(m.masked).toBe('Ab ⟦1⟧ cd.');
		expect(maskedToOriginal(m, 0, -1)).toBe(0);
		expect(maskedToOriginal(m, 3, -1)).toBe(3);
		expect(maskedToOriginal(m, 4, -1)).toBe(3);
		expect(maskedToOriginal(m, 4, 1)).toBe(6);
		expect(maskedToOriginal(m, 6, -1)).toBe(6);
		expect(maskedToOriginal(m, m.masked.length, -1)).toBe(text.length);
	});
});

describe('placeholder validation', () => {
	it('accepts each placeholder exactly once in any order', () => {
		expect(placeholdersValid('b ⟦2⟧ a ⟦1⟧', 2)).toBe(true);
		expect(placeholdersValid('none', 0)).toBe(true);
	});

	it.each([
		['missing', 'only ⟦1⟧', 2],
		['duplicated', '⟦1⟧ ⟦1⟧', 2],
		['extra', '⟦1⟧ ⟦2⟧ ⟦3⟧', 2],
		['invented', 'text ⟦1⟧', 0],
	])('rejects %s placeholders', (_name, text, count) => {
		expect(placeholdersValid(text, count)).toBe(false);
	});

	it('tidies padded placeholders', () => {
		expect(tidyPlaceholders('a ⟦ 1 ⟧ b ⟦2 ⟧')).toBe('a ⟦1⟧ b ⟦2⟧');
		expect(placeholdersValid(tidyPlaceholders('⟦ 1⟧'), 1)).toBe(true);
	});

	it('restores tokens and leaves unknown placeholders alone', () => {
		expect(restore('x ⟦1⟧ y ⟦9⟧', ['[[A]]'])).toBe('x [[A]] y ⟦9⟧');
	});
});
