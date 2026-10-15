import type { DisplayMode } from './core/types';
import type { ProviderPresetId } from './translator/providers';
import type { SegmentOptions } from './core/sentences';
import type { FolderRules } from './core/paths';
import { DEFAULT_ABBREVIATIONS } from './core/sentences';
import { parseFolderList } from './core/paths';
import { parseGlossary } from './core/prompt';

export type EditSessionDefault = 'ask' | 'replace' | 'original';
export type ConfirmDelete = 'off' | 'translated';
export type NoteEditPreference = 'replace' | 'original';

export interface TransparentTranslateSettings {
	// Provider
	providerPreset: ProviderPresetId;
	baseUrl: string;
	model: string;
	/** Name of the secret in Obsidian's SecretStorage. The key itself is never stored here. */
	apiKeySecret: string;
	jsonMode: boolean;
	temperature: number;
	maxTokens: number;
	extraHeaders: string;
	extraBody: string;
	timeoutSeconds: number;
	concurrency: number;
	maxRetries: number;
	batchSize: number;

	// Translation
	glossary: string;
	translateWikilinkAliases: boolean;
	abbreviations: string;
	typingIdleMs: number;

	// Display
	defaultMode: DisplayMode;
	livePreview: boolean;
	animateTranslations: boolean;
	statusBar: boolean;

	// Editing in translated views
	editSessionDefault: EditSessionDefault;
	applyOnLeave: boolean;
	confirmDelete: ConfirmDelete;
	noteEditPreferences: Record<string, NoteEditPreference>;

	// Folders
	cacheFolder: string;
	excludedFolders: string;
	includeOnlyFolders: string;

	// Cost estimate
	inputPrice: number;
	outputPrice: number;
	charsPerToken: number;

	// Advanced
	pruneCache: boolean;
	pruneAfterDays: number;
	debugLogging: boolean;
}

export const DEFAULT_SETTINGS: TransparentTranslateSettings = {
	providerPreset: 'lmstudio',
	baseUrl: 'http://localhost:1234/v1',
	model: '',
	apiKeySecret: '',
	jsonMode: false,
	temperature: 0,
	maxTokens: 0,
	extraHeaders: '',
	extraBody: '',
	timeoutSeconds: 60,
	concurrency: 2,
	maxRetries: 2,
	batchSize: 40,

	glossary: '',
	translateWikilinkAliases: false,
	abbreviations: DEFAULT_ABBREVIATIONS.join('\n'),
	typingIdleMs: 1500,

	defaultMode: 'original',
	livePreview: true,
	animateTranslations: true,
	statusBar: true,

	editSessionDefault: 'ask',
	applyOnLeave: true,
	confirmDelete: 'off',
	noteEditPreferences: {},

	cacheFolder: '_Translations',
	excludedFolders: '',
	includeOnlyFolders: '',

	inputPrice: 0,
	outputPrice: 0,
	charsPerToken: 4,

	pruneCache: true,
	pruneAfterDays: 30,
	debugLogging: false,
};

/** Merges stored data over the defaults, ignoring unknown or mistyped keys. */
export function mergeSettings(stored: unknown): TransparentTranslateSettings {
	const settings: TransparentTranslateSettings = { ...DEFAULT_SETTINGS, noteEditPreferences: {} };
	if (typeof stored !== 'object' || stored === null) return settings;
	const record = stored as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof TransparentTranslateSettings>) {
		const value = record[key];
		if (value === undefined || typeof value !== typeof DEFAULT_SETTINGS[key]) continue;
		(settings as unknown as Record<string, unknown>)[key] = value;
	}
	return settings;
}

/** Derived values, recomputed only when the settings object changes. */
export class DerivedSettings {
	private source: TransparentTranslateSettings | null = null;
	private segment: SegmentOptions | null = null;
	private folders: FolderRules | null = null;
	private glossaryTerms: string[] = [];

	constructor(private readonly get: () => TransparentTranslateSettings) {}

	private refresh(): TransparentTranslateSettings {
		const settings = this.get();
		if (settings !== this.source) {
			this.source = settings;
			const abbreviations = settings.abbreviations
				.split(/\r?\n/)
				.map((a) => a.trim())
				.filter((a) => a.length > 0);
			this.segment = {
				protect: { translateWikilinkAliases: settings.translateWikilinkAliases },
				abbreviations,
			};
			this.folders = {
				cacheFolder: settings.cacheFolder,
				excludedFolders: parseFolderList(settings.excludedFolders),
				includeOnlyFolders: parseFolderList(settings.includeOnlyFolders),
			};
			this.glossaryTerms = parseGlossary(settings.glossary);
		}
		return settings;
	}

	/** Call after mutating settings in place, so derived values are rebuilt. */
	invalidate(): void {
		this.source = null;
	}

	get segmentOptions(): SegmentOptions {
		this.refresh();
		return this.segment!;
	}

	get folderRules(): FolderRules {
		this.refresh();
		return this.folders!;
	}

	get glossary(): string[] {
		this.refresh();
		return this.glossaryTerms;
	}
}
