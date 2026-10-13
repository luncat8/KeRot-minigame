// Boot + fixed-step accumulator (h = 1/480 s regardless of display rate).
(() => {
	const cv = document.getElementById('c');
	Render.setup(cv);
	Game.reset();
	Game.bindInput(cv);
	UI.bind(() => Game.reset());
	window.addEventListener('resize', () => Render.resize());
	document.addEventListener('visibilitychange', () => { last = performance.now(); });
	let last = performance.now(), acc = 0, uiAcc = 0;
	function frame(now) {
		requestAnimationFrame(frame);
		let dt = (now - last) / 1000;
		last = now;
		if (dt > 0.25) dt = 0.25; // clamped; backlog beyond the cap is dropped, never one huge step
		if (!Game.paused) {
			Game.tick(dt);
			Game.beforeSteps();
			acc += dt;
			let steps = 0;
			while (acc >= CFG.h && steps < 96) { stepWorld(Game.world, CFG.h); acc -= CFG.h; steps++; }
			if (steps === 96) acc = 0;
			if (steps) Game.afterSteps(steps * CFG.h);
		}
		Render.drawWorld(Game.world, Game.aim, UI.opts(), Game.pred);
		uiAcc += dt;
		if (uiAcc >= 0.2) { uiAcc = 0; UI.update(Game.world); } // ~5 Hz numeric readouts
	}
	requestAnimationFrame(frame);
})();
