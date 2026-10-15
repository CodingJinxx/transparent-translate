import { MarkdownRenderChild, MarkdownRenderer, type MarkdownPostProcessor } from 'obsidian';
import { composeRange } from '../core/compose';
import { sentencesInLines } from '../core/note';
import { lineEnd } from '../core/text';
import { isTargetLanguage } from '../core/types';
import type { TranslateHost } from '../host';
import { log } from '../log';

export const MARKER_PREFIX = 'tt';

/** Sections this plugin rendered. Nested renders inside them are skipped. */
const ownSections = new WeakSet<HTMLElement>();

function insideOwnSection(el: HTMLElement): boolean {
	for (let node: HTMLElement | null = el; node; node = node.parentElement) {
		if (ownSections.has(node)) return true;
	}
	return false;
}

/**
 * Reading view: replaces each rendered section with the rendering of its
 * translated Markdown. Sentences without a translation yet are shown in the
 * original language, dimmed, and re-rendered once the translation arrives.
 */
export function createReadingViewProcessor(host: TranslateHost): MarkdownPostProcessor {
	return async (el, ctx) => {
		if (insideOwnSection(el)) return;
		const info = ctx.getSectionInfo(el);
		if (!info) return;
		const path = ctx.sourcePath;
		const view = host.findMarkdownView(path, el);
		if (!view) return;
		const mode = host.modeOf(view.leaf, path);
		if (!isTargetLanguage(mode) || !host.isTranslatable(path)) return;
		// Only translate the note itself, never other renders of other text (embeds, exports).
		if (info.text !== view.data) return;

		const note = host.parse(path, info.text);
		const sentences = sentencesInLines(note, info.lineStart, info.lineEnd);
		if (sentences.length === 0) return;

		let missing = false;
		const composed = composeRange(
			note.text,
			note.lineStarts[info.lineStart] ?? 0,
			lineEnd(note.text, note.lineStarts, info.lineEnd),
			sentences,
			(s) => {
				const display = host.service.display(path, s, mode);
				if (display.kind === 'missing' && host.service.canTranslate) {
					missing = true;
					return { kind: 'pending' };
				}
				return display;
			},
			{ markerClassPrefix: MARKER_PREFIX },
		);
		// Lazy translation: the first section that needs it requests the whole note.
		if (missing) host.service.request(path, note, note.sentences, mode, host.noteTitle(path));
		if (composed.translated === 0 && composed.pending === 0 && composed.failed === 0 && composed.missing === 0) return;

		const child = new MarkdownRenderChild(el);
		ctx.addChild(child);
		ownSections.add(el);
		const rendered = createDiv();
		ownSections.add(rendered);
		try {
			await MarkdownRenderer.render(host.app, composed.text, rendered, path, child);
		} catch (error) {
			log.error('Could not render translation', error);
			return;
		}
		el.empty();
		el.addClass('tt-translated');
		el.toggleClass('tt-has-pending', composed.pending > 0);
		el.setAttr('lang', mode);
		while (rendered.firstChild) el.appendChild(rendered.firstChild);
	};
}
