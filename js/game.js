// Game flow: AIM -> RESOLVE -> (next puck | SETTLE -> SCORED).
// Input events are queued with their timestamp; throws are applied between
// fixed steps, never inside one, so frame cadence cannot shift a throw.
const Game = (() => {
	const w = createWorld(CFG);
	let state = 'aim', pending = -1, resolveT = 0, paused = false, finalScore = null;
	const aim = { pending: -1, hasStroke: false, vx: 0, vy: 0, dragging: false };
	const queue = []; // {type:'throw', timeStamp}
	function newPending() {
		pending = spawnPuck(w, CFG.launchX, CFG.launchY);
		aim.pending = pending; aim.hasStroke = false; aim.vx = 0; aim.vy = 0;
	}
	function reset() {
		resetWorld(w); state = 'aim'; finalScore = null; resolveT = 0;
		newPending();
	}
	function setStroke(dx, dy) {
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) { aim.hasStroke = false; return; }
		const sp = Math.min(1, len / CFG.dragFull) * CFG.vMax;
		aim.vx = dx / len * sp; aim.vy = dy / len * sp; aim.hasStroke = true;
	}
	function commitThrow() {
		if (state !== 'aim' || pending < 0 || !aim.hasStroke) return;
		throwPuck(w, pending, aim.vx, aim.vy);
		aim.hasStroke = false; state = 'resolve'; resolveT = 0;
	}
	// Called by main once per frame before stepping.
	function beforeSteps() {
		while (queue.length) { const ev = queue.shift(); if (ev.type === 'throw') commitThrow(); }
	}
	// Called by main after each batch of fixed steps (dtSim simulated seconds).
	function afterSteps(dtSim) {
		if (state === 'resolve') {
			resolveT += dtSim;
			if (isSettled(w) || resolveT >= CFG.maxResolve) {
				if (w.thrown >= CFG.pucksPerGame) { state = 'settle'; beginSettle(w); }
				else { state = 'aim'; newPending(); }
			}
		} else if (state === 'settle' && w.settled) {
			state = 'scored'; finalScore = totalScore(w);
		}
	}
	function bindInput(canvas) {
		canvas.style.touchAction = 'none';
		let sx = 0, sy = 0;
		canvas.addEventListener('pointerdown', e => {
			if (state !== 'aim') return;
			canvas.setPointerCapture(e.pointerId);
			const p = Render.toWorld(e.clientX, e.clientY);
			sx = w.x[pending]; sy = w.y[pending]; aim.dragging = true;
			setStroke(p.x - sx, p.y - sy);
		});
		canvas.addEventListener('pointermove', e => {
			if (!aim.dragging || state !== 'aim') return;
			const p = Render.toWorld(e.clientX, e.clientY);
			setStroke(p.x - sx, p.y - sy);
		});
		canvas.addEventListener('pointerup', () => { aim.dragging = false; });
		window.addEventListener('keydown', e => {
			if (e.code === 'Space') { e.preventDefault(); queue.push({ type: 'throw', timeStamp: e.timeStamp }); }
			else if (e.key === 'Escape') aim.hasStroke = false;
			else if (e.key === 'r' || e.key === 'R') reset();
			else if (state === 'aim' && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(e); }
		});
	}
	function nudge(e) {
		if (!aim.hasStroke) setStroke(-CFG.dragFull * 0.5, 0);
		let ang = Math.atan2(aim.vy, aim.vx), sp = Math.hypot(aim.vx, aim.vy);
		const da = (e.shiftKey ? 0.2 : 1) * Math.PI / 180;
		if (e.key === 'ArrowLeft') ang -= da;
		if (e.key === 'ArrowRight') ang += da;
		if (e.key === 'ArrowUp') sp = Math.min(CFG.vMax, sp * 1.02 + 0.005);
		if (e.key === 'ArrowDown') sp = Math.max(0, sp * 0.98 - 0.005);
		aim.vx = Math.cos(ang) * sp; aim.vy = Math.sin(ang) * sp; aim.hasStroke = sp > 0;
	}
	return {
		world: w, aim, reset, bindInput, beforeSteps, afterSteps, setStroke, commitThrow,
		queueThrow: ts => queue.push({ type: 'throw', timeStamp: ts }),
		get state() { return state; },
		get pending() { return pending; },
		get finalScore() { return finalScore; },
		get paused() { return paused; },
		togglePause: () => { paused = !paused; return paused; },
	};
})();
