// STALE sampler. chooseStroke no longer uses this speed formula or this value
// function (the annuity is the locked rate, and the rim feed is a tight grid).
// Kept as a record of the sweep that missed the lock band; not a gate.
// One decision under a microscope: every candidate stroke a profile samples on an
// empty rim6 board, with the predicted pieces its value is built from — so a
// mis-ranking shows whether the sampler missed the good region or the value
// function scored a good stroke down.
Object.assign(globalThis,
	require('../js/field.js'), require('../js/physics.js'), require('../js/score.js'),
	require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'));

const PROFILE = BOT_PROFILES[process.argv[2] || 'keeper'];
CFG.diskSchema = 'rim6';
const w = createWorld(CFG), pred = createPredictor(CFG);
const roster = createRoster(['keeper'], CFG.ballsPerPlayer);
w.theta = 0;
const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);

// Replicate chooseStroke's sampling, printing each candidate.
const BOT_GROUPS = 5, BOT_LEVELS = 4, BOT_SPREAD = [0.78, 0.36, 0.48, 0.48, 0.10];
const rng = makeRng(777);
globalThis.strategicTargets === undefined; // not exported; reproduce the call path through chooseStroke below
const targets = globalThis.botTargets;
chooseStroke('keeper', w, CFG, i, pred, makeRng(777), roster); // fills targets as a side effect
console.log('targets: ' + targets.map((t, g) => g + ':(' + t.x.toFixed(2) + ',' + t.y.toFixed(2) + ',v0 ' + t.v0.toFixed(2) + ')').join(' '));
const urgency = 1 + (CFG.ballsPerPlayer - roster[0].balls) * 0.55;
const rowsRng = makeRng(777); // the same stream chooseStroke used for offsets
// chooseStroke consumed the rng inside; repeat the construction exactly:
const rng2 = makeRng(777);
console.log('grp  ang    v      integ·1k  opp·1k  denied·1k  rec Δ  ownLost enLost  value');
for (let k = 0; k < BOT_GROUPS * BOT_LEVELS; k++) {
	const group = (k / BOT_LEVELS) | 0, level = k - group * BOT_LEVELS;
	const t = targets[group];
	const base = Math.atan2(t.y - w.y[i], t.x - w.x[i]);
	const offset = (level / (BOT_LEVELS - 1) - 0.5) * 2 * BOT_SPREAD[group] + (rng2() - 0.5) * 0.10;
	const speedIndex = (level * 3 + group * 5) % BOT_LEVELS;
	const fraction = t.v0 > 0 ? (t.v0 / CFG.vMax) * (0.84 + 0.12 * speedIndex) : speedIndex / (BOT_LEVELS - 1);
	const speed = clamp(CFG.vMin + (fraction + (rng2() - 0.5) * 0.08) * (CFG.vMax - CFG.vMin), CFG.vMin, CFG.vMax);
	const vx = Math.cos(base + offset) * speed, vy = Math.sin(base + offset) * speed;
	predictStroke(pred, w, i, vx, vy, CFG.handoffT, true);
	const owner = w.own[i], base2 = pred.initialRates, integral = pred.scoreBySeat;
	const ownIntegral = integral[owner] - base2[owner] * pred.duration;
	const ownOpportunity = (pred.finalRates[owner] - base2[owner]) * CFG.handoffT;
	let enemyIntegral = 0, enemyOpportunity = 0;
	for (let s = 0; s < base2.length; s++) {
		if (s === owner) continue;
		enemyIntegral += integral[s] - base2[s] * pred.duration;
		enemyOpportunity += pred.finalRates[s] - base2[s];
	}
	const denied = -(enemyIntegral + enemyOpportunity * CFG.handoffT);
	const value = PROFILE.score * ownIntegral + PROFILE.opportunity * ownOpportunity
		+ PROFILE.denial * denied + PROFILE.recovery * pred.recoveryDelta
		+ PROFILE.reserve * pred.recoveryDelta * urgency
		- PROFILE.risk * pred.ownLost + PROFILE.kill * pred.enemyLost;
	const degv = (base + offset) * 180 / Math.PI;
	console.log(String(group).padStart(2) + ' ' + degv.toFixed(0).padStart(5) + '°  ' + speed.toFixed(2) + '  ' +
		(1000 * ownIntegral).toFixed(1).padStart(8) + ' ' + (1000 * ownOpportunity).toFixed(1).padStart(8) + ' ' +
		(1000 * denied).toFixed(1).padStart(9) + ' ' + String(pred.recoveryDelta).padStart(5) + ' ' +
		String(pred.ownLost).padStart(6) + ' ' + String(pred.enemyLost).padStart(6) + '  ' + value.toFixed(1).padStart(7));
}
