import { describe, expect, it } from 'vitest';
import { parseJsonOutput, parseNumberedOutput } from '../../src/core/output-parser';

describe('parseNumberedOutput', () => {
	it('parses well-formed output', () => {
		expect(parseNumberedOutput('<<1>> Hello.\n<<2>> World ⟦1⟧.', 2)).toEqual({ ok: true, texts: ['Hello.', 'World ⟦1⟧.'] });
	});

	it('tolerates code fences, reasoning blocks, spacing and out-of-order markers', () => {
		const output = '<think>hmm</think>\n```\n<< 2 >>  B\n<<1>>A\n```';
		expect(parseNumberedOutput(output, 2)).toEqual({ ok: true, texts: ['A', 'B'] });
	});

	it('joins accidental line breaks inside one item', () => {
		expect(parseNumberedOutput('<<1>> first\npart\n<<2>> second', 2)).toEqual({ ok: true, texts: ['first part', 'second'] });
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
		expect(parseJsonOutput(output, 2)).toEqual({ ok: true, texts: ['a', 'b'] });
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
