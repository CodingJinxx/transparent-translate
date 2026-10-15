import { describe, expect, it } from 'vitest';
import { parseNote, sentencesInLines, NoteParser, DEFAULT_SEGMENT_OPTIONS } from '../../src/core/note';
import { parseBlocks } from '../../src/core/blocks';
import { fallbackSegmenter, setSegmenterForTesting } from '../../src/core/sentences';
import { fixture } from './helpers';

const texts = (source: string) => parseNote(source).sentences.map((s) => s.text);

describe('parseBlocks', () => {
	it('recognizes every block kind in the Lektion 1 fixture', () => {
		const blocks = parseBlocks(fixture('lektion-1.md'));
		expect(blocks.map((b) => [b.kind, b.startLine, b.endLine])).toEqual([
			['frontmatter', 0, 3],
			['heading', 4, 4],
			['paragraph', 6, 6],
			['paragraph', 8, 8],
			['math', 10, 12],
			['list', 14, 17],
			['table', 19, 22],
			['callout', 24, 25],
			['code', 27, 29],
			['paragraph', 31, 31],
		]);
	});

	it('marks code, math, frontmatter, comments, html and rules as not translatable', () => {
		const blocks = parseBlocks(fixture('structure.md'));
		const fixed = blocks.filter((b) => !b.translatable).map((b) => b.kind);
		expect(fixed).toEqual(['frontmatter', 'html', 'comment', 'code', 'hr']);
	});

	it('handles an unterminated code fence by running to the end', () => {
		const blocks = parseBlocks('Text.\n\n```\ncode\nmore');
		expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code']);
		expect(blocks[1]!.endLine).toBe(4);
	});

	it('does not treat a horizontal rule at the start as frontmatter without a closing line', () => {
		expect(parseBlocks('---\nJust text.').map((b) => b.kind)).toEqual(['hr', 'paragraph']);
	});
});

describe('parseNote', () => {
	it('extracts the sentences of the Lektion 1 fixture', () => {
		expect(texts(fixture('lektion-1.md'))).toEqual([
			'Lektion 1: Laufzeitanalyse',
			'Heute geht es um die Laufzeit von Algorithmen.',
			'We count steps, not seconds!',
			'Das ist z. B. bei Karel wichtig.',
			'Die Laufzeit ist:',
			'Jeder Schritt kostet $1$ Zeiteinheit.',
			'Loops multiply the cost, d. h. eine Schleife mit $n$ Durchläufen kostet $n$ Schritte.',
			'Verschachtelte Schleifen: $n^2$',
			'Siehe [[Woche 1 (14.10.-20.10.)|Woche 1]] und #INF-K.',
			'Begriff',
			'Bedeutung',
			'Laufzeit',
			'Anzahl der Schritte',
			'Big O',
			'Obere Schranke für das Wachstum',
			'Merke',
			'Konstanten fallen in der O-Notation weg.',
			'Mehr dazu in BlueJ.',
			'Fragen bitte über Particify stellen.',
		]);
	});

	it('never includes Markdown structure in sentence ranges', () => {
		const note = parseNote(fixture('structure.md'));
		for (const s of note.sentences) {
			expect(note.text.slice(s.from, s.to)).toBe(s.text);
			expect(s.text).not.toMatch(/^(?:[-*+>#|]|\d+\.)\s/);
			expect(s.text).toBe(s.text.trim());
		}
		expect(note.sentences.map((s) => s.text)).toContain('Eine offene Aufgabe');
		expect(note.sentences.map((s) => s.text)).toContain('Achtung, wichtig');
		expect(note.sentences.map((s) => s.text)).toContain('Nested quote line.');
		expect(note.sentences.map((s) => s.text)).not.toContain('Raw HTML is never translated.');
		expect(note.sentences.map((s) => s.text)).not.toContain('A comment block that must stay hidden.');
	});

	it('skips sentences that contain nothing but protected syntax', () => {
		expect(texts('![[diagram.png]]\n\n#tag #other\n\n$x$ = $y$')).toEqual([]);
	});

	it('uses raw offsets for CRLF files', () => {
		const note = parseNote(fixture('crlf.md'));
		expect(note.sentences.map((s) => s.text)).toEqual([
			'Erste Zeile mit Windows-Zeilenenden.',
			'Zweiter Satz.',
			'Third sentence!',
			'Punkt eins',
			'Point two',
		]);
		for (const s of note.sentences) {
			expect(note.text.slice(s.from, s.to)).toBe(s.text);
			expect(s.text).not.toContain('\r');
		}
	});

	it('returns nothing for an empty note', () => {
		const note = parseNote(fixture('empty.md'));
		expect(note.blocks).toEqual([]);
		expect(note.sentences).toEqual([]);
	});

	it('keeps sentence hashes when paragraphs are reordered', () => {
		const a = 'Erster Absatz. Mit zwei Sätzen.\n\nSecond paragraph here.\n\n- Punkt eins\n- Punkt zwei';
		const b = '- Punkt zwei\n- Punkt eins\n\nSecond paragraph here.\n\nErster Absatz. Mit zwei Sätzen.';
		const hashes = (t: string) => new Set(parseNote(t).sentences.map((s) => s.hash));
		expect(hashes(b)).toEqual(hashes(a));
	});

	it('changes exactly one hash when one sentence is edited', () => {
		const before = parseNote('Eins ist hier. Zwei ist da.\n\nDrei bleibt.').sentences.map((s) => s.hash);
		const after = parseNote('Eins ist hier. Zwei ist dort.\n\nDrei bleibt.').sentences.map((s) => s.hash);
		const changed = after.filter((h) => !before.includes(h));
		expect(changed).toHaveLength(1);
		expect(after).toHaveLength(before.length);
	});

	it('finds sentences by line range', () => {
		const note = parseNote(fixture('lektion-1.md'));
		expect(sentencesInLines(note, 14, 17).map((s) => s.text)).toHaveLength(4);
		expect(sentencesInLines(note, 10, 12)).toEqual([]);
	});

	it('parses a long note quickly', () => {
		const text = fixture('long.md');
		const started = performance.now();
		const note = parseNote(text);
		const ms = performance.now() - started;
		expect(note.sentences.length).toBe(400 * 5);
		expect(ms).toBeLessThan(2000);
	});

	it('memoizes by text', () => {
		const parser = new NoteParser();
		const a = parser.parse('Hallo Welt.', DEFAULT_SEGMENT_OPTIONS);
		expect(parser.parse('Hallo Welt.', DEFAULT_SEGMENT_OPTIONS)).toBe(a);
		expect(parser.parse('Hallo Welt!', DEFAULT_SEGMENT_OPTIONS)).not.toBe(a);
	});
});

describe('sentence splitting', () => {
	it.each([
		['German abbreviations', 'Das gilt z. B. hier. Und u. a. dort.', ['Das gilt z. B. hier.', 'Und u. a. dort.']],
		['English abbreviations', 'Use e.g. this one. Dr. Smith agrees.', ['Use e.g. this one.', 'Dr. Smith agrees.']],
		['decimal numbers', 'Es dauert 1.5 Sekunden. Done.', ['Es dauert 1.5 Sekunden.', 'Done.']],
		['dates', 'Am 14. Oktober beginnt es. Gut.', ['Am 14. Oktober beginnt es.', 'Gut.']],
		['urls', 'Siehe https://a.de/x.html für mehr. Ok.', ['Siehe https://a.de/x.html für mehr.', 'Ok.']],
		['math with periods', 'Es gilt $a.b = 1$. Fertig.', ['Es gilt $a.b = 1$.', 'Fertig.']],
		['bold lead-in ending in a period', '- **SW und HW gehören zusammen (Folien 4–6).** Software abstrahiert. Ende.', ['**SW und HW gehören zusammen (Folien 4–6).**', 'Software abstrahiert.', 'Ende.']],
		['italic lead-in', '*Wichtig (Folie 3).* Rest des Satzes.', ['*Wichtig (Folie 3).*', 'Rest des Satzes.']],
		['highlight and strike lead-ins', '==Merke.== Dann ~~Alt.~~ Neu.', ['==Merke.==', 'Dann ~~Alt.~~', 'Neu.']],
		['bold ending with a colon stays whole', '**Software:** GNU-Toolchain. Mehr.', ['**Software:** GNU-Toolchain.', 'Mehr.']],
	])('handles %s', (_name, source, expected) => {
		expect(texts(source)).toEqual(expected);
	});

	it('works with the fallback segmenter (no Intl.Segmenter)', () => {
		setSegmenterForTesting(fallbackSegmenter);
		try {
			expect(texts('Eins. Zwei! Drei? z. B. hier.')).toEqual(['Eins.', 'Zwei!', 'Drei? z. B. hier.']);
		} finally {
			setSegmenterForTesting(null);
		}
	});
});
