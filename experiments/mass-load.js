// The mass slider (CFG.puckM) and the load law it acts through (loadFactor, js/cfg.js).
// Under load-independent Coulomb friction a lone puck's mass cancels — so a mass slider
// alone would move nothing. Ice grips a heavier puck less (μ ∝ m^(−1/3)), and that is
// the only door mass has, which is what this checks:
//   1. a puck of mass m on μ is the same puck as a massRef puck on μ·loadFactor(m);
//   2. its stopping distance on bare ice grows as m^(1/3), as stopDistance() says;
//   3. its hold radius shrinks as m^(−1/3): a co-rotating puck that rides at the
//      reference mass is flung when heavy — also when the mass changes mid-ride;
//   4. autoOmega() puts the hold radius back on 0.9 R for any mass;
//   5. at the reference mass the factor is exactly 1: the default physics is unchanged;
//   6. unequal masses still conserve momentum in a collision.
const cfgm = require('../js/cfg.js');
const { createWorld, spawnPuck, throwPuck, stepWorld } = require('../js/physics.js');
const { loadFactor, holdRadius, autoOmega, stopDistance, ST_LOCKED, ST_SLEEP } = cfgm;
const base = Object.assign({}, cfgm.CFG);
const MASSES = [base.massMin, 1, base.massRef, 8, base.massMax];
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

// 1. The stroke crosses the spinning disk, so the floor, the disk and the lock test
// are all in the comparison.
{
	function stroke(cfg, m) {
		const w = createWorld(cfg);
		const i = spawnPuck(w, cfg.launchX, cfg.launchY);
		w.m[i] = m;
		throwPuck(w, i, -1.2, 0.3);
		for (let s = 0; s < 480 * 6; s++) stepWorld(w, cfg.h);
		return w;
	}
	let worst = 0, spread = 0;
	const ends = [];
	for (const m of MASSES) {
		const lf = loadFactor(base, m), a = stroke(base, m);
		const b = stroke(Object.assign({}, base, { muK: base.muK * lf, muS: base.muS * lf }), base.massRef);
		worst = Math.max(worst, Math.hypot(a.x[0] - b.x[0], a.y[0] - b.y[0]));
		ends.push([a.x[0], a.y[0]]);
		console.log('m = ' + m.toFixed(1).padStart(4) + ' kg  μ ×' + lf.toFixed(3) + '  ends (' + a.x[0].toFixed(4) + ', ' + a.y[0].toFixed(4) + ')');
	}
	for (const e of ends) spread = Math.max(spread, Math.hypot(e[0] - ends[0][0], e[1] - ends[0][1]));
	console.log('mass m on μ vs a ' + base.massRef + ' kg puck on μ·loadFactor(m): worst Δ ' + worst.toExponential(1) + ' m; the ends spread over ' + spread.toFixed(3) + ' m');
	check(worst < 1e-9, 'mass enters only through the load factor', worst.toExponential(1) + ' m');
	check(spread > 0.1, 'and through it the mass is felt', spread.toFixed(3) + ' m');
}
// 2. Bare ice, no spin: away from the disk, the zones and the walls.
{
	const v = 0.6, line = [];
	let worst = 0;
	for (const m of MASSES) {
		const cfg = Object.assign({}, base, { puckM: m });
		const w = createWorld(cfg);
		const i = spawnPuck(w, 2.8, 0.15);
		throwPuck(w, i, 0, v);
		for (let s = 0; s < 480 * 12 && w.st[i] !== ST_SLEEP; s++) stepWorld(w, cfg.h);
		const got = w.y[i] - 0.15, want = stopDistance(cfg, v);
		worst = Math.max(worst, Math.abs(got / want - 1));
		line.push(m + ' kg ' + got.toFixed(3) + ' m');
	}
	console.log('stop from ' + v + ' m/s: ' + line.join(' · ') + ' (worst vs stopDistance ' + (100 * worst).toFixed(2) + ' %)');
	check(worst < 0.01, 'the stopping distance grows as m^(1/3), as stopDistance() predicts', (100 * worst).toFixed(2) + ' %');
}
// 3. The 90 % rule at the reference mass puts d_hold at 0.9 R; 20 kg pulls it in to 0.53 R.
{
	function ride(m, f, swapTo) {
		const cfg = Object.assign({}, base, { puckM: m });
		const w = createWorld(cfg);
		const i = spawnPuck(w, cfg.diskX + f * cfg.diskR, cfg.diskY);
		w.m[i] = m; w.st[i] = cfgm.ST_SLIDE;
		w.vy[i] = cfg.omega * f * cfg.diskR; // co-rotating: v_surf at (d, 0) is (0, ω·d)
		for (let s = 0; s < 480 * 4; s++) stepWorld(w, cfg.h);
		const lockedFirst = w.st[i] === ST_LOCKED;
		if (swapTo) { cfg.puckM = swapTo; w.m[i] = swapTo; } // what Game.setPuckMass does
		for (let s = 0; s < 480 * 16; s++) stepWorld(w, cfg.h);
		const d = Math.hypot(w.x[i] - cfg.diskX, w.y[i] - cfg.diskY);
		return { lockedFirst, locked: w.st[i] === ST_LOCKED, d };
	}
	const f = 0.7, heavy = Object.assign({}, base, { puckM: base.massMax });
	const ref = ride(base.massRef, f), hv = ride(base.massMax, f), swap = ride(base.massRef, f, base.massMax);
	console.log('co-rotating at ' + f + ' R: d_hold/R ' + (holdRadius(base) / base.diskR).toFixed(3) + ' at ' + base.massRef + ' kg -> ' +
		(ref.locked ? 'rides' : 'flung') + '; ' + (holdRadius(heavy) / base.diskR).toFixed(3) + ' at ' + base.massMax + ' kg -> ' +
		(hv.locked ? 'rides' : 'flung, ends ' + hv.d.toFixed(2) + ' m out') + '; mass raised mid-ride -> ' + (swap.locked ? 'rides' : 'flung, ends ' + swap.d.toFixed(2) + ' m out'));
	check(ref.locked, 'a co-rotating puck inside the reference hold radius rides');
	check(!hv.locked && hv.d > base.diskR, 'the same puck at 20 kg is flung off the disk', hv.d.toFixed(3) + ' m');
	check(swap.lockedFirst && !swap.locked && swap.d > base.diskR, 'raising the mass mid-ride frees and flings a riding puck');
	check(holdRadius(Object.assign({}, base, { puckM: base.massMin })) > base.diskR, 'a 0.5 kg puck is never flung at the default ω');
}
// 4 + 5.
{
	let worst = 0;
	for (const m of MASSES) {
		const cfg = Object.assign({}, base, { puckM: m });
		cfg.omega = autoOmega(cfg);
		worst = Math.max(worst, Math.abs(holdRadius(cfg) / (0.9 * cfg.diskR) - 1));
	}
	check(worst < 1e-12, 'autoOmega re-solves the 90 % rule for any mass', worst.toExponential(1));
	check(loadFactor(base, base.massRef) === 1, 'the reference mass is exactly unscaled (default physics bit-identical)');
}
// 6. Unequal-mass head-on collision conserves momentum.
{
	const w = createWorld(Object.assign({}, base, { omega: 0, muK: 0 }));
	const i = spawnPuck(w, 1.4, 2.0), j = spawnPuck(w, 1.8, 2.0);
	w.m[i] = 1; w.m[j] = 4;
	throwPuck(w, i, 1, 0); w.st[j] = ST_SLEEP;
	const p0 = 1 * 1;
	for (let s = 0; s < 144; s++) stepWorld(w, base.h); // 0.3 s: collision at ~0.2 s, no wall reached
	const p1 = w.m[i] * w.vx[i] + w.m[j] * w.vx[j];
	console.log('unequal-mass collision: momentum before/after = ' + p0 + ' / ' + p1.toFixed(6));
	check(Math.abs(p1 - p0) < 1e-6, 'momentum is conserved across unequal masses');
}
console.log(fail ? 'FAIL' : 'OK (mass acts only through the load law, and does)');
process.exit(fail);
