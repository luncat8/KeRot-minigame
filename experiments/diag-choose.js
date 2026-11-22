// Compare chooseStroke's pick vs a brute-force optimum on the small disk.
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
resetWorld(w);
spawnPuck(w, CFG.diskX + 0.02, CFG.diskY, 0);
w.st[0] = ST_LOCKED; w.vx[0] = 0; w.vy[0] = 0; w.om[0] = CFG.omega;
spawnPuck(w, CFG.diskX + 0.4, CFG.diskY + 0.3, 1);
w.st[1] = ST_SLEEP;
const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);

const profile = BOT_PROFILES.keeper;
const own = w.own[i], stock = roster[own].balls;
const urgency = 1 + (CFG.ballsPerPlayer - stock) * 0.55;
let future = CFG.handoffT;
{ let turns = 0; for (let s = 0; s < roster.length; s++) turns += roster[s].balls; future = 2 + 0.9 * CFG.handoffT * turns; }
const r0 = Math.PI * CFG.puckR * CFG.puckR * diskMeanRed(CFG);
const ballValue = r0 * future;
const recPrice = 0.2 * ballValue;
const lifePrice = ballValue / Math.max(1, roster.length);

function valueOf(vx, vy) {
	return evaluateStroke(profile, w, CFG, i, pred, vx, vy, rng, urgency, future, ballValue, recPrice, lifePrice);
}
function outcome(vx, vy) {
	predictStroke(pred, w, i, vx, vy, CFG.handoffT, true);
	const d = Math.hypot(pred.endX - CFG.diskX, pred.endY - CFG.diskY);
	return { d, locked: pred.locked, v: pred.dScore };
}

const rank = makeStrokeRank();
const rng2 = makeRng(777);
const s = chooseStroke('keeper', w, CFG, i, pred, rng2, roster, rank);
const pick = outcome(s.vx, s.vy);
console.log(PRESET + ': chooseStroke pick |v|=' + Math.hypot(s.vx, s.vy).toFixed(3) +
	' angle=' + Math.atan2(s.vy, s.vx).toFixed(3) + ' endD=' + pick.d.toFixed(3) + ' locked=' + pick.locked +
	' value=' + valueOf(s.vx, s.vy).toFixed(2));

// brute force
let best = -Infinity, bvx = 0, bvy = 0, bd = 0, blk = false;
for (let a = 0; a < 240; a++) {
	const ang = a * Math.PI / 120;
	for (let sp = 0.3; sp <= 3.0001; sp += 0.02) {
		const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
		const v = valueOf(vx, vy);
		if (v > best) { best = v; bvx = vx; bvy = vy; const o = outcome(vx, vy); bd = o.d; blk = o.locked; }
	}
}
console.log(PRESET + ': brute-force best |v|=' + Math.hypot(bvx, bvy).toFixed(3) +
	' angle=' + Math.atan2(bvy, bvx).toFixed(3) + ' endD=' + bd.toFixed(3) + ' locked=' + blk + ' value=' + best.toFixed(2));
