import type { App, MarkdownView, WorkspaceLeaf } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { DisplayMode, NoteModel, TargetLanguage } from './core/types';
import type { TransparentTranslateSettings } from './settings';
import type { TranslationService } from './services/translation-service';

/**
 * What the views need from the plugin. Keeps the view modules independent of
 * `main.ts` (no import cycles) and documents the contract in one place.
 */
export interface TranslateHost {
	readonly app: App;
	readonly settings: TransparentTranslateSettings;
	readonly isMobile: boolean;
	readonly service: TranslationService;

	isTranslatable(path: string): boolean;
	parse(path: string, text: string): NoteModel;
	noteTitle(path: string): string;

	modeOf(leaf: WorkspaceLeaf, path: string | null): DisplayMode;
	setMode(leaf: WorkspaceLeaf, mode: DisplayMode): void;
	/** The Markdown view a rendered section or editor belongs to. */
	findMarkdownView(path: string, el?: HTMLElement): MarkdownView | null;

	registerEditorView(view: EditorView): void;
	unregisterEditorView(view: EditorView): void;

	/** Opens the dialog to correct the translation of one sentence. */
	fixTranslation(path: string, sentenceHash: string, target: TargetLanguage): void;
	/** Called after an edit session replaced original text with `newText`. */
	recordReplacement(path: string, oldText: string, newText: string, target: TargetLanguage): void;
	/** Called after translated sentences were deleted from the file. */
	recordDeletion(path: string, texts: string[], target: TargetLanguage, editorView: EditorView): void;
	confirmDelete(count: number, target: TargetLanguage): Promise<boolean>;
	/** Remembers "don't ask again" for a note. */
	setNoteEditPreference(path: string, preference: 'replace' | 'original'): void;
}
