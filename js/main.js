// Boot + fixed-step accumulator (h = 1/480 s regardless of display rate).
(() => {
	const cv = document.getElementById('c');
	Render.setup(cv);
	Game.reset();
	Game.bindInput(cv);
	UI.bind(() => Game.reset());
	// URL parameters configure the boot (?schema=rim6&seats=human,hunter, see
	// js/presets.js); no parameters, and this is exactly the page as shipped.
	UI.applySetup(parseQuery(location.search));
	Help.bind();
	// The board is fitted to its box, so it has to be re-measured on every event that
	// changes that box: window size, the panel's scrollbar, or a mobile URL bar.
	const refit = () => Render.resize();
	window.addEventListener('resize', refit);
	window.addEventListener('orientationchange', refit);
	if (window.ResizeObserver) new window.ResizeObserver(refit).observe(cv.parentElement);
	if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
	document.addEventListener('visibilitychange', () => { last = performance.now(); });
	// Everything the renderer needs about the game, in one object main mutates in
	// place: the draw call itself allocates nothing.
	const view = { w: Game.world, aim: Game.aim, opts: null, pred: Game.pred, roster: Game.roster, turn: 0, resolveT: 0, voteT: 0, state: 'aim' };
	let last = performance.now(), acc = 0, uiAcc = 0;
	function frame(now) {
		requestAnimationFrame(frame);
		let dt = (now - last) / 1000;
		last = now;
		if (dt > 0.25) dt = 0.25; // clamped; backlog beyond the cap is dropped, never one huge step
		if (!Game.paused) {
			Game.tick(dt); // the bots think here, a time-warp search included
			Game.beforeSteps();
			// The board holds still while a bot is looking ahead (js/warp.js): its plan
			// is computed on this exact state, so nothing may move under it. The frame
			// is spent on the search instead of on stepping, and no backlog builds up.
			if (!Game.planning) {
				acc += dt;
				let steps = 0;
				while (acc >= CFG.h && steps < 96) { stepWorld(Game.world, CFG.h); acc -= CFG.h; steps++; }
				if (steps === 96) acc = 0;
				if (steps) Game.afterSteps(steps * CFG.h);
			}
		}
		view.opts = UI.opts(); view.turn = Game.turn; view.resolveT = Game.resolveT; view.voteT = Game.voteT; view.state = Game.state;
		Render.drawWorld(view);
		uiAcc += dt;
		if (uiAcc >= 0.2) { uiAcc = 0; UI.update(Game.world); } // ~5 Hz numeric readouts
	}
	requestAnimationFrame(frame);
})();
