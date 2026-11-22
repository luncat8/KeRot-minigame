// Stroke prediction for the ghost trajectory and strategic bots. The evaluator samples
// every 1/30 s while the disk rotates, so score opportunity follows theta, not one
// stale final-angle lookup. Node-safe; state and buffers are reused per predictor.
if (typeof module !== 'undefined') Object.assign(globalThis,
	require('./cfg.js'), require('./physics.js'), require('./score.js'), require('./rules.js'));

const PRED_SAMPLES = 640;
const PRED_SCORE_EVERY = 16; // 30 Hz score samples at the fixed 480 Hz physics step
const PRED_PATH_EVERY = 8; // 60 Hz ghost samples

function createPredictor(cfg) {
	const seats = cfg.maxPlayers || CFG.maxPlayers;
	return {
		world: createWorld(cfg),
		n: 0,
		path: new Float64Array(2 * PRED_SAMPLES),
		initialRates: new Float64Array(seats),
		previousRates: new Float64Array(seats),
		sampleRates: new Float64Array(seats),
		scoreBySeat: new Float64Array(seats),
		finalRates: new Float64Array(seats),
		stableBase: new Float64Array(seats), // locked/asleep rate before the throw
		stableRates: new Float64Array(seats), // locked/asleep rate after it has had time to capture
		endX: 0, endY: 0, endV: 0, dScore: 0, locked: false, removed: false, settled: false,
		recoveryDelta: 0, ownLost: 0, enemyLost: 0, duration: 0, t: 0,
		// window: the part of the turn scoreBySeat integrates (≤ handoffT). stallLead: in a
		// motion-ended turn, the thrower's lead over the strongest other seat integrated
		// over the time the turn runs past that window (negative when it settles short).
		window: 0, stallLead: 0,
	};
}
// How far a prediction plays the turn out: the fixed window, or in motion mode the turn
// itself up to maxResolve. The bound is the search's cost cap, not a rule: what still
// slides there is extrapolated (predictStroke), and the real turn plays on.
function predictHorizon(cfg) { return motionTurns(cfg) ? Math.min(turnLimit(cfg), cfg.maxResolve) : cfg.handoffT; }
// The thrower's lead in rate over the strongest other seat.
function rateLead(rates, owner) {
	let top = 0;
	for (let s = 0; s < rates.length; s++) if (s !== owner && rates[s] > top) top = rates[s];
	return rates[owner] - top;
}
function cloneInto(dst, src) {
	dst.t = src.t; dst.theta = src.theta; dst.omegaCur = src.omegaCur; dst.alpha = src.alpha;
	dst.rampFrom = src.rampFrom; dst.rampTo = src.rampTo; dst.rampT = src.rampT; dst.rampDur = src.rampDur;
	dst.n = src.n; dst.thrown = src.thrown; dst.nextUid = src.nextUid;
	dst.settling = src.settling; dst.settled = src.settled;
	dst.x.set(src.x); dst.y.set(src.y); dst.vx.set(src.vx); dst.vy.set(src.vy);
	dst.r.set(src.r); dst.m.set(src.m); dst.st.set(src.st);
	dst.th.set(src.th); dst.om.set(src.om); dst.own.set(src.own); dst.uid.set(src.uid);
	dst.ownerLosses.set(src.ownerLosses);
}
function findPuckUid(w, uid) {
	for (let i = 0; i < w.n; i++) if (w.uid[i] === uid) return i;
	return -1;
}
function recoverableCount(w, owner, mode, skip) {
	let count = 0;
	for (let i = 0; i < w.n; i++) {
		if (i !== skip && w.own[i] === owner && puckWouldRecycle(w, i, mode)) count++;
	}
	return count;
}
function sumOtherLosses(losses, owner) {
	let sum = 0;
	for (let i = 0; i < losses.length; i++) if (i !== owner) sum += losses[i];
	return sum;
}
// Simulate throwing puck i of src with (vx, vy); results land in pred. `evaluate`
// enables the per-seat score integration used by bots; the ghost only needs a path.
function predictStroke(pred, src, i, vx, vy, maxT, evaluate) {
	const cfg = src.cfg, w = pred.world, owner = src.own[i];
	const uid = src.uid[i], startLoss = src.ownerLosses[owner] || 0;
	const startEnemyLoss = sumOtherLosses(src.ownerLosses, owner);
	const recoverable0 = recoverableCount(src, owner, cfg.recycleMode, i);
	let rate0;
	if (evaluate) { scoreRates(src, pred.initialRates); rate0 = pred.initialRates[owner]; }
	else rate0 = scoreRate(src, owner);
	pred.n = 0; pred.removed = false; pred.locked = false;
	pred.endX = src.x[i]; pred.endY = src.y[i]; pred.endV = 0;
	pred.duration = 0; pred.t = 0; pred.recoveryDelta = 0; pred.ownLost = 0; pred.enemyLost = 0;
	pred.window = 0; pred.stallLead = 0; pred.settled = false;
	pred.scoreBySeat.fill(0); pred.finalRates.fill(0); pred.stableRates.fill(0);
	if (evaluate) stableRates(src, pred.stableBase);
	cloneInto(w, src);
	throwPuck(w, i, vx, vy);
	let tracked = i, lastX = w.x[i], lastY = w.y[i];
	const path = pred.path, cap = PRED_SAMPLES;
	path[0] = lastX; path[1] = lastY; pred.n = 1;
	const horizon = maxT === undefined ? cfg.maxResolve : Math.max(0, maxT);
	const maxSteps = Math.ceil(horizon / cfg.h);
	// The score term prices the fixed window; motion mode's time past it is the stall term's.
	const windowSteps = Math.min(maxSteps, Math.ceil(cfg.handoffT / cfg.h));
	let steps = 0, scoreSampleStep = 0, lead = 0;
	if (evaluate) {
		scoreRates(w, pred.sampleRates);
		pred.previousRates.set(pred.sampleRates);
	}
	while (steps < maxSteps && !isSettled(w)) {
		stepWorld(w, cfg.h);
		steps++;
		if (tracked >= 0 && (tracked >= w.n || w.uid[tracked] !== uid)) tracked = findPuckUid(w, uid);
		if (tracked >= 0) { lastX = w.x[tracked]; lastY = w.y[tracked]; }
		else pred.removed = true;
		if (steps % PRED_PATH_EVERY === 0 && tracked >= 0 && pred.n < cap - 1) {
			path[pred.n * 2] = lastX; path[pred.n * 2 + 1] = lastY; pred.n++;
		}
		const done = isSettled(w);
		if (evaluate && (steps - scoreSampleStep >= PRED_SCORE_EVERY || steps === windowSteps || done || steps >= maxSteps)) {
			scoreRates(w, pred.sampleRates);
			const dt = (steps - scoreSampleStep) * cfg.h;
			if (steps <= windowSteps) {
				for (let s = 0; s < pred.scoreBySeat.length; s++) {
					pred.scoreBySeat[s] += (pred.previousRates[s] + pred.sampleRates[s]) * 0.5 * dt;
				}
				lead = rateLead(pred.sampleRates, owner);
			} else {
				const next = rateLead(pred.sampleRates, owner);
				pred.stallLead += (lead + next) * 0.5 * dt;
				lead = next;
			}
			pred.previousRates.set(pred.sampleRates);
			scoreSampleStep = steps;
		}
	}
	if (tracked >= 0) { lastX = w.x[tracked]; lastY = w.y[tracked]; }
	if (pred.n >= cap) pred.n = cap - 1;
	if (pred.n === 0 || path[(pred.n - 1) * 2] !== lastX || path[(pred.n - 1) * 2 + 1] !== lastY) {
		path[pred.n * 2] = lastX; path[pred.n * 2 + 1] = lastY; pred.n++;
	}
	pred.endX = lastX; pred.endY = lastY;
	pred.endV = tracked >= 0 ? Math.hypot(w.vx[tracked], w.vy[tracked]) : 0;
	pred.locked = tracked >= 0 && w.st[tracked] === ST_LOCKED;
	pred.duration = steps * cfg.h; pred.t = pred.duration;
	pred.window = Math.min(steps, windowSteps) * cfg.h;
	pred.settled = isSettled(w);
	if (evaluate && motionTurns(cfg)) pred.stallLead += lead * stallTail(w, pred.settled, pred.duration);
	pred.recoveryDelta = recoverableCount(w, owner, cfg.recycleMode, -1) - recoverable0;
	pred.ownLost = (w.ownerLosses[owner] || 0) - startLoss;
	pred.enemyLost = sumOtherLosses(w.ownerLosses, owner) - startEnemyLoss;
	if (evaluate) {
		scoreRates(w, pred.finalRates);
		pred.dScore = pred.finalRates[owner] - rate0;
		// The handoff window is what the score integral covers. A puck still sliding then
		// may lock a moment later or be flung — follow it, but only while something is
		// still on the disk or heading back toward it, and only for a short tail. Recovery
		// and losses stay the handoff ones: that is when the game would hand the turn over.
		const cap = Math.ceil(cfg.maxResolve / cfg.h);
		if (!isSettled(w) && steps < cap) followThrown(w, uid, steps, cap);
		stableRates(w, pred.stableRates);
	} else pred.dScore = scoreRate(w, owner) - rate0;
	return pred;
}
// The turn time the integral did not cover, signed: a board that settled inside the
// window shortened the turn by the rest of it; one still sliding at the horizon runs on
// about as long as its fastest slider needs to stop on bare ice (within the watchdog).
// The lead at the last sample is held over it.
function stallTail(w, settled, duration) {
	const cfg = w.cfg;
	if (settled) return Math.min(0, duration - cfg.handoffT);
	let v2 = 0;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] !== ST_SLIDE) continue;
		const s = w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i];
		if (s > v2) v2 = s;
	}
	return Math.min(Math.sqrt(v2) / (muKEff(cfg) * cfg.g), Math.max(0, turnLimit(cfg) - duration));
}
// Extra steps after the scored window, so a capture that lands just past handoff is
// priced as the lock it is. Only the thrown puck is waited on: following every slider
// on a crowded board made each candidate pay for pucks this throw did not touch.
function followThrown(w, uid, steps, cap) {
	const cfg = w.cfg, R = cfg.diskR + cfg.puckR, R2 = R * R;
	const hard = Math.min(cap, steps + Math.ceil(1.5 / cfg.h));
	while (steps < hard) {
		const i = findPuckUid(w, uid);
		if (i < 0 || w.st[i] !== ST_SLIDE) return;
		const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
		if (dx * dx + dy * dy > R2 && dx * w.vx[i] + dy * w.vy[i] >= 0) return;
		stepWorld(w, cfg.h);
		steps++;
	}
}

if (typeof module !== 'undefined') module.exports = { createPredictor, cloneInto, findPuckUid, predictStroke, predictHorizon, rateLead, recoverableCount, PRED_SAMPLES, PRED_SCORE_EVERY, PRED_PATH_EVERY };
