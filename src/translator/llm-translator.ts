import type { TargetLanguage } from '../core/types';
import { buildMessages, type ChatMessage, type PromptItem } from '../core/prompt';
import { parseJsonOutput, parseNumberedOutput, type ParseResult } from '../core/output-parser';
import { placeholdersValid, tidyPlaceholders } from '../core/protect';
import { buildReviewMessages, parseReviewOutput, type ReviewPair, type ReviewTerm } from '../core/term-review';
import {
	TranslatorError,
	type ItemResult,
	type TokenUsage,
	type TranslateResult,
	type TranslationContext,
	type TranslationItem,
	type Translator,
} from './translator';

export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
}

export interface HttpResponse {
	status: number;
	text: string;
	headers: Record<string, string>;
}

/** Injected so the translator runs without Obsidian (tests use a fake). */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export interface LlmConfig {
	baseUrl: string;
	model: string;
	apiKey: string | null;
	jsonMode: boolean;
	temperature: number;
	/** 0 means "do not send max_tokens". */
	maxTokens: number;
	extraHeaders: Record<string, string>;
	/** Merged into the request body, e.g. `{"reasoning_effort": "low"}`. */
	extraBody: Record<string, unknown>;
	timeoutMs: number;
	maxRetries: number;
}

export interface ConnectionTestResult {
	text: string;
	ms: number;
	usage: TokenUsage;
	model: string;
}

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

const defaultSleep: Sleep = (ms, signal) =>
	new Promise((resolve, reject) => {
		const timer = window.setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				window.clearTimeout(timer);
				reject(new TranslatorError('Request cancelled', 'aborted'));
			},
			{ once: true },
		);
	});

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.trim().replace(/\/+$/, '')}/${path}`;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	return key ? headers[key] : undefined;
}

/** Extracts a readable error message from an OpenAI-style error body. */
function errorMessage(text: string): string {
	try {
		const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
		if (typeof body.error === 'string') return body.error;
		if (body.error?.message) return body.error.message;
		if (body.message) return body.message;
	} catch {
		// Not JSON.
	}
	return text.slice(0, 200);
}

function messageContent(json: unknown): string {
	const choices = (json as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
	const content = choices?.[0]?.message?.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content.map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? ''))).join('');
	}
	throw new TranslatorError('Response has no message content', 'format');
}

function usageOf(json: unknown): TokenUsage {
	const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
	return { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 };
}

export class LlmTranslator implements Translator {
	constructor(
		private readonly getConfig: () => LlmConfig,
		private readonly http: HttpClient,
		private readonly sleep: Sleep = defaultSleep,
	) {}

	async translate(
		items: readonly TranslationItem[],
		target: TargetLanguage,
		ctx: TranslationContext,
		signal?: AbortSignal,
	): Promise<TranslateResult> {
		const config = this.checkedConfig();
		const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
		const results: ItemResult[] = items.map(() => ({ ok: false, error: 'not translated' }));
		if (items.length === 0) return { items: results, usage, model: config.model };

		// First pass: the whole batch. A malformed response (wrong count or
		// numbering) is retried once before the batch counts as failed.
		let pending = items.map((_, index) => index);
		for (let pass = 0; pass < 2 && pending.length > 0; pass++) {
			const batch = pending.map((index) => items[index]!);
			let parsed: ParseResult = { ok: false, reason: 'not requested' };
			for (let attempt = 0; attempt < 2; attempt++) {
				const response = await this.chat(this.messages(batch, target, ctx, config), config, signal);
				usage.inputTokens += response.usage.inputTokens;
				usage.outputTokens += response.usage.outputTokens;
				parsed = config.jsonMode
					? parseJsonOutput(response.content, batch.length)
					: parseNumberedOutput(response.content, batch.length);
				if (parsed.ok) break;
			}
			if (!parsed.ok) {
				for (const index of pending) results[index] = { ok: false, error: `Invalid model output: ${parsed.reason}` };
				break;
			}

			// Second pass: only the sentences whose placeholders did not survive.
			const retry: number[] = [];
			const langs = parsed.langs;
			parsed.texts.forEach((raw, k) => {
				const index = pending[k]!;
				const item = items[index]!;
				const text = tidyPlaceholders(raw);
				if (text.length > 0 && placeholdersValid(text, item.placeholderCount)) {
					const lang = langs[k];
					results[index] = lang ? { ok: true, text, lang } : { ok: true, text };
				} else {
					results[index] = { ok: false, error: 'Placeholders were changed by the model' };
					retry.push(index);
				}
			});
			pending = retry;
		}

		return { items: results, usage, model: config.model };
	}

	/**
	 * True if the endpoint answers at all. Any HTTP response counts (a missing
	 * `/models` route or a rejected key still means the server is there); only
	 * network errors and timeouts do not.
	 */
	async ping(timeoutMs = 3000): Promise<boolean> {
		const config = this.getConfig();
		if (!/^https?:\/\//i.test(config.baseUrl.trim())) return false;
		let timer: number | undefined;
		try {
			await Promise.race([
				this.http({ url: joinUrl(config.baseUrl, 'models'), method: 'GET', headers: this.headers(config) }),
				new Promise<never>((_, reject) => {
					timer = window.setTimeout(() => reject(new TranslatorError('Endpoint did not answer', 'timeout')), timeoutMs);
				}),
			]);
			return true;
		} catch {
			return false;
		} finally {
			if (timer !== undefined) window.clearTimeout(timer);
		}
	}

	/** Asks which terms of a translation were a judgment call. See `core/term-review`. */
	async reviewTerms(
		pairs: readonly ReviewPair[],
		target: TargetLanguage,
		knownTerms: readonly string[],
		signal?: AbortSignal,
	): Promise<{ terms: ReviewTerm[]; usage: TokenUsage }> {
		const config = this.checkedConfig();
		const response = await this.chat(buildReviewMessages(pairs, target, knownTerms), config, signal);
		return { terms: parseReviewOutput(response.content, pairs.map((p) => p.source)), usage: response.usage };
	}

	/** Lists model ids from `GET /models`. Not every server supports it. */
	async listModels(signal?: AbortSignal): Promise<string[]> {
		const config = this.getConfig();
		if (!config.baseUrl.trim()) throw new TranslatorError('Base URL is empty', 'config');
		const response = await this.send({ url: joinUrl(config.baseUrl, 'models'), method: 'GET', headers: this.headers(config) }, config, signal);
		const json = JSON.parse(response.text) as { data?: Array<{ id?: unknown }> };
		const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
		return ids.sort((a, b) => a.localeCompare(b));
	}

	/** Translates "Guten Morgen" into English and reports latency and usage. */
	async testConnection(signal?: AbortSignal): Promise<ConnectionTestResult> {
		const started = Date.now();
		const result = await this.translate([{ masked: 'Guten Morgen', placeholderCount: 0 }], 'en', { noteTitle: '', glossary: [] }, signal);
		const first = result.items[0];
		if (!first?.ok) throw new TranslatorError(first?.error ?? 'No result', 'format');
		return { text: first.text, ms: Date.now() - started, usage: result.usage, model: result.model };
	}

	private checkedConfig(): LlmConfig {
		const config = this.getConfig();
		if (!config.baseUrl.trim()) throw new TranslatorError('No base URL configured', 'config');
		if (!/^https?:\/\//i.test(config.baseUrl.trim())) throw new TranslatorError('Base URL must start with http:// or https://', 'config');
		if (!config.model.trim()) throw new TranslatorError('No model configured', 'config');
		return config;
	}

	private messages(batch: readonly TranslationItem[], target: TargetLanguage, ctx: TranslationContext, config: LlmConfig): ChatMessage[] {
		const items: PromptItem[] = batch.map((item, k) => ({ id: k + 1, text: item.masked }));
		return buildMessages(items, target, { ...ctx, jsonMode: config.jsonMode });
	}

	private headers(config: LlmConfig): Record<string, string> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
		if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
		return { ...headers, ...config.extraHeaders };
	}

	private async chat(messages: ChatMessage[], config: LlmConfig, signal?: AbortSignal): Promise<{ content: string; usage: TokenUsage }> {
		const body: Record<string, unknown> = {
			model: config.model.trim(),
			messages,
			temperature: config.temperature,
			stream: false,
		};
		if (config.maxTokens > 0) body.max_tokens = config.maxTokens;
		if (config.jsonMode) body.response_format = { type: 'json_object' };
		Object.assign(body, config.extraBody);

		const response = await this.send(
			{ url: joinUrl(config.baseUrl, 'chat/completions'), method: 'POST', headers: this.headers(config), body: JSON.stringify(body) },
			config,
			signal,
		);
		let json: unknown;
		try {
			json = JSON.parse(response.text);
		} catch {
			throw new TranslatorError('Response is not JSON', 'format');
		}
		return { content: messageContent(json), usage: usageOf(json) };
	}

	/** Sends a request with timeout and retry/backoff for rate limits, server errors and network errors. */
	private async send(request: HttpRequest, config: LlmConfig, signal?: AbortSignal): Promise<HttpResponse> {
		let lastError: TranslatorError | null = null;
		for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
			if (signal?.aborted) throw new TranslatorError('Request cancelled', 'aborted');
			let response: HttpResponse;
			try {
				response = await this.withTimeout(this.http(request), config.timeoutMs, signal);
			} catch (error) {
				if (error instanceof TranslatorError && error.kind === 'aborted') throw error;
				lastError = error instanceof TranslatorError ? error : new TranslatorError(`Network error: ${String((error as Error)?.message ?? error)}`, 'network');
				if (attempt < config.maxRetries) await this.sleep(this.backoff(attempt), signal);
				continue;
			}

			if (response.status >= 200 && response.status < 300) return response;
			const message = errorMessage(response.text);
			if (response.status === 401 || response.status === 403) {
				throw new TranslatorError(`Authentication failed (${response.status}): ${message}`, 'auth', response.status);
			}
			if (response.status === 429 || response.status >= 500) {
				lastError = new TranslatorError(
					`${response.status === 429 ? 'Rate limited' : 'Server error'} (${response.status}): ${message}`,
					response.status === 429 ? 'rate-limit' : 'http',
					response.status,
				);
				if (attempt < config.maxRetries) {
					const retryAfter = Number(headerValue(response.headers, 'retry-after'));
					await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : this.backoff(attempt), signal);
				}
				continue;
			}
			throw new TranslatorError(`Request failed (${response.status}): ${message}`, 'http', response.status);
		}
		throw lastError ?? new TranslatorError('Request failed', 'network');
	}

	private backoff(attempt: number): number {
		return Math.min(1000 * 2 ** attempt, 15_000) + Math.floor(Math.random() * 250);
	}

	private withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const timer = timeoutMs > 0 ? window.setTimeout(() => reject(new TranslatorError(`Timed out after ${Math.round(timeoutMs / 1000)} s`, 'timeout')), timeoutMs) : null;
			const onAbort = () => reject(new TranslatorError('Request cancelled', 'aborted'));
			signal?.addEventListener('abort', onAbort, { once: true });
			promise.then(
				(value) => {
					if (timer) window.clearTimeout(timer);
					signal?.removeEventListener('abort', onAbort);
					resolve(value);
				},
				(error: unknown) => {
					if (timer) window.clearTimeout(timer);
					signal?.removeEventListener('abort', onAbort);
					reject(error instanceof Error ? error : new Error(String(error)));
				},
			);
		});
	}
}

/** Parses "Name: value" lines into a header map. */
export function parseHeaderLines(value: string): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const line of value.split(/\r?\n/)) {
		const colon = line.indexOf(':');
		if (colon <= 0) continue;
		const name = line.slice(0, colon).trim();
		const val = line.slice(colon + 1).trim();
		if (name && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) headers[name] = val;
	}
	return headers;
}

/** Parses the "extra body" setting. Returns null when the JSON is invalid or not an object. */
export function parseExtraBody(value: string): Record<string, unknown> | null {
	if (!value.trim()) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
