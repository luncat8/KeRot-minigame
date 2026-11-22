// Enumerate the keeper's candidate strokes on notsobigdisk and print value components.
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

const PRESET = process.argv[2] || 'notsobigdisk';
applyCfg(parseQuery('?preset=' + PRESET));

const w = createWorld(CFG);
const pred = createPredictor(CFG);
const roster = createRoster(['keeper', 'hunter'], CFG.ballsPerPlayer);
const rng = makeRng(777);

// Build a realistic board: keeper has one puck parked near the disk, hunter has one elsewhere.
resetWorld(w);
spawnPuck(w, CFG.diskX + 0.02, CFG.diskY, 0);
w.st[0] = ST_LOCKED; w.vx[0] = 0; w.vy[0] = 0; w.om[0] = CFG.omega;
spawnPuck(w, CFG.diskX + 0.4, CFG.diskY + 0.3, 1);
w.st[1] = ST_SLEEP;
const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);

const profile = BOT_PROFILES.keeper;
const BOT_LEVELS = 4;
const BOT_SPREAD = [0.78, 0.36, 0.48, 0.48, 0.10];
const FEED_FRAC = [0.70, 0.82, 0.92];
const FEED_DKV = [-0.04, 0, 0.04];
const FEED_DA = [-0.02618, 0, 0.02618, 0.05236];
const own = w.own[i], stock = roster[own].balls;
const urgency = 1 + (CFG.ballsPerPlayer - stock) * 0.55;
let future = CFG.handoffT;
{
	let turns = 0;
	for (let s = 0; s < roster.length; s++) turns += roster[s].balls;
	future = 2 + 0.9 * CFG.handoffT * turns;
}
const r0 = Math.PI * CFG.puckR * CFG.puckR * diskMeanRed(CFG);
const ballValue = r0 * future;
const recPrice = 0.2 * ballValue;
const lifePrice = ballValue / Math.max(1, roster.length);

strategicTargets(w, CFG, i);
console.log('targets: g0=(' + botTargets[0].x.toFixed(3) + ',' + botTargets[0].y.toFixed(3) + ') g1=(' + botTargets[1].x.toFixed(3) + ',' + botTargets[1].y.toFixed(3) +
	') g2=(' + botTargets[2].x.toFixed(3) + ',' + botTargets[2].y.toFixed(3) + ') g3=(' + botTargets[3].x.toFixed(3) + ',' + botTargets[3].y.toFixed(3) +
	') g4=(' + botTargets[4].x.toFixed(3) + ',' + botTargets[4].y.toFixed(3) + ') v0=' + botTargets[4].v0.toFixed(3));
console.log('r0=' + r0.toFixed(4) + ' ballValue=' + ballValue.toFixed(2) + ' future=' + future.toFixed(2));

function evalStroke(vx, vy) {
	const v = evaluateStroke(profile, w, CFG, i, pred, vx, vy, rng, urgency, future, ballValue, recPrice, lifePrice);
	// recompute components by re-running predictStroke and reading pred fields
	predictStroke(pred, w, i, vx, vy, CFG.handoffT, true);
	const owner = w.own[i];
	const ownIntegral = pred.scoreBySeat[owner] - pred.initialRates[owner] * pred.duration;
	const ownOpportunity = (pred.stableRates[owner] - pred.stableBase[owner]) * future;
	return { v, ownIntegral, ownOpportunity, locked: pred.locked, endX: pred.endX, endY: pred.endY, endD: Math.hypot(pred.endX - CFG.diskX, pred.endY - CFG.diskY) };
}

const cands = [];
const step = 1;
for (let k = 0; k < BOT_SAMPLES; k += step) {
	const group = (k / BOT_LEVELS) | 0, level = k - group * BOT_LEVELS;
	if (group === 4) continue;
	const t = botTargets[group];
	const base = Math.atan2(t.y - w.y[i], t.x - w.x[i]);
	const spread = group === 1 ? 0.30 : BOT_SPREAD[group];
	const offset = (level / (BOT_LEVELS - 1) - 0.5) * 2 * spread;
	const speedIndex = (level * 3 + group * 5) % BOT_LEVELS;
	const fraction = t.v0 > 0 ? (t.v0 / CFG.vMax) * (0.80 + 0.10 * speedIndex) : speedIndex / (BOT_LEVELS - 1);
	const speed = clamp(CFG.vMin + fraction * (CFG.vMax - CFG.vMin), CFG.vMin, CFG.vMax);
	cands.push({ group, level, vx: Math.cos(base + offset) * speed, vy: Math.sin(base + offset) * speed, speed });
}
// feed grid
{
	const dh = holdRadius(CFG), cap = CFG.diskR - CFG.puckR - 0.01;
	for (let r = 0; r < FEED_FRAC.length; r++) {
		const rf = Math.min(FEED_FRAC[r] * dh, cap);
		if (rf <= CFG.puckR) continue;
		const f = feedTangent(CFG, w.x[i], w.y[i], rf);
		if (!f) continue;
		for (let s = 0; s < FEED_DKV.length; s++) {
			const speed = clamp(f.v0 * (f.kv + FEED_DKV[s]), CFG.vMin, CFG.vMax);
			for (let a = 0; a < FEED_DA.length; a++) {
				const ang = f.ang + FEED_DA[a];
				cands.push({ group: 4, r, s, a, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed });
			}
		}
	}
}
for (const c of cands) {
	const r = evalStroke(c.vx, c.vy);
	c.v = r.v; c.ownIntegral = r.ownIntegral; c.ownOpportunity = r.ownOpportunity;
	c.locked = r.locked; c.endD = r.endD;
}
cands.sort((a, b) => b.v - a.v);
console.log('\nTop 15 candidates:');
console.log('group lvl |v|    endD    locked  ownInt  ownOpp    value');
for (const c of cands.slice(0, 15)) {
	console.log(String(c.group).padStart(4) + ' ' + String(c.level !== undefined ? c.level : (c.r + '.' + c.s + '.' + c.a)).padStart(4) +
		' ' + c.speed.toFixed(3).padStart(6) + ' ' + c.endD.toFixed(3).padStart(7) + ' ' + String(c.locked).padStart(6) +
		' ' + c.ownIntegral.toFixed(3).padStart(7) + ' ' + c.ownOpportunity.toFixed(2).padStart(8) + ' ' + c.v.toFixed(2).padStart(8));
}
