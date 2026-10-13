// Headless bot competition: every bot plays whole games under identical rules
// and seeds; score/throw/recycle/time stats land in experiments/results/ for
// comparing new bots over time. Run: node experiments/compete.js [games] [seed0]
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'));
const fs = require('fs');
const path = require('path');

const GAMES = parseInt(process.argv[2], 10) || 40;
const SEED0 = parseInt(process.argv[3], 10) || 20261013;
const BOTS = ['random', 'keeper', 'hunter'];

function playGame(botName, seed) {
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	const rng = makeRng(seed);
	resetWorld(w);
	let recycled = 0;
	for (;;) {
		const i = spawnPuck(w, CFG.launchX, CFG.launchY);
		const s = chooseStroke(botName, w, CFG, i, pred, rng);
		throwPuck(w, i, s.vx, s.vy);
		let t = 0;
		while (!isSettled(w) && t < CFG.maxResolve) { stepWorld(w, CFG.h); t += CFG.h; }
		recycled += recyclePucks(w, CFG.recycleMode);
		if (roundOver(w, CFG)) break;
	}
	beginSettle(w);
	while (!w.settled) stepWorld(w, CFG.h);
	recycled += recyclePucks(w, CFG.recycleMode);
	return { score: totalScore(w), thrown: w.thrown, recycled, board: w.n, t: w.t };
}

function stats(xs) {
	const n = xs.length;
	const mean = xs.reduce((a, b) => a + b, 0) / n;
	const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
	return { mean, std, min: Math.min(...xs), max: Math.max(...xs) };
}

function runBot(name) {
	const scores = [], mss = [], throwns = [], recycleds = [], boards = [], times = [];
	for (let g = 0; g < GAMES; g++) {
		const t0 = process.hrtime.bigint();
		const r = playGame(name, SEED0 + g * 7919);
		mss.push(Number(process.hrtime.bigint() - t0) / 1e6);
		scores.push(r.score); throwns.push(r.thrown); recycleds.push(r.recycled);
		boards.push(r.board); times.push(r.t);
	}
	const s = stats(scores);
	return {
		name, games: GAMES,
		scoreMean: s.mean, scoreStd: s.std, scoreMin: s.min, scoreMax: s.max,
		msMean: stats(mss).mean, throwsMean: stats(throwns).mean,
		recycledMean: stats(recycleds).mean, boardMean: stats(boards).mean, timeMean: stats(times).mean,
	};
}

const t0 = Date.now();
const results = BOTS.map(runBot);
const out = {
	date: new Date().toISOString(),
	config: {
		omega: CFG.omega, muK: CFG.muK, muS: CFG.muS,
		vMin: CFG.vMin, vMax: CFG.vMax, recycleMode: CFG.recycleMode,
		poolSize: CFG.poolSize, maxThrows: CFG.maxThrows, h: CFG.h,
		games: GAMES, seed0: SEED0,
	},
	bots: results,
};
const dir = path.join(__dirname, 'results');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'competition.json'), JSON.stringify(out, null, '\t') + '\n');
const csv = path.join(dir, 'history.csv');
if (!fs.existsSync(csv)) fs.writeFileSync(csv, 'date,bot,games,scoreMean,scoreStd,scoreMin,scoreMax,msPerGame,throwsMean,recycledMean,boardMean,simTimeMean,recycleMode,seed0\n');
for (const r of results) {
	fs.appendFileSync(csv, [
		out.date, r.name, r.games, r.scoreMean.toFixed(4), r.scoreStd.toFixed(4),
		r.scoreMin.toFixed(4), r.scoreMax.toFixed(4), r.msMean.toFixed(1),
		r.throwsMean.toFixed(2), r.recycledMean.toFixed(2), r.boardMean.toFixed(2),
		r.timeMean.toFixed(2), CFG.recycleMode, SEED0,
	].join(',') + '\n');
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('bot', 9) + pad('score', 24) + pad('throws', 8) + pad('recyc', 8) + pad('board', 8) + pad('ms/game', 9) + 'sim t');
for (const r of results) {
	console.log(pad(r.name, 9)
		+ pad(r.scoreMean.toFixed(2) + ' ± ' + r.scoreStd.toFixed(2) + ' [' + r.scoreMin.toFixed(1) + ',' + r.scoreMax.toFixed(1) + ']', 24)
		+ pad(r.throwsMean.toFixed(1), 8) + pad(r.recycledMean.toFixed(1), 8) + pad(r.boardMean.toFixed(1), 8)
		+ pad(r.msMean.toFixed(0), 9) + r.timeMean.toFixed(1) + ' s');
}
console.log('OK (' + GAMES + ' games x ' + BOTS.length + ' bots in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s) -> experiments/results/competition.json + history.csv');
