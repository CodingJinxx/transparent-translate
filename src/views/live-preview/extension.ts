import { editorInfoField, editorLivePreviewField, Keymap, MarkdownView, Menu, Notice } from 'obsidian';
import { EditorState, StateField, type Extension, type Range, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { composeRange } from '../../core/compose';
import { isTargetLanguage, type DisplayMode, type TargetLanguage } from '../../core/types';
import type { TranslateHost } from '../../host';
import { t } from '../../i18n';
import {
	endSessionEffect,
	INACTIVE,
	isOwnTransaction,
	newSessionId,
	ownChange,
	refreshEffect,
	SESSION_USER_EVENT,
	setModeEffect,
	startSessionEffect,
	touchedRanges,
	type EditSession,
	type TranslatedRange,
	type TranslationState,
} from './state';
import { animationKey, claimAnimation } from '../decode-animation';
import { SentenceWidget, SessionWidget, type SentenceWidgetHandlers, type SessionWidgetHandlers } from './widgets';

/** The language a translated sentence was written in. With two languages, it is the other one. */
function otherLanguage(target: TargetLanguage): TargetLanguage {
	return target === 'en' ? 'de' : 'en';
}

function pathOf(state: EditorState): string | null {
	return state.field(editorInfoField, false)?.file?.path ?? null;
}

function leafMode(host: TranslateHost, state: EditorState): DisplayMode {
	const info = state.field(editorInfoField, false);
	if (info instanceof MarkdownView) return host.modeOf(info.leaf, info.file?.path ?? null);
	return 'original';
}

/**
 * Live Preview support. Translated sentences are replaced by widgets that sit
 * on top of the real text; Markdown structure stays real, editable text.
 */
export function createLivePreviewExtension(host: TranslateHost): Extension {
	let field: StateField<TranslationState>;
	const read = (state: EditorState) => state.field(field, false);

	function compute(state: EditorState, base: Pick<TranslationState, 'mode' | 'typed' | 'session'>): TranslationState {
		const path = pathOf(state);
		const livePreview = state.field(editorLivePreviewField, false) ?? false;
		const mode = base.mode;
		if (!path || !livePreview || !host.settings.livePreview || !isTargetLanguage(mode) || !host.isTranslatable(path)) {
			return { ...INACTIVE, path, mode };
		}
		const note = host.parse(path, state.doc.toString());
		const head = state.selection.main.head;
		const { session } = base;
		let typed = base.typed;
		let typingSentence = false;
		let missing = false;
		const ranges: TranslatedRange[] = [];
		const decorations: Array<Range<Decoration>> = [];
		const atomic: Array<Range<Decoration>> = [];
		const readOnly = host.isMobile;

		for (const s of note.sentences) {
			if (session && s.to > session.from && s.from < session.to) continue;
			const underCaret = head >= s.from && head <= s.to;
			if (typed && underCaret && s.from <= typed.to && s.to >= typed.from) {
				// Typing region: show exactly what is typed until the caret leaves the sentence.
				typingSentence = true;
				const d = host.service.display(path, s, mode);
				if (d.kind === 'missing') missing = true;
				continue;
			}
			const d = host.service.display(path, s, mode);
			switch (d.kind) {
				case 'translated': {
					const widget = Decoration.replace({
						widget: new SentenceWidget(
							d.text,
							s.hash,
							mode,
							host.app,
							path,
							sentenceHandlers,
							readOnly,
							host.settings.animateTranslations && claimAnimation(animationKey(path, mode, s.hash)),
						),
					});
					decorations.push(widget.range(s.from, s.to));
					atomic.push(widget.range(s.from, s.to));
					ranges.push({ from: s.from, to: s.to, hash: s.hash, display: d.text, source: s.text });
					break;
				}
				case 'same':
					break;
				case 'failed': {
					const reason = host.service.failureReason(path, s.hash, mode) ?? '';
					decorations.push(Decoration.mark({ class: 'tt-failed', attributes: { title: t('widget.failed', { error: reason }) } }).range(s.from, s.to));
					break;
				}
				case 'missing':
					if (host.service.canTranslate) {
						missing = true;
						decorations.push(Decoration.mark({ class: 'tt-pending', attributes: { title: t('widget.pending') } }).range(s.from, s.to));
					} else {
						decorations.push(Decoration.mark({ class: 'tt-missing', attributes: { title: t('widget.missing') } }).range(s.from, s.to));
					}
					break;
				case 'pending':
					decorations.push(Decoration.mark({ class: 'tt-pending', attributes: { title: t('widget.pending') } }).range(s.from, s.to));
					break;
			}
		}

		if (session) {
			const target = session.target;
			const source = otherLanguage(target);
			const widget = Decoration.replace({
				widget: new SessionWidget(
					session,
					{ source: t(`language.${source}`), sourceName: t(`mode.${source}`), target: t(`mode.${target}`) },
					sessionHandlers,
				),
			});
			decorations.push(widget.range(session.from, session.to));
			atomic.push(widget.range(session.from, session.to));
		}

		// Once the caret has left the typed sentence, the exemption ends.
		if (!typingSentence) typed = null;
		return {
			path,
			mode,
			active: true,
			ranges,
			missing,
			typed,
			session,
			decorations: Decoration.set(decorations, true),
			atomic: Decoration.set(atomic, true),
		};
	}

	field = StateField.define<TranslationState>({
		create(state) {
			return compute(state, { mode: leafMode(host, state), typed: null, session: null });
		},
		update(value, tr) {
			let { mode, typed, session } = value;
			let changed = tr.docChanged || tr.selection !== undefined;
			for (const effect of tr.effects) {
				if (effect.is(setModeEffect)) {
					if (effect.value !== mode) session = null;
					mode = effect.value;
					changed = true;
				} else if (effect.is(refreshEffect)) {
					changed = true;
				} else if (effect.is(startSessionEffect)) {
					session = effect.value;
					changed = true;
				} else if (effect.is(endSessionEffect)) {
					session = null;
					changed = true;
				}
			}
			if (tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false)) changed = true;
			if (tr.docChanged) {
				if (session && !tr.effects.some((e) => e.is(startSessionEffect))) {
					const from = tr.changes.mapPos(session.from, 1);
					const to = tr.changes.mapPos(session.to, -1);
					session = to > from ? { ...session, from, to } : null;
				}
				if (typed) typed = { from: tr.changes.mapPos(typed.from, -1), to: tr.changes.mapPos(typed.to, 1) };
				if (!isOwnTransaction(tr) && (tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
					tr.changes.iterChangedRanges((_fA, _tA, fromB, toB) => {
						typed = typed ? { from: Math.min(typed.from, fromB), to: Math.max(typed.to, toB) } : { from: fromB, to: toB };
					});
				}
			}
			if (!changed) return value;
			return compute(tr.state, { mode, typed, session });
		},
		provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f, false)?.atomic ?? Decoration.none)],
	});

	// ---- Edit sessions ----------------------------------------------------

	function sessionFor(state: EditorState, value: TranslationState, from: number, to: number, selectAll: boolean): EditSession | null {
		if (!isTargetLanguage(value.mode) || !value.path) return null;
		const covered = value.ranges.filter((r) => r.to > from && r.from < to);
		if (covered.length === 0) return null;
		const start = Math.min(from, ...covered.map((r) => r.from));
		const end = Math.max(to, ...covered.map((r) => r.to));
		const note = host.parse(value.path, state.doc.toString());
		const target = value.mode;
		const path = value.path;
		const display = composeRange(note.text, start, end, note.sentences, (s) => {
			const d = host.service.display(path, s, target);
			return d.kind === 'translated' ? d : { kind: 'same' };
		}).text;
		const preference = host.settings.noteEditPreferences[path];
		return {
			id: newSessionId(),
			from: start,
			to: end,
			display,
			source: state.sliceDoc(start, end),
			target,
			showBanner: !preference && host.settings.editSessionDefault === 'ask',
			selectAll,
			multi: covered.length > 1,
		};
	}

	function leafOf(view: EditorView) {
		const info = view.state.field(editorInfoField, false);
		return info instanceof MarkdownView ? info.leaf : null;
	}

	function editOriginalAt(view: EditorView, pos: number): void {
		const leaf = leafOf(view);
		if (!leaf) return;
		host.setMode(leaf, 'original');
		view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) }, scrollIntoView: true });
		view.focus();
	}

	function currentSession(view: EditorView, id: number): { value: TranslationState; session: EditSession } | null {
		const value = read(view.state);
		const session = value?.session;
		return value && session && session.id === id ? { value, session } : null;
	}

	const sessionHandlers: SessionWidgetHandlers = {
		apply(view, id, text, dontAsk) {
			const current = currentSession(view, id);
			if (!current) return;
			const { value, session } = current;
			if (dontAsk && value.path) host.setNoteEditPreference(value.path, 'replace');
			// Re-check the file range before writing: sync or another plugin may have changed it.
			if (view.state.sliceDoc(session.from, session.to) !== session.source) {
				new Notice(t('notice.session-conflict'));
				view.dispatch({ effects: endSessionEffect.of(null) });
				return;
			}
			if (text === session.display) {
				view.dispatch({ effects: endSessionEffect.of(null) });
				view.focus();
				return;
			}
			view.dispatch({
				changes: { from: session.from, to: session.to, insert: text },
				effects: endSessionEffect.of(null),
				selection: { anchor: session.from + text.length },
				userEvent: SESSION_USER_EVENT,
				annotations: ownChange.of(true),
			});
			if (value.path) host.recordReplacement(value.path, session.source, text, session.target);
			view.focus();
		},
		cancel(view, id) {
			if (!currentSession(view, id)) return;
			view.dispatch({ effects: endSessionEffect.of(null) });
			view.focus();
		},
		editOriginal(view, id, dontAsk) {
			const current = currentSession(view, id);
			if (!current) return;
			if (dontAsk && current.value.path) host.setNoteEditPreference(current.value.path, 'original');
			view.dispatch({ effects: endSessionEffect.of(null) });
			editOriginalAt(view, current.session.from);
		},
		leave(view, id, text) {
			if (!currentSession(view, id)) return;
			// Leaving applies the primary action (decided default), unless turned off in the settings.
			if (host.settings.applyOnLeave) this.apply(view, id, text, false);
		},
	};

	const sentenceHandlers: SentenceWidgetHandlers = {
		activate(view, pos) {
			const value = read(view.state);
			if (!value?.active || !value.path) return;
			const range = value.ranges.find((r) => pos >= r.from && pos <= r.to);
			if (!range) return;
			if (host.isMobile) {
				const leaf = leafOf(view);
				if (leaf) host.setMode(leaf, 'original');
				return;
			}
			const preference = host.settings.noteEditPreferences[value.path] ?? (host.settings.editSessionDefault === 'original' ? 'original' : null);
			if (preference === 'original') {
				editOriginalAt(view, range.from);
				return;
			}
			const session = sessionFor(view.state, value, range.from, range.to, false);
			if (session) view.dispatch({ effects: startSessionEffect.of(session) });
		},
		contextMenu(view, pos, event) {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle(t(host.isMobile ? 'menu.show-original' : 'menu.edit-original'))
					.setIcon('file-pen-line')
					.onClick(() => editOriginalAt(view, pos)),
			);
			menu.showAtMouseEvent(event);
		},
		openLink(href, sourcePath, event) {
			if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
				window.open(href, '_blank', 'noopener');
				return;
			}
			void host.app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(event));
		},
	};

	// ---- Guards ----------------------------------------------------------

	const filter = EditorState.transactionFilter.of((tr: Transaction) => {
		if (!tr.docChanged || isOwnTransaction(tr)) return tr;
		const value = tr.startState.field(field, false);
		if (!value?.active) return tr;
		const userEdit = tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move');
		if (!userEdit) return tr;
		// Mobile: translated views are view-only.
		if (host.isMobile) return [];

		const touched = new Map<string, TranslatedRange>();
		let insertsText = false;
		tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			for (const r of touchedRanges(value.ranges, fromA, toA)) touched.set(`${r.from}`, r);
			if (inserted.length > 0 && touchedRanges(value.ranges, fromA, toA).length > 0) insertsText = true;
		});
		if (touched.size === 0) return tr;
		const list = [...touched.values()];

		if (tr.isUserEvent('input') || insertsText) {
			// Typing over translated text: open an edit session instead of writing to the file.
			const from = Math.min(...list.map((r) => r.from));
			const to = Math.max(...list.map((r) => r.to));
			const session = sessionFor(tr.startState, value, from, to, true);
			return session ? { effects: startSessionEffect.of(session) } : [];
		}

		if (tr.isUserEvent('delete') && host.settings.confirmDelete === 'translated' && isTargetLanguage(value.mode)) {
			const view = findView(tr.startState);
			if (!view) return tr;
			const changes = tr.changes;
			const target = value.mode;
			void host.confirmDelete(list.length, target).then((ok) => {
				if (ok && view.state.doc === tr.startState.doc) {
					view.dispatch({ changes, userEvent: 'delete.confirmed', annotations: ownChange.of(true) });
					if (value.path) host.recordDeletion(value.path, list.map((r) => r.source), target, view);
				}
			});
			return [];
		}
		return tr;
	});

	const views = new Set<EditorView>();
	function findView(state: EditorState): EditorView | undefined {
		for (const view of views) if (view.state === state) return view;
		return undefined;
	}

	// ---- Requests and delete notifications ---------------------------------

	class TranslationViewPlugin {
		private timer: number | null = null;

		constructor(private readonly view: EditorView) {
			views.add(view);
			host.registerEditorView(view);
			this.schedule(50);
		}

		update(update: ViewUpdate): void {
			for (const tr of update.transactions) this.detectDeletion(tr);
			const value = read(update.state);
			if (!value?.missing) return;
			const triggered = update.transactions.some((tr) => tr.effects.some((e) => e.is(setModeEffect) || e.is(refreshEffect)));
			if (update.docChanged) this.schedule(host.settings.typingIdleMs);
			else if (triggered && this.timer === null) this.schedule(50);
		}

		private schedule(delay: number): void {
			if (this.timer !== null) window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => {
				this.timer = null;
				const value = read(this.view.state);
				if (!value?.active || !value.missing || !value.path || !isTargetLanguage(value.mode)) return;
				const note = host.parse(value.path, this.view.state.doc.toString());
				host.service.request(value.path, note, note.sentences, value.mode, host.noteTitle(value.path));
			}, delay);
		}

		private detectDeletion(tr: Transaction): void {
			if (!tr.docChanged || isOwnTransaction(tr) || !tr.isUserEvent('delete')) return;
			const before = tr.startState.field(field, false);
			if (!before?.active || !before.path || !isTargetLanguage(before.mode)) return;
			const deleted: string[] = [];
			tr.changes.iterChanges((fromA, toA) => {
				for (const r of before.ranges) if (fromA <= r.from && toA >= r.to) deleted.push(r.source);
			});
			if (deleted.length > 0) host.recordDeletion(before.path, deleted, before.mode, this.view);
		}

		destroy(): void {
			if (this.timer !== null) window.clearTimeout(this.timer);
			views.delete(this.view);
			host.unregisterEditorView(this.view);
		}
	}

	// ---- Clipboard: copy what is displayed ---------------------------------

	function displayedText(view: EditorView, from: number, to: number): string | null {
		const value = read(view.state);
		if (!value?.active || !value.path || !isTargetLanguage(value.mode)) return null;
		if (!value.ranges.some((r) => r.to > from && r.from < to)) return null;
		const path = value.path;
		const target = value.mode;
		const note = host.parse(path, view.state.doc.toString());
		return composeRange(note.text, from, to, note.sentences, (s) => {
			const d = host.service.display(path, s, target);
			return d.kind === 'translated' ? d : { kind: 'same' };
		}).text;
	}

	const clipboard = EditorView.domEventHandlers({
		copy(event, view) {
			const { from, to } = view.state.selection.main;
			const text = from === to ? null : displayedText(view, from, to);
			if (text === null || !event.clipboardData) return false;
			event.clipboardData.setData('text/plain', text);
			event.preventDefault();
			return true;
		},
		cut(event, view) {
			const { from, to } = view.state.selection.main;
			const text = from === to ? null : displayedText(view, from, to);
			if (text === null || !event.clipboardData) return false;
			event.clipboardData.setData('text/plain', text);
			event.preventDefault();
			view.dispatch({ changes: { from, to }, userEvent: 'delete.cut' });
			return true;
		},
	});

	return [field, filter, ViewPlugin.fromClass(TranslationViewPlugin), clipboard];
}

/** Effects the plugin dispatches to editors when modes or translations change. */
export { refreshEffect, setModeEffect };
export type { DecorationSet };
