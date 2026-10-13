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
	// len/anchor* implement precision mode (shift): the speed mapping is rebased every
	// time shift flips, so the stroke never jumps when it is pressed or released.
	const aim = { pending: -1, hasStroke: false, vx: 0, vy: 0, dragging: false, len: 0, anchorLen: 0, anchorSp: CFG.vMin, precise: false };
	const queue = []; // {type:'throw', timeStamp}

	function isBot() { return player !== 'human'; }
	function newPending() {
		pending = spawnPuck(w, CFG.launchX, CFG.launchY);
		aim.pending = pending; aim.hasStroke = false; aim.vx = 0; aim.vy = 0;
		rebase(0, CFG.vMin, false);
		if (isBot()) botPrep();
	}
	function botPrep() {
		const s = chooseStroke(player, w, CFG, pending, pred, rng);
		aim.vx = s.vx; aim.vy = s.vy; aim.hasStroke = true;
		botT = 0; invalidateGhost();
	}
	function reset() {
		resetWorld(w); state = 'aim'; finalScore = null; resolveT = 0; botT = 0;
		rng = makeRng(++seed); // fresh seed per board: bot games differ, competitions stay reproducible
		newPending();
	}
	function rebase(len, sp, precise) { aim.anchorLen = len; aim.anchorSp = sp; aim.precise = precise; }
	function rawSpeed(len) { return clamp(CFG.vMin + len / CFG.dragFull * (CFG.vMax - CFG.vMin), CFG.vMin, CFG.vMax); }
	// Drag 0..dragFull maps onto the stroke speed range CFG.vMin..CFG.vMax; with shift
	// held only a preciseGain share of further drag counts (precision mode).
	function setStroke(dx, dy, precise) {
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) { aim.hasStroke = false; return; }
		if (precise !== aim.precise) rebase(len, aim.hasStroke ? Math.hypot(aim.vx, aim.vy) : rawSpeed(len), precise);
		const slope = (CFG.vMax - CFG.vMin) / CFG.dragFull * (precise ? CFG.preciseGain : 1);
		const sp = clamp(aim.anchorSp + (len - aim.anchorLen) * slope, CFG.vMin, CFG.vMax);
		aim.len = len;
		setAimVel(dx / len * sp, dy / len * sp);
	}
	function setAimVel(vx, vy) {
		aim.vx = vx; aim.vy = vy; aim.hasStroke = true;
		invalidateGhost();
	}
	function invalidateGhost() { ghostDirty = true; predT = 0; } // re-sim on the next tick
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
			rebase(0, CFG.vMin, e.shiftKey); setStroke(p.x - sx, p.y - sy, e.shiftKey);
		});
		canvas.addEventListener('pointermove', e => {
			if (!aim.dragging || state !== 'aim') return;
			const p = Render.toWorld(e.clientX, e.clientY);
			setStroke(p.x - sx, p.y - sy, e.shiftKey);
		});
		canvas.addEventListener('pointerup', () => { aim.dragging = false; });
		window.addEventListener('keydown', e => {
			if (e.code === 'Space') {
				e.preventDefault();
				if (!isBot()) queue.push({ type: 'throw', timeStamp: e.timeStamp });
			}
			else if (e.key === 'Escape') { aim.hasStroke = false; rebase(0, CFG.vMin, false); }
			else if (e.key === 'r' || e.key === 'R') reset();
			else if (state === 'aim' && !isBot() && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(e); }
		});
	}
	function nudge(e) {
		if (!aim.hasStroke) { setStroke(-CFG.dragFull * 0.5, 0, e.shiftKey); rebase(aim.len, Math.hypot(aim.vx, aim.vy), e.shiftKey); }
		let ang = Math.atan2(aim.vy, aim.vx), sp = Math.hypot(aim.vx, aim.vy);
		const da = (e.shiftKey ? 0.2 : 1) * Math.PI / 180; // shift = fine on both axes
		const dk = e.shiftKey ? 1.005 : 1.020, ds = e.shiftKey ? 0.002 : 0.010;
		if (e.key === 'ArrowLeft') ang -= da;
		if (e.key === 'ArrowRight') ang += da;
		if (e.key === 'ArrowUp') sp = Math.min(CFG.vMax, sp * dk + ds);
		if (e.key === 'ArrowDown') sp = Math.max(CFG.vMin, sp / dk - ds);
		rebase(aim.len, sp, e.shiftKey); // arrows and drag share the same anchor
		setAimVel(Math.cos(ang) * sp, Math.sin(ang) * sp);
	}
	function setPlayer(name) {
		player = name;
		if (isBot() && state === 'aim' && pending >= 0) botPrep();
	}
	return {
		world: w, aim, pred, reset, bindInput, beforeSteps, afterSteps, tick,
		setStroke, setAimVel, commitThrow, setPlayer, invalidateGhost,
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
