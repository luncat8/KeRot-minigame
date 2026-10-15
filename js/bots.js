// Seeded strategy bots. Every profile scores the same simulated candidate set; only
// its preferences differ, so recovery, reserve use and puck-loss risk are considered
// by every bot. Node-safe and synchronous: predictor buffers and botOut are reused.
if (typeof module !== 'undefined') Object.assign(globalThis,
	require('./cfg.js'), require('./field.js'), require('./physics.js'), require('./predict.js'), require('./rules.js'));

const BOT_GROUPS = 5;
const BOT_LEVELS = 4;
const BOT_SAMPLES = BOT_GROUPS * BOT_LEVELS;
// score/opportunity/denial multiply raw red·s-rate units; the ball terms (recovery,
// reserve, risk, kill) are priced in red-rate economics (see evaluateStroke): a ball
// costs or saves the turns that remain for it, so profiles no longer treat a ball as
// almost free against a parking stroke — and noise pays in the same coin, so random
// truly wanders while scoring bots keep their signal all game. A returned ball is
// worth barely a window (recPrice), so extending a game by recycling is a tactical
// fallback, never a scoring plan.
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

function makeRng(seed) {
	let s = (seed >>> 0) || 0x9e3779b9;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
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
	// Group 4: the rim feed — the only throw that holds a puck outside the dead-stop
	// lock radius (~0.5 R, where the rim6 lobes cannot be reached): approach the
	// hold circle tangentially and arrive with the surface velocity, so the disk
	// picks the puck up instead of flinging it. v0 is the launch speed that leaves
	// exactly that arrival after friction, and the levels spread it for arrival
	// phase (slightly slower/faster = the lobe led by less/more).
	const dh = holdRadius(cfg), rf = Math.min(0.85 * dh, cfg.diskR - cfg.puckR - 0.01);
	const ox = w.x[i] - cfg.diskX, oy = w.y[i] - cfg.diskY, od = Math.hypot(ox, oy) || 1e-9;
	const beta = Math.atan2(oy, ox), alpha = Math.acos(clamp(rf / Math.max(od, rf + 1e-9), -1, 1));
	for (const side of [-1, 1]) {
		const a = beta + side * alpha;
		const tx = cfg.diskX + rf * Math.cos(a), ty = cfg.diskY + rf * Math.sin(a);
		// Of the two tangents from the puck to the hold circle, keep the one whose
		// chord direction agrees with the surface — there the disk carries the puck
		// forward; the other chord fights it.
		const along = ((tx - w.x[i]) * -Math.sin(a) + (ty - w.y[i]) * Math.cos(a)) * cfg.omega;
		if (along > 0 || side === 1) {
			const chord = Math.hypot(tx - w.x[i], ty - w.y[i]), vs = Math.abs(cfg.omega) * rf;
			setTarget(4, tx, ty, Math.sqrt(vs * vs + 2 * muKEff(cfg) * cfg.g * chord));
			if (along > 0) break;
		}
	}
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
	const owner = w.own[i], base = pred.initialRates, final = pred.finalRates, integral = pred.scoreBySeat;
	const duration = pred.duration;
	const ownIntegral = integral[owner] - base[owner] * duration;
	// A locked puck is an annuity: it pays its rate every later resolve window, not
	// only this one. future = the pays-still-coming horizon (later turns' windows
	// plus the end settle), so an ending state is priced by what it actually earns.
	const ownOpportunity = (final[owner] - base[owner]) * future;
	let enemyIntegral = 0, enemyOpportunity = 0;
	for (let s = 0; s < base.length; s++) {
		if (s === owner) continue;
		enemyIntegral += integral[s] - base[s] * duration;
		enemyOpportunity += final[s] - base[s];
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
function chooseStroke(name, w, cfg, i, pred, rng, roster) {
	const profile = BOT_PROFILES[name] || BOT_PROFILES.balanced;
	strategicTargets(w, cfg, i);
	const own = w.own[i], stock = roster && roster[own] ? roster[own].balls : 0;
	const urgency = 1 + (cfg.ballsPerPlayer - stock) * 0.55;
	// Pays-still-coming horizon: later turns' resolve windows (≈0.9·handoffT each,
	// they close on settle) plus ~2 s of the end settle. A thrown puck that ends
	// the turn holding red earns that rate for all of them, so it is priced in here.
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
	let best = -Infinity, bestVx = 0, bestVy = 0, secondVx = 0, secondVy = 0;
	for (let k = 0; k < BOT_SAMPLES; k++) {
		const group = (k / BOT_LEVELS) | 0, level = k - group * BOT_LEVELS;
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
		const vx = Math.cos(base + offset) * speed, vy = Math.sin(base + offset) * speed;
		const value = evaluateStroke(profile, w, cfg, i, pred, vx, vy, rng, urgency, future, ballValue, recPrice, lifePrice);
		if (value <= best) continue;
		secondVx = bestVx; secondVy = bestVy;
		best = value; bestVx = vx; bestVy = vy;
	}
	for (let p = 0; p < 2; p++) {
		const ang0 = Math.atan2(p ? secondVy : bestVy, p ? secondVx : bestVx);
		const sp0 = Math.hypot(p ? secondVy : bestVy, p ? secondVx : bestVx);
		if (p && !sp0) break;
		for (let a = 0; a < BOT_REFINE_DA.length; a++) {
			for (let s = 0; s < BOT_REFINE_KV.length; s++) {
				const speed = clamp(sp0 * BOT_REFINE_KV[s], cfg.vMin, cfg.vMax);
				const vx = Math.cos(ang0 + BOT_REFINE_DA[a]) * speed, vy = Math.sin(ang0 + BOT_REFINE_DA[a]) * speed;
				const value = evaluateStroke(profile, w, cfg, i, pred, vx, vy, rng, urgency, future, ballValue, recPrice, lifePrice);
				if (value <= best) continue;
				best = value; bestVx = vx; bestVy = vy;
			}
		}
	}
	botOut.vx = bestVx; botOut.vy = bestVy;
	return botOut;
}

if (typeof module !== 'undefined') module.exports = { makeRng, chooseStroke, botOut, botTargets, strategicTargets, BOT_SAMPLES, BOT_PROFILES };
