// Game flow: AIM -> RESOLVE -> (recycle -> next puck | SETTLE -> recycle -> SCORED).
// Input events are queued with their timestamp; throws are applied between
// fixed steps, never inside one, so frame cadence cannot shift a throw.
// The player is either a human (pointer/keyboard) or a bot (js/bots.js) that
// aims on its own; tick() drives bot throws and the ghost-trajectory preview.
const Game = (() => {
	const PRED_COOLDOWN = 0.08; // s between ghost re-sims during a drag
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	let state = 'aim', pending = -1, resolveT = 0, paused = false, finalScore = null;
	let player = 'human'; // 'human' | 'random' | 'keeper' | 'hunter'
	let botT = 0, predT = 0, ghostDirty = false, seed = 1, rng = makeRng(seed);
	const aim = { pending: -1, hasStroke: false, vx: 0, vy: 0, dragging: false };
	const queue = []; // {type:'throw', timeStamp}

	function isBot() { return player !== 'human'; }
	function newPending() {
		pending = spawnPuck(w, CFG.launchX, CFG.launchY);
		aim.pending = pending; aim.hasStroke = false; aim.vx = 0; aim.vy = 0;
		if (isBot()) botPrep();
	}
	function botPrep() {
		const s = chooseStroke(player, w, CFG, pending, pred, rng);
		aim.vx = s.vx; aim.vy = s.vy; aim.hasStroke = true;
		botT = 0; ghostDirty = true; predT = 0; // predict at once
	}
	function reset() {
		resetWorld(w); state = 'aim'; finalScore = null; resolveT = 0; botT = 0;
		rng = makeRng(++seed); // fresh seed per board: bot games differ, competitions stay reproducible
		newPending();
	}
	// Drag 0..dragFull maps onto the stroke speed range CFG.vMin..CFG.vMax.
	function setStroke(dx, dy) {
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) { aim.hasStroke = false; return; }
		const sp = CFG.vMin + Math.min(1, len / CFG.dragFull) * (CFG.vMax - CFG.vMin);
		setAimVel(dx / len * sp, dy / len * sp);
	}
	function setAimVel(vx, vy) {
		aim.vx = vx; aim.vy = vy; aim.hasStroke = true;
		ghostDirty = true;
	}
	function commitThrow() {
		if (state !== 'aim' || pending < 0 || !aim.hasStroke) return;
		throwPuck(w, pending, aim.vx, aim.vy);
		aim.hasStroke = false; aim.pending = -1;
		state = 'resolve'; resolveT = 0;
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
				recyclePucks(w, CFG.recycleMode);
				if (roundOver(w, CFG)) { state = 'settle'; beginSettle(w); }
				else { state = 'aim'; newPending(); }
			}
		} else if (state === 'settle' && w.settled) {
			recyclePucks(w, CFG.recycleMode);
			state = 'scored'; finalScore = totalScore(w);
		}
	}
	// Per-frame housekeeping: ghost re-sim (throttled) and bot throws.
	function tick(dt) {
		if (ghostDirty && predT <= 0 && state === 'aim' && aim.hasStroke && pending >= 0) {
			predictStroke(pred, w, pending, aim.vx, aim.vy, CFG.maxResolve);
			ghostDirty = false; predT = PRED_COOLDOWN;
		}
		predT -= dt;
		if (paused || state !== 'aim' || !isBot() || !aim.hasStroke) return;
		botT += dt;
		if (botT >= CFG.botDelay) { botT = 0; commitThrow(); }
	}
	function bindInput(canvas) {
		canvas.style.touchAction = 'none';
		let sx = 0, sy = 0;
		canvas.addEventListener('pointerdown', e => {
			if (state !== 'aim' || isBot()) return;
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
			if (e.code === 'Space') {
				e.preventDefault();
				if (!isBot()) queue.push({ type: 'throw', timeStamp: e.timeStamp });
			}
			else if (e.key === 'Escape') aim.hasStroke = false;
			else if (e.key === 'r' || e.key === 'R') reset();
			else if (state === 'aim' && !isBot() && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(e); }
		});
	}
	function nudge(e) {
		if (!aim.hasStroke) setStroke(-CFG.dragFull * 0.5, 0);
		let ang = Math.atan2(aim.vy, aim.vx), sp = Math.hypot(aim.vx, aim.vy);
		const da = (e.shiftKey ? 0.2 : 1) * Math.PI / 180;
		if (e.key === 'ArrowLeft') ang -= da;
		if (e.key === 'ArrowRight') ang += da;
		if (e.key === 'ArrowUp') sp = Math.min(CFG.vMax, sp * 1.02 + 0.005);
		if (e.key === 'ArrowDown') sp = Math.max(CFG.vMin, sp * 0.98 - 0.005);
		setAimVel(Math.cos(ang) * sp, Math.sin(ang) * sp);
	}
	function setPlayer(name) {
		player = name;
		if (isBot() && state === 'aim' && pending >= 0) botPrep();
	}
	return {
		world: w, aim, pred, reset, bindInput, beforeSteps, afterSteps, tick,
		setStroke, setAimVel, commitThrow, setPlayer,
		queueThrow: ts => queue.push({ type: 'throw', timeStamp: ts }),
		get state() { return state; },
		get pending() { return pending; },
		get player() { return player; },
		get pool() { return poolOf(w, CFG); },
		get finalScore() { return finalScore; },
		get paused() { return paused; },
		togglePause: () => { paused = !paused; return paused; },
	};
})();
