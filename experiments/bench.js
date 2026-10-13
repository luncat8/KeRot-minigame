const cfgm = require('../js/cfg.js');
const { createWorld, spawnPuck, throwPuck, stepWorld } = require('../js/physics.js');
const cfg = Object.assign({}, cfgm.CFG);
const w = createWorld(cfg);
for (let k = 0; k < 16; k++) {
	const i = spawnPuck(w, 0.4 + (k % 8) * 0.4, 0.5 + Math.floor(k / 8) * 1.2);
	throwPuck(w, i, -0.8 + k * 0.07, 0.4 - k * 0.03);
}
const t0 = process.hrtime.bigint();
const steps = 480 * 20;
for (let s = 0; s < steps; s++) stepWorld(w, cfg.h);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log('per step: ' + (ms / steps * 1000).toFixed(1) + ' us; per 60Hz frame (8 steps): ' + (ms / steps * 8).toFixed(3) + ' ms (target < 0.3 ms)');
console.log(ms / steps * 8 < 0.3 ? 'OK' : 'SLOW (informational)');
