// Source files use `window.setTimeout` (required for Obsidian popout windows).
// In Node there is no `window`, so alias it to the global object.
(globalThis as { window?: unknown }).window ??= globalThis;
