// The board is simulated continuously — nothing stops the physics on contact or at a
// turn boundary — and a settings change always gets the disk moving again. Gated here:
//
//  1. A puck that settled against the turned-off disk while it spun must be caught up
//     by the disk's spin-down arm (it is riding, not asleep).
//  2. Contacts never gate stepping: the world advances in every turn state, and a puck
//     still moving at the handoff keeps being simulated until it settles.
//  3. "Change settings, can't move the disk again": the round ends by spinning the disk
//     down (SETTLE -> SCORED); from there only a reset brought it back, so a ω slider
//     move changed the readout and nothing else. A spent board must restart.
Object.assign(globalThis, require('../js/physics.js'), require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'));
// game.js is a browser IIFE whose top-level const is module-local under node: load it
// the way the page does, so Game lands on globalThis (same trick as client-smoke).
const fs = require('fs');
eval(fs.readFileSync(require('path').join(__dirname, '../js/game.js'), 'utf8')
	.replace(/^if \(typeof module !== 'undefined'\).*$/m, '')
	.replace(/\bconst (Render|Game) =/, 'globalThis.$1 ='));
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }
const ov = { a: 0, cx: 0, cy: 0, d: 0, qd: 0, qf: 0, px: 0, py: 0 };

// 1. A jammed straddler is held by the floor, not by the disk: speeding the disk up
//    changes the slip direction under it, not the force the floor has to hold.
{
	const c = Object.assign({}, CFG, { omega: 0.10 });
	const w = createWorld(c);
	const i = spawnPuck(w, c.diskX + c.diskR + 0.09, c.diskY); // sliver of overlap
	throwPuck(w, i, 0, 0);
	let t = 0;
	while (w.st[i] !== ST_SLEEP && t < 2) { stepWorld(w, c.h); t += c.h; }
	const a = diskOverlap(w, i, ov);
	const x0 = w.x[i], y0 = w.y[i];
	w.cfg.omega = 3; // the slider path: cfg is read every step, the world is not rebuilt
	for (let s = 0; s < 480 * 3; s++) stepWorld(w, c.h);
	const drift = Math.hypot(w.x[i] - x0, w.y[i] - y0);
	console.log('held straddler (a=' + a.toFixed(4) + '): slept at ' + t.toFixed(2) + 's, drift after omega 0.10 -> 3.0 is ' +
		drift.toExponential(1) + ' m');
	check(w.st[i] === ST_SLEEP, 'a sliver the floor can hold stays asleep');
	check(drift < 1e-9, 'the disk spinning up does not move a puck the floor holds');
	// ...and the moment the floor cannot hold it (deeper overlap), it is never asleep.
	const w2 = createWorld(Object.assign({}, CFG));
	const j = spawnPuck(w2, CFG.diskX + CFG.diskR - 0.05, CFG.diskY); // a ≈ 0.8
	throwPuck(w2, j, 0, 0);
	let sleptDeep = false, t2 = 0;
	while (t2 < 12 && w2.st[j] !== ST_SLEEP) { stepWorld(w2, CFG.h); t2 += CFG.h; sleptDeep = true; }
	const a2 = diskOverlap(w2, j, ov);
	console.log('deep straddler (a0=0.8): ' + (sleptDeep ? 'settled' : 'never settled') + ' at t=' + t2.toFixed(2) +
		's, end a=' + a2.toFixed(3) + ', holdable=' + holdable(CFG, a2, ov));
	check(w2.st[j] === ST_SLEEP && !holdable(CFG, a2, ov) === false, 'the deep straddler settles where the floor can finally hold it');
}

// 2. Continuous simulation: contact and the turn boundary never stop the world.
{
	const g = Game;
	g.reset();
	const w = g.world;
	// Park a straddler on the rim first: it rolls for ~6 s, so at least one turn has to
	// hand over while the board is still moving (the case the timer exists for).
	const i0 = spawnPuck(w, CFG.diskX + CFG.diskR, CFG.diskY);
	throwPuck(w, i0, 0, 0);
	let frames = 0, movedAfterHandoff = 0, handoffSeen = 0, stillMovingAtScored = 0;
	let guard = 0;
	while (g.state !== 'scored' && guard++ < 6000) {
		if (g.state === 'aim' && g.pending >= 0) { g.setAimVel(-1.6, 0.1); g.commitThrow(); }
		g.beforeSteps();
		const prev = g.state, wasSettled = isSettled(w), t0 = w.t;
		for (let s = 0; s < 8; s++) stepWorld(w, CFG.h);
		g.afterSteps(8 * CFG.h);
		frames++;
		if (w.t <= t0) { console.log('FAIL w.t did not advance in state ' + g.state); fail = 1; break; }
		// The turn must hand over at handoffT even with something still sliding.
		if (prev === 'resolve' && g.state !== 'resolve' && !wasSettled) handoffSeen++;
		if (g.state === 'aim') { // a live board: is anything still moving?
			for (let i = 0; i < w.n; i++) if (w.st[i] === ST_SLIDE && Math.hypot(w.vx[i], w.vy[i]) > 0.01) movedAfterHandoff++;
		}
	}
	console.log('round: ' + w.thrown + ' throws, ' + frames + ' frames, ' + w.t.toFixed(1) + 's sim; ' +
		'post-handoff moving-puck frames = ' + movedAfterHandoff + ', over-timer handoffs = ' + handoffSeen);
	check(g.state === 'scored', 'the round plays out');
	check(handoffSeen > 0, 'the turn hands over while a puck is still moving');
	check(movedAfterHandoff > 0, 'pucks still moving after the handoff keep being simulated in the next turn');
	for (let i = 0; i < w.n; i++) stillMovingAtScored += w.st[i] === ST_SLIDE ? 1 : 0;
	const tBefore = w.t;
	for (let s = 0; s < 480 * 6; s++) stepWorld(w, CFG.h);
	let moving = 0;
	for (let i = 0; i < w.n; i++) moving += w.st[i] === ST_SLIDE ? 1 : 0;
	console.log('at scored: ' + stillMovingAtScored + ' still sliding; 6 s later ' + moving +
		' sliding (the disk is dead, they are coasting to rest)');
	check(w.t > tBefore + 5.9, 'the world is still stepped after the round is scored');
	check(moving === 0, 'anything still moving when the round ends simply coasts to rest');
}

// 3. Spent board: the disk is dead, and a physics input restarts the board.
{
	const g = Game;
	g.reset();
	const w = g.world;
	let guard = 0;
	while (g.state !== 'scored' && guard++ < 6000) {
		if (g.state === 'aim' && g.pending >= 0) { g.setAimVel(-1.6, 0.1); g.commitThrow(); }
		g.beforeSteps();
		for (let s = 0; s < 8; s++) stepWorld(w, CFG.h);
		g.afterSteps(8 * CFG.h);
	}
	for (let k = 0; k < 480 * 4; k++) stepWorld(w, CFG.h); // let the spin-down finish
	const th0 = w.theta;
	for (let s = 0; s < 480; s++) stepWorld(w, CFG.h);
	const spentTheta = w.theta - th0;
	console.log('spent board: settled=' + w.settled + ', omegaCur=' + w.omegaCur.toFixed(4) +
		', theta drift over 1 s = ' + spentTheta.toExponential(1) + ', roundEnded=' + g.roundEnded);
	check(g.roundEnded, 'the game reports the round as over');
	check(w.settled && w.omegaCur === 0 && spentTheta === 0, 'the disk is stopped while the board is spent');
	// What js/ui.js does on any physics input:
	CFG.omega = 2.0;
	if (g.roundEnded) g.reset();
	const th1 = w.theta;
	for (let s = 0; s < 480; s++) stepWorld(w, CFG.h);
	const turned = w.theta - th1;
	console.log('after the restart: state=' + g.state + ', omegaCur=' + w.omegaCur.toFixed(4) +
		', theta over 1 s = ' + turned.toFixed(9) + ' (expect 2.0)');
	check(g.state === 'aim' && !g.roundEnded, 'the board is live again');
	check(Math.abs(turned - 2.0) < 1e-9, 'the disk turns at the new rate');
	// And the slider is still honoured mid-round, with no reset involved.
	CFG.omega = 0.5;
	const th2 = w.theta;
	for (let s = 0; s < 480; s++) stepWorld(w, CFG.h);
	check(Math.abs((w.theta - th2) - 0.5) < 1e-9, 'a mid-round omega change is honoured immediately');
	console.log(fail ? 'FAIL' : 'OK (continuous simulation, spent board restarts on a settings change)');
	process.exit(fail);
}
