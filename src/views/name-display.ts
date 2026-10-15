import { FileView, TFile, TFolder, type TAbstractFile } from 'obsidian';
import { isNameTranslatable, parentPath, resolveCollisions, type NameRules } from '../core/names';
import { isTargetLanguage, type TargetLanguage } from '../core/types';
import type TransparentTranslatePlugin from '../main';
import { getTabHeaderEls } from '../obsidian/internals';
import type { NameRequest } from '../services/name-service';

/**
 * Shows translated file and folder names. Only the text on screen changes:
 * names on disk are never touched, and the real name is always what gets
 * read back by Obsidian when a rename starts (see `isEditing`).
 *
 * Obsidian has no API for this, so the visible labels are swapped in place:
 * the file explorer, tab titles, the view header title, its breadcrumbs and
 * the inline title. A MutationObserver re-applies the swap whenever Obsidian
 * redraws a label. If a label is not found, it simply keeps its real name.
 */

interface Target {
	el: HTMLElement;
	file: TAbstractFile;
	/** Name as Obsidian shows it without any translation. */
	real: string;
	/** `attr`: editable while `contenteditable` is set (explorer rename). Otherwise only while focused. */
	editableBy: 'attr' | 'focus';
	/** Also mirror the name into this element's `aria-label` (tab headers). */
	labelEl?: HTMLElement;
}

const OBSERVE: MutationObserverInit = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['contenteditable'] };
const REQUEST_DELAY_MS = 300;

export class NameDisplayController {
	private readonly observers = new Map<HTMLElement, MutationObserver>();
	private readonly queued = new Map<string, NameRequest>();
	private readonly shown = new WeakMap<Element, string>();
	private requestTimer: number | null = null;
	private enabled = true;

	constructor(private readonly plugin: TransparentTranslatePlugin) {}

	start(): void {
		const { plugin } = this;
		const workspace = plugin.app.workspace;
		const sync = () => this.sync();
		plugin.registerEvent(workspace.on('layout-change', sync));
		plugin.registerEvent(workspace.on('file-open', sync));
		plugin.registerEvent(workspace.on('active-leaf-change', sync));
		plugin.registerEvent(plugin.app.vault.on('rename', sync));
		plugin.registerDomEvent(document, 'focusin', () => this.pass());
		// After focus left a label, show its translation again.
		plugin.registerDomEvent(document, 'focusout', () => window.setTimeout(() => this.pass(), 0));
		plugin.names.onUpdate(() => this.pass());
		workspace.onLayoutReady(sync);
	}

	/** Restores every label and stops observing. Called on unload. */
	stop(): void {
		this.enabled = false;
		this.pass();
		for (const observer of this.observers.values()) observer.disconnect();
		this.observers.clear();
		if (this.requestTimer !== null) window.clearTimeout(this.requestTimer);
		this.requestTimer = null;
	}

	/** The names mode or a related setting changed. */
	refresh(): void {
		this.plugin.names.clearFailures();
		this.sync();
	}

	private get mode(): TargetLanguage | null {
		if (!this.enabled) return null;
		const mode = this.plugin.settings.nameMode;
		return isTargetLanguage(mode) ? mode : null;
	}

	private rules(): NameRules {
		return { ...this.plugin.derived.folderRules, includeAttachments: this.plugin.settings.nameIncludeAttachments };
	}

	// ---- Observers ------------------------------------------------------

	/** Finds the elements to watch (they come and go with leaves and views) and updates labels. */
	private sync(): void {
		const live = new Set<HTMLElement>();
		const watch = (el: HTMLElement | null | undefined) => {
			if (!el) return;
			live.add(el);
			if (!this.observers.has(el)) {
				const observer = new MutationObserver(() => this.pass());
				observer.observe(el, OBSERVE);
				this.observers.set(el, observer);
			}
		};
		const workspace = this.plugin.app.workspace;
		for (const leaf of workspace.getLeavesOfType('file-explorer')) watch(leaf.view.containerEl);
		workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof FileView)) return;
			watch(getTabHeaderEls(leaf).title);
			watch(leaf.view.containerEl.querySelector<HTMLElement>('.view-header'));
			watch(leaf.view.containerEl.querySelector<HTMLElement>('.inline-title'));
		});
		for (const [el, observer] of this.observers) {
			if (live.has(el) && el.isConnected) continue;
			observer.disconnect();
			this.observers.delete(el);
		}
		this.pass();
	}

	// ---- Collecting labels ---------------------------------------------

	private realName(file: TAbstractFile): string {
		return file instanceof TFile ? file.basename : file.name;
	}

	private collect(): Target[] {
		const { vault, workspace } = this.plugin.app;
		const targets: Target[] = [];

		for (const leaf of workspace.getLeavesOfType('file-explorer')) {
			const rows = leaf.view.containerEl.querySelectorAll<HTMLElement>('.nav-file-title[data-path], .nav-folder-title[data-path]');
			rows.forEach((row) => {
				const file = vault.getAbstractFileByPath(row.dataset.path ?? '');
				const el = row.querySelector<HTMLElement>(':scope > .nav-file-title-content, :scope > .nav-folder-title-content');
				if (file && el && file.path !== '/') targets.push({ el, file, real: this.realName(file), editableBy: 'attr' });
			});
		}

		workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof FileView) || !view.file) return;
			const file = view.file;
			const real = file.basename;
			const tab = getTabHeaderEls(leaf);
			if (tab.title) targets.push({ el: tab.title, file, real, editableBy: 'focus', ...(tab.header ? { labelEl: tab.header } : {}) });
			const headerTitle = view.containerEl.querySelector<HTMLElement>('.view-header-title');
			if (headerTitle) targets.push({ el: headerTitle, file, real, editableBy: 'focus' });
			const inline = view.containerEl.querySelector<HTMLElement>('.inline-title');
			if (inline) targets.push({ el: inline, file, real, editableBy: 'focus' });

			// The breadcrumbs list the folders of the path, outermost first.
			const folders = parentPath(file.path).split('/').filter((s) => s.length > 0);
			view.containerEl.querySelectorAll<HTMLElement>('.view-header-breadcrumb').forEach((el, index) => {
				const folder = vault.getAbstractFileByPath(folders.slice(0, index + 1).join('/'));
				if (folder instanceof TFolder && (el.textContent === folder.name || el.textContent === this.shown.get(el))) targets.push({ el, file: folder, real: folder.name, editableBy: 'focus' });
			});
		});
		return targets;
	}

	// ---- Applying -------------------------------------------------------

	private isEditing(target: Target): boolean {
		const active = target.el.ownerDocument.activeElement;
		if (active && (active === target.el || target.el.contains(active))) return true;
		if (target.editableBy === 'attr') {
			const editable = target.el.getAttribute('contenteditable');
			return editable !== null && editable !== 'false';
		}
		return false;
	}

	private eligible(file: TAbstractFile): boolean {
		return isNameTranslatable(file.path, file instanceof TFolder, file instanceof TFile ? file.extension : '', this.rules());
	}

	/** Translation of a name or its real name. Queues a request when it is not cached. */
	private translated(file: TAbstractFile, real: string, mode: TargetLanguage, queue: boolean): string {
		if (!this.eligible(file)) return real;
		const display = this.plugin.names.display(real, mode);
		if (display.kind === 'translated') return display.text;
		if (display.kind === 'missing' && queue) this.queue({ stem: real, folder: parentPath(file.path) });
		return real;
	}

	/** Final labels for all children of a folder, resolving clashes between siblings. */
	private siblingLabels(parent: TFolder, mode: TargetLanguage, cache: Map<string, Map<string, string>>): Map<string, string> {
		const known = cache.get(parent.path);
		if (known) return known;
		const children = parent.children;
		const inputs = children.map((child) => {
			const real = this.realName(child);
			return { real, display: this.translated(child, real, mode, false) };
		});
		const resolved = resolveCollisions(inputs);
		const labels = new Map<string, string>();
		children.forEach((child, i) => labels.set(child.path, resolved[i]!));
		cache.set(parent.path, labels);
		return labels;
	}

	private pass(): void {
		const mode = this.mode;
		const targets = this.collect();
		const cache = new Map<string, Map<string, string>>();
		for (const target of targets) {
			const { file, real } = target;
			let display = real;
			if (mode && !this.isEditing(target)) {
				display = this.translated(file, real, mode, true);
				if (display !== real && file.parent) display = this.siblingLabels(file.parent, mode, cache).get(file.path) ?? real;
			}
			this.apply(target, display);
		}
		// Our own changes need no second pass.
		for (const observer of this.observers.values()) observer.takeRecords();
		this.flushSoon();
	}

	private apply(target: Target, display: string): void {
		const { el, real, labelEl } = target;
		const current = el.textContent ?? '';
		const last = this.shown.get(el);
		// Only touch labels that show this file's name. Anything else (an unrelated title, a name being typed) stays.
		if (current !== display && (current === real || current === last)) {
			setText(el, display);
			if (display === real && target.editableBy === 'attr' && this.isEditing(target)) selectAll(el);
		}
		this.shown.set(el, display);
		if (labelEl) {
			const label = labelEl.getAttribute('aria-label');
			const lastLabel = this.shown.get(labelEl);
			if (label !== display && (label === real || label === lastLabel)) labelEl.setAttribute('aria-label', display);
			this.shown.set(labelEl, display);
		}
	}

	// ---- Requests -------------------------------------------------------

	private queue(request: NameRequest): void {
		if (!this.plugin.names.canTranslate) return;
		this.queued.set(request.stem, request);
	}

	private flushSoon(): void {
		if (this.queued.size === 0 || this.requestTimer !== null) return;
		this.requestTimer = window.setTimeout(() => {
			this.requestTimer = null;
			const mode = this.mode;
			const items = [...this.queued.values()];
			this.queued.clear();
			if (mode && items.length > 0) this.plugin.names.request(items, mode);
		}, REQUEST_DELAY_MS);
	}
}

/** Changes the text in place when the label is a single text node, so a selection in it survives. */
function setText(el: HTMLElement, text: string): void {
	const node = el.firstChild;
	if (el.childNodes.length === 1 && node instanceof Text) node.nodeValue = text;
	else el.textContent = text;
}

function selectAll(el: HTMLElement): void {
	const selection = el.ownerDocument.getSelection();
	if (!selection) return;
	const range = el.ownerDocument.createRange();
	range.selectNodeContents(el);
	selection.removeAllRanges();
	selection.addRange(range);
}
