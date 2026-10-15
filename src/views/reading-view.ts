import {
	MarkdownRenderChild,
	MarkdownRenderer,
	Menu,
	type MarkdownPostProcessor,
	type MarkdownPostProcessorContext,
	type WorkspaceLeaf,
} from 'obsidian';
import { composeRange } from '../core/compose';
import { sentencesInLines } from '../core/note';
import { lineEnd } from '../core/text';
import { isTargetLanguage, type TargetLanguage } from '../core/types';
import type { TranslateHost } from '../host';
import { t } from '../i18n';
import { log } from '../log';
import { animationKey, claimAnimation, decode } from './decode-animation';

export const MARKER_PREFIX = 'tt';

/** A rendered section of a note in Reading view that contains translatable sentences. */
interface Section {
	el: HTMLElement;
	ctx: MarkdownPostProcessorContext;
	path: string;
	leaf: WorkspaceLeaf;
	/** Obsidian's own rendering of the section, kept to restore it in Original mode. */
	original: ChildNode[] | null;
	/** Markdown currently rendered into `el` (to skip identical re-renders). */
	shown: string | null;
	/** Nodes this controller inserted into `el`. */
	inserted: ChildNode[];
	token: number;
}

/**
 * Reading view. Obsidian renders sections once and reuses them, so instead of
 * relying on a full re-render this controller remembers the sections it has
 * seen and swaps their content whenever the mode or the translations change.
 */
export class ReadingViewController {
	private readonly sections = new Map<string, Set<Section>>();
	private readonly byElement = new WeakMap<HTMLElement, Section>();
	/** Scratch containers this controller renders into; nested renders inside them are ignored. */
	private readonly own = new WeakSet<HTMLElement>();
	/** Sections that already have the context menu for translated sentences. */
	private readonly menuBound = new WeakSet<HTMLElement>();

	constructor(private readonly host: TranslateHost) {}

	readonly processor: MarkdownPostProcessor = (el, ctx) => {
		if (this.isOwn(el)) return;
		const path = ctx.sourcePath;
		if (!this.host.isTranslatable(path)) return;
		const info = ctx.getSectionInfo(el);
		if (!info) return;
		const view = this.host.findMarkdownView(path, el);
		// Only the note itself is translated, never other renders (embeds, hover previews, exports).
		if (!view || info.text !== view.data) return;
		const note = this.host.parse(path, info.text);
		if (sentencesInLines(note, info.lineStart, info.lineEnd).length === 0) return;

		let section = this.byElement.get(el);
		if (section) {
			section.leaf = view.leaf;
			section.ctx = ctx;
			// Obsidian may run post-processors again on an element it did not re-render.
			// Only fresh content (not ours) replaces the saved original.
			const ours = section.inserted.length > 0 && section.inserted.every((n) => n.parentNode === el);
			if (!ours) {
				section.original = null;
				section.shown = null;
				section.inserted = [];
			}
		} else {
			section = { el, ctx, path, leaf: view.leaf, original: null, shown: null, inserted: [], token: 0 };
			this.byElement.set(el, section);
			let set = this.sections.get(path);
			if (!set) {
				set = new Set();
				this.sections.set(path, set);
			}
			set.add(section);
			const entry = section;
			const child = new MarkdownRenderChild(el);
			child.register(() => this.forget(entry));
			ctx.addChild(child);
		}
		return this.apply(section);
	};

	/** True if `el` sits inside a container this controller rendered (a nested render). */
	private isOwn(el: HTMLElement): boolean {
		for (let node: HTMLElement | null = el.parentElement; node; node = node.parentElement) {
			if (this.own.has(node)) return true;
		}
		return false;
	}

	private forget(section: Section): void {
		const set = this.sections.get(section.path);
		set?.delete(section);
		if (set && set.size === 0) this.sections.delete(section.path);
		this.byElement.delete(section.el);
	}

	/** Re-applies the current mode to every known section of a note. */
	refresh(path: string): void {
		for (const section of this.sections.get(path) ?? []) void this.apply(section);
	}

	refreshAll(): void {
		for (const path of this.sections.keys()) this.refresh(path);
	}

	/** Moves known sections of a renamed note to its new path. */
	rename(oldPath: string, newPath: string): void {
		const set = this.sections.get(oldPath);
		if (!set) return;
		this.sections.delete(oldPath);
		for (const section of set) section.path = newPath;
		this.sections.set(newPath, set);
	}

	private async apply(section: Section): Promise<void> {
		const token = ++section.token;
		const mode = this.host.modeOf(section.leaf, section.path);
		if (!isTargetLanguage(mode) || !this.host.isTranslatable(section.path)) {
			this.restore(section, true);
			return;
		}
		const info = section.ctx.getSectionInfo(section.el);
		if (!info) return;
		const markdown = this.compose(section.path, info.text, info.lineStart, info.lineEnd, mode);
		if (markdown === null) {
			this.restore(section);
			return;
		}
		if (markdown.text === section.shown) return;

		const rendered = createDiv();
		this.own.add(rendered);
		const child = new MarkdownRenderChild(rendered);
		section.ctx.addChild(child);
		try {
			await MarkdownRenderer.render(this.host.app, markdown.text, rendered, section.path, child);
		} catch (error) {
			log.error('Could not render translation', error);
			return;
		}
		// A newer apply() started while rendering: drop this result.
		if (token !== section.token) return;

		const el = section.el;
		if (section.original === null) section.original = Array.from(el.childNodes);
		el.empty();
		section.inserted = Array.from(rendered.childNodes);
		for (const node of section.inserted) el.appendChild(node);
		el.addClass('tt-translated');
		el.toggleClass('tt-has-pending', markdown.pending);
		el.setAttr('lang', mode);
		section.shown = markdown.text;
		this.bindMenu(section);
		if (this.host.settings.animateTranslations) {
			el.querySelectorAll<HTMLElement>('span.tt-s[data-tt]').forEach((span) => {
				if (claimAnimation(animationKey(section.path, mode, span.dataset.tt ?? ''))) decode(span);
			});
		}
	}

	/** Right-click on a translated sentence offers "Fix translation". Links keep Obsidian's own menu. */
	private bindMenu(section: Section): void {
		if (this.menuBound.has(section.el)) return;
		this.menuBound.add(section.el);
		section.el.addEventListener('contextmenu', (event) => {
			const target = event.target instanceof HTMLElement ? event.target : null;
			const span = target?.closest<HTMLElement>('span.tt-t[data-tt]');
			const mode = this.host.modeOf(section.leaf, section.path);
			if (!target || !span || target.closest('a') || section.shown === null || !isTargetLanguage(mode)) return;
			const hash = span.dataset.tt;
			if (!hash) return;
			event.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle(t('menu.fix-translation'))
					.setIcon('pencil-line')
					.onClick(() => this.host.fixTranslation(section.path, hash, mode)),
			);
			menu.showAtMouseEvent(event);
		});
	}

	/** Puts Obsidian's own rendering back. `animate` plays the decode animation when leaving a translated mode. */
	private restore(section: Section, animate = false): void {
		section.token++;
		const { el, original } = section;
		const wasTranslated = section.shown !== null;
		if (original !== null) {
			el.empty();
			for (const node of original) el.appendChild(node);
			section.original = null;
		}
		section.inserted = [];
		el.removeClass('tt-translated', 'tt-has-pending');
		el.removeAttribute('lang');
		section.shown = null;
		if (animate && wasTranslated && this.host.settings.animateTranslations) {
			const line = section.ctx.getSectionInfo(el)?.lineStart ?? 0;
			if (claimAnimation(animationKey(section.path, 'original', `section-${line}`))) decode(el);
		}
	}

	/**
	 * Translated Markdown for lines `lineStart..lineEnd`, or null if nothing in
	 * them differs from the original. Requests missing translations (lazily,
	 * for the whole note at once).
	 */
	private compose(path: string, text: string, lineStart: number, lineEndLine: number, mode: TargetLanguage): { text: string; pending: boolean } | null {
		const host = this.host;
		const note = host.parse(path, text);
		const sentences = sentencesInLines(note, lineStart, lineEndLine);
		let missing = false;
		const composed = composeRange(
			note.text,
			note.lineStarts[lineStart] ?? 0,
			lineEnd(note.text, note.lineStarts, lineEndLine),
			sentences,
			(s) => {
				const display = host.service.display(path, s, mode);
				if (display.kind === 'missing' && host.service.canTranslate) {
					missing = true;
					return { kind: 'pending' };
				}
				if (display.kind === 'translated' && display.outdated) missing = true;
				return display;
			},
			{ markerClassPrefix: MARKER_PREFIX, wrapTranslated: true, wrapSame: host.settings.animateTranslations },
		);
		if (missing) host.service.request(path, note, note.sentences, mode, host.noteTitle(path));
		const animating = host.settings.animateTranslations && composed.same > 0;
		if (composed.translated + composed.pending + composed.failed + composed.missing === 0 && !animating) return null;
		return { text: composed.text, pending: composed.pending > 0 };
	}
}
