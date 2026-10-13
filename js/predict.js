// Stroke prediction: clone a world, throw one puck, simulate to rest. Shared by
// the ghost-trajectory preview and the sampling bots. Node-safe; everything is
// allocated once in createPredictor and mutated in place.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./physics.js'));

const PRED_SAMPLES = 640; // path points; 8 s of 60 Hz samples fits in 480

function createPredictor(cfg) {
	return {
		world: createWorld(cfg),
		n: 0,
		path: new Float64Array(2 * PRED_SAMPLES),
		endX: 0, endY: 0, endV: 0, dScore: 0, locked: false, t: 0,
	};
}
function cloneInto(dst, src) {
	dst.t = src.t; dst.theta = src.theta; dst.omegaCur = src.omegaCur;
	dst.n = src.n; dst.thrown = src.thrown;
	dst.settling = src.settling; dst.settleT = src.settleT; dst.settled = src.settled;
	dst.x.set(src.x); dst.y.set(src.y); dst.vx.set(src.vx); dst.vy.set(src.vy);
	dst.r.set(src.r); dst.m.set(src.m); dst.st.set(src.st);
}
// Simulate throwing puck i of src with (vx, vy); results land in pred.
function predictStroke(pred, src, i, vx, vy, maxT) {
	const cfg = src.cfg, w = pred.world;
	const score0 = totalScore(src);
	cloneInto(w, src);
	throwPuck(w, i, vx, vy);
	const path = pred.path, cap = PRED_SAMPLES;
	const sampleEvery = 8; // 60 Hz samples at h = 1/480
	pred.n = 0;
	path[0] = w.x[i]; path[1] = w.y[i]; pred.n = 1;
	const maxSteps = Math.ceil(maxT / cfg.h);
	let steps = 0;
	while (steps < maxSteps && !isSettled(w)) {
		stepWorld(w, cfg.h);
		steps++;
		if (steps % sampleEvery === 0 && pred.n < cap) {
			path[pred.n * 2] = w.x[i]; path[pred.n * 2 + 1] = w.y[i]; pred.n++;
		}
	}
	// Always record the true final position (drop the last sample if full).
	if (pred.n >= cap) pred.n = cap - 1;
	path[pred.n * 2] = w.x[i]; path[pred.n * 2 + 1] = w.y[i]; pred.n++;
	pred.endX = w.x[i]; pred.endY = w.y[i];
	pred.endV = Math.sqrt(w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i]);
	pred.locked = w.st[i] === ST_LOCKED;
	pred.t = w.t - src.t;
	pred.dScore = totalScore(w) - score0;
	return pred;
}

if (typeof module !== 'undefined') module.exports = { createPredictor, cloneInto, predictStroke, PRED_SAMPLES };
