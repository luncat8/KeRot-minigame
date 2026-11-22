// Boot + fixed-step accumulator (h = 1/480 s regardless of display rate).
(() => {
	const app = document.getElementById('app');
	const cv = document.getElementById('c');
	// Mobile browsers often report 100vh/100dvh taller than the visible area below the
	// URL bar (or lag a frame on rotation), clipping the bottom of the board under
	// overflow:hidden. Pin #app to the live visible viewport before measuring #boardWrap.
	function syncAppBox() {
		let h = window.innerHeight || 0, top = 0;
		const vv = window.visualViewport;
		if (vv && vv.height > 0 && Math.abs((vv.scale || 1) - 1) < 0.02) {
			h = h > 0 ? Math.min(h, vv.height) : vv.height;
			top = Math.max(0, Math.round(vv.offsetTop || 0));
		}
		if (!app || !(h > 0)) return;
		const topCss = top + 'px', hCss = Math.floor(h) + 'px';
		if (app.style.top !== topCss) app.style.top = topCss;
		if (app.style.height !== hCss) app.style.height = hCss;
	}
	const refit = () => {
		syncAppBox();
		const box = cv.parentElement;
		box.dataset.fit = document.body.dataset.fit;
		const aspect = box.dataset.fit === '1' && box.clientHeight && box.clientWidth ? box.clientWidth / box.clientHeight : undefined;
		Render.resize(Game.fitBoard(aspect));
	};
	syncAppBox();
	Render.setup(cv);
	Game.reset();
	Game.bindInput(cv);
	UI.bind(() => Game.reset());
	Auto.bind(); // the autoplay button of js/auto.js: random all-bot games, back to back
	// The fit drawer's switch and open/close, and the board refit a layout change needs.
	View.bind(refit);
	// URL parameters configure the boot (?schema=rim6&seats=human,hunter, see
	// js/presets.js); no parameters, and this is exactly the page as shipped.
	UI.applySetup(parseQuery(location.search));
	Help.bind();
	refit();
	window.addEventListener('resize', refit);
	window.addEventListener('orientationchange', () => {
		refit();
		requestAnimationFrame(refit);
		setTimeout(refit, 120);
	});
	if (window.ResizeObserver) new window.ResizeObserver(refit).observe(cv.parentElement);
	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', refit);
		window.visualViewport.addEventListener('scroll', refit);
	}
	const editButton = document.getElementById('btnEdit');
	let editorLoad = null;
	function loadEditor() {
		if (typeof ZoneEditor !== 'undefined') return Promise.resolve();
		if (editorLoad) return editorLoad;
		editorLoad = new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = 'js/zone-editor.js';
			script.onload = resolve;
			script.onerror = () => { script.remove(); editorLoad = null; reject(new Error('Editor could not load')); };
			document.head.appendChild(script);
		});
		return editorLoad;
	}
	editButton.addEventListener('click', async () => {
		if (typeof ZoneEditor !== 'undefined' && ZoneEditor.active) { ZoneEditor.close(); return; }
		editButton.disabled = true;
		editButton.textContent = 'Loading…';
		try {
			await loadEditor();
			ZoneEditor.open({ canvas: cv, game: Game, render: Render, ui: UI, refit, button: editButton });
		} catch (e) {
			editButton.textContent = 'Retry editor';
			editButton.title = 'Could not load editor. Click to retry.';
		} finally { editButton.disabled = false; }
	});

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
		Auto.frame(dt); // a finished board holds, then the next random game is dealt
		if (!Game.paused) {
			// Autoplay buys extra slices of the frame for the game: each slice is one
			// tick plus one batch of fixed steps, so a page that only watches plays
			// several turns per frame and the board runs well past realtime. The budget
			// is wall time — a bot search inside a slice spends it and ends the loop.
			const cap = Auto.on ? 480 : 96;
			let slices = Auto.on ? 8 : 1;
			const stop = Auto.on ? performance.now() + 20 : 0;
			do {
				Game.tick(dt); // the bots think here, a time-warp search included
				Game.beforeSteps();
				// The board holds still while a bot is looking ahead (js/warp.js): its plan
				// is computed on this exact state, so nothing may move under it. The frame
				// is spent on the search instead of on stepping, and no backlog builds up.
				if (!Game.planning) {
					acc += dt;
					let steps = 0;
					while (acc >= CFG.h && steps < cap) { stepWorld(Game.world, CFG.h); acc -= CFG.h; steps++; }
					if (steps === cap) acc = 0;
					if (steps) Game.afterSteps(steps * CFG.h);
				}
				slices--;
			} while (slices && performance.now() < stop && Game.state !== 'scored');
		}
		// The optional sound layer reads the world after the frame's steps. With the
		// add-on absent this is one guarded call and the shipped loop is unchanged.
		if (typeof FX !== 'undefined') FX.frame(dt, Game.world, Game.state, Game.paused || Game.planning);
		view.opts = UI.opts(); view.turn = Game.turn; view.resolveT = Game.resolveT; view.voteT = Game.voteT; view.state = Game.state;
		Render.drawWorld(view);
		uiAcc += dt;
		if (uiAcc >= 0.2) { uiAcc = 0; UI.update(Game.world); } // ~5 Hz numeric readouts
	}
	requestAnimationFrame(frame);
})();
