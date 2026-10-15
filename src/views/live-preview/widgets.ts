import { Component, Keymap, MarkdownRenderer, Platform, type App } from 'obsidian';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { TargetLanguage } from '../../core/types';
import { t } from '../../i18n';
import type { EditSession } from './state';

const components = new WeakMap<HTMLElement, Component>();
/** Removes the window key listener of an edit session widget. */
const keyListeners = new WeakMap<HTMLElement, () => void>();

/**
 * Renders inline Markdown (links, bold, math) into `target`. A single
 * paragraph is unwrapped so the result flows inline with the editor line.
 */
function renderInline(app: App, markdown: string, target: HTMLElement, sourcePath: string): void {
	const component = new Component();
	component.load();
	components.set(target, component);
	const scratch = createDiv();
	void MarkdownRenderer.render(app, markdown, scratch, sourcePath, component).then(() => {
		if (!target.isConnected && !components.has(target)) return;
		const first = scratch.firstElementChild;
		const source = scratch.childElementCount === 1 && first?.tagName === 'P' ? first : scratch;
		target.empty();
		while (source.firstChild) target.appendChild(source.firstChild);
	});
}

function releaseInline(dom: HTMLElement): void {
	const component = components.get(dom);
	if (component) {
		component.unload();
		components.delete(dom);
	}
}

export interface SentenceWidgetHandlers {
	activate(view: EditorView, from: number, event: MouseEvent): void;
	contextMenu(view: EditorView, from: number, event: MouseEvent): void;
	openLink(href: string, sourcePath: string, event: MouseEvent): void;
}

/** Shows a translated sentence in place of the original text. */
export class SentenceWidget extends WidgetType {
	constructor(
		readonly display: string,
		readonly hash: string,
		readonly lang: TargetLanguage,
		private readonly app: App,
		private readonly sourcePath: string,
		private readonly handlers: SentenceWidgetHandlers,
		private readonly readOnly: boolean,
	) {
		super();
	}

	override eq(other: SentenceWidget): boolean {
		return other.display === this.display && other.hash === this.hash && other.readOnly === this.readOnly;
	}

	toDOM(view: EditorView): HTMLElement {
		const span = createSpan({ cls: 'tt-sentence', text: this.display, attr: { lang: this.lang } });
		if (!this.readOnly) span.setAttr('title', t('widget.edit-hint'));
		renderInline(this.app, this.display, span, this.sourcePath);
		span.addEventListener('mousedown', (event) => {
			if (event.button !== 0) return;
			const link = (event.target as HTMLElement | null)?.closest('a');
			if (link) {
				event.preventDefault();
				const href = link.getAttribute('data-href') ?? link.getAttribute('href');
				if (href) this.handlers.openLink(href, this.sourcePath, event);
				return;
			}
			event.preventDefault();
			this.handlers.activate(view, view.posAtDOM(span), event);
		});
		span.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			this.handlers.contextMenu(view, view.posAtDOM(span), event);
		});
		return span;
	}

	override destroy(dom: HTMLElement): void {
		releaseInline(dom);
	}

	override ignoreEvent(): boolean {
		return true;
	}
}

export interface SessionWidgetHandlers {
	apply(view: EditorView, id: number, text: string, dontAsk: boolean): void;
	cancel(view: EditorView, id: number): void;
	editOriginal(view: EditorView, id: number, dontAsk: boolean): void;
	/** Focus left the inline editor without a decision. */
	leave(view: EditorView, id: number, text: string): void;
}

export interface SessionLabels {
	source: string;
	sourceName: string;
	target: string;
}

/**
 * The inline editor of an edit session: a text box with the displayed
 * (translated) text and, unless the user chose a default, a banner that
 * explains what the edit will do.
 */
export class SessionWidget extends WidgetType {
	constructor(
		readonly session: EditSession,
		private readonly labels: SessionLabels,
		private readonly handlers: SessionWidgetHandlers,
	) {
		super();
	}

	override eq(other: SessionWidget): boolean {
		return other.session.id === this.session.id;
	}

	toDOM(view: EditorView): HTMLElement {
		const { session, labels, handlers } = this;
		const wrap = createSpan({ cls: 'tt-session', attr: { lang: session.target } });
		const input = wrap.createEl('textarea', {
			cls: 'tt-session-input',
			attr: { rows: '1', spellcheck: 'true', 'aria-label': t('session.input-label') },
		});
		input.value = session.display;

		let dontAsk = false;
		if (session.showBanner) {
			const banner = wrap.createDiv({ cls: 'tt-session-banner', attr: { role: 'group' } });
			banner.createDiv({
				cls: 'tt-session-message',
				text: t(session.multi ? 'session.banner-multi' : 'session.banner', { source: labels.source }),
			});
			banner.createDiv({ cls: 'tt-session-replaces', text: t('session.replaces', { text: session.source }) });
			const actions = banner.createDiv({ cls: 'tt-session-actions' });
			const button = (label: string, hint: string, cls: string, onClick: () => void) => {
				const el = actions.createEl('button', { cls });
				el.createSpan({ text: label });
				el.createEl('kbd', { text: hint });
				el.addEventListener('mousedown', (event) => event.preventDefault());
				el.addEventListener('click', (event) => {
					event.preventDefault();
					onClick();
				});
			};
			button(t('session.replace', { target: labels.target }), t('session.hint-enter'), 'mod-cta', () => handlers.apply(view, session.id, input.value, dontAsk));
			button(t('session.edit-original', { sourceName: labels.sourceName }), Platform.isMacOS ? '⌘⇧↵' : t('session.hint-alt-enter'), '', () =>
				handlers.editOriginal(view, session.id, dontAsk),
			);
			button(t('session.cancel'), t('session.hint-esc'), '', () => handlers.cancel(view, session.id));
			const label = banner.createEl('label', { cls: 'tt-session-dont-ask' });
			const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
			label.appendText(t('session.dont-ask'));
			checkbox.addEventListener('change', () => (dontAsk = checkbox.checked));
		}

		// Keys are caught on the window in the capture phase, before Obsidian's own
		// handlers: some Obsidian versions move focus away on Escape, which would
		// otherwise count as "clicking elsewhere" and apply the edit.
		const win = wrap.win;
		const onKey = (event: KeyboardEvent) => {
			// While the session is open its keys also apply when focus slipped back to this editor.
			const active = win.document.activeElement;
			if (event.isComposing || !wrap.isConnected || !(active === input || (active && view.dom.contains(active)))) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				handlers.cancel(view, session.id);
			} else if (event.key === 'Enter' && ((Keymap.isModEvent(event) && event.shiftKey) || event.altKey)) {
				// Mod+Shift+Enter (Alt+Enter also works where the OS delivers it).
				event.preventDefault();
				event.stopPropagation();
				handlers.editOriginal(view, session.id, dontAsk);
			} else if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				handlers.apply(view, session.id, input.value, dontAsk);
			}
		};
		win.addEventListener('keydown', onKey, true);
		keyListeners.set(wrap, () => win.removeEventListener('keydown', onKey, true));
		// Other keys must not reach the editor's keymap.
		input.addEventListener('keydown', (event) => event.stopPropagation());
		// "Clicking elsewhere" means a real pointer press outside the session.
		// Focus moving to the editor on its own (after an update, or when the
		// window regains focus) is not a decision: the input just takes focus back.
		const onPointer = (event: PointerEvent) => {
			if (!wrap.isConnected || wrap.contains(event.target as Node)) return;
			handlers.leave(view, session.id, input.value);
		};
		win.addEventListener('pointerdown', onPointer, true);
		const removeKeys = keyListeners.get(wrap);
		keyListeners.set(wrap, () => {
			removeKeys?.();
			win.removeEventListener('pointerdown', onPointer, true);
		});
		wrap.addEventListener('focusout', (event) => {
			const next = event.relatedTarget as HTMLElement | null;
			if (next && wrap.contains(next)) return;
			// Tab (or a shortcut) moved focus to another control outside the editor: that is leaving.
			if (next && !view.dom.contains(next)) {
				handlers.leave(view, session.id, input.value);
				return;
			}
			win.setTimeout(() => {
				if (wrap.isConnected && win.document.hasFocus() && win.document.activeElement !== input) input.focus();
			}, 0);
		});
		win.addEventListener(
			'focus',
			() => {
				if (wrap.isConnected) input.focus();
			},
			{ once: true },
		);

		window.requestAnimationFrame(() => {
			input.focus();
			if (session.selectAll) input.select();
			else input.setSelectionRange(input.value.length, input.value.length);
		});
		return wrap;
	}

	override destroy(dom: HTMLElement): void {
		keyListeners.get(dom)?.();
		keyListeners.delete(dom);
	}

	override ignoreEvent(): boolean {
		return true;
	}
}
