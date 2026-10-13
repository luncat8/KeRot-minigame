const cfgm = require('../js/cfg.js');
const { createWorld, spawnPuck, throwPuck, stepWorld } = require('../js/physics.js');
const cfg = Object.assign({}, cfgm.CFG, { omega: 0 });
let fail = 0;
// Stopping distance on open floor (right side, away from disk influence is
// impossible on this board, so throw left->right is replaced by a puck far
// from the disk sliding on the floor strip below it is still partial; use
// omega=0 and a puck fully off-disk travelling along the bottom lane.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, 0.3, 2.0);
	throwPuck(w, i, 1.0, 0);
	let guard = 0;
	while (w.st[i] === cfgm.ST_SLIDE && guard++ < 480 * 30) stepWorld(w, cfg.h);
	const travelled = w.x[i] - 0.3, expect = 1.0 / (2 * cfg.muK * cfg.g);
	console.log('stop dist=' + travelled.toFixed(3) + ' expect=' + expect.toFixed(3));
	if (Math.abs(travelled - expect) / expect > 0.02) { console.log('FAIL stopping distance'); fail = 1; }
}
// Wall bounce energy ratio: head-on into left wall.
{
	const w = createWorld(cfg);
	const i = spawnPuck(w, 3.3, 0.9); // x=3.3 lane is fully off-disk
	throwPuck(w, i, 0, -1.0); // toward top wall, 0.8 m away (stopping distance 1.7 m)
	let prevVy = -1.0, ratio = 0, guard = 0;
	while (guard++ < 480 * 10) {
		stepWorld(w, cfg.h);
		if (w.vy[i] > 0) { ratio = w.vy[i] / 1.0; break; }
		prevVy = w.vy[i];
	}
	// friction bleeds speed en route: expect e * v_impact, v_impact^2 = v0^2 - 2*mu*g*dist
	const vImpact = Math.sqrt(Math.max(0, 1 - 2 * cfg.muK * cfg.g * 0.8));
	console.log('wall bounce |vy| ratio=' + ratio.toFixed(3) + ' expect=' + (cfg.eWall * vImpact).toFixed(3));
	if (Math.abs(ratio - cfg.eWall * vImpact) > 0.01) { console.log('FAIL wall bounce'); fail = 1; }
}
console.log(fail ? 'FAIL' : 'OK');
process.exit(fail);
