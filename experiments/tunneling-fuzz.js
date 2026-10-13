// Deterministic PRNG (mulberry32) so the fuzz is reproducible, sim stays RNG-free.
const cfgm = require('../js/cfg.js');
const { createWorld, spawnPuck, throwPuck, stepWorld } = require('../js/physics.js');
const cfg = Object.assign({}, cfgm.CFG);
let seed = 12345, fail = 0;
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
for (let trial = 0; trial < 2000; trial++) {
	const w = createWorld(cfg);
	const n = 1 + Math.floor(rnd() * 4);
	for (let k = 0; k < n; k++) {
		const i = spawnPuck(w, cfg.puckR + rnd() * (cfg.boardW - 2 * cfg.puckR), cfg.puckR + rnd() * (cfg.boardH - 2 * cfg.puckR));
		const ang = rnd() * Math.PI * 2, sp = rnd() * 50; // far beyond vMax: TOI must still hold
		throwPuck(w, i, Math.cos(ang) * sp, Math.sin(ang) * sp);
	}
	for (let s = 0; s < 480; s++) {
		stepWorld(w, cfg.h);
		for (let i = 0; i < w.n; i++) {
			if (!isFinite(w.x[i] + w.y[i] + w.vx[i] + w.vy[i])) { console.log('FAIL NaN trial', trial); fail = 1; }
			if (w.x[i] < w.r[i] - 1e-9 || w.x[i] > cfg.boardW - w.r[i] + 1e-9 || w.y[i] < w.r[i] - 1e-9 || w.y[i] > cfg.boardH - w.r[i] + 1e-9) { console.log('FAIL wall penetration trial', trial, w.x[i], w.y[i]); fail = 1; }
			for (let j = i + 1; j < w.n; j++) {
				const d = Math.hypot(w.x[j] - w.x[i], w.y[j] - w.y[i]);
				if (d < w.r[i] + w.r[j] - 1e-6) { console.log('FAIL interpenetration trial', trial, d); fail = 1; }
			}
		}
		if (fail) break;
	}
	if (fail) break;
}
console.log(fail ? 'FAIL' : 'OK (2000 trials x 1 s, speeds to 50 m/s)');
process.exit(fail);
