/**
 * A tiny OpenAI-compatible server for end-to-end tests. Deterministic and
 * offline: known sentences get real translations (so screenshots look
 * right), everything else gets a language prefix. Placeholders and the
 * `<<n>>` format are preserved, like a well-behaved model.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';

const EN: Record<string, string> = {
	'Lektion 1: Laufzeitanalyse': 'Lesson 1: Runtime analysis',
	'Heute geht es um die Laufzeit von Algorithmen.': 'Today is about the runtime of algorithms.',
	'Das ist z. B. bei Karel wichtig.': 'This matters for Karel, for example.',
	'Die Laufzeit ist:': 'The runtime is:',
	'Jeder Schritt kostet ⟦1⟧ Zeiteinheit.': 'Each step costs ⟦1⟧ time unit.',
	'Loops multiply the cost, d. h. eine Schleife mit ⟦1⟧ Durchläufen kostet ⟦2⟧ Schritte.': 'Loops multiply the cost, i.e. a loop with ⟦1⟧ iterations costs ⟦2⟧ steps.',
	'Verschachtelte Schleifen: ⟦1⟧': 'Nested loops: ⟦1⟧',
	'Siehe ⟦1⟧ und ⟦2⟧.': 'See ⟦1⟧ and ⟦2⟧.',
	Begriff: 'Term',
	Bedeutung: 'Meaning',
	Laufzeit: 'Runtime',
	'Anzahl der Schritte': 'Number of steps',
	'Obere Schranke für das Wachstum': 'Upper bound for growth',
	Merke: 'Note',
	'Konstanten fallen in der O-Notation weg.': 'Constants drop out in O notation.',
	'Mehr dazu in BlueJ.': 'More on this in BlueJ.',
	'Fragen bitte über Particify stellen.': 'Please ask questions via Particify.',
	'Das ist der erste Satz.': 'This is the first sentence.',
	'Hier steht ein zweiter Satz.': 'Here is a second sentence.',
	'Ein Punkt in der Liste.': 'An item in the list.',
	'Guten Morgen': 'Good morning',
};

const DE: Record<string, string> = {
	'We count steps, not seconds!': 'Wir zählen Schritte, keine Sekunden!',
	'Loops multiply the cost, d. h. eine Schleife mit ⟦1⟧ Durchläufen kostet ⟦2⟧ Schritte.': 'Schleifen multiplizieren die Kosten, d. h. eine Schleife mit ⟦1⟧ Durchläufen kostet ⟦2⟧ Schritte.',
	'Big O': 'Groß-O',
};

/** Sentences that are already English and must come back unchanged in English mode. */
const ALREADY_EN = new Set(['We count steps, not seconds!', 'Big O']);

export function mockTranslate(text: string, target: 'en' | 'de'): string {
	if (target === 'en') return EN[text] ?? (ALREADY_EN.has(text) ? text : `EN: ${text}`);
	// German originals (the keys of EN) are already German and stay unchanged.
	return DE[text] ?? (text in EN ? text : `DE: ${text}`);
}

export interface MockStats {
	requests: number;
	sentences: string[];
	authorization: string[];
}

async function body(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

export function startMockLlm(port: number): Promise<Server> {
	const stats: MockStats = { requests: 0, sentences: [], authorization: [] };
	const server = createServer((req, res) => {
		void (async () => {
			const send = (status: number, payload: unknown) => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(payload));
			};
			const url = req.url ?? '';
			if (url.endsWith('/__stats')) return send(200, stats);
			if (url.endsWith('/__reset')) {
				stats.requests = 0;
				stats.sentences = [];
				stats.authorization = [];
				return send(200, { ok: true });
			}
			if (req.method === 'GET' && url.endsWith('/models')) return send(200, { data: [{ id: 'mock-small' }, { id: 'mock-large' }] });
			if (req.method !== 'POST' || !url.endsWith('/chat/completions')) return send(404, { error: { message: 'not found' } });

			const request = JSON.parse(await body(req)) as { messages: Array<{ role: string; content: string }>; response_format?: unknown };
			stats.requests++;
			stats.authorization.push(String(req.headers.authorization ?? ''));
			const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
			const user = request.messages.find((m) => m.role === 'user')?.content ?? '';
			const target = system.includes('into German') ? 'de' : 'en';
			const lines = [...user.matchAll(/^<<(\d+)>> (.*)$/gm)];
			stats.sentences.push(...lines.map((m) => m[2]!));
			const content = request.response_format
				? JSON.stringify({ translations: lines.map((m) => mockTranslate(m[2]!, target)) })
				: lines.map((m) => `<<${m[1]}>> ${mockTranslate(m[2]!, target)}`).join('\n');
			// A little latency, like a real endpoint, so pending states are visible.
			await new Promise((resolve) => setTimeout(resolve, 150));
			send(200, {
				id: 'mock',
				object: 'chat.completion',
				model: 'mock-small',
				choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
				usage: { prompt_tokens: user.length / 4, completion_tokens: content.length / 4 },
			});
		})();
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
