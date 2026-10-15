/**
 * Logging. Errors are always reported. Debug messages only appear when the
 * "Debug logging" setting is on, so release builds stay quiet.
 */
let debugEnabled = false;

export function setDebug(enabled: boolean): void {
	debugEnabled = enabled;
}

export const log = {
	debug(...args: unknown[]): void {
		if (debugEnabled) console.debug('[transparent-translate]', ...args);
	},
	error(...args: unknown[]): void {
		console.error('[transparent-translate]', ...args);
	},
};
