const cfgm = require('../js/cfg.js');
const { createWorld, spawnPuck, throwPuck, stepWorld } = require('../js/physics.js');
const cfg = Object.assign({}, cfgm.CFG);
let fail = 0;
function path(m) {
	const w = createWorld(cfg);
	const i = spawnPuck(w, cfg.launchX, cfg.launchY);
	w.m[i] = m;
	throwPuck(w, i, -1.2, 0.3);
	for (let s = 0; s < 480 * 6; s++) stepWorld(w, cfg.h);
	return w;
}
const a = path(1), b = path(20);
console.log('m=1 ends', a.x[0].toFixed(4), a.y[0].toFixed(4), ' m=20 ends', b.x[0].toFixed(4), b.y[0].toFixed(4));
if (Math.hypot(a.x[0] - b.x[0], a.y[0] - b.y[0]) > 1e-9) { console.log('FAIL mass should cancel for a lone puck'); fail = 1; }
// Unequal-mass head-on collision conserves momentum.
{
	const w = createWorld(Object.assign({}, cfg, { omega: 0, muK: 0 }));
	const i = spawnPuck(w, 1.4, 2.0), j = spawnPuck(w, 1.8, 2.0);
	w.m[i] = 1; w.m[j] = 4;
	throwPuck(w, i, 1, 0); w.st[j] = cfgm.ST_SLEEP;
	const p0 = 1 * 1;
	for (let s = 0; s < 144; s++) stepWorld(w, cfg.h); // 0.3 s: collision at ~0.2 s, no wall reached
	const p1 = w.m[i] * w.vx[i] + w.m[j] * w.vx[j];
	console.log('momentum before/after =', p0, p1.toFixed(6));
	if (Math.abs(p1 - p0) > 1e-6) { console.log('FAIL momentum'); fail = 1; }
}
console.log(fail ? 'FAIL' : 'OK');
process.exit(fail);
