// Puck material rotation: the spinning-friction rates, the lock snap, the angular
// impulses at walls and between pucks, and the invariants they must not break.
Object.assign(globalThis, require('../js/cfg.js'), require('../js/physics.js'));
const cfg = Object.assign({}, CFG);
const I = 0.5 * cfg.puckM * cfg.puckR * cfg.puckR;
const rate = cfg.spinDrag * cfg.muK * cfg.g / cfg.puckR; // |ω̇| for a fully covered patch
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }
function ke(w) {
	let e = 0;
	for (let i = 0; i < w.n; i++) e += 0.5 * w.m[i] * (w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i]) + 0.5 * I * w.om[i] * w.om[i];
	return e;
}
// 1. Spin decay on bare ice, at the closed-form rate, landing exactly on 0.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, 2.5, 1.1); // far off the disk: floor patch = whole puck
	w.st[i] = ST_SLIDE; w.om[i] = 4;
	const t0 = 4 / rate, expect = 4 / rate;
	let steps = 0, prev = w.om[i], mono = true, snapped = false;
	while (steps < 480 * 4 && w.st[i] !== ST_SLEEP) {
		stepWorld(w, cfg.h); steps++;
		mono = mono && w.om[i] <= prev + 1e-12 && w.om[i] >= 0; prev = w.om[i];
		if (!snapped && w.om[i] === 0) snapped = true;
	}
	const t = steps * cfg.h;
	console.log('spin decay: stopped at t = ' + t.toFixed(4) + ' s (expect ' + expect.toFixed(4) + '), om = ' + w.om[i] +
		', state = ' + (w.st[i] === ST_SLEEP ? 'SLEEP' : 'still moving'));
	check(Math.abs(t - t0) < cfg.epsSpin / rate + 3 * cfg.h, 'spin decay time'); // eps-snap may fire early
	check(w.om[i] === 0 && w.st[i] === ST_SLEEP, 'spin snaps to 0 and sleeps');
	check(mono, 'spin decays monotonically, never negative');
}
// 2a. Fully covered and co-rotating but past the hold radius: no lock can fire, so
//     the spin ramp is observable in isolation and must match rate·a.
{
	const c = Object.assign({}, cfg, { omega: 1.5, muS: 0.01 }); // d_hold = 0.044 m < 0.5 m
	const w = createWorld(c);
	const i = spawnPuck(w, cfg.diskX + 0.5, cfg.diskY);
	w.st[i] = ST_SLIDE; w.vy[i] = c.omega * 0.5;
	const steps = 40;
	for (let s = 0; s < steps; s++) stepWorld(w, cfg.h);
	const expect = rate * steps * cfg.h;
	console.log('spin ramp on the disk: Δom = ' + w.om[i].toFixed(6) + ' (expect ' + expect.toFixed(6) + '), state = ' + w.st[i]);
	check(w.st[i] === ST_SLIDE, 'low muS keeps it sliding (no lock)');
	check(Math.abs(w.om[i] - expect) < 0.01 * expect, 'spin-up rate = spinDrag·μk·g/r');
}
// 2b. Captured puck: locks and spins exactly with the disk, riding without drift.
{
	const w = createWorld(Object.assign({}, cfg, { omega: 1.5 }));
	const i = spawnPuck(w, cfg.diskX, cfg.diskY);
	w.st[i] = ST_SLIDE;
	let t = 0;
	while (w.st[i] !== ST_LOCKED && t < 4) { stepWorld(w, cfg.h); t += cfg.h; }
	const d = Math.hypot(w.x[i] - cfg.diskX, w.y[i] - cfg.diskY);
	console.log('centre puck: locked after ' + t.toFixed(4) + ' s, om = ' + w.om[i] + ' (ω = ' + w.omegaCur + '), drift = ' + d.toExponential(2) + ' m');
	check(w.st[i] === ST_LOCKED, 'centre puck locks');
	check(w.om[i] === w.omegaCur, 'locked puck spins exactly with the disk (lock snaps the spin)');
	check(d < 1e-9, 'no drift while captured');
}
// 3. A riding puck turns at ω_disk (θ integrates at the disk rate).
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, cfg.diskX + 0.5, cfg.diskY);
	w.vy[i] = cfg.omega * 0.5;
	w.st[i] = ST_SLIDE;
	while (w.st[i] !== ST_LOCKED) stepWorld(w, cfg.h);
	const th0 = w.th[i], t0 = w.t;
	for (let s = 0; s < 480; s++) stepWorld(w, cfg.h);
	const w1 = (w.th[i] - th0) / (w.t - t0);
	console.log('riding puck dθ/dt = ' + w1.toFixed(6) + ' (ω_disk = ' + cfg.omega.toFixed(6) + ')');
	check(Math.abs(w1 - cfg.omega) < 1e-9, 'riding puck turns with the disk');
}
// 4. Wall rub: predicted angular impulse for an oblique hit, none head-on.
{
	const w = createWorld(Object.assign({}, cfg, { muK: 0, omega: 0 }));
	const i = spawnPuck(w, 1.8, 0.3);
	throwPuck(w, i, 0.5, -1.0);
	let guard = 0;
	while (w.vy[i] < 0 && guard++ < 480) stepWorld(w, cfg.h);
	const vt = -0.5, dvt = -(1 - cfg.wallTanKeep) * vt; // top wall: sd = +1, ω = 0
	const expectOm = -2 * dvt / cfg.puckR;
	console.log('wall rub: om = ' + w.om[i].toFixed(6) + ' (expect ' + expectOm.toFixed(6) + '), vx = ' + w.vx[i].toFixed(4) +
		' (expect ' + (0.5 - dvt).toFixed(4) + '), vy = ' + w.vy[i].toFixed(4));
	check(Math.abs(w.om[i] - expectOm) < 1e-9, 'oblique wall hit spins the puck');
	check(Math.abs(w.vy[i] - cfg.eWall * 1.0) < 1e-9, 'normal restitution untouched by the rub');
	const j = spawnPuck(w, 1.8, 0.5);
	throwPuck(w, j, 0, -1.0);
	let g2 = 0;
	while (w.vy[j] < 0 && g2++ < 480) stepWorld(w, cfg.h);
	check(w.om[j] === 0, 'head-on wall hit does not spin the puck');
}
// 5. Puck-puck: edge rub gives both pucks the same Δω (rolling), head-on none,
//    the normal impulse is untouched and the contact rub is dissipative.
{
	const c = Object.assign({}, cfg, { muK: 0, omega: 0 });
	const w = createWorld(c);
	const i = spawnPuck(w, 2.0, 1.0), j = spawnPuck(w, 2.4, 1.18);
	w.st[j] = ST_SLEEP;
	throwPuck(w, i, 1.0, 0);
	const p0 = w.m[i] * w.vx[i] + w.m[j] * w.vx[j];
	const e0 = ke(w);
	for (let s = 0; s < 300; s++) stepWorld(w, cfg.h); // contact at t ~ 0.313 s
	const p1 = w.m[i] * w.vx[i] + w.m[j] * w.vx[j];
	console.log('puck rub: om_i = ' + w.om[i].toFixed(6) + ', om_j = ' + w.om[j].toFixed(6) +
		', Σmv = ' + p1.toFixed(9) + ', KE ' + e0.toFixed(9) + ' -> ' + ke(w).toFixed(9));
	check(Math.abs(w.om[i]) > 0.1, 'oblique hit spins both pucks');
	check(w.om[i] === w.om[j], 'equal masses get the same Δω (rolling contact)');
	check(Math.abs(p1 - p0) < 1e-9, 'momentum conserved through the rub');
	check(ke(w) <= e0 + 1e-12, 'KE does not increase');
	const w2 = createWorld(c);
	const k = spawnPuck(w2, 2.0, 1.0), l = spawnPuck(w2, 2.4, 1.0);
	w2.st[l] = ST_SLEEP;
	throwPuck(w2, k, 1.0, 0);
	for (let s = 0; s < 300; s++) stepWorld(w2, cfg.h);
	check(w2.om[k] === 0 && w2.om[l] === 0, 'head-on hit creates no spin');
}
// 6. A flung puck keeps its spin, then bleeds it off on the ice at the same rate.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, cfg.launchX, cfg.launchY);
	throwPuck(w, i, -2.4, 0.0);
	let peak = 0, guard = 0;
	while (guard++ < 480 * 6) {
		stepWorld(w, cfg.h);
		const d = Math.hypot(w.x[i] - cfg.diskX, w.y[i] - cfg.diskY);
		if (d > cfg.diskR + cfg.puckR) peak = Math.max(peak, w.om[i]);
	}
	console.log('throw across the disk: peak spin off-disk = ' + peak.toFixed(4) + ' rad/s, om/ω_disk = ' +
		(peak / cfg.omega).toFixed(3) + ', ends ' + (w.st[i] === ST_LOCKED ? 'riding' : 'at rest') + ' with om = ' + w.om[i]);
	check(peak > 0.2 * cfg.omega, 'disk contact spins the puck up');
	check(peak <= cfg.omega + 1e-9, 'spin never overshoots the disk rate');
	check(w.st[i] !== ST_LOCKED || w.om[i] === w.omegaCur, 'captured puck still turns with the disk');
}
// 6b. Off the disk the spin law is independent of the linear slip: a sliding puck
//     stops turning after exactly the same time as the resting one in test 1.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, 2.5, 1.1);
	throwPuck(w, i, 1.0, 0.5);
	w.om[i] = 3;
	const expect = 3 / rate;
	let t = 0;
	while (w.om[i] > 0 && t < 4) { stepWorld(w, cfg.h); t += cfg.h; }
	console.log('sliding spin decay: stopped turning at t = ' + t.toFixed(4) + ' s (expect ' + expect.toFixed(4) + '), still moving = ' + (w.st[i] === ST_SLIDE));
	check(Math.abs(t - expect) < cfg.epsSpin / rate + 3 * cfg.h, 'slip-independent spin decay');
	check(w.st[i] === ST_SLIDE, 'linear motion continues after the spin stops');
}
// 7. Stability sweep: spinning pucks in a box with no friction never gain energy.
{
	const w = createWorld(Object.assign({}, cfg, { muK: 0, omega: 0 }));
	for (let k = 0; k < 8; k++) {
		const i = spawnPuck(w, 0.3 + 0.4 * k, 0.4 + 0.5 * (k % 3));
		throwPuck(w, i, 0.6 - 0.2 * k, 0.5 - 0.1 * k);
		w.om[i] = 6 - k;
	}
	const e0 = ke(w);
	let worst = 0;
	for (let s = 0; s < 480 * 6; s++) {
		stepWorld(w, cfg.h);
		worst = Math.max(worst, ke(w));
		for (let i = 0; i < w.n; i++) if (!isFinite(w.om[i] + w.th[i])) { console.log('FAIL NaN spin'); fail = 1; s = 1e9; break; }
	}
	console.log('energy sweep: KE ' + e0.toFixed(6) + ' -> worst ' + worst.toFixed(6));
	check(worst <= e0 + 1e-9, 'no energy gain with spin + frictionless contacts');
}
console.log(fail ? 'FAIL' : 'OK (spin rates, lock snap, angular impulses, invariants)');
process.exit(fail);
