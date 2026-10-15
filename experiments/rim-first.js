// Decision-gap probe on rim6: on an empty board at various disk phases, what does a
// profile's chooseStroke pick (its predicted 4 s score integral), versus the best
// stroke of a fine (direction, speed) grid? The empty board makes first-throw
// decisions comparable; on rim6 the grid is theta-periodic (60 deg).
// Run: node experiments/rim-first.js [profile...]
Object.assign(globalThis,
	require('../js/field.js'), require('../js/physics.js'), require('../js/score.js'),
	require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'));
CFG.diskSchema = 'rim6';

const w = createWorld(CFG), pred = createPredictor(CFG);
const roster = createRoster(['keeper'], CFG.ballsPerPlayer);
const profiles = process.argv.slice(2);
if (!profiles.length) profiles.push('keeper', 'balanced');

function valueAt(type, theta0) {
	resetWorld(w); w.theta = theta0;
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
	roster[0].type = type;
	const s = chooseStroke(type, w, CFG, i, pred, makeRng(777), roster);
	predictStroke(pred, w, i, s.vx, s.vy, CFG.handoffT, true);
	const sp = Math.hypot(s.vx, s.vy);
	return { v: pred.scoreBySeat[0], ang: Math.atan2(s.vy, s.vx), sp: sp };
}
function gridBest(theta0) {
	resetWorld(w); w.theta = theta0;
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
	let best = -1, ang = 0, sp = 0;
	for (let da = -40; da <= 40; da += 2) {
		for (let kv = 40; kv <= 180; kv += 5) {
			const a = Math.PI + da * 0.01, v = kv * 0.01;
			predictStroke(pred, w, i, Math.cos(a) * v, Math.sin(a) * v, CFG.handoffT, true);
			if (pred.scoreBySeat[0] > best) { best = pred.scoreBySeat[0]; ang = a; sp = v; }
		}
	}
	return { v: best, ang: ang, sp: sp };
}

const deg = r => (r * 180 / Math.PI).toFixed(0) + '°';
for (const type of profiles) {
	let sumPick = 0, sumBest = 0;
	console.log(type + ': pick vs grid-best, 4 s integral x1000 (empty board, rim6)');
	for (let d = 0; d < 60; d += 10) {
		const theta0 = d * Math.PI / 180;
		const pick = valueAt(type, theta0), best = gridBest(theta0);
		sumPick += pick.v; sumBest += best.v;
		console.log('  theta0 ' + String(d).padStart(3) + '  pick ' + (1000 * pick.v).toFixed(0).padStart(5) +
			' (' + deg(pick.ang) + ', ' + pick.sp.toFixed(2) + ' m/s)  best ' + (1000 * best.v).toFixed(0).padStart(5) +
			' (' + deg(best.ang) + ', ' + best.sp.toFixed(2) + ' m/s)  gap ' + Math.round(100 * (best.v - pick.v) / best.v) + ' %');
	}
	console.log('  mean: pick ' + (6000 * sumPick / 6).toFixed(0) + ' vs best ' + (6000 * sumBest / 6).toFixed(0) +
		' -> ' + Math.round(100 * (sumBest - sumPick) / sumBest) + ' % left on the table');
}
