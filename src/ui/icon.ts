/**
 * The plugin's icon: two overlapping pages, as in `docs/images/icon.svg`
 * reduced to one colour. Registered once with `addIcon`, so it follows the
 * theme like the built-in Lucide icons.
 */
export const ICON_ID = 'transparent-translate';

/**
 * Obsidian draws custom icons in a 0–100 coordinate space. The shapes are the
 * 24×24 originals, scaled by 100/24 (4.1667), with stroke attributes of their own.
 */
export const ICON_SVG =
	'<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
	'<rect x="2.5" y="3.5" width="12" height="14" rx="2.5"/>' +
	'<rect x="9.5" y="6.5" width="12" height="14" rx="2.5"/>' +
	'<path d="M13 12h5M13 16h3"/>' +
	'</g>';
