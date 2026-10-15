// Background music for the demo: off until the visitor turns it on, stores nothing.
// Starting it restarts the GIF so each scene begins on a bar; each time the loop
// wraps around, the GIF is restarted again so the two stay in step.
(() => {
	const box = document.getElementById('music');
	const button = document.getElementById('music-toggle');
	const audio = document.getElementById('theme');
	const demo = document.getElementById('demo');
	if (!box || !button || !audio || !demo) return;
	box.hidden = false;

	const gifUrl = demo.getAttribute('src');
	let gifBlob = null;
	let blobUrl = null;
	let last = 0;
	let raf = 0;

	// A fresh object URL for the same bytes makes the browser start the animation from its first frame,
	// without downloading the GIF again.
	async function restartGif() {
		try {
			if (!gifBlob) gifBlob = await (await fetch(gifUrl)).blob();
			const url = URL.createObjectURL(gifBlob);
			demo.src = url;
			if (blobUrl) URL.revokeObjectURL(blobUrl);
			blobUrl = url;
			await demo.decode();
		} catch {
			// The demo keeps playing on its own.
		}
	}

	function watchLoop() {
		if (audio.currentTime + 0.5 < last) void restartGif();
		last = audio.currentTime;
		raf = requestAnimationFrame(watchLoop);
	}

	function setPlaying(playing) {
		button.setAttribute('aria-pressed', String(playing));
		button.textContent = playing ? 'Pause music' : 'Play music';
	}

	button.addEventListener('click', async () => {
		if (!audio.paused) {
			audio.pause();
			return;
		}
		await restartGif();
		audio.currentTime = 0;
		last = 0;
		try {
			await audio.play();
		} catch {
			setPlaying(false);
		}
	});

	audio.addEventListener('play', () => {
		setPlaying(true);
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(watchLoop);
	});
	audio.addEventListener('pause', () => {
		setPlaying(false);
		cancelAnimationFrame(raf);
	});
})();
