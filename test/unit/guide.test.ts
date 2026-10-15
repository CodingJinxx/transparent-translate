import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitGuide } from '../../src/core/guide';
import { de } from '../../src/i18n/de';
import { en } from '../../src/i18n/en';

const guides = {
	en: readFileSync('docs/guide.en.md', 'utf8'),
	de: readFileSync('docs/guide.de.md', 'utf8'),
};

describe('splitGuide', () => {
	it('splits at level-2 headings and ignores headings in code blocks', () => {
		const sections = splitGuide('intro\n\n## One\n\ntext\n\n```\n## not a heading\n```\n\n## Two\n\n- a\n- b\n');
		expect(sections.map((s) => s.title)).toEqual(['One', 'Two']);
		expect(sections[0]!.body).toContain('## not a heading');
		expect(sections[1]!.body).toBe('- a\n- b');
	});

	it('handles Windows line endings and an empty guide', () => {
		expect(splitGuide('## A\r\n\r\ntext\r\n').map((s) => s.title)).toEqual(['A']);
		expect(splitGuide('')).toEqual([]);
	});
});

describe('user guide', () => {
	it('has the same sections in English and German, each with content', () => {
		const english = splitGuide(guides.en);
		const german = splitGuide(guides.de);
		expect(english.length).toBeGreaterThanOrEqual(8);
		expect(german).toHaveLength(english.length);
		for (const section of [...english, ...german]) {
			expect(section.title.length).toBeGreaterThan(0);
			expect(section.body.length).toBeGreaterThan(40);
		}
	});

	it.each([
		['en', en],
		['de', de],
	] as const)('names every command and key setting exactly as the %s interface does', (language, table) => {
		const guide = guides[language].toLowerCase();
		const grouped = /^command\.(show-|names-)/;
		for (const [key, value] of Object.entries(table)) {
			if (!key.startsWith('command.') || grouped.test(key)) continue;
			expect(guide, `${language} guide should mention "${value}"`).toContain(value.toLowerCase());
		}
		for (const key of ['settings.animate', 'settings.default-mode', 'settings.exclude-cache.button'] as const) {
			expect(guide, `${language} guide should mention "${table[key]}"`).toContain(table[key].toLowerCase());
		}
	});

	it('does not use HTML or images that the in-app renderer could not show', () => {
		for (const guide of Object.values(guides)) {
			expect(guide).not.toMatch(/<(?!kbd)\w+/);
			expect(guide).not.toMatch(/!\[/);
		}
	});
});
