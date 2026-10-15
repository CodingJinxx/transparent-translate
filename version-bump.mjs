import { readFileSync, writeFileSync } from 'node:fs';

const targetVersion = process.env.npm_package_version;
if (!targetVersion || !/^\d+\.\d+\.\d+$/.test(targetVersion)) {
	console.error(`Refusing to bump: "${targetVersion}" is not a plain x.y.z version.`);
	process.exit(1);
}

// Read minAppVersion from manifest.json and bump version to the target version.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');

// Map the new version to the current minAppVersion in versions.json.
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');
}
