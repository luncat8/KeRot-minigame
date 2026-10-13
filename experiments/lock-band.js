const cfgm = require('../js/cfg.js');
const { createWorld, spawnPuck, stepWorld } = require('../js/physics.js');
const cfg = Object.assign({}, cfgm.CFG);
let fail = 0;
function run(f, corotating) {
	const w = createWorld(cfg);
	const i = spawnPuck(w, cfg.diskX + f * cfg.diskR, cfg.diskY);
	w.st[i] = cfgm.ST_SLIDE;
	if (corotating) w.vy[i] = cfg.omega * f * cfg.diskR; // v_surf at (d, 0) is (0, omega*d)
	for (let s = 0; s < 20 * 480; s++) stepWorld(w, cfg.h);
	return w;
}
console.log('co-rotating placement (the 90% rule proper): r/R\tstate\tsettled_d/R');
for (let f = 0.2; f <= 1.001; f += 0.1) {
	const w = run(f, true), i = 0;
	const d = Math.hypot(w.x[i] - cfg.diskX, w.y[i] - cfg.diskY) / cfg.diskR;
	const name = w.st[i] === cfgm.ST_LOCKED ? 'LOCKED' : w.st[i] === cfgm.ST_SLEEP ? 'SLEEP' : 'SLIDE';
	console.log(f.toFixed(1) + '\t' + name + '\t' + d.toFixed(3));
	if (f <= 0.85 && w.st[i] !== cfgm.ST_LOCKED) { console.log('FAIL: co-rotating should lock at ' + f); fail = 1; }
	if (f >= 0.95 && w.st[i] === cfgm.ST_LOCKED) { console.log('FAIL: co-rotating should not lock at ' + f); fail = 1; }
}
console.log('lab-rest drop (spin-up drift shrinks the capture band; informational):');
for (let f = 0.2; f <= 0.801; f += 0.2) {
	const w = run(f, false), i = 0;
	console.log(f.toFixed(1) + '\t' + (w.st[i] === cfgm.ST_LOCKED ? 'LOCKED' : 'ejected/slid off'));
	if (f <= 0.4 && w.st[i] !== cfgm.ST_LOCKED) { console.log('FAIL: rest drop should lock deep inside at ' + f); fail = 1; }
}
console.log(fail ? 'FAIL' : 'OK');
process.exit(fail);
