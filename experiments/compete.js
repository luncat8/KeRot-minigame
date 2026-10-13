// Headless bot competition: every bot takes a seat in the same game, so they play
// the same board and the same seeds. The seat order rotates from game to game —
// the seat that throws first is not the seat that scores most — and what is compared
// is the displayed score, the throws each bot needed, the recycles and the time.
// Run: node experiments/compete.js [games] [seed0]
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'));
const fs = require('fs');
const path = require('path');

const GAMES = parseInt(process.argv[2], 10) || 40;
const SEED0 = parseInt(process.argv[3], 10) || 20261013;
const BOTS = ['random', 'keeper', 'hunter'];
const TICK = 8; // score every 8 steps, as the page does (once per 60 Hz frame)

// One game, the way js/game.js plays it: seats take turns, one push each, and every
// seat is paid for the red it holds while the board resolves.
function playGame(w, pred, roster, rng) {
	const giveBack = owner => roster[owner].balls++;
	resetWorld(w);
	for (const s of roster) { s.balls = CFG.ballsPerPlayer; s.score = 0; }
	let turn = 0, recycled = 0;
	for (;;) {
		const seat = nextSeat(roster, turn);
		if (seat < 0) break;
		turn = seat;
		roster[turn].balls--;
		const i = spawnPuck(w, CFG.launchX, CFG.launchY, turn);
		if (i < 0) { roster[turn].balls = 0; continue; } // board full: the seat is out
		const s = chooseStroke(roster[turn].type, w, CFG, i, pred, rng);
		throwPuck(w, i, s.vx, s.vy);
		let t = 0;
		while (!isSettled(w) && t < CFG.handoffT) {
			for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
			scoreTick(w, roster, TICK * CFG.h);
			t += TICK * CFG.h;
		}
		recycled += recyclePucks(w, CFG.recycleMode, giveBack);
		turn = (turn + 1) % roster.length;
		if (w.thrown >= CFG.maxThrows) break;
	}
	beginSettle(w);
	while (!w.settled) {
		for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
		scoreTick(w, roster, TICK * CFG.h);
	}
	recycled += recyclePucks(w, CFG.recycleMode, giveBack);
	return { thrown: w.thrown, recycled: recycled, board: w.n, t: w.t };
}

function stats(xs) {
	const n = xs.length;
	const mean = xs.reduce((a, b) => a + b, 0) / n;
	const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
	return { mean, std, min: Math.min(...xs), max: Math.max(...xs) };
}

function run() {
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	const roster = createRoster(BOTS, CFG.ballsPerPlayer);
	const acc = {};
	for (const b of BOTS) acc[b] = { shown: [], raw: [], wins: 0 };
	const mss = [], throwns = [], recycleds = [], boards = [], times = [];
	for (let g = 0; g < GAMES; g++) {
		// Rotate the seats: with the roster shifted one place each game, no bot is
		// stuck in the seat that throws first (or last).
		for (let i = 0; i < roster.length; i++) roster[i].type = BOTS[(i + g) % BOTS.length];
		const t0 = process.hrtime.bigint();
		const r = playGame(w, pred, roster, makeRng(SEED0 + g * 7919));
		mss.push(Number(process.hrtime.bigint() - t0) / 1e6);
		throwns.push(r.thrown); recycleds.push(r.recycled); boards.push(r.board); times.push(r.t);
		const best = leader(roster);
		for (let i = 0; i < roster.length; i++) {
			const a = acc[roster[i].type];
			a.shown.push(displayScore(CFG, roster.length, roster[i].score));
			a.raw.push(roster[i].score);
			if (i === best) a.wins++;
		}
	}
	const out = [];
	for (const b of BOTS) {
		const a = acc[b], s = stats(a.shown), raw = stats(a.raw);
		out.push({ name: b, games: GAMES, scoreMean: s.mean, scoreStd: s.std, scoreMin: s.min, scoreMax: s.max, rawMean: raw.mean, winPct: 100 * a.wins / GAMES, msMean: stats(mss).mean });
	}
	return { out, throws: stats(throwns), recycled: stats(recycleds), board: stats(boards), t: stats(times) };
}

const t0 = Date.now();
const r = run();
const results = r.out;
const out = {
	date: new Date().toISOString(),
	config: {
		omega: CFG.omega, muK: CFG.muK, muS: CFG.muS,
		vMin: CFG.vMin, vMax: CFG.vMax, recycleMode: CFG.recycleMode,
		ballsPerPlayer: CFG.ballsPerPlayer, seats: BOTS.length, maxThrows: CFG.maxThrows, h: CFG.h,
		games: GAMES, seed0: SEED0,
		note: 'score = displayed 0..' + CFG.scoreDisplayMax + ' (red area x time); seats rotate every game',
	},
	bots: results,
	game: { throwsMean: r.throws.mean, recycledMean: r.recycled.mean, boardMean: r.board.mean, timeMean: r.t.mean },
};
const dir = path.join(__dirname, 'results');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'competition.json'), JSON.stringify(out, null, '\t') + '\n');
const csv = path.join(dir, 'history.csv');
if (!fs.existsSync(csv)) fs.writeFileSync(csv, 'date,bot,games,scoreMean,scoreStd,scoreMin,scoreMax,rawMean,winPct,msPerGame,throwsMean,recycledMean,boardMean,simTimeMean,recycleMode,seed0\n');
for (const b of results) {
	fs.appendFileSync(csv, [
		out.date, b.name, b.games, b.scoreMean.toFixed(4), b.scoreStd.toFixed(4),
		b.scoreMin.toFixed(1), b.scoreMax.toFixed(1), b.rawMean.toFixed(2), b.winPct.toFixed(1), b.msMean.toFixed(1),
		r.throws.mean.toFixed(2), r.recycled.mean.toFixed(2), r.board.mean.toFixed(2),
		r.t.mean.toFixed(2), CFG.recycleMode, SEED0,
	].join(',') + '\n');
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('bot', 9) + pad('score 0..' + CFG.scoreDisplayMax, 26) + pad('win%', 7) + pad('raw', 9) + 'ms/game');
for (const b of results) {
	console.log(pad(b.name, 9)
		+ pad(b.scoreMean.toFixed(0) + ' ± ' + b.scoreStd.toFixed(0) + ' [' + b.scoreMin + ',' + b.scoreMax + ']', 26)
		+ pad(b.winPct.toFixed(0), 7) + pad(b.rawMean.toFixed(0), 9) + b.msMean.toFixed(0));
}
console.log(pad('game', 9) + pad(r.throws.mean.toFixed(1) + ' throws, ' + r.recycled.mean.toFixed(1) + ' recycled, ' +
	r.board.mean.toFixed(1) + ' on the board, ' + r.t.mean.toFixed(1) + ' s', 26));
console.log('OK (' + GAMES + ' games x ' + BOTS.length + ' seats in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s) -> experiments/results/competition.json + history.csv');
