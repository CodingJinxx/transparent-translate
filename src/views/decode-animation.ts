/**
 * "Decode" animation: the letters of a freshly translated sentence scramble
 * through random characters and settle left to right, as if the text were
 * being translated in real time. Purely visual: it changes text nodes of the
 * rendered output only, never the editor document or the file.
 */

const LOWER = 'abcdefghijklmnopqrstuvwxyzäöüß';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ';
/** Elements whose text must never change visually (math, code, links' targets stay intact anyway). */
const SKIP = 'code, pre, mjx-container, .math, .tag, kbd';

/** Sentences already shown in a mode. Only new ones animate, so scrolling does not replay it. */
const shown = new Map<string, number>();
const SHOWN_LIMIT = 5000;

export function animationKey(path: string, mode: string, hash: string): string {
	return `${path}\u0000${mode}\u0000${hash}`;
}

/**
 * Records that a sentence is displayed. Returns true the first time, or when
 * it was first shown within the last `freshMs` (a widget recreated during the
 * same update keeps animating).
 */
export function claimAnimation(key: string, freshMs = 600): boolean {
	const now = Date.now();
	const first = shown.get(key);
	if (first === undefined) {
		if (shown.size >= SHOWN_LIMIT) shown.clear();
		shown.set(key, now);
		return true;
	}
	return now - first < freshMs;
}

/** Forgets what was shown for a note, so the next mode switch animates again. */
export function resetAnimations(path: string): void {
	const prefix = `${path}\u0000`;
	for (const key of [...shown.keys()]) if (key.startsWith(prefix)) shown.delete(key);
}

function randomLike(ch: string): string {
	if (!/\p{L}/u.test(ch)) return ch;
	const pool = ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? UPPER : LOWER;
	return pool[Math.floor(Math.random() * pool.length)] ?? ch;
}

interface Track {
	node: Text;
	final: string;
	/** Time (ms from start) at which each character settles. */
	settle: number[];
}

/** Runs the decode animation on all text inside `el`. */
export function decode(el: HTMLElement, durationMs = 650): void {
	const win = el.win;
	const tracks: Track[] = [];
	const walker = el.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let total = 0;
	const nodes: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const text = n as Text;
		if (!text.data.trim() || text.parentElement?.closest(SKIP)) continue;
		nodes.push(text);
		total += text.data.length;
	}
	if (total === 0) return;

	let offset = 0;
	for (const node of nodes) {
		const final = node.data;
		const settle = Array.from(final, (_ch, i) => {
			const position = (offset + i) / total;
			return position * durationMs * 0.75 + Math.random() * durationMs * 0.25;
		});
		offset += final.length;
		tracks.push({ node, final, settle });
	}

	el.addClass('tt-decoding');
	const start = win.performance.now();
	let lastFrame = 0;
	const frame = (now: number) => {
		const elapsed = now - start;
		const done = elapsed >= durationMs || !el.isConnected;
		// About 30 updates per second is enough and keeps the work small.
		if (!done && now - lastFrame < 33) {
			win.requestAnimationFrame(frame);
			return;
		}
		lastFrame = now;
		for (const track of tracks) {
			if (done) {
				if (track.node.data !== track.final) track.node.data = track.final;
				continue;
			}
			let out = '';
			let i = 0;
			for (const ch of track.final) {
				out += elapsed >= (track.settle[i] ?? 0) ? ch : randomLike(ch);
				i++;
			}
			track.node.data = out;
		}
		if (done) el.removeClass('tt-decoding');
		else win.requestAnimationFrame(frame);
	};
	win.requestAnimationFrame(frame);
}
