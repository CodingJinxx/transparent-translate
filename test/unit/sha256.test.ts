import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/core/sha256';
import { normalizeSentence, sentenceHash } from '../../src/core/text';

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
	it.each([
		'',
		'abc',
		'Guten Morgen',
		'Größenordnung ⟦1⟧ – Übersicht 😀',
		'a'.repeat(55),
		'a'.repeat(56),
		'a'.repeat(63),
		'a'.repeat(64),
		'a'.repeat(65),
		'x'.repeat(1000),
	])('matches node:crypto for %#', (input) => {
		expect(sha256Hex(input)).toBe(nodeSha(input));
	});
});

describe('sentenceHash', () => {
	it('ignores whitespace differences and Unicode normalization form', () => {
		expect(sentenceHash('Hallo   Welt ')).toBe(sentenceHash('Hallo Welt'));
		expect(sentenceHash('Größe')).toBe(sentenceHash('Größe'));
	});

	it('distinguishes different text', () => {
		expect(sentenceHash('Hallo Welt.')).not.toBe(sentenceHash('Hallo Welt!'));
	});

	it('normalizes to single spaces', () => {
		expect(normalizeSentence(' a \t b\n c ')).toBe('a b c');
	});
});
