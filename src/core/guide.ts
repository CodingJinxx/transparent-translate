export interface GuideSection {
	title: string;
	/** Markdown without the heading line. */
	body: string;
}

/**
 * Splits the user guide into sections at its `## ` headings. Headings inside
 * fenced code blocks do not count.
 */
export function splitGuide(markdown: string): GuideSection[] {
	const sections: GuideSection[] = [];
	let current: { title: string; lines: string[] } | null = null;
	let fenced = false;
	for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		const heading = !fenced ? /^##\s+(.+?)\s*$/.exec(line) : null;
		if (heading) {
			if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() });
			current = { title: heading[1]!, lines: [] };
		} else if (current) {
			current.lines.push(line);
		}
	}
	if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() });
	return sections;
}
