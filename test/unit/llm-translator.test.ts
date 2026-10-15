import { describe, expect, it } from 'vitest';
import { LlmTranslator, type HttpRequest, type HttpResponse, type LlmConfig } from '../../src/translator/llm-translator';
import { TranslatorError } from '../../src/translator/translator';

const config = (overrides: Partial<LlmConfig> = {}): LlmConfig => ({
	baseUrl: 'https://api.example.com/v1/',
	model: 'test-model',
	apiKey: 'sk-test',
	jsonMode: false,
	temperature: 0,
	maxTokens: 0,
	extraHeaders: {},
	extraBody: {},
	timeoutMs: 1000,
	maxRetries: 2,
	...overrides,
});

const reply = (content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }): HttpResponse => ({
	status: 200,
	text: JSON.stringify({ choices: [{ message: { content } }], usage }),
	headers: {},
});

function fakeHttp(responses: Array<HttpResponse | Error | (() => Promise<HttpResponse>)>) {
	const requests: HttpRequest[] = [];
	const http = async (req: HttpRequest): Promise<HttpResponse> => {
		requests.push(req);
		const next = responses.shift();
		if (!next) throw new Error('no more responses');
		if (next instanceof Error) throw next;
		if (typeof next === 'function') return next();
		return next;
	};
	return { http, requests };
}

const noSleep = async () => {};
const ctx = { noteTitle: 'Note', glossary: [] };
const item = (masked: string, placeholderCount = 0) => ({ masked, placeholderCount });

describe('LlmTranslator', () => {
	it('sends an OpenAI-compatible request and parses <<n>> output', async () => {
		const { http, requests } = fakeHttp([reply('<<1>> Good morning.\n<<2>> See ⟦1⟧.')]);
		const translator = new LlmTranslator(() => config({ extraBody: { reasoning_effort: 'low' }, extraHeaders: { 'X-Title': 'tt' } }), http, noSleep);
		const result = await translator.translate([item('Guten Morgen.'), item('Siehe ⟦1⟧.', 1)], 'en', ctx);

		expect(result.items).toEqual([
			{ ok: true, text: 'Good morning.' },
			{ ok: true, text: 'See ⟦1⟧.' },
		]);
		expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
		expect(requests).toHaveLength(1);
		const req = requests[0]!;
		expect(req.url).toBe('https://api.example.com/v1/chat/completions');
		expect(req.headers.Authorization).toBe('Bearer sk-test');
		expect(req.headers['X-Title']).toBe('tt');
		const body = JSON.parse(req.body!) as Record<string, unknown>;
		expect(body).toMatchObject({ model: 'test-model', temperature: 0, stream: false, reasoning_effort: 'low' });
		expect(body).not.toHaveProperty('max_tokens');
		expect(body).not.toHaveProperty('response_format');
	});

	it('omits the Authorization header without a key', async () => {
		const { http, requests } = fakeHttp([reply('<<1>> Hi')]);
		await new LlmTranslator(() => config({ apiKey: null }), http, noSleep).translate([item('Hallo')], 'en', ctx);
		expect(requests[0]!.headers).not.toHaveProperty('Authorization');
	});

	it('retries a malformed response once', async () => {
		const { http, requests } = fakeHttp([reply('Here you go: Hello'), reply('<<1>> Hello')]);
		const result = await new LlmTranslator(() => config(), http, noSleep).translate([item('Hallo')], 'en', ctx);
		expect(result.items[0]).toEqual({ ok: true, text: 'Hello' });
		expect(requests).toHaveLength(2);
	});

	it('fails the batch after two malformed responses', async () => {
		const { http } = fakeHttp([reply('<<1>> only one'), reply('<<1>> still one')]);
		const result = await new LlmTranslator(() => config(), http, noSleep).translate([item('A'), item('B')], 'en', ctx);
		expect(result.items.every((r) => !r.ok)).toBe(true);
		expect(result.items[0]).toMatchObject({ error: expect.stringContaining('missing marker <<2>>') as unknown });
	});

	it('retries only sentences whose placeholders were broken', async () => {
		const { http, requests } = fakeHttp([reply('<<1>> Fine.\n<<2>> Lost the placeholder.'), reply('<<1>> Kept ⟦1⟧.')]);
		const result = await new LlmTranslator(() => config(), http, noSleep).translate([item('Gut.'), item('Mit ⟦1⟧.', 1)], 'en', ctx);
		expect(result.items).toEqual([
			{ ok: true, text: 'Fine.' },
			{ ok: true, text: 'Kept ⟦1⟧.' },
		]);
		expect(requests[1]!.body).toContain('<<1>> Mit ⟦1⟧.');
		expect(requests[1]!.body).not.toContain('Gut.');
	});

	it('marks a sentence failed when its placeholders stay broken', async () => {
		const { http } = fakeHttp([reply('<<1>> Lost.'), reply('<<1>> Lost again.')]);
		const result = await new LlmTranslator(() => config(), http, noSleep).translate([item('Mit ⟦1⟧.', 1)], 'en', ctx);
		expect(result.items[0]).toEqual({ ok: false, error: 'Placeholders were changed by the model' });
	});

	it('supports JSON mode', async () => {
		const { http, requests } = fakeHttp([reply('{"translations": ["Hallo", "Welt"]}')]);
		const result = await new LlmTranslator(() => config({ jsonMode: true, maxTokens: 500 }), http, noSleep).translate([item('Hello'), item('World')], 'de', ctx);
		expect(result.items).toEqual([
			{ ok: true, text: 'Hallo' },
			{ ok: true, text: 'Welt' },
		]);
		const body = JSON.parse(requests[0]!.body!) as Record<string, unknown>;
		expect(body.response_format).toEqual({ type: 'json_object' });
		expect(body.max_tokens).toBe(500);
	});

	it('retries rate limits and server errors with backoff, honouring Retry-After', async () => {
		const sleeps: number[] = [];
		const { http } = fakeHttp([
			{ status: 429, text: '{"error":{"message":"slow down"}}', headers: { 'Retry-After': '2' } },
			{ status: 503, text: 'unavailable', headers: {} },
			reply('<<1>> ok'),
		]);
		const translator = new LlmTranslator(() => config(), http, async (ms) => {
			sleeps.push(ms);
		});
		const result = await translator.translate([item('x')], 'en', ctx);
		expect(result.items[0]).toEqual({ ok: true, text: 'ok' });
		expect(sleeps[0]).toBe(2000);
		expect(sleeps).toHaveLength(2);
	});

	it('gives up after maxRetries', async () => {
		const { http } = fakeHttp([
			{ status: 500, text: 'a', headers: {} },
			{ status: 500, text: 'b', headers: {} },
		]);
		await expect(new LlmTranslator(() => config({ maxRetries: 1 }), http, noSleep).translate([item('x')], 'en', ctx)).rejects.toMatchObject({ kind: 'http', status: 500 });
	});

	it('does not retry authentication errors', async () => {
		const { http, requests } = fakeHttp([{ status: 401, text: '{"error":{"message":"bad key"}}', headers: {} }]);
		await expect(new LlmTranslator(() => config(), http, noSleep).translate([item('x')], 'en', ctx)).rejects.toMatchObject({
			kind: 'auth',
			message: expect.stringContaining('bad key') as unknown,
		});
		expect(requests).toHaveLength(1);
	});

	it('retries network errors', async () => {
		const { http } = fakeHttp([new Error('ECONNREFUSED'), reply('<<1>> ok')]);
		const result = await new LlmTranslator(() => config(), http, noSleep).translate([item('x')], 'en', ctx);
		expect(result.items[0]!.ok).toBe(true);
	});

	it('times out slow requests', async () => {
		const { http } = fakeHttp([() => new Promise<HttpResponse>(() => {})]);
		await expect(new LlmTranslator(() => config({ timeoutMs: 20, maxRetries: 0 }), http, noSleep).translate([item('x')], 'en', ctx)).rejects.toMatchObject({ kind: 'timeout' });
	});

	it('can be cancelled', async () => {
		const controller = new AbortController();
		const { http } = fakeHttp([() => new Promise<HttpResponse>(() => {})]);
		const pending = new LlmTranslator(() => config({ timeoutMs: 0 }), http, noSleep).translate([item('x')], 'en', ctx, controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
	});

	it('validates configuration before sending anything', async () => {
		const { http, requests } = fakeHttp([]);
		await expect(new LlmTranslator(() => config({ model: ' ' }), http, noSleep).translate([item('x')], 'en', ctx)).rejects.toBeInstanceOf(TranslatorError);
		await expect(new LlmTranslator(() => config({ baseUrl: 'ftp://x' }), http, noSleep).translate([item('x')], 'en', ctx)).rejects.toMatchObject({ kind: 'config' });
		expect(requests).toHaveLength(0);
	});

	it('accepts content returned as an array of parts', async () => {
		const { http } = fakeHttp([{ status: 200, text: JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: '<<1>> ok' }] } }] }), headers: {} }]);
		const result = await new LlmTranslator(() => config(), http, noSleep).translate([item('x')], 'en', ctx);
		expect(result.items[0]).toEqual({ ok: true, text: 'ok' });
		expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
	});

	it('lists models and tests the connection', async () => {
		const { http, requests } = fakeHttp([
			{ status: 200, text: JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }, { nope: 1 }] }), headers: {} },
			reply('<<1>> Good morning'),
		]);
		const translator = new LlmTranslator(() => config(), http, noSleep);
		expect(await translator.listModels()).toEqual(['a-model', 'b-model']);
		expect(requests[0]).toMatchObject({ method: 'GET', url: 'https://api.example.com/v1/models' });
		const test = await translator.testConnection();
		expect(test.text).toBe('Good morning');
		expect(test.model).toBe('test-model');
	});
});
