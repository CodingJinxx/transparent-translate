/**
 * Live test against a real OpenAI-compatible endpoint. Not part of `npm test`.
 *
 * Run with `npm run test:live`. Reads connection details from the JSON file in
 * LLM_CONNECTION_FILE (default: `.llm_connection_details.json`, git-ignored):
 *   { "baseurl": "...", "model": "...", "apikey": "...", "reasoning": ["low", ...] }
 * The API key is never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LlmTranslator, type HttpClient, type LlmConfig } from '../../src/translator/llm-translator';
import { parseNote } from '../../src/core/note';
import { composeRange } from '../../src/core/compose';
import { restore } from '../../src/core/protect';
import type { TargetLanguage } from '../../src/core/types';
import { fixture } from '../unit/helpers';

const file = process.env.LLM_CONNECTION_FILE ?? '.llm_connection_details.json';

interface Details {
	baseurl: string;
	model: string;
	apikey?: string;
	reasoning?: string[];
}

function loadDetails(): Details | null {
	if (!existsSync(file)) return null;
	return JSON.parse(readFileSync(file, 'utf8')) as Details;
}

const details = loadDetails();

/** Prefers the cheapest reasoning level the provider lists. */
function lowestReasoning(levels: string[] | undefined): string | undefined {
	if (!levels || levels.length === 0) return undefined;
	const order = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
	return [...levels].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
}

const fetchHttp: HttpClient = async (req) => {
	const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
	const headers: Record<string, string> = {};
	res.headers.forEach((v, k) => (headers[k] = v));
	return { status: res.status, text: await res.text(), headers };
};

function makeTranslator(jsonMode = false): LlmTranslator {
	const reasoning = lowestReasoning(details?.reasoning);
	const config: LlmConfig = {
		baseUrl: details!.baseurl,
		model: details!.model,
		apiKey: details!.apikey ?? null,
		jsonMode,
		temperature: 0,
		maxTokens: 0,
		extraHeaders: {},
		extraBody: reasoning ? { reasoning_effort: reasoning } : {},
		timeoutMs: 120_000,
		maxRetries: 2,
	};
	return new LlmTranslator(() => config, fetchHttp);
}

async function translateNote(source: string, target: TargetLanguage, jsonMode = false) {
	const note = parseNote(source);
	const translator = makeTranslator(jsonMode);
	const result = await translator.translate(
		note.sentences.map((s) => ({ masked: s.masked, placeholderCount: s.tokens.length })),
		target,
		{ noteTitle: 'Lektion 1', glossary: ['Karel', 'BlueJ', 'Particify'] },
	);
	const byHash = new Map<string, string>();
	note.sentences.forEach((s, i) => {
		const r = result.items[i]!;
		if (r.ok) byHash.set(s.hash, restore(r.text, s.tokens));
	});
	const composed = composeRange(source, 0, source.length, note.sentences, (s) => {
		const t = byHash.get(s.hash);
		return t === undefined ? { kind: 'failed' } : { kind: 'translated', text: t };
	});
	return { note, result, composed };
}

describe.skipIf(!details)('live LLM endpoint', () => {
	it('tests the connection', async () => {
		const test = await makeTranslator().testConnection();
		console.log(`[live] model=${test.model} "${test.text}" in ${test.ms} ms, usage`, test.usage);
		expect(test.text.toLowerCase()).toContain('morning');
	});

	it.each(['en', 'de'] as const)('translates the Lektion 1 fixture into %s with all syntax intact', async (target) => {
		const source = fixture('lektion-1.md');
		const { note, result, composed } = await translateNote(source, target);
		const langs = result.items.map((r) => (r.ok ? (r.lang ?? '?') : 'x')).join(' ');
		console.log(`[live] ${target} usage`, result.usage, `failed=${composed.failed}`, `langs=${langs}`);
		console.log(composed.text);

		expect(composed.failed).toBe(0);
		// Every protected span survives verbatim.
		for (const s of note.sentences) for (const token of s.tokens) expect(composed.text).toContain(token);
		// Structure (line count, code, math, frontmatter) is untouched.
		expect(composed.text.split('\n')).toHaveLength(source.split('\n').length);
		expect(composed.text).toContain('$$\nT(n) = 3n + 2\n$$');
		expect(composed.text).toContain('for (int i = 0; i < n; i++) { move(); }');
		expect(composed.text.startsWith('---\ntags: [vorlesung]\nkurs: INF-K\n---\n')).toBe(true);
		for (const term of ['Karel', 'BlueJ', 'Particify']) expect(composed.text).toContain(term);
	});

	it('works in JSON mode', async () => {
		const { composed } = await translateNote('Guten Morgen. Wie geht es dir?\n\n- Siehe [[Woche 1]].', 'en', true);
		console.log('[live] json mode:', composed.text);
		expect(composed.failed).toBe(0);
		expect(composed.text).toContain('[[Woche 1]]');
	});
});
