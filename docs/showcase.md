# Showcase: demo GIF, website and music

The demo GIF in the README and the website at <https://codingjinxx.github.io/transparent-translate/> are made from this repository. Nothing in them comes from a real vault or a real LLM.

## Demo GIF

```bash
npm run build
npm run demo                    # record and assemble
npm run demo -- --skip-record   # assemble again from the last recording
```

`npm run demo` (`scripts/make-demo.mjs`) runs `test/e2e/specs/demo.e2e.ts` in a sandboxed Obsidian (latest version, desktop only) with the e2e test vault and the mock translator from `test/e2e/mock-llm.ts`. The spec takes screenshots continuously while it switches languages, opens an edit session in Live Preview, fixes a term with **Fix translation…** and shows translated file names. A yellow ring stands in for the mouse pointer, which screenshots do not show.

The script then uses ffmpeg (7 or newer) to stretch every scene to whole bars of the music (2 s at 120 BPM), add the captions and write:

- `docs/images/demo.gif` (720 px wide, 20 fps, optimised palette)
- `docs/images/demo-fix-translation.png` and `docs/images/demo-file-names.png` (stills for the website)

Frames go to a folder in the system temp directory (or `TT_DEMO_OUT`), never into the repository. The caption font is Segoe UI on Windows; set `TT_DEMO_FONT` to a `.ttf` file elsewhere.

## Website

The site is plain HTML and CSS in `site/`, with one small local script for the music button, plus the Buy Me a Coffee donation button (a script from `cdnjs.buymeacoffee.com`, the only thing loaded from another site). It sets no cookies of its own and has no analytics. The workflow `.github/workflows/pages.yml` copies `site/` and the images it uses from `docs/images/` into one folder and publishes it to GitHub Pages on every push to `main` that touches them.

To preview it locally, copy the same files into a folder and serve it:

```bash
mkdir -p /tmp/tt-site && cp -r site/. /tmp/tt-site/
cp docs/images/{icon.svg,demo.gif,demo-fix-translation.png,demo-file-names.png,reading-english.png} /tmp/tt-site/
python -m http.server 8000 --directory /tmp/tt-site
```

## Music

`site/theme.ogg` (Opus) and `site/theme.mp3` are a 40 s loop, the length of the GIF. The music is off until a visitor presses **Play music**; starting it restarts the GIF so each scene begins on a bar, and a short noise swell marks each scene change.

It was written in [Strudel](https://strudel.cc) and rendered with the REPL's **export** tab (Export to WAV, cycles 0 to 40, 48 kHz, "Multi Channel Orbits" off). The loop is cycles 20 to 40 of that render, so it starts with the echo and reverb tails of the previous pass and loops without a seam. Encoded with ffmpeg: `volume=2dB`, Opus 96 kbit/s and MP3 128 kbit/s.

- Strudel is free software under the AGPL-3.0. Its FAQ says the music you make with it is your own.
- The pattern uses only Strudel's built-in oscillators (`sawtooth`, `square`, `triangle`, `sine`) and noise (`white`, `pink`), no sample banks, so no third-party sounds are included.
- The pattern and the rendered loop are part of this repository and under its MIT license.

To render it again, paste the pattern into <https://strudel.cc>, export cycles 0 to 40 as above, and cut seconds 40 to 80 of the WAV.

```js
// Transparent Translate: showcase theme
// 120 BPM, one cycle = one 4/4 bar = 2 s. Oscillators and noise only, no samples.
// Everything repeats within 20 bars (40 s), the length of the demo GIF.
setcpm(30)

// Pad: Am7, Fmaj7, Cmaj7, G6
$: note("<[a3,c4,e4,g4] [f3,a3,c4,e4] [c4,e4,g4,b4] [g3,b3,d4,e4]>")
  .s("sawtooth").lpf(900).lpq(2).attack(.4).sustain(.8).release(1.5)
  .gain(.12).room(.6).roomsize(4)

// Bass
$: note("<a1 f1 c2 g1>").struct("x ~ x x ~ x ~ x")
  .s("square").lpf(500).decay(.2).sustain(.3).gain(.3)

// Arpeggio with a dotted-eighth echo
$: note("<[a4 c5 e5 c5]*2 [f4 a4 c5 a4]*2 [e4 g4 c5 g4]*2 [d4 g4 b4 g4]*2>")
  .s("triangle").decay(.18).sustain(0).gain(.28)
  .delay(.3).delaytime(.375).delayfeedback(.35).room(.3)

// Kick: a sine with a fast pitch drop
$: note("a1*4").s("sine").penv(36).pattack(0).pdecay(.05)
  .decay(.3).sustain(0).gain(.9)

// Hi-hats and a noise snare on 2 and 4
$: s("white*8").decay(.04).sustain(0).hpf(7000).gain("[.1 .18]*4")
$: s("pink").struct("~ x ~ x").decay(.15).sustain(0).hpf(1200).gain(.2).room(.3)

// Swells where the demo changes scene (bars 0, 2, 5, 8, 11 and 17 of 20)
$: s("white").struct("<x ~ x ~ ~ x ~ ~ x ~ ~ x ~ ~ ~ ~ ~ x ~ ~>")
  .attack(.005).decay(1.2).sustain(0).hpf(3000).lpf(9000).gain(.16).room(.8)
```
