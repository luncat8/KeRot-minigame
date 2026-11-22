// Reproduce bot play on the 'notsobigdisk' preset vs the default board.
// Run: node experiments/repro-notsobig.js [games] [seed0]
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

const GAMES = parseInt(process.argv[2], 10) || 6;
const SEED0 = parseInt(process.argv[3], 10) || 20261013;
const BOTS = ['random', 'balanced', 'blackhole', 'retriever'];
const TICK = 8;

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
		if (i < 0) { roster[turn].balls = 0; continue; }
		const s = chooseStroke(roster[turn].type, w, CFG, i, pred, rng, roster);
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

function report(label) {
	const r = run();
	const pad = (s, n) => String(s).padEnd(n);
	console.log('\n=== ' + label + ' ===');
	console.log('board ' + CFG.boardW.toFixed(3) + 'x' + CFG.boardH.toFixed(3) + ' diskR ' + CFG.diskR.toFixed(4) +
		' puckR ' + CFG.puckR.toFixed(4) + ' omega ' + CFG.omega.toFixed(4) + ' schema ' + CFG.diskSchema +
		' zones ' + CFG.zoneStyle + ' holes ' + CFG.holeStyle + ' recycle ' + CFG.recycleMode + ' patternScale ' + patternScale(CFG).toFixed(4));
	console.log(pad('bot', 9) + pad('score 0..' + CFG.scoreDisplayMax, 26) + pad('win%', 7) + pad('raw', 9) + 'ms/game');
	for (const b of r.out) {
		console.log(pad(b.name, 9)
			+ pad(b.scoreMean.toFixed(0) + ' ± ' + b.scoreStd.toFixed(0) + ' [' + b.scoreMin + ',' + b.scoreMax + ']', 26)
			+ pad(b.winPct.toFixed(0), 7) + pad(b.rawMean.toFixed(0), 9) + b.msMean.toFixed(0));
	}
	console.log(pad('game', 9) + pad(r.throws.mean.toFixed(1) + ' throws, ' + r.recycled.mean.toFixed(1) + ' recycled, ' +
		r.board.mean.toFixed(1) + ' on the board, ' + r.t.mean.toFixed(1) + ' s', 26));
	return r;
}

// default board
applyCfg(PRESETS.default);
report('default board');

// notsobigdisk preset
const setup = parseQuery('?preset=notsobigdisk');
applyCfg(setup);
report('notsobigdisk preset');
