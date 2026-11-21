// Direct check of the timing bot: it spends the fixed scoring window well — it weights
// the *within-turn* red-time (score) far above the far-future lock (opportunity), so it
// throws to get pucks dwelling in red (and double-passing the zone) instead of only
// building the best end-state. And when it is already ahead it votes to slow the disk so
// its parked lead keeps dwelling in red. Run: node experiments/timing-check.js
Object.assign(globalThis,
	require('../js/field.js'), require('../js/physics.js'), require('../js/score.js'),
	require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'),
	require('../js/bots.js'), require('../js/vote.js'));

// Rate (red·m²) the thrown puck is earning at the end of its simulated turn.
function endRate(w, i, vx, vy, pred) {
	predictStroke(pred, w, i, vx, vy, CFG.handoffT, true);
	const uid = w.uid[i];
	let idx = -1;
	for (let k = 0; k < pred.world.n; k++) if (pred.world.uid[k] === uid) { idx = k; break; }
	if (idx < 0) return -1; // swallowed by a hole
	return puckRate(pred.world, idx);
}
// Reddest on-disk throw (ends parked on the scoring disk, r > 1) vs dimmest off-disk
// throw (ends off the disk, r < 1) — the two ends of "spends the window on red".
function findThrow(w, i, wantRed) {
	const pred = createPredictor(CFG);
	let best = null;
	for (let sp = 0.4; sp <= 3.0; sp += 0.15)
		for (let a = -Math.PI; a <= Math.PI; a += 0.15) {
			const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, r = endRate(w, i, vx, vy, pred);
			if (r < 0) continue;
			if (wantRed) { if (r > 1 && (!best || r > best.r)) best = { vx, vy, r }; }
			else { if (r < 1 && (!best || r < best.r)) best = { vx, vy, r }; }
		}
	return best;
}
function evalThrow(type, w, i, vx, vy) {
	const pred = createPredictor(CFG);
	const rng = makeRng(1);
	const future = 20, ballValue = Math.PI * CFG.puckR * CFG.puckR * diskMeanRed(CFG) * future;
	return evaluateStroke(BOT_PROFILES[type], w, CFG, i, pred, vx, vy, rng, 1, future, ballValue, 0.2 * ballValue, ballValue / 2);
}

// A board with one puck to throw, nothing else on the scoring disk.
const w = createWorld(CFG), pend = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
const redT = findThrow(w, pend, true), offT = findThrow(w, pend, false);
if (!redT || !offT) { console.log('FAIL: could not find red/off-red sample throws'); process.exit(1); }
console.log('sample throws: stop-in-red rate=' + redT.r.toFixed(1) + ', off-red rate=' + offT.r.toFixed(1));

const redTiming = evalThrow('timing', w, pend, redT.vx, redT.vy);
const offTiming = evalThrow('timing', w, pend, offT.vx, offT.vy);
const redRand = evalThrow('random', w, pend, redT.vx, redT.vy);
const offRand = evalThrow('random', w, pend, offT.vx, offT.vy);
const timingGap = redTiming - offTiming, randGap = redRand - offRand;
console.log('preference for a puck dwelling in red:  timing +' + timingGap.toFixed(1) + '   random +' + randGap.toFixed(1));

let ok = true;
const check = (c, m) => { if (!c) { console.log('FAIL: ' + m); ok = false; } };
check(redTiming > offTiming, 'timing scores a dwell-in-red throw above an off-red one');
check(randGap >= 0, 'random also prefers red (sanity)');
check(timingGap > randGap * 2, 'timing weights within-turn red-time far more than random (its signature)');

// --- Vote bias: when ahead, timing slows the disk; when behind it does not.
const vRoster = createRoster(['timing', 'balanced'], CFG.ballsPerPlayer), vRng = makeRng(7);
function voteOf(mine, theirs, mode) {
	CFG.speedVote = 'turn'; CFG.voteMode = mode;
	const b = createWorld(CFG), hot = DISK_SCHEMAS[CFG.diskSchema].aims[0];
	for (let k = 0; k < mine; k++) { const i = spawnPuck(b, CFG.diskX + hot.x, CFG.diskY + hot.y, 0); b.st[i] = ST_LOCKED; b.vx[i] = -CFG.omega * (b.y[i] - CFG.diskY); b.vy[i] = CFG.omega * (b.x[i] - CFG.diskX); b.om[i] = CFG.omega; }
	for (let k = 0; k < theirs; k++) { const i = spawnPuck(b, CFG.diskX + hot.x, CFG.diskY + hot.y, 1); b.st[i] = ST_LOCKED; b.vx[i] = -CFG.omega * (b.y[i] - CFG.diskY); b.vy[i] = CFG.omega * (b.x[i] - CFG.diskX); b.om[i] = CFG.omega; }
	const v = chooseVote('timing', b, CFG, 0, vRoster, 2, vRng);
	CFG.speedVote = 'round'; CFG.voteMode = 'delta';
	return { kind: v.kind, value: v.value };
}
const vAhead = voteOf(2, 0, 'delta'), vBehind = voteOf(0, 2, 'delta'), vAheadE = voteOf(2, 0, 'exact');
console.log('vote (delta) ahead: ' + voteLabel(CFG, vAhead.kind, vAhead.value) + '   behind: ' + voteLabel(CFG, vBehind.kind, vBehind.value));
console.log('vote (exact) ahead: ' + voteLabel(CFG, vAheadE.kind, vAheadE.value) + '  (current ω=' + CFG.omega.toFixed(2) + ')');
check(vAhead.kind !== VOTE_NONE && vAhead.value < 0, 'ahead: timing votes to slow the disk (negative delta)');
check(vAhead.value <= vBehind.value + 1e-9, 'ahead: timing leans slower than when behind');
check(vAheadE.kind === VOTE_SET && vAheadE.value < CFG.omega, 'ahead (exact): timing asks for a speed below the current one');

console.log(ok ? 'OK: timing bot spends the window on red, as designed' : 'SOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
