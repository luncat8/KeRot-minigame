// Seeded strategy bots. Every profile scores the same simulated candidate set; only
// its preferences differ, so recovery, reserve use and puck-loss risk are considered
// by every bot. Node-safe and synchronous: predictor buffers and botOut are reused.
if (typeof module !== 'undefined') Object.assign(globalThis,
	require('./cfg.js'), require('./field.js'), require('./physics.js'), require('./predict.js'), require('./rules.js'));

const BOT_GROUPS = 4;
const BOT_LEVELS = 4;
const BOT_SAMPLES = BOT_GROUPS * BOT_LEVELS;
// Reserve weights scale a discrete returned ball by stock urgency; low stock raises
// the same recovery reward without making an idle throw score as if it had landed.
const BOT_PROFILES = {
	random: { score: 0.18, opportunity: 0.10, denial: 0.15, recovery: 0.65, reserve: 0.55, risk: 2.5, kill: 0.15, noise: 1.8 },
	keeper: { score: 1.25, opportunity: 1.60, denial: 0.20, recovery: 0.45, reserve: 0.70, risk: 4.5, kill: 0.20, noise: 0.02 },
	hunter: { score: 1.00, opportunity: 1.05, denial: 0.75, recovery: 0.65, reserve: 0.80, risk: 5.0, kill: 1.00, noise: 0.02 },
	retriever: { score: 0.60, opportunity: 0.55, denial: 0.15, recovery: 4.00, reserve: 7.00, risk: 7.0, kill: 0.10, noise: 0.02 },
	blackhole: { score: 0.70, opportunity: 0.75, denial: 1.10, recovery: 0.50, reserve: 0.55, risk: 8.0, kill: 16.0, noise: 0.02 },
	balanced: { score: 0.95, opportunity: 1.10, denial: 0.45, recovery: 2.75, reserve: 12.0, risk: 6.0, kill: 1.8, noise: 0.02 },
};
const BOT_SPREAD = [0.78, 0.36, 0.48, 0.48];
const botTargets = new Float64Array(BOT_GROUPS * 2);
const botOut = { vx: 0, vy: 0 };

function makeRng(seed) {
	let s = (seed >>> 0) || 0x9e3779b9;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
function setTarget(group, x, y) { botTargets[group * 2] = x; botTargets[group * 2 + 1] = y; }
function strategicTargets(w, cfg, i) {
	const owner = w.own[i];
	setTarget(0, cfg.diskX, cfg.diskY);
	// The schema's hot spot nearest the puck at the current disk angle.
	const aims = DISK_SCHEMAS[cfg.diskSchema].aims, c = Math.cos(w.theta), s = Math.sin(w.theta);
	let best = Infinity;
	for (let k = 0; k < aims.length; k++) {
		const ax = cfg.diskX + c * aims[k].x - s * aims[k].y, ay = cfg.diskY + s * aims[k].x + c * aims[k].y;
		const d = Math.hypot(ax - w.x[i], ay - w.y[i]);
		if (d < best) { best = d; setTarget(1, ax, ay); }
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
function evaluateStroke(profile, w, cfg, i, pred, vx, vy, rng, urgency) {
	predictStroke(pred, w, i, vx, vy, cfg.handoffT, true);
	const owner = w.own[i], base = pred.initialRates, final = pred.finalRates, integral = pred.scoreBySeat;
	const duration = pred.duration, future = cfg.handoffT;
	const ownIntegral = integral[owner] - base[owner] * duration;
	const ownOpportunity = (final[owner] - base[owner]) * future;
	let enemyIntegral = 0, enemyOpportunity = 0;
	for (let s = 0; s < base.length; s++) {
		if (s === owner) continue;
		enemyIntegral += integral[s] - base[s] * duration;
		enemyOpportunity += final[s] - base[s];
	}
	const denied = -(enemyIntegral + enemyOpportunity * future);
	return profile.score * ownIntegral + profile.opportunity * ownOpportunity
		+ profile.denial * denied + profile.recovery * pred.recoveryDelta
		+ profile.reserve * pred.recoveryDelta * urgency
		- profile.risk * pred.ownLost + profile.kill * pred.enemyLost
		+ (rng() - 0.5) * profile.noise;
}
function chooseStroke(name, w, cfg, i, pred, rng, roster) {
	const profile = BOT_PROFILES[name] || BOT_PROFILES.balanced;
	strategicTargets(w, cfg, i);
	const own = w.own[i], stock = roster && roster[own] ? roster[own].balls : 0;
	const urgency = 1 + (cfg.ballsPerPlayer - stock) * 0.55;
	let best = -Infinity;
	for (let k = 0; k < BOT_SAMPLES; k++) {
		const group = (k / BOT_LEVELS) | 0, level = k - group * BOT_LEVELS;
		const tx = botTargets[group * 2], ty = botTargets[group * 2 + 1];
		const base = Math.atan2(ty - w.y[i], tx - w.x[i]);
		const offset = (level / (BOT_LEVELS - 1) - 0.5) * 2 * BOT_SPREAD[group] + (rng() - 0.5) * 0.10;
		const speedIndex = (level * 3 + group * 5) % BOT_LEVELS;
		const fraction = speedIndex / (BOT_LEVELS - 1) + (rng() - 0.5) * 0.08;
		const speed = clamp(cfg.vMin + fraction * (cfg.vMax - cfg.vMin), cfg.vMin, cfg.vMax);
		const vx = Math.cos(base + offset) * speed, vy = Math.sin(base + offset) * speed;
		const value = evaluateStroke(profile, w, cfg, i, pred, vx, vy, rng, urgency);
		if (value <= best) continue;
		best = value; botOut.vx = vx; botOut.vy = vy;
	}
	return botOut;
}

if (typeof module !== 'undefined') module.exports = { makeRng, chooseStroke, botOut, BOT_SAMPLES, BOT_PROFILES };
