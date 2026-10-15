/**
 * End-to-end tests in a real, sandboxed Obsidian (downloaded into
 * .obsidian-cache, never your installed app or vaults). Translation requests
 * go to a local mock of an OpenAI-compatible API, so no key is needed.
 *
 *   npm run test:e2e                         # latest Obsidian + minAppVersion + mobile emulation
 *   OBSIDIAN_VERSIONS=latest/latest npm run test:e2e
 */
import * as path from 'node:path';
import { env } from 'node:process';
import type { Server } from 'node:http';
import { parseObsidianVersions } from 'wdio-obsidian-service';
import { startMockLlm } from './test/e2e/mock-llm.ts';

const cacheDir = path.resolve('.obsidian-cache');

const desktopVersions = await parseObsidianVersions(env.OBSIDIAN_VERSIONS ?? 'earliest/earliest latest/latest', { cacheDir });
const mobileVersions = await parseObsidianVersions(env.OBSIDIAN_MOBILE_VERSIONS ?? 'latest/latest', { cacheDir });
if (env.CI) console.log('obsidian-cache-key:', JSON.stringify([desktopVersions, mobileVersions]));

const vault = 'test/vaults/e2e';
const screenshots = 'test/e2e/specs/screenshots.e2e.ts';
const mobileSpec = 'test/e2e/specs/mobile.e2e.ts';
let mockServer: Server | null = null;

export const config: WebdriverIO.Config = {
	runner: 'local',
	framework: 'mocha',
	specs: ['./test/e2e/specs/**/*.e2e.ts'],
	// Screenshots only run when asked for explicitly (npm run screenshots).
	exclude: process.argv.some((a) => a.includes('screenshots')) ? [] : [screenshots],
	// One instance at a time: all instances share one mock server and its request counters.
	maxInstances: Number(env.WDIO_MAX_INSTANCES || 1),

	capabilities: [
		...desktopVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
			browserName: 'obsidian',
			'wdio:obsidianOptions': { appVersion, installerVersion, plugins: ['.'], vault },
			'wdio:exclude': [mobileSpec],
		})),
		...(env.TT_SKIP_MOBILE
			? []
			: mobileVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
					browserName: 'obsidian',
					'wdio:obsidianOptions': { appVersion, installerVersion, emulateMobile: true, plugins: ['.'], vault },
					'goog:chromeOptions': { mobileEmulation: { deviceMetrics: { width: 390, height: 844 } } },
					'wdio:specs': [mobileSpec],
				}))),
	],

	services: ['obsidian'],
	reporters: ['obsidian'],
	// UI timing can flake under load (e.g. typing while another Obsidian starts): retry once.
	mochaOpts: { ui: 'bdd', timeout: 90 * 1000, retries: 1 },
	waitforInterval: 100,
	waitforTimeout: 10 * 1000,
	logLevel: 'warn',
	cacheDir,
	injectGlobals: false,

	async onPrepare() {
		// Port 0: the OS picks a free port. Workers start later and inherit the variable.
		mockServer = await startMockLlm(Number(env.TT_MOCK_PORT ?? 0));
		const address = mockServer.address();
		if (address && typeof address === 'object') env.TT_MOCK_PORT = String(address.port);
	},
	async onComplete() {
		await new Promise<void>((resolve) => (mockServer ? mockServer.close(() => resolve()) : resolve()));
	},
};
