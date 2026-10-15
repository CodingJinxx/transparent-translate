/**
 * Records the showcase demo in a sandboxed Obsidian and turns it into the
 * README/website GIF and two stills. Needs ffmpeg 7 or newer on the PATH.
 *
 *   npm run demo                    # record (latest Obsidian, mock translator) and assemble
 *   npm run demo -- --skip-record   # assemble again from the last recording
 *
 * Frames go to TT_DEMO_OUT (default: a folder in the system temp directory),
 * never into the repository. Each scene is stretched to whole bars of
 * BAR seconds (120 BPM, 4/4), so the GIF lines up with the website music.
 * The caption font can be set with TT_DEMO_FONT (a .ttf/.otf path).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BAR = 2;
/** The total length is padded to a multiple of this many bars (one music phrase). */
const PHRASE_BARS = 4;
const WIDTH = 720;
/** 20 fps gives exact GIF frame delays (5 centiseconds). */
const FPS = 20;
const CAPTION_HEIGHT = 44;

const root = resolve(import.meta.dirname, '..');
const frames = resolve(process.env.TT_DEMO_OUT ?? join(tmpdir(), 'transparent-translate-demo'));
const gifOut = join(root, 'docs/images/demo.gif');

function run(cmd, args, options = {}) {
	const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
	if (result.status !== 0) throw new Error(`${cmd} failed with exit code ${result.status}`);
}

function findFont() {
	const candidates = [
		process.env.TT_DEMO_FONT,
		'C:/Windows/Fonts/seguisb.ttf',
		'C:/Windows/Fonts/segoeui.ttf',
		'/System/Library/Fonts/Supplemental/Arial.ttf',
		'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
	];
	const font = candidates.find((f) => f && existsSync(f));
	if (!font) throw new Error('No caption font found: set TT_DEMO_FONT to a .ttf file');
	return font;
}

// ---- 1. Record ------------------------------------------------------------

if (!process.argv.includes('--skip-record')) {
	rmSync(frames, { recursive: true, force: true });
	mkdirSync(frames, { recursive: true });
	// One command string (no arguments to escape), so `npx` also resolves on Windows.
	run('npx wdio run ./wdio.conf.mts --spec test/e2e/specs/demo.e2e.ts', [], {
		cwd: root,
		shell: true,
		env: { ...process.env, OBSIDIAN_VERSIONS: 'latest/latest', TT_SKIP_MOBILE: '1', TT_DEMO_OUT: frames },
	});
}

// ---- 2. Retime the scenes to whole bars ------------------------------------

const timeline = JSON.parse(readFileSync(join(frames, 'timeline.json'), 'utf8'));
const { scenes, end } = timeline;
const allFrames = timeline.frames;

const entries = []; // { file, duration }
const captions = []; // { text, from, to }
let clock = 0;
scenes.forEach((scene, i) => {
	const from = scene.t;
	const to = i + 1 < scenes.length ? scenes[i + 1].t : end;
	const inScene = allFrames.filter((f) => f.t >= from && f.t < to);
	if (inScene.length === 0) throw new Error(`scene "${scene.caption}" has no frames`);
	let length = Math.max(1, Math.ceil((to - from) / BAR)) * BAR;
	if (i === scenes.length - 1) {
		const total = clock + length;
		const phrase = PHRASE_BARS * BAR;
		length += Math.ceil(total / phrase) * phrase - total;
	}
	inScene.forEach((f, k) => {
		const next = k + 1 < inScene.length ? inScene[k + 1].t : from + length;
		entries.push({ file: f.file, duration: next - f.t });
	});
	captions.push({ text: scene.caption, from: clock, to: clock + length });
	clock += length;
});

const concat = ['ffconcat version 1.0'];
for (const e of entries) concat.push(`file '${e.file}'`, `duration ${e.duration.toFixed(4)}`);
concat.push(`file '${entries.at(-1).file}'`);
writeFileSync(join(frames, 'frames.ffconcat'), concat.join('\n') + '\n');

// ---- 3. Captions and GIF ------------------------------------------------------

copyFileSync(findFont(), join(frames, 'caption-font.ttf'));
const draw = captions.map((c, i) => {
	writeFileSync(join(frames, `caption-${i}.txt`), c.text);
	return (
		`drawtext=fontfile=caption-font.ttf:textfile=caption-${i}.txt:fontsize=19:fontcolor=0xf2f2f2` +
		`:x=(w-text_w)/2:y=h-${CAPTION_HEIGHT}+(${CAPTION_HEIGHT}-text_h)/2` +
		`:enable='between(t,${c.from.toFixed(3)},${(c.to - 0.001).toFixed(3)})'`
	);
});
const filter = [
	`[0:v]fps=${FPS},scale=${WIDTH}:-2:flags=lanczos,pad=iw:ih+${CAPTION_HEIGHT}:0:0:color=0x262626,`,
	`drawbox=x=0:y=ih-${CAPTION_HEIGHT}:w=6:h=${CAPTION_HEIGHT}:color=0x8b6cef:t=fill,`,
	draw.join(',') + ',',
	'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
].join('\n');
writeFileSync(join(frames, 'gif.filter'), filter);
run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.ffconcat', '-/filter_complex', 'gif.filter', '-t', String(clock), '-loop', '0', gifOut], { cwd: frames });

// ---- 4. Stills for the website -------------------------------------------------

for (const still of timeline.stills ?? []) {
	const frame = allFrames.find((f) => f.t >= still.t) ?? allFrames.at(-1);
	const out = join(root, `docs/images/demo-${still.name}.png`);
	run('ffmpeg', ['-y', '-v', 'error', '-i', frame.file, '-vf', 'scale=960:-2:flags=lanczos', '-frames:v', '1', out], { cwd: frames });
}

const mb = (f) => (statSync(f).size / 1024 / 1024).toFixed(2);
console.log(`GIF: ${gifOut} (${mb(gifOut)} MB, ${clock} s, ${clock / BAR} bars of ${BAR} s)`);
for (const c of captions) console.log(`  ${c.from.toFixed(0).padStart(3)}–${c.to.toFixed(0).padStart(3)} s  ${c.text}`);
