/**
 * Parses model output. The default format is one `<<n>> text` line per
 * sentence, which small local models follow more reliably than JSON. JSON
 * mode is optional for providers that support `response_format`.
 */

export type ParseResult = { ok: true; texts: string[] } | { ok: false; reason: string };

function stripCodeFence(output: string): string {
	const trimmed = output.trim();
	const fenced = /^```[\w-]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
	return fenced ? fenced[1]! : trimmed;
}

/** Removes reasoning blocks some models emit before the answer (`<think>…</think>`). */
function stripReasoning(output: string): string {
	return output.replace(/<think>[\s\S]*?<\/think>/gi, '');
}

export function parseNumberedOutput(output: string, count: number): ParseResult {
	const body = stripCodeFence(stripReasoning(output));
	const marker = /<<\s*(\d+)\s*>>/g;
	const found: Array<{ n: number; start: number; end: number }> = [];
	let m: RegExpExecArray | null;
	while ((m = marker.exec(body))) found.push({ n: Number(m[1]), start: m.index, end: m.index + m[0].length });

	if (found.length === 0) return { ok: false, reason: 'no <<n>> markers in output' };
	const texts = new Array<string | undefined>(count).fill(undefined);
	for (let k = 0; k < found.length; k++) {
		const cur = found[k]!;
		const next = found[k + 1];
		if (cur.n < 1 || cur.n > count) return { ok: false, reason: `unexpected marker <<${cur.n}>>` };
		if (texts[cur.n - 1] !== undefined) return { ok: false, reason: `duplicate marker <<${cur.n}>>` };
		const text = body
			.slice(cur.end, next ? next.start : body.length)
			.replace(/\s*\n\s*/g, ' ')
			.trim();
		texts[cur.n - 1] = text;
	}
	const missing = texts.findIndex((t) => t === undefined);
	if (missing !== -1) return { ok: false, reason: `missing marker <<${missing + 1}>>` };
	return { ok: true, texts: texts as string[] };
}

export function parseJsonOutput(output: string, count: number): ParseResult {
	const body = stripCodeFence(stripReasoning(output));
	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch {
		return { ok: false, reason: 'output is not valid JSON' };
	}
	let list: unknown = raw;
	if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
		const obj = raw as Record<string, unknown>;
		list = obj.translations ?? Object.values(obj).find((v) => Array.isArray(v));
	}
	if (!Array.isArray(list)) return { ok: false, reason: 'JSON output has no array' };
	if (list.length !== count) return { ok: false, reason: `expected ${count} items, got ${list.length}` };
	if (!list.every((x) => typeof x === 'string')) return { ok: false, reason: 'JSON array contains non-strings' };
	return { ok: true, texts: (list as string[]).map((t) => t.trim()) };
}
