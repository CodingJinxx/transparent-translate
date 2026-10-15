import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../../src/core/language';

describe('detectLanguage', () => {
	it.each([
		['We count steps, not seconds!', 'en'],
		['This is the first sentence of the note.', 'en'],
		['Heute geht es um die Laufzeit von Algorithmen.', 'de'],
		['Das ist der erste Satz.', 'de'],
		['Fragen bitte über Particify stellen.', 'de'],
	])('detects %s', (text, lang) => {
		expect(detectLanguage(text)).toBe(lang);
	});

	it.each([
		['mixed', 'Loops multiply the cost, d. h. eine Schleife mit ⟦1⟧ Durchläufen kostet ⟦2⟧ Schritte.'],
		['too short', 'Big O'],
		['no function words', 'Karel BlueJ Particify Runtime'],
		['placeholders only', '⟦1⟧ ⟦2⟧ ⟦3⟧ ⟦4⟧'],
	])('returns null for %s', (_name, text) => {
		expect(detectLanguage(text)).toBeNull();
	});
});
