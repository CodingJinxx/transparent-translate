import type { WorkspaceLeaf } from 'obsidian';
import type { DisplayMode } from './core/types';

interface LeafMode {
	path: string | null;
	mode: DisplayMode;
}

/**
 * Display mode per leaf (tab). A leaf that opens another file starts again
 * with the default mode from the settings.
 */
export class ModeManager {
	private readonly modes = new WeakMap<WorkspaceLeaf, LeafMode>();

	constructor(private readonly defaultMode: () => DisplayMode) {}

	get(leaf: WorkspaceLeaf, path: string | null): DisplayMode {
		const entry = this.modes.get(leaf);
		return entry && entry.path === path ? entry.mode : this.defaultMode();
	}

	set(leaf: WorkspaceLeaf, path: string | null, mode: DisplayMode): void {
		this.modes.set(leaf, { path, mode });
	}
}
