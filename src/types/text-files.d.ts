/** Markdown files are bundled as text (see `esbuild.config.mjs`). */
declare module '*.md' {
	const content: string;
	export default content;
}
