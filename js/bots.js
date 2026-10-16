// Seeded strategy bots. Every profile scores the same simulated candidate set; only
// its preferences differ, so recovery, reserve use and puck-loss risk are considered
// by every bot. Node-safe and synchronous: predictor buffers and botOut are reused.
if (typeof module !== 'undefined') Object.assign(globalThis,
	require('./cfg.js'), require('./field.js'), require('./physics.js'), require('./score.js'), require('./predict.js'), require('./rules.js'));

const BOT_GROUPS = 5;
const BOT_LEVELS = 4;
const BOT_SAMPLES = BOT_GROUPS * BOT_LEVELS;
// score/opportunity/denial multiply raw red·s-rate units; the ball terms (recovery,
// reserve, risk, kill) are priced in red-rate economics (see evaluateStroke): a ball
// costs or saves the turns that remain for it, so profiles no longer treat a ball as
// almost free against a parking stroke — and noise pays in the same coin, so random
// truly wanders while scoring bots keep their signal all game. A returned ball is
// worth barely a window (recPrice), so extending a game by recycling is a tactical
// fallback, never a scoring plan. Opportunity is the locked rate, not the rate at the
// sample instant: a puck crossing red at handoff pays for the window and then leaves.
const BOT_PROFILES = {
	random: { score: 0.10, opportunity: 0.10, denial: 0.05, recovery: 0.30, reserve: 0.20, risk: 0.30, kill: 0.05, noise: 8.0 },
	keeper: { score: 1.00, opportunity: 1.20, denial: 0.15, recovery: 0.20, reserve: 0.15, risk: 1.30, kill: 0.10, noise: 0.00 },
	hunter: { score: 0.80, opportunity: 1.00, denial: 0.60, recovery: 0.30, reserve: 0.25, risk: 0.80, kill: 0.80, noise: 0.10 },
	retriever: { score: 0.60, opportunity: 0.70, denial: 0.10, recovery: 0.50, reserve: 0.90, risk: 1.00, kill: 0.10, noise: 0.05 },
	blackhole: { score: 0.40, opportunity: 0.50, denial: 0.70, recovery: 0.20, reserve: 0.10, risk: 0.60, kill: 1.60, noise: 0.05 },
	balanced: { score: 0.90, opportunity: 1.00, denial: 0.35, recovery: 0.30, reserve: 0.40, risk: 1.00, kill: 0.40, noise: 0.05 },
};
const BOT_SPREAD = [0.78, 0.36, 0.48, 0.48, 0.10];
// One record per target group; v0 is a solved launch speed (0 = sample the whole
// stroke range instead). Module-level and mutated in place per decision.
const botTargets = [];
for (let g = 0; g < BOT_GROUPS; g++) botTargets.push({ x: 0, y: 0, v0: 0 });
const botOut = { vx: 0, vy: 0 };
// The rng's state is readable and writable so a look-ahead can hand every candidate
// the same noise stream (js/warp.js), and so a copy of a game replays the decisions.
function makeRng(seed) {
	let s = (seed >>> 0) || 0x9e3779b9;
	const rng = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
	rng.getState = () => s;
	rng.setState = v => { s = (v >>> 0) || 0x9e3779b9; };
	return rng;
}
function setTarget(group, x, y, v0) { const t = botTargets[group]; t.x = x; t.y = y; t.v0 = v0 || 0; }
// Time of a stop-at-target throw over `dist` at the current load: v² = 2μgD and
// v = μg·t, so t = √(2D/μg). Used to lead rotating aims by the flight time.
function flightTime(cfg, dist) {
	const a = muKEff(cfg) * cfg.g;
	return a > 0 ? Math.sqrt(2 * dist / a) : 0;
}
function strategicTargets(w, cfg, i) {
	const owner = w.own[i];
	setTarget(0, cfg.diskX, cfg.diskY);
	// Group 1: the schema's hot spot nearest the puck, led by the disk's rotation
	// over the flight — the disk turns ~1 rad while a thrown puck crosses the board,
	// so the lobe aims at empty ice by arrival unless it is led. On a schema of
	// equivalent lobes (rim6) the lead matters modulo one lobe period: any lobe
	// parks a puck as well as the next.
	const schema = DISK_SCHEMAS[cfg.diskSchema], aims = schema.aims, lobes = schema.lobes || 1, period = 2 * Math.PI / lobes;
	const c = Math.cos(w.theta), s = Math.sin(w.theta);
	let best = Infinity;
	for (let k = 0; k < aims.length; k++) {
		const awx = cfg.diskX + c * aims[k].x - s * aims[k].y, awy = cfg.diskY + s * aims[k].x + c * aims[k].y;
		const dist = Math.hypot(awx - w.x[i], awy - w.y[i]);
		if (dist >= best) continue;
		best = dist;
		let lead = w.omegaCur * flightTime(cfg, dist);
		if (lobes > 1) lead %= period;
		const cl = Math.cos(lead), sl = Math.sin(lead);
		const lx = aims[k].x * cl - aims[k].y * sl, ly = aims[k].x * sl + aims[k].y * cl;
		setTarget(1, cfg.diskX + c * lx - s * ly, cfg.diskY + s * lx + c * ly);
	}
	// Group 4 records the middle feed so a microscope can see it. The decision itself
	// samples the tight grid in chooseStroke — the 4 jittered levels of this group
	// never landed in the lock band.
	const dh = holdRadius(cfg), rf = Math.min(0.82 * dh, cfg.diskR - cfg.puckR - 0.01);
	const feed = cfg.omega !== 0 && rf > cfg.puckR ? feedTangent(cfg, w.x[i], w.y[i], rf) : null;
	if (feed) setTarget(4, feed.x, feed.y, feed.v0);
	else setTarget(4, cfg.diskX, cfg.diskY);
	best = Infinity;
	let targetX = cfg.diskX, targetY = cfg.diskY;
	for (let j = 0; j < w.n; j++) {
		if (j === i || w.own[j] !== owner || puckWouldRecycle(w, j, cfg.recycleMode)) continue;
		const ox = w.x[j] - cfg.diskX, oy = w.y[j] - cfg.diskY;
		const offDisk = Math.hypot(ox, oy) - (cfg.diskR + cfg.puckR);
		if (offDisk <= 0) continue;
		const d = Math.hypot(w.x[j] - w.x[i], w.y[j] - w.y[i]);
		if (d < best) { best = d; targetX = w.x[j]; targetY = w.y[j]; }
	}
	const recoverDX = cfg.diskX - targetX, recoverDY = cfg.diskY - targetY;
	const recoverD = Math.hypot(recoverDX, recoverDY);
	if (recoverD > 1e-6) { targetX -= recoverDX / recoverD * 2 * cfg.puckR; targetY -= recoverDY / recoverD * 2 * cfg.puckR; }
	setTarget(2, targetX, targetY);
	best = Infinity; targetX = cfg.diskX; targetY = cfg.diskY;
	for (let j = 0; j < w.n; j++) {
		if (j === i || w.own[j] === owner) continue;
		let holeDistance = Infinity, holeIndex = 0;
		for (let k = 0; k < BLACK_HOLES.length; k++) {
			const hole = BLACK_HOLES[k];
			const d = Math.hypot(w.x[j] - hole.x, w.y[j] - hole.y) - (hole.r + cfg.puckR);
			if (d < holeDistance) { holeDistance = d; holeIndex = k; }
		}
		if (holeDistance >= best) continue;
		best = holeDistance;
		const hole = BLACK_HOLES[holeIndex], pushX = hole.x - w.x[j], pushY = hole.y - w.y[j];
		const pushD = Math.hypot(pushX, pushY) || 1;
		targetX = w.x[j] - pushX / pushD * 2 * cfg.puckR;
		targetY = w.y[j] - pushY / pushD * 2 * cfg.puckR;
	}
	setTarget(3, targetX, targetY);
}
// Event prices, all derived from one red-rate R0 (what an average parked puck pays)
// and one horizon (the windows still to come):
// - ballValue: the annuity one parked puck still earns — sets the noise coin and the
//   value of spending an extra throw (recPrice), since a thrown ball is spent until
//   it comes back one way or another.
// - lifePrice: a lost ball forfeits its own remaining turns (~1/seats of the
//   horizon); a parked puck's lost annuity is already priced by opportunity/denied.
function evaluateStroke(profile, w, cfg, i, pred, vx, vy, rng, urgency, future, ballValue, recPrice, lifePrice) {
	predictStroke(pred, w, i, vx, vy, cfg.handoffT, true);
	const owner = w.own[i], base = pred.initialRates, integral = pred.scoreBySeat;
	const duration = pred.duration;
	const ownIntegral = integral[owner] - base[owner] * duration;
	// A locked puck is an annuity: it pays its rate every later resolve window, not
	// only this one. future = the pays-still-coming horizon (later turns' windows
	// plus the end settle). Only the locked/asleep rate counts — the instantaneous
	// rate at handoff prices a puck that is crossing red and about to leave as if it
	// would pay for the rest of the game, and that single mistake makes every profile
	// prefer a fly-by over a capture.
	const stable = pred.stableRates, stable0 = pred.stableBase;
	const ownOpportunity = (stable[owner] - stable0[owner]) * future;
	let enemyIntegral = 0, enemyOpportunity = 0;
	for (let s = 0; s < base.length; s++) {
		if (s === owner) continue;
		enemyIntegral += integral[s] - base[s] * duration;
		enemyOpportunity += stable[s] - stable0[s];
	}
	const denied = -(enemyIntegral + enemyOpportunity * future);
	return profile.score * ownIntegral + profile.opportunity * ownOpportunity
		+ profile.denial * denied + recPrice * (profile.recovery + profile.reserve * urgency) * pred.recoveryDelta
		+ lifePrice * (profile.kill * pred.enemyLost - profile.risk * pred.ownLost)
		+ (rng() - 0.5) * profile.noise * ballValue;
}
// The value landscape of a parking or capture shot is razor-thin (a few cm/s between
// a lobe lock and an ejection), and a 20-sample sweep strides over it. After the
// coarse winner is known, a fine patch around its direction and speed polishes it
// with the same exact evaluation. Costs ~2x a plain decision; still ms-scale.
const BOT_REFINE_DA = [-0.05, -0.025, 0, 0.025, 0.05];
const BOT_REFINE_KV = [0.82, 0.88, 0.94, 1, 1.06, 1.12, 1.18];
// Rim capture is a band a few centimetres per second wide around the co-rotating tangent
// (measured: launch-lane locks sit near 0.90 of the floor-friction solve, a degree or
// two off the geometric tangent, and which hold-circle radius lands on red depends on
// the disk's phase). A jittered 4-sample sweep strides over it. This grid does not.
const FEED_FRAC = [0.70, 0.82, 0.92]; // of d_hold, the three radii that cover a lobe period
const FEED_KV = [0.86, 0.90, 0.94]; // of the floor-friction solve; on-disk drag makes the true speed lower
const FEED_DA = [-0.02618, 0, 0.02618, 0.05236]; // rad around the tangent, about −1.5°..+3°
// --- The shortlist a deeper search can work through --------------------------------
// chooseStroke weighs ~90 strokes and keeps the best. A look-ahead (js/warp.js) wants
// the best *of each line of play* instead — park on the hot lobe, feed the rim, knock
// an enemy puck back, push one into a hole — because those are the moves whose ranking
// a one-ply estimate is least able to settle. So the search hands over its per-group
// winner, sorted, and near-duplicates (same direction and speed) drop out: a look-ahead
// spent twice on the same throw is a look-ahead wasted.
const BOT_RANK_SLOTS = BOT_GROUPS + 1; // the four aim groups, the feed grid, the fine patch
function makeStrokeRank() {
	const r = { n: 0, vx: new Float64Array(BOT_RANK_SLOTS), vy: new Float64Array(BOT_RANK_SLOTS), value: new Float64Array(BOT_RANK_SLOTS) };
	r.value.fill(-Infinity); // a rank nobody has filled this round holds no candidate
	return r;
}
function rankAdd(rank, slot, vx, vy, value) {
	if (value <= rank.value[slot]) return;
	rank.value[slot] = value; rank.vx[slot] = vx; rank.vy[slot] = vy;
}
function rankFinish(rank) {
	let n = 0;
	for (let s = 0; s < BOT_RANK_SLOTS; s++) {
		if (!isFinite(rank.value[s])) continue;
		const v = rank.value[s], ax = rank.vx[s], ay = rank.vy[s]; // the shift below overwrites slot s
		let k = n;
		while (k > 0 && rank.value[k - 1] < v) { // insertion sort, by value
			rank.value[k] = rank.value[k - 1]; rank.vx[k] = rank.vx[k - 1]; rank.vy[k] = rank.vy[k - 1];
			k--;
		}
		rank.value[k] = v; rank.vx[k] = ax; rank.vy[k] = ay;
		n++;
	}
	let m = n > 0 ? 1 : 0; // drop a candidate that is the same throw under another name
	for (let a = 1; a < n; a++) {
		let dupe = false;
		for (let b = 0; b < m; b++) if (sameThrow(rank, a, b)) { dupe = true; break; }
		if (dupe) continue;
		if (m !== a) { rank.value[m] = rank.value[a]; rank.vx[m] = rank.vx[a]; rank.vy[m] = rank.vy[a]; }
		m++;
	}
	rank.n = m;
	return m;
}
function sameThrow(rank, a, b) {
	const da = Math.abs(Math.atan2(rank.vy[a], rank.vx[a]) - Math.atan2(rank.vy[b], rank.vx[b]));
	const sa = Math.hypot(rank.vx[a], rank.vy[a]), sb = Math.hypot(rank.vx[b], rank.vy[b]);
	const dv = sa - sb;
	return da < 0.02 && dv * dv < 0.0004 * sa * sb; // within 0.02 rad and 2 % of speed
}
// `light` is the budget a look-ahead's rollout can pay for an answer (js/warp.js): the
// same policy — the same targets, the same simulation, the same economics — sampling
// every other aim level and every other feed radius/angle and skipping the fine patch.
// A copy that answered with the full search would cost ~190 ms a seat, more than all the
// physics in a rollout; a copy that answered without simulating at all is a *weak* reply:
// every stroke is thrown at the speed that stops on its target, so it never knocks a
// parked puck off the disk, and a search priced against it learns to leave pucks where a
// real answer takes them (measured in experiments/warp-replies.js).
function chooseStroke(name, w, cfg, i, pred, rng, roster, rank, light) {
	const profile = BOT_PROFILES[name] || BOT_PROFILES.balanced;
	if (rank) rank.value.fill(-Infinity);
	strategicTargets(w, cfg, i);
	const own = w.own[i], stock = roster && roster[own] ? roster[own].balls : 0;
	const urgency = 1 + (cfg.ballsPerPlayer - stock) * 0.55;
	// Pays-still-coming horizon: later turns' resolve windows (≈0.9·handoffT each,
	// they close on settle) plus ~2 s of the end settle. A throw that ends locked
	// earns that rate for all of them; a fly-by earns only the window.
	let future = cfg.handoffT;
	if (roster) {
		let turns = 0;
		for (let s = 0; s < roster.length; s++) turns += roster[s].balls;
		future = 2 + 0.9 * cfg.handoffT * turns;
	}
	const r0 = Math.PI * cfg.puckR * cfg.puckR * diskMeanRed(cfg);
	const ballValue = r0 * future;
	// A returned ball is NOT a full annuity: it has to be thrown again, escapes via
	// parking/loss, and may never be thrown at all (last-turn pass). 0.2 of one is
	// deterrent enough for opportunistic scraping, small enough under stock pressure.
	const recPrice = 0.2 * ballValue;
	const lifePrice = ballValue / (roster ? Math.max(1, roster.length) : 3);
	let best = -Infinity, bestVx = 0, bestVy = 0;
	function consider(vx, vy, slot) {
		const value = evaluateStroke(profile, w, cfg, i, pred, vx, vy, rng, urgency, future, ballValue, recPrice, lifePrice);
		if (rank) rankAdd(rank, slot, vx, vy, value);
		if (value <= best) return;
		best = value; bestVx = vx; bestVy = vy;
	}
	const step = light ? 2 : 1;
	for (let k = 0; k < BOT_SAMPLES; k += step) {
		const group = (k / BOT_LEVELS) | 0, level = k - group * BOT_LEVELS;
		if (group === 4) continue; // replaced by the feed grid; skipping it keeps the other groups' rng stream
		const t = botTargets[group];
		const base = Math.atan2(t.y - w.y[i], t.x - w.x[i]);
		// Rim-lobe captures sit up to ~0.3 rad past the led aim (measured on empty
		// rim6), so the aim group gets the narrower ±30° sweep around its direction.
		const spread = group === 1 ? 0.30 : BOT_SPREAD[group];
		const offset = (level / (BOT_LEVELS - 1) - 0.5) * 2 * spread + (rng() - 0.5) * 0.10;
		const speedIndex = (level * 3 + group * 5) % BOT_LEVELS;
		// A group with a solved speed samples around it (arrival phase diversity);
		// the others sweep the whole stroke range as four coarse fractions.
		const fraction = t.v0 > 0 ? (t.v0 / cfg.vMax) * (0.80 + 0.10 * speedIndex) : speedIndex / (BOT_LEVELS - 1);
		const speed = clamp(cfg.vMin + (fraction + (rng() - 0.5) * 0.08) * (cfg.vMax - cfg.vMin), cfg.vMin, cfg.vMax);
		consider(Math.cos(base + offset) * speed, Math.sin(base + offset) * speed, group);
	}
	// Co-rotating tangent feeds. Every throw is launched from the same spot, so the
	// geometry is fixed; the predictor still sees the pucks already on the board.
	if (cfg.omega !== 0) {
		const dh = holdRadius(cfg), cap = cfg.diskR - cfg.puckR - 0.01;
		for (let r = 0; r < FEED_FRAC.length; r += step) {
			const rf = Math.min(FEED_FRAC[r] * dh, cap);
			if (rf <= cfg.puckR) continue;
			const f = feedTangent(cfg, w.x[i], w.y[i], rf);
			if (!f) continue;
			for (let s = 0; s < FEED_KV.length; s++) {
				const speed = clamp(f.v0 * FEED_KV[s], cfg.vMin, cfg.vMax);
				for (let a = 0; a < FEED_DA.length; a += step) {
					const ang = f.ang + FEED_DA[a];
					consider(Math.cos(ang) * speed, Math.sin(ang) * speed, 4);
				}
			}
		}
	}
	// One patch around the winner. A second patch around the runner-up cost as much
	// again and, once the feed grid covers the lock band, rarely changed the pick — and a
	// light decision, being an answer inside somebody else's rollout, gets neither.
	const ang0 = Math.atan2(bestVy, bestVx), sp0 = light ? 0 : Math.hypot(bestVx, bestVy);
	if (sp0) {
		for (let a = 0; a < BOT_REFINE_DA.length; a++) {
			for (let s = 0; s < BOT_REFINE_KV.length; s++) {
				const speed = clamp(sp0 * BOT_REFINE_KV[s], cfg.vMin, cfg.vMax);
				consider(Math.cos(ang0 + BOT_REFINE_DA[a]) * speed, Math.sin(ang0 + BOT_REFINE_DA[a]) * speed, 5);
			}
		}
	}
	botOut.vx = bestVx; botOut.vy = bestVy;
	if (rank) rankFinish(rank);
	return botOut;
}
// Tangent from (x, y) to the circle of radius rf about the disk, on the side whose
// chord agrees with the surface velocity — the only side a capture works. v0 is the
// launch speed that would leave exactly that surface speed after floor friction over
// the whole chord; the true capture is a little slower (the disk drags less than the
// floor once the puck is on it), which is why the feed grid scales v0 down.
function feedTangent(cfg, x, y, rf) {
	const ox = x - cfg.diskX, oy = y - cfg.diskY, od = Math.hypot(ox, oy);
	if (!(od > rf)) return null;
	const beta = Math.atan2(oy, ox), alpha = Math.acos(rf / od);
	for (let s = 0; s < 2; s++) {
		const side = s === 0 ? -1 : 1, a = beta + side * alpha;
		const tx = cfg.diskX + rf * Math.cos(a), ty = cfg.diskY + rf * Math.sin(a);
		const along = ((tx - x) * -Math.sin(a) + (ty - y) * Math.cos(a)) * cfg.omega;
		if (along <= 0 && side !== 1) continue;
		const chord = Math.hypot(tx - x, ty - y), vs = Math.abs(cfg.omega) * rf;
		return { x: tx, y: ty, v0: Math.sqrt(vs * vs + 2 * muKEff(cfg) * cfg.g * chord), ang: Math.atan2(ty - y, tx - x) };
	}
	return null;
}

if (typeof module !== 'undefined') module.exports = { makeRng, chooseStroke, botOut, botTargets, strategicTargets, feedTangent, makeStrokeRank, rankFinish, BOT_SAMPLES, BOT_PROFILES, BOT_GROUPS };
