// Autoplay: the Auto ▶ button deals random all-bot games back to back — one shuffle
// of the game settings per game (js/presets.js, the `random` preset) — and plays them
// as fast as the browser gives it time for. The finished board is held for a beat so
// its result card and bot record are readable, then the next game is dealt.
// The speed itself lives in js/main.js: while `on`, a frame spends several slices on
// tick + fixed steps instead of one, and the bot think delay is dropped here — the
// bot's search is the slow part of a game, and watching it is what costs the time.
if (typeof module !== 'undefined') module.exports = { Auto };

const Auto = (() => {
	const HOLD = 0.8; // s a finished board stays up before the next deal
	let on = false, hold = 0, btn = null, think = 0;
	function set(v) {
		if (on === v || !btn) return;
		on = v; hold = 0;
		btn.textContent = on ? '■ Stop' : 'Auto ▶';
		btn.setAttribute('aria-pressed', on ? 'true' : 'false');
		btn.classList.toggle('on', on);
		if (!on) { CFG.botDelay = think; return; }
		think = CFG.botDelay;
		CFG.botDelay = 0; // no cosmetic think time: an armed bot throws at once
		UI.applyPreset('random'); // the shuffle deals a table of bots, so every seat plays itself
	}
	// Once per frame, before the steps: a game over waits out its hold, then the next
	// random game is dealt. A paused board waits too — pause stops the show.
	function frame(dt) {
		if (!on || Game.paused) return;
		if (Game.state !== 'scored') { hold = 0; return; }
		hold += dt;
		if (hold < HOLD) return;
		hold = 0;
		UI.applyPreset('random');
	}
	function bind() {
		btn = document.getElementById('btnAutoPlay');
		btn.addEventListener('click', () => set(!on));
	}
	return { bind, frame, get on() { return on; } };
})();
