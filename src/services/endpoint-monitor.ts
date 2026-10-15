export type EndpointStatus = 'unknown' | 'reachable' | 'unreachable';

/** How long a successful check is trusted. A failed check is repeated every time, so recovery is noticed at once. */
const REACHABLE_TTL_MS = 30_000;

/**
 * Knows whether the translation endpoint can be reached. Translating needs it
 * only for notes that have no translation yet, so the check runs lazily when
 * a request would be needed, not in the background.
 */
export class EndpointMonitor {
	private current: EndpointStatus = 'unknown';
	private checkedAt = 0;
	private pending: Promise<boolean> | null = null;

	constructor(
		private readonly ping: () => Promise<boolean>,
		private readonly now: () => number = () => Date.now(),
	) {}

	get status(): EndpointStatus {
		return this.current;
	}

	/** True if the endpoint answered recently or does now. */
	async check(): Promise<boolean> {
		if (this.current === 'reachable' && this.now() - this.checkedAt < REACHABLE_TTL_MS) return true;
		if (this.pending) return this.pending;
		this.pending = (async () => {
			let ok = false;
			try {
				ok = await this.ping();
			} catch {
				ok = false;
			}
			this.current = ok ? 'reachable' : 'unreachable';
			this.checkedAt = this.now();
			this.pending = null;
			return ok;
		})();
		return this.pending;
	}

	/** A request failed because the endpoint could not be reached. */
	markUnreachable(): void {
		this.current = 'unreachable';
		this.checkedAt = this.now();
	}

	/** Forget what is known (the provider settings changed). */
	reset(): void {
		this.current = 'unknown';
		this.checkedAt = 0;
	}
}
