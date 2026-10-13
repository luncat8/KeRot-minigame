// Puck material rotation: the spinning-friction rates, the lock snap, the angular
// impulses at walls and between pucks, and the invariants they must not break.
// The contact is integrated over the puck now (js/physics.js FR_RINGS × FR_RAYS), so
// the spec is the integral, not a patch at one point: the exact closed form where one
// exists, and an independent equal-area quadrature everywhere else.
Object.assign(globalThis, require('../js/cfg.js'), require('../js/physics.js'));
const cfg = Object.assign({}, CFG);
const I = 0.5 * cfg.puckM * cfg.puckR * cfg.puckR;
const rate = cfg.spinDrag * cfg.muK * cfg.g / cfg.puckR; // |ω̇| for a spin on bare ice
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }
// Independent reference: 40 equal-area rings × 160 rays, the same friction law.
function refStep(c, x, y, vx, vy, om, omS, h) {
	const N = 40, NR = 160, r = c.puckR, cell = c.muK * c.g * h / (N * NR);
	let fx = 0, fy = 0, tq = 0;
	for (let k = 0; k < N; k++) {
		const rad = Math.sqrt((k + 0.5) / N) * r;
		for (let j = 0; j < NR; j++) {
			const ph = (j + 0.5) * 2 * Math.PI / NR;
			const rx = rad * Math.cos(ph), ry = rad * Math.sin(ph);
			const ex = x + rx - c.diskX, ey = y + ry - c.diskY;
			let sx = 0, sy = 0;
			if (ex * ex + ey * ey <= c.diskR * c.diskR) { sx = -omS * ey; sy = omS * ex; }
			const ux = vx - om * ry - sx, uy = vy + om * rx - sy;
			const rr = Math.sqrt(ux * ux + uy * uy);
			if (rr <= 1e-9) continue;
			const gx = -cell * ux / rr, gy = -cell * uy / rr;
			fx += gx; fy += gy; tq += rx * gy - ry * gx;
		}
	}
	return [vx + fx, vy + fy, om + tq * 2 / (r * r)];
}
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
// 2a. A puck riding the disk without spinning of its own: every cell's slip is then
//     exactly Ω·ρ — the classic spinning-contact case — and the spin ramps at
//     spinDrag·μk·g/r. Exactly, because the pattern is built so Σw|ρ| = (2/3)r³, and
//     the drag of a purely rotational slip is force-free (Σẑ×ρ/|ρ| = 0 by symmetry).
//     μs is lowered only so the lock (rightly) cannot capture the puck first.
{
	const c = Object.assign({}, cfg, { omega: 1.5, muS: 0.01 }); // d_hold = 0.044 m < 0.5 m
	const w = createWorld(c);
	const i = spawnPuck(w, cfg.diskX + 0.5, cfg.diskY);
	w.st[i] = ST_SLIDE;
	w.vx[i] = 0; w.vy[i] = c.omega * 0.5; // exactly the surface velocity under the centre
	const expect = rate * cfg.h;
	stepWorld(w, cfg.h);
	console.log('ride spin-up, first step: Δom = ' + w.om[i].toFixed(12) + ' (expect ' + expect.toFixed(12) +
		'), Δv = ' + Math.hypot(w.vx[i], w.vy[i] - c.omega * 0.5).toExponential(2));
	check(w.st[i] === ST_SLIDE, 'low muS keeps it sliding (no lock)');
	check(Math.abs(w.om[i] - expect) < 1e-12, 'spin-up rate = spinDrag·μk·g/r exactly');
	check(Math.abs(w.vx[i]) < 1e-15 && Math.abs(w.vy[i] - c.omega * 0.5) < 1e-15, 'a rotational slip drags the puck along nothing');
	// The puck no longer co-moves once it has drifted (the surface is a rotation, not a
	// translation), which weakens the torque: the run stays positive and under the bound.
	for (let s = 1; s < 40; s++) stepWorld(w, cfg.h);
	const got = w.om[i];
	console.log('ride spin-up, 40 steps: Δom = ' + got.toFixed(6) + ' (classic bound ' + (40 * expect).toFixed(6) + ')');
	check(got > 0.5 * 40 * expect && got <= 40 * expect + 1e-12, 'spin-up accumulates toward ω_disk, never past the classic bound');
}
// 2c. The sleep gate. A stopped puck may only be called stopped where the floor patch
//     can still hold the disk patch's drive; a puck the disk can drive on is kept
//     sliding, otherwise a partial overlap would end the round with the disk pulling.
//     (The failure this replaces: the disk dragged a rest puck off the rim in one
//     frame and an eps-snap threshold froze it mid-drag, so a straddler could never
//     come to rest at all — measured, then, as |ω| winding up to 9 ω_disk.)
{
	const ov = { a: 0, cx: 0, cy: 0, d: 0, qd: 0, qf: 0, px: 0, py: 0 };
	// One world each: spawnPuck resolves puck-puck overlap, which would shove the
	// second puck measurably deeper onto the disk.
	const w1 = createWorld(cfg);
	const sliver = spawnPuck(w1, cfg.diskX + cfg.diskR + 0.09, cfg.diskY); // barely touching
	const aSliver = diskOverlap(w1, sliver, ov);
	const heldSliver = holdable(cfg, aSliver, ov);
	const w2 = createWorld(cfg);
	const rim = spawnPuck(w2, cfg.diskX + cfg.diskR, cfg.diskY); // centre on the rim
	const aRim = diskOverlap(w2, rim, ov);
	const heldRim = holdable(cfg, aRim, ov);
	check(aSliver > 0 && aSliver < 0.05, 'sliver overlap is a sliver', 'a=' + aSliver.toFixed(4));
	console.log('sleep gate: sliver a=' + aSliver.toFixed(4) + ' holdable=' + heldSliver +
		', rim a=' + aRim.toFixed(4) + ' holdable=' + heldRim);
	check(aRim > 0.4 && aRim < 0.6, 'rim straddle is about half', 'a=' + aRim.toFixed(4));
	check(heldSliver, 'a sliver is held by the floor — it may sleep');
	check(!heldRim, 'a half-overlapped puck on the turning disk is not held');
	// Bare ice, pure translation: exactly μk·g, and the eps-snap ends the slide.
	const b = createWorld(cfg);
	const j = spawnPuck(b, 2.5, cfg.diskY);
	b.st[j] = ST_SLIDE; b.vx[j] = cfg.epsSleep * 3;
	const v0 = b.vx[j];
	stepWorld(b, cfg.h);
	const dv = v0 - b.vx[j];
	console.log('slow slide: Δv = ' + dv.toFixed(12) + ' (μk·g·h = ' + (cfg.muK * cfg.g * cfg.h).toFixed(12) + ')');
	check(Math.abs(dv - cfg.muK * cfg.g * cfg.h) < 1e-15, 'a sliding contact brakes at μk·g, exactly');
	let t = 0;
	while (b.st[j] === ST_SLIDE && t < 2) { stepWorld(b, cfg.h); t += cfg.h; }
	check(b.st[j] === ST_SLEEP && b.vx[j] === 0 && b.om[j] === 0, 'the slide ends in an exact sleep');
}
// 2d. A still disk is just more ice: with ω_disk = 0 every contact surface is at rest,
//     so a straddling puck must decay at exactly the bare-ice rates — spin at
//     4/3·μk·g/r and linear speed at μk·g — whatever the overlap. This is the case
//     that used to wind up: a straddler span up like a roller bearing between the rim
//     and the floor and walked along the rim forever (14 m of travel, |ω| → 9 ω_disk).
{
	const c = Object.assign({}, cfg, { omega: 0 });
	const dK = -rate * cfg.h; // bare-ice Δω per step
	for (const off of [0, -0.05]) { // a ≈ ½ and a ≈ 0.8
		for (const om0 of [1.0, 0.3]) {
			const w = createWorld(c);
			const i = spawnPuck(w, cfg.diskX + cfg.diskR + off, cfg.diskY);
			w.st[i] = ST_SLIDE; w.om[i] = om0;
			stepWorld(w, cfg.h);
			const got = w.om[i] - om0;
			console.log('still-disk straddle (d=' + (cfg.diskR + off).toFixed(3) + ', om=' + om0 +
				'): Δom = ' + got.toFixed(12) + ' (μk ' + dK.toFixed(12) + '), |Δv| = ' +
				Math.hypot(w.vx[i], w.vy[i]).toExponential(1));
			check(Math.abs(got - dK) < 1e-12, 'straddling spin decays at the bare-ice rate exactly');
			check(Math.hypot(w.vx[i], w.vy[i]) < 1e-15, 'a straddling spin is force-free');
		}
		const w2 = createWorld(c);
		const j = spawnPuck(w2, cfg.diskX + cfg.diskR + off, cfg.diskY);
		w2.st[j] = ST_SLIDE; w2.vx[j] = 0.4;
		stepWorld(w2, cfg.h);
		const dvx = w2.vx[j] - 0.4;
		console.log('still-disk straddle (d=' + (cfg.diskR + off).toFixed(3) + ', om=0): Δvx = ' +
			dvx.toFixed(12) + ' (μk ' + (-cfg.muK * cfg.g * cfg.h).toFixed(12) + ')');
		check(Math.abs(dvx + cfg.muK * cfg.g * cfg.h) < 1e-15, 'straddling slide brakes at μk·g exactly');
	}
}
// 2e. The roller bearing: a puck left straddling the rim of the turning disk must
//     settle, not creep and spin up along the rim forever.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, cfg.launchX, cfg.launchMinY);
	throwPuck(w, i, -1.2, -0.3); // a throw that lands on the rim and stays there
	let t = 0, worst = 0;
	while (w.st[i] !== ST_SLEEP && t < 30) { stepWorld(w, cfg.h); t += cfg.h; worst = Math.max(worst, Math.abs(w.om[i])); }
	console.log('rim roller: settled after ' + t.toFixed(2) + ' s, om = ' + w.om[i].toFixed(4) +
		', peak |om| = ' + worst.toFixed(3) + ', state = ' + (w.st[i] === ST_SLEEP ? 'SLEEP' : 'still moving'));
	check(w.st[i] === ST_SLEEP, 'rim roller sleeps instead of spinning up');
	check(t < 8, 'rim roller settles inside the 8 s ghost horizon');
	check(worst < 3 * cfg.omega, 'rim roller never winds up past a few times ω_disk');
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
// 2f. The straddle, against the continuum: an independent fine-grid quadrature of the
//     same law (160² cells per puck, all-kinetic, disk turning under the covered part,
//     h = 1/480) settles a rest straddler at d = 0.842 (a≈½) and 0.897 (a≈0.8), and
//     peaks at |ω| = 1.67 and 2.40 rad/s on the way — a squeezed puck rolls between the
//     rim and the ice like a wheel, so it does briefly turn faster than the disk. The
//     model must land on both numbers, not merely "settle": an earlier single-point
//     contact law looked calm here only because its couple was capped, and a
//     lever-plus-couple one wound up to 9 ω_disk and never stopped.
{
	for (const [off, dRef, omRef] of [[0, 0.842, 1.672], [-0.05, 0.897, 2.401]]) {
		const w = createWorld(cfg);
		const i = spawnPuck(w, cfg.diskX + cfg.diskR + off, cfg.diskY);
		throwPuck(w, i, 0, 0); // spawnPuck alone leaves the puck asleep
		let t = 0, peak = 0;
		while (w.st[i] !== ST_SLEEP && t < 30) {
			stepWorld(w, cfg.h); t += cfg.h;
			peak = Math.max(peak, Math.abs(w.om[i]));
		}
		const d = Math.hypot(w.x[i] - cfg.diskX, w.y[i] - cfg.diskY);
		console.log('straddle d0=' + (cfg.diskR + off).toFixed(3) + ': sleep@' + t.toFixed(2) + 's d=' +
			d.toFixed(3) + ' (reference ' + dRef.toFixed(3) + '), peak|om|=' + peak.toFixed(3) +
			' (reference ' + omRef.toFixed(3) + ')');
		check(w.st[i] === ST_SLEEP, 'the straddler sleeps');
		check(Math.abs(d - dRef) < 0.01, 'settles where the continuum quadrature settles');
		check(Math.abs(peak - omRef) < 0.09, 'peaks at the spin the continuum quadrature peaks at');
	}
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
// 6. A puck crossing the turning disk is spun the way the disk turns, at the rate the
//     integral gives. While it slides fast the contact is nearly torque-free (the slip
//     direction is almost uniform under the puck), so the spin is small — the old
//     single-point model injected a saturated couple regardless of the slip and span
//     pucks up past the disk rate.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, cfg.launchX, cfg.launchY);
	throwPuck(w, i, -2.4, 0.0);
	let peak = 0, guard = 0;
	while (guard++ < 480 * 6) {
		stepWorld(w, cfg.h);
		// Only while it slides: a capture legitimately snaps the spin onto ω_disk.
		if (w.st[i] === ST_SLIDE) peak = Math.max(peak, w.om[i]);
	}
	console.log('throw across the disk: peak spin = ' + peak.toFixed(5) + ' rad/s, om/ω_disk = ' +
		(peak / cfg.omega).toFixed(4) + ', ends ' + (w.st[i] === ST_LOCKED ? 'riding' : 'at rest') +
		' with om = ' + w.om[i].toFixed(4));
	check(peak > 0, 'disk contact spins the puck the way the disk turns');
	check(peak <= cfg.omega + 1e-9, 'spin never overshoots the disk rate');
	check(w.st[i] !== ST_LOCKED || w.om[i] === w.omegaCur, 'captured puck still turns with the disk');
	// One step of the same throw, against the reference integral.
	const p = createWorld(cfg);
	const k = spawnPuck(p, cfg.diskX, cfg.diskY);
	p.st[k] = ST_SLIDE; p.vx[k] = -2.4; p.vy[k] = 0;
	const [rx, ry, rom] = refStep(cfg, cfg.diskX, cfg.diskY, -2.4, 0, 0, p.omegaCur, cfg.h);
	stepWorld(p, cfg.h);
	const dv = Math.hypot(p.vx[k] - rx, p.vy[k] - ry), dom = Math.abs(p.om[k] - rom);
	console.log('one step on the disk: |Δv| err = ' + dv.toExponential(2) + ' (' +
		(100 * dv / (cfg.muK * cfg.g * cfg.h)).toFixed(2) + ' % of μk·g·h), Δom err = ' +
		dom.toExponential(2) + ' of ' + (rom).toExponential(2));
	check(dv < 0.01 * cfg.muK * cfg.g * cfg.h, 'force matches the reference quadrature within 1 %');
	check(dom < 0.05 * Math.abs(rom), 'torque matches the reference quadrature within 5 %');
}
// 6b. Off the disk the spin law is the free-spin one, and a fast slide makes it slower,
//     not faster: the contact is a torque-free drag when the slip is uniform, so the
//     decay is τ/|v| of the bare-ice rate. Reference-quadrature parity, one step.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, 2.5, 1.1);
	w.st[i] = ST_SLIDE; w.vx[i] = 1.0; w.vy[i] = -0.4; w.om[i] = 3;
	const [rx, ry, rom] = refStep(cfg, 2.5, 1.1, 1.0, -0.4, 3, w.omegaCur, cfg.h);
	stepWorld(w, cfg.h);
	const dv = Math.hypot(w.vx[i] - rx, w.vy[i] - ry), dom = Math.abs(w.om[i] - rom);
	console.log('sliding spin decay: Δom = ' + (w.om[i] - 3).toExponential(3) + ' (bare ice ' +
		(-rate * cfg.h).toExponential(3) + ', reference ' + (rom - 3).toExponential(3) + ')');
	check(dv < 0.01 * cfg.muK * cfg.g * cfg.h, 'off-disk force matches the reference within 1 %');
	check(dom < 0.03 * Math.abs(rom - 3), 'off-disk spin decay matches the reference within 3 %');
	check(Math.abs(w.om[i] - 3) < rate * cfg.h, 'a fast slide bleeds spin slower than a pure spin');
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
