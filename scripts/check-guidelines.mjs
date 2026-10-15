#!/usr/bin/env node
/**
 * Checks plugin-guideline rules that ESLint does not cover. Fails CI if any
 * source file breaks them. See CONTRIBUTING.md for the reasons.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const srcDir = join(root, 'src');

const rules = [
	{ name: 'regex lookbehind (breaks on older iOS)', pattern: /\(\?<[=!]/ },
	{ name: 'innerHTML / outerHTML / insertAdjacentHTML', pattern: /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(/ },
	{ name: 'inline style (use CSS classes in styles.css)', pattern: /\.style\.[a-zA-Z]+\s*=|\.setAttribute\(\s*['"]style['"]|setCssStyles\(|attr:\s*\{[^}]*\bstyle\s*:/ },
	{ name: 'console.log / console.info (use log.debug)', pattern: /console\.(log|info)\(/ },
	{ name: 'default hotkeys (users bind their own)', pattern: /\bhotkeys\s*:/ },
	{ name: 'global app (use this.app)', pattern: /(?<![\w.])app\.(vault|workspace|metadataCache)/, skipComments: true },
	{ name: 'vault adapter (use the Vault API)', pattern: /\.adapter\./ },
	{ name: 'Node or Electron import (breaks mobile)', pattern: /from\s+['"](fs|path|os|child_process|electron|crypto|node:[a-z_]+)['"]/ },
];

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
	});
}

let problems = 0;
for (const file of files(srcDir)) {
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, index) => {
		const code = line.replace(/\/\/.*$/, '');
		if (/^\s*(\*|\/\*)/.test(line)) return;
		for (const rule of rules) {
			if (rule.pattern.test(code)) {
				problems++;
				console.error(`${relative(root, file)}:${index + 1}  ${rule.name}\n    ${line.trim()}`);
			}
		}
	});
}

// The manifest must be valid for the community directory.
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const versions = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifestChecks = [
	[!/obsidian/i.test(manifest.id), 'manifest id must not contain "obsidian"'],
	[/^\d+\.\d+\.\d+$/.test(manifest.version), 'manifest version must be x.y.z'],
	[manifest.version === pkg.version, 'manifest and package.json versions differ'],
	[versions[manifest.version] === manifest.minAppVersion, 'versions.json must map the current version to minAppVersion'],
	[manifest.isDesktopOnly === false, 'isDesktopOnly must be false (mobile display is supported)'],
	[!/obsidian/i.test(manifest.description) && manifest.description.endsWith('.'), 'description: no "Obsidian", end with a period'],
];
for (const [ok, message] of manifestChecks) {
	if (!ok) {
		problems++;
		console.error(`manifest.json  ${message}`);
	}
}

if (problems > 0) {
	console.error(`\n${problems} guideline problem(s) found.`);
	process.exit(1);
}
console.log('Guideline check passed.');
