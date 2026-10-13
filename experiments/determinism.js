// Same fixed h, different frame cadences (steps batched differently) must give
// bit-identical results, because stepWorld is the only thing that mutates state.
const cfgm = require('../js/cfg.js');
const { createWorld, spawnPuck, throwPuck, stepWorld } = require('../js/physics.js');
const cfg = Object.assign({}, cfgm.CFG);
function run(stepsPerFrame, frames) {
	const w = createWorld(cfg);
	const i = spawnPuck(w, cfg.launchX, cfg.launchY);
	throwPuck(w, i, -1.1, 0.25);
	spawnPuck(w, 1.8, 0.7);
	for (let f = 0; f < frames; f++) for (let s = 0; s < stepsPerFrame; s++) stepWorld(w, cfg.h);
	return w;
}
const a = run(16, 60), b = run(3, 320), c = run(1, 960); // all 960 steps
let fail = 0;
for (let i = 0; i < a.n; i++) {
	for (const k of ['x', 'y', 'vx', 'vy']) {
		if (a[k][i] !== b[k][i] || a[k][i] !== c[k][i]) { console.log('FAIL', k, i, a[k][i], b[k][i], c[k][i]); fail = 1; }
	}
}
console.log('theta a/b/c =', a.theta, b.theta, c.theta);
console.log(fail ? 'FAIL' : 'OK (bit-identical across frame batching at fixed h)');
process.exit(fail);
