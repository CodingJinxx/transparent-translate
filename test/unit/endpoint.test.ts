import { describe, expect, it } from 'vitest';
import { EndpointMonitor } from '../../src/services/endpoint-monitor';
import { LlmTranslator, type HttpClient, type LlmConfig } from '../../src/translator/llm-translator';

describe('EndpointMonitor', () => {
	function setup(answers: boolean[]) {
		let calls = 0;
		let time = 0;
		const monitor = new EndpointMonitor(
			async () => {
				const answer = answers[Math.min(calls, answers.length - 1)]!;
				calls++;
				return answer;
			},
			() => time,
		);
		return { monitor, calls: () => calls, advance: (ms: number) => (time += ms) };
	}

	it('trusts a reachable endpoint for a while, then checks again', async () => {
		const { monitor, calls, advance } = setup([true]);
		expect(monitor.status).toBe('unknown');
		expect(await monitor.check()).toBe(true);
		expect(await monitor.check()).toBe(true);
		expect(calls()).toBe(1);
		expect(monitor.status).toBe('reachable');
		advance(31_000);
		await monitor.check();
		expect(calls()).toBe(2);
	});

	it('checks an unreachable endpoint every time, so recovery is noticed at once', async () => {
		const { monitor, calls } = setup([false, false, true]);
		expect(await monitor.check()).toBe(false);
		expect(monitor.status).toBe('unreachable');
		expect(await monitor.check()).toBe(false);
		expect(await monitor.check()).toBe(true);
		expect(calls()).toBe(3);
	});

	it('shares one check between concurrent callers and treats a throwing ping as unreachable', async () => {
		const { monitor, calls } = setup([true]);
		const [a, b] = await Promise.all([monitor.check(), monitor.check()]);
		expect([a, b]).toEqual([true, true]);
		expect(calls()).toBe(1);

		const failing = new EndpointMonitor(async () => {
			throw new Error('boom');
		});
		expect(await failing.check()).toBe(false);
	});

	it('remembers a failed request and forgets everything on reset', async () => {
		const { monitor } = setup([true]);
		await monitor.check();
		monitor.markUnreachable();
		expect(monitor.status).toBe('unreachable');
		expect(await monitor.check()).toBe(true);
		monitor.reset();
		expect(monitor.status).toBe('unknown');
	});
});

describe('LlmTranslator.ping', () => {
	const config = (baseUrl: string): LlmConfig => ({
		baseUrl,
		model: 'm',
		apiKey: null,
		jsonMode: false,
		temperature: 0,
		maxTokens: 0,
		extraHeaders: {},
		extraBody: {},
		timeoutMs: 1000,
		maxRetries: 0,
	});

	const translator = (http: HttpClient, baseUrl = 'http://localhost:1234/v1') => new LlmTranslator(() => config(baseUrl), http);

	it('counts any HTTP answer as reachable, including errors', async () => {
		for (const status of [200, 401, 404, 500]) {
			expect(await translator(async () => ({ status, text: '', headers: {} })).ping()).toBe(true);
		}
	});

	it('is false for network errors, hanging servers and unusable URLs', async () => {
		expect(
			await translator(async () => {
				throw new Error('ECONNREFUSED');
			}).ping(),
		).toBe(false);
		expect(await translator(() => new Promise(() => undefined)).ping(30)).toBe(false);
		expect(await translator(async () => ({ status: 200, text: '', headers: {} }), 'not a url').ping()).toBe(false);
		expect(await translator(async () => ({ status: 200, text: '', headers: {} }), '').ping()).toBe(false);
	});

	it('asks the models route with the configured headers', async () => {
		let seen = '';
		await translator(async (request) => {
			seen = `${request.method} ${request.url}`;
			return { status: 200, text: '', headers: {} };
		}).ping();
		expect(seen).toBe('GET http://localhost:1234/v1/models');
	});
});
