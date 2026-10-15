import { describe, expect, it } from 'vitest';
import { parseJsonOutput, parseNumberedOutput } from '../../src/core/output-parser';

describe('parseNumberedOutput', () => {
	it('parses well-formed output', () => {
		expect(parseNumberedOutput('<<1>> Hello.\n<<2>> World ⟦1⟧.', 2)).toMatchObject({ ok: true, texts: ['Hello.', 'World ⟦1⟧.'] });
	});

	it('tolerates code fences, reasoning blocks, spacing and out-of-order markers', () => {
		const output = '<think>hmm</think>\n```\n<< 2 >>  B\n<<1>>A\n```';
		expect(parseNumberedOutput(output, 2)).toMatchObject({ ok: true, texts: ['A', 'B'] });
	});

	it('joins accidental line breaks inside one item', () => {
		expect(parseNumberedOutput('<<1>> first\npart\n<<2>> second', 2)).toMatchObject({ ok: true, texts: ['first part', 'second'] });
	});

	it.each([
		['no markers', 'Hello world', 1, 'no <<n>> markers'],
		['missing', '<<1>> a', 2, 'missing marker <<2>>'],
		['duplicate', '<<1>> a\n<<1>> b', 2, 'duplicate marker <<1>>'],
		['out of range', '<<1>> a\n<<3>> b', 2, 'unexpected marker <<3>>'],
	])('rejects %s', (_name, output, count, reason) => {
		const result = parseNumberedOutput(output, count);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain(reason);
	});
});

describe('parseJsonOutput', () => {
	it.each([
		['object', '{"translations": ["a", "b"]}'],
		['bare array', '["a", "b"]'],
		['other key', '{"result": ["a", "b"]}'],
		['fenced', '```json\n{"translations": ["a", "b"]}\n```'],
	])('parses %s', (_name, output) => {
		expect(parseJsonOutput(output, 2)).toMatchObject({ ok: true, texts: ['a', 'b'] });
	});

	it.each([
		['wrong count', '["a"]'],
		['not json', 'translations: a, b'],
		['non strings', '[1, 2]'],
		['no array', '{"a": 1}'],
	])('rejects %s', (_name, output) => {
		expect(parseJsonOutput(output, 2).ok).toBe(false);
	});
});

describe('source language tags', () => {
	it('reads optional {lang} tags in line output', () => {
		expect(parseNumberedOutput('<<1>> {de} Hello.\n<<2>> {EN} Fine.\n<<3>> { mixed } Both.\n<<4>> Untagged.', 4)).toEqual({
			ok: true,
			texts: ['Hello.', 'Fine.', 'Both.', 'Untagged.'],
			langs: ['de', 'en', 'mixed', undefined],
		});
	});

	it('reads {lang, text} objects in JSON output', () => {
		expect(parseJsonOutput('{"translations": [{"lang": "de", "text": "Hi"}, "{en} Yo", "plain"]}', 3)).toEqual({
			ok: true,
			texts: ['Hi', 'Yo', 'plain'],
			langs: ['de', 'en', undefined],
		});
	});

	it('does not treat other braces as tags', () => {
		expect(parseNumberedOutput('<<1>> {fr} text', 1)).toMatchObject({ texts: ['{fr} text'], langs: [undefined] });
	});
});

describe('tag variants', () => {
	it.each(['[de] Hi', 'de: Hi', '{ de } Hi'])('accepts %s', (line) => {
		expect(parseNumberedOutput(`<<1>> ${line}`, 1)).toMatchObject({ texts: ['Hi'], langs: ['de'] });
	});

	it('does not strip words that only look like codes', () => {
		expect(parseNumberedOutput('<<1>> Mixed feelings.', 1)).toMatchObject({ texts: ['Mixed feelings.'], langs: [undefined] });
	});
});
