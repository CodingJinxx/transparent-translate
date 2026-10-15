/**
 * Records the showcase demo (README GIF and website) from the test vault,
 * with the mock translator (no key, no private notes). Run it with
 * `npm run demo`, which also assembles the GIF (scripts/make-demo.mjs).
 * Not part of the normal e2e run.
 *
 * Frames are taken continuously while the scenes run; every scene start is
 * logged with its caption. Frames and the timeline go to TT_DEMO_OUT, a
 * scratch folder outside the repository.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { $, $$, browser } from '@wdio/globals';
import { after, before, describe, it } from 'mocha';
import { configure, freshVault, openNote, PLUGIN, readingText } from '../helpers';

const OUT = process.env.TT_DEMO_OUT ?? '';
const NOTE = 'Informatik/Lektion 1.md';

interface Frame {
	file: string;
	t: number;
}

/** Takes screenshots back to back until stopped. */
class Recorder {
	readonly frames: Frame[] = [];
	readonly scenes: Array<{ caption: string; t: number }> = [];
	readonly stills: Array<{ name: string; t: number }> = [];
	private running = false;
	private loop: Promise<void> = Promise.resolve();
	private t0 = 0;

	start(): void {
		this.t0 = Date.now();
		this.running = true;
		this.loop = (async () => {
			while (this.running) {
				const png = await browser.takeScreenshot();
				const file = `frame-${String(this.frames.length).padStart(5, '0')}.png`;
				writeFileSync(path.join(OUT, file), png, 'base64');
				this.frames.push({ file, t: (Date.now() - this.t0) / 1000 });
			}
		})();
	}

	scene(caption: string): void {
		this.scenes.push({ caption, t: (Date.now() - this.t0) / 1000 });
	}

	/** Marks the current moment as a still image for the website. */
	still(name: string): void {
		this.stills.push({ name, t: (Date.now() - this.t0) / 1000 });
	}

	async stop(): Promise<void> {
		this.running = false;
		await this.loop;
		const end = (Date.now() - this.t0) / 1000;
		writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ frames: this.frames, scenes: this.scenes, stills: this.stills, end }, null, '\t'));
	}
}

/** A visible pointer, since screenshots do not show the mouse. Exists only in the recording session. */
async function installPointer(): Promise<void> {
	await browser.execute(() => {
		const style = document.createElement('style');
		style.textContent = `
			#tt-demo-pointer { position: fixed; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px;
				border-radius: 50%; border: 3px solid #f5b83d; background: rgba(245, 184, 61, 0.25); z-index: 100000;
				pointer-events: none; transition: left 0.45s ease-in-out, top 0.45s ease-in-out, transform 0.15s; }
			#tt-demo-pointer.is-pressed { transform: scale(0.7); background: rgba(245, 184, 61, 0.6); }`;
		document.head.appendChild(style);
		const dot = document.createElement('div');
		dot.id = 'tt-demo-pointer';
		document.body.appendChild(dot);
	});
}

/** Moves the pointer to the middle of an element (or a point inside it) and waits for it to arrive. */
async function pointAt(el: WebdriverIO.Element, dx = 0.5): Promise<void> {
	await browser.execute(
		(target: HTMLElement, fx: number) => {
			const r = target.getBoundingClientRect();
			const dot = document.getElementById('tt-demo-pointer')!;
			dot.style.left = `${r.left + r.width * fx}px`;
			dot.style.top = `${r.top + r.height / 2}px`;
		},
		el as unknown as HTMLElement,
		dx,
	);
	await browser.pause(550);
}

async function press(): Promise<void> {
	await browser.execute(() => document.getElementById('tt-demo-pointer')!.classList.add('is-pressed'));
	await browser.pause(150);
	await browser.execute(() => document.getElementById('tt-demo-pointer')!.classList.remove('is-pressed'));
}

async function clickOn(el: WebdriverIO.Element, button: 'left' | 'right' = 'left', dx = 0.5): Promise<void> {
	await pointAt(el, dx);
	await press();
	if (button === 'right') await el.click({ button: 'right' });
	else await el.click();
}

/** Finds the first element matching `selector` whose text contains `text`. */
async function withText(selector: string, text: string): Promise<WebdriverIO.Element> {
	let found: WebdriverIO.Element | undefined;
	await browser.waitUntil(
		async () => {
			for (const el of await $$(selector).getElements()) {
				if ((await el.getText()).includes(text)) {
					found = el;
					return true;
				}
			}
			return false;
		},
		{ timeoutMsg: `no ${selector} with "${text}"` },
	);
	return found!;
}

const waitForText = (text: string) => browser.waitUntil(async () => (await readingText()).includes(text), { timeout: 15_000, timeoutMsg: `Reading view never showed "${text}"` });

const hideNotices = () => browser.execute(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));

describe('Showcase demo', function () {
	this.timeout(5 * 60 * 1000);
	const rec = new Recorder();

	before(async function () {
		if (!OUT) throw new Error('TT_DEMO_OUT is not set: run the demo through `npm run demo`');
		mkdirSync(OUT, { recursive: true });
		await browser.execute(() => window.resizeTo(960, 700));
		await freshVault();
		await configure({ animateTranslations: true });
		await browser.executeObsidian(({ app }) => {
			const vault = app.vault as unknown as { setConfig(key: string, value: unknown): void };
			vault.setConfig('propertiesInDocument', 'hidden');
			vault.setConfig('showInlineTitle', false);
			app.workspace.leftSplit?.collapse();
			app.workspace.rightSplit?.collapse();
		});
		await openNote(NOTE, 'preview');
		await installPointer();
		await hideNotices();
		await browser.pause(800);
	});

	after(async function () {
		await rec.stop();
	});

	it('records the scenes', async function () {
		rec.start();
		await browser.pause(300);

		rec.scene('A note written in German, with some English');
		await browser.pause(2200);

		rec.scene('One click shows it in English');
		await clickOn(await $('.workspace-leaf.mod-active .tt-header-action'));
		await waitForText('Constants drop out');
		await hideNotices();
		await browser.pause(2600);

		rec.scene('Another click shows it in German. The file never changes.');
		await clickOn(await $('.workspace-leaf.mod-active .tt-header-action'));
		await waitForText('Wir zählen Schritte');
		await browser.pause(2600);

		rec.scene('Live Preview too: click a sentence to edit the original');
		await browser.executeObsidianCommand(`${PLUGIN}:show-english`);
		await openNote(NOTE, 'live');
		await browser.waitUntil(async () => (await $$('.workspace-leaf.mod-active .cm-content .tt-sentence').length) > 3, { timeoutMsg: 'no translation widgets' });
		await browser.pause(1200);
		await clickOn(await withText('.workspace-leaf.mod-active .cm-content .tt-sentence', 'Today is about'), 'left', 0.3);
		await $('.tt-session .tt-session-input').waitForDisplayed();
		await browser.pause(2400);
		await browser.keys('Escape');
		await browser.pause(400);

		rec.scene('Fix a term once; the glossary updates every sentence');
		await openNote(NOTE, 'preview');
		await waitForText('Today is about the runtime');
		await browser.pause(500);
		await clickOn(await withText('.workspace-leaf.mod-active span.tt-t', 'Today is about the runtime'), 'right', 0.3);
		const fix = await $('.menu-item-title=Fix translation…');
		await fix.waitForDisplayed();
		await clickOn(fix);
		await $('.tt-correction').waitForDisplayed();
		await browser.pause(500);
		await clickOn(await withText('.tt-correction .tt-chip', 'Laufzeit'));
		await browser.pause(400);
		const shouldBe = (await $$('.tt-correction input[type="text"]').getElements())[1]!;
		await clickOn(shouldBe);
		for (const ch of 'running time') {
			await browser.keys(ch);
			await browser.pause(40);
		}
		await browser.pause(300);
		rec.still('fix-translation');
		await browser.pause(300);
		await clickOn(await $('.tt-correction button.mod-cta'));
		await browser.pause(300);
		await hideNotices();
		await waitForText('running time of algorithms');
		await hideNotices();
		await browser.pause(2200);

		rec.scene('File and folder names are shown translated, never renamed');
		await browser.executeObsidian(async ({ app }, p) => {
			await app.commands.executeCommandById('file-explorer:open');
			const view = app.workspace.getLeavesOfType('file-explorer')[0]!.view as unknown as { revealInFolder(f: unknown): void };
			view.revealInFolder(app.vault.getAbstractFileByPath(p));
		}, NOTE);
		await browser.pause(1000);
		await browser.executeObsidianCommand(`${PLUGIN}:names-english`);
		await browser.waitUntil(async () => (await $('.nav-folder-title[data-path="Informatik"]').getText()) === 'Computer science', { timeoutMsg: 'names were not translated' });
		await hideNotices();
		await pointAt(await $('.nav-folder-title[data-path="Informatik"]'), 0.3);
		rec.still('file-names');
		await browser.pause(2500);
	});
});
