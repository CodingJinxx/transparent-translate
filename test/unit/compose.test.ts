import { describe, expect, it } from 'vitest';
import { composeRange, type SentenceDisplay } from '../../src/core/compose';
import { parseNote } from '../../src/core/note';
import { restore } from '../../src/core/protect';
import { fixture } from './helpers';

describe('composeRange', () => {
	const source = '- Hallo Welt. Mit $x$ Formel.\n- Already English.';
	const note = parseNote(source);
	const translations: Record<string, string> = {
		'Hallo Welt.': 'Hello world.',
		'Mit ⟦1⟧ Formel.': 'With ⟦1⟧ formula.',
	};
	const display = (s: { masked: string; tokens: string[] }): SentenceDisplay => {
		const t = translations[s.masked];
		return t ? { kind: 'translated', text: restore(t, s.tokens) } : { kind: 'same' };
	};

	it('replaces sentences and keeps structure and protected spans', () => {
		const result = composeRange(source, 0, source.length, note.sentences, display);
		expect(result.text).toBe('- Hello world. With $x$ formula.\n- Already English.');
		expect(result.translated).toBe(2);
	});

	it('returns the source unchanged when nothing is translated', () => {
		const text = fixture('lektion-1.md');
		const n = parseNote(text);
		expect(composeRange(text, 0, text.length, n.sentences, () => ({ kind: 'same' })).text).toBe(text);
	});

	it('wraps untranslated sentences in marker spans when asked', () => {
		const result = composeRange(source, 0, source.length, note.sentences, () => ({ kind: 'pending' }), {
			markerClassPrefix: 'tt',
		});
		expect(result.text).toContain('<span class="tt-pending">Hallo Welt.</span>');
		expect(result.pending).toBe(3);
	});

	it('composes a sub range only', () => {
		const firstLineEnd = source.indexOf('\n');
		const result = composeRange(source, 0, firstLineEnd, note.sentences, display);
		expect(result.text).toBe('- Hello world. With $x$ formula.');
	});
});
