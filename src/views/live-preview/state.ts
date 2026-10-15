import { Annotation, StateEffect, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import type { DisplayMode, TargetLanguage } from '../../core/types';

/** A sentence currently shown as a translation widget. */
export interface TranslatedRange {
	from: number;
	to: number;
	hash: string;
	/** Translated text shown instead of the original. */
	display: string;
	/** Original text on disk. */
	source: string;
}

/** An open edit session on translated text. Nothing is written until it is applied. */
export interface EditSession {
	id: number;
	from: number;
	to: number;
	display: string;
	source: string;
	target: TargetLanguage;
	showBanner: boolean;
	/** Select all text when the inline editor opens (session started by typing). */
	selectAll: boolean;
	multi: boolean;
}

export interface TranslationState {
	path: string | null;
	mode: DisplayMode;
	/** True when this editor shows translations (Live Preview, translated mode, translatable note). */
	active: boolean;
	ranges: TranslatedRange[];
	/** Some sentences have no translation yet and should be requested. */
	missing: boolean;
	/** Text typed recently; the sentence under the caret inside it is shown as typed. */
	typed: { from: number; to: number } | null;
	session: EditSession | null;
	decorations: DecorationSet;
	/** Replace decorations only: the caret skips over these. */
	atomic: DecorationSet;
}

export const setModeEffect = StateEffect.define<DisplayMode>();
export const refreshEffect = StateEffect.define<null>();
export const startSessionEffect = StateEffect.define<EditSession>();
export const endSessionEffect = StateEffect.define<null>();

/** Marks transactions written by this plugin (edit sessions, confirmed deletes). */
export const ownChange = Annotation.define<boolean>();

/** User event of edits applied by an edit session. */
export const SESSION_USER_EVENT = 'input.transparent-translate';

export const INACTIVE: Omit<TranslationState, 'path' | 'mode'> = {
	active: false,
	ranges: [],
	missing: false,
	typed: null,
	session: null,
	decorations: Decoration.none,
	atomic: Decoration.none,
};

let nextSessionId = 1;

export function newSessionId(): number {
	return nextSessionId++;
}

/** Translated ranges that a change from `fromA` to `toA` touches (not just borders). */
export function touchedRanges(ranges: readonly TranslatedRange[], fromA: number, toA: number): TranslatedRange[] {
	return ranges.filter((r) => (fromA === toA ? fromA > r.from && fromA < r.to : fromA < r.to && toA > r.from));
}

export function isOwnTransaction(tr: { annotation: (a: typeof ownChange) => boolean | undefined; isUserEvent: (e: string) => boolean }): boolean {
	return tr.annotation(ownChange) === true || tr.isUserEvent(SESSION_USER_EVENT);
}

export type FieldReader = (state: EditorState) => TranslationState | undefined;
