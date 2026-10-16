// The look-ahead in wins, not in its own units. Its rollouts answer with the quick
// policy while the real game plays searching bots, so the ball annuities it reports
// to itself are an upper bound — this plays the same seeds with nobody searching, one
// profile searching, and everybody searching, through the real game (createGame, fixed
// speed, no bot delay), seats rotating, and reads who wins.
// Run: node experiments/warp-wins.js [games] [seed0] [schema] [table]
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/vote.js'),
	require('../js/game.js'),
	require('../js/warp.js'));
const fs = require('fs');
const path = require('path');

const GAMES = parseInt(process.argv[2], 10) || 8;
const SEED0 = parseInt(process.argv[3], 10) || 20261016;
const SCHEMA = process.argv[4] || 'classic';
const TABLE = (process.argv[5] || 'keeper,hunter,balanced').split(',');
if (!DISK_SCHEMAS[SCHEMA]) { console.log('unknown disk schema ' + SCHEMA); process.exit(1); }
for (const t of TABLE) {
	if (t === 'human' || !SEAT_TYPES.includes(t)) { console.log('warp-wins needs bot seats only — ' + t + ' cannot search'); process.exit(1); }
}
const TICK = 8;
const VARIANTS = [{ name: 'none', searcher: null }, { name: 'all', searcher: '*' }];
for (const t of TABLE) if (!VARIANTS.some(v => v.searcher === t)) VARIANTS.push({ name: t + '+warp', searcher: t });

function mkGame() {
	const cfg = Object.assign({}, CFG, {
		diskSchema: SCHEMA, ballsPerPlayer: 4, speedVote: 'off', botDelay: 0,
		warp: false, warpTries: CFG.warpTries, warpTurns: CFG.warpTurns, warpGoal: CFG.warpGoal,
	});
	const g = createGame({ world: createWorld(cfg), roster: createRoster(TABLE, cfg.ballsPerPlayer), cfg: cfg });
	return g;
}
// One game, the way js/main.js runs the page: tick, then steps unless a search holds
// the board. The search flag is per turn — only the searching profile looks ahead.
function playGame(g, searcher) {
	const t0 = Number(process.hrtime.bigint()) / 1e6;
	let frames = 0, held = 0;
	while (g.state !== 'scored' && frames++ < 60000) {
		if (searcher === '*') g.cfg.warp = true;
		else if (!searcher) g.cfg.warp = false;
		else g.cfg.warp = g.roster[g.turn].type === searcher;
		g.tick(TICK * g.cfg.h);
		if (g.planning) { held++; continue; }
		g.beforeSteps();
		for (let s = 0; s < TICK; s++) stepWorld(g.world, g.cfg.h);
		g.afterSteps(TICK * g.cfg.h);
	}
	const ms = Number(process.hrtime.bigint()) / 1e6 - t0;
	return { frames: frames, held: held, throws: g.world.thrown, ms: ms };
}
function stats(xs) {
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length);
	return { mean: mean, std: std, min: Math.min(...xs), max: Math.max(...xs) };
}

const g = mkGame();
const out = [];
for (const v of VARIANTS) {
	const acc = {};
	for (const t of TABLE) acc[t] = { shown: [], raw: [], wins: 0 };
	const mss = [], helds = [], throwns = [];
	for (let game = 0; game < GAMES; game++) {
		for (let i = 0; i < g.roster.length; i++) g.roster[i].type = TABLE[(i + game) % TABLE.length];
		g.reset();
		g.setRngState(SEED0 + game * 7919); // same seeds in every variant
		const r = playGame(g, v.searcher);
		mss.push(r.ms); helds.push(r.held); throwns.push(r.throws);
		const best = g.winner;
		for (let i = 0; i < g.roster.length; i++) {
			const a = acc[g.roster[i].type];
			a.shown.push(displayScore(g.cfg, g.roster.length, g.roster[i].score));
			a.raw.push(g.roster[i].score);
			if (i === best) a.wins++;
		}
	}
	const bots = [];
	for (const t of TABLE) {
		if (bots.some(b => b.type === t)) continue;
		const a = acc[t], s = stats(a.shown), raw = stats(a.raw);
		bots.push({ type: t, scoreMean: s.mean, scoreStd: s.std, rawMean: raw.mean, winPct: 100 * a.wins / GAMES });
	}
	out.push({ name: v.name, searcher: v.searcher, bots: bots,
		game: { msMean: stats(mss).mean, heldMean: stats(helds).mean, throwsMean: stats(throwns).mean } });
}

const dir = path.join(__dirname, 'results');
fs.mkdirSync(dir, { recursive: true });
const file = 'warp-wins-' + SCHEMA + '-' + TABLE.join('-') + '.json';
fs.writeFileSync(path.join(dir, file), JSON.stringify({ date: new Date().toISOString(),
	config: { games: GAMES, seed0: SEED0, schema: SCHEMA, table: TABLE,
		warpTries: CFG.warpTries, warpTurns: CFG.warpTurns, warpGoal: CFG.warpGoal,
		note: 'same seeds in every variant; seats rotate every game; fixed speed, no bot delay' },
	variants: out }, null, '\t') + '\n');
const base = {};
for (const b of out[0].bots) base[b.type] = b;
for (const v of out) {
	console.log('--- ' + v.name + ' (' + GAMES + ' games, ' + v.game.msMean.toFixed(0) + ' ms/game, ' +
		v.game.heldMean.toFixed(0) + ' frames held, ' + v.game.throwsMean.toFixed(1) + ' throws)');
	for (const b of v.bots) {
		const d = v.searcher === b.type ? '  Δwins ' + (b.winPct - base[b.type].winPct).toFixed(0) + 'pp Δscore ' +
			(b.scoreMean - base[b.type].scoreMean).toFixed(0) : '';
		console.log('  ' + b.type.padEnd(10) + b.scoreMean.toFixed(0).padStart(4) + ' ± ' + b.scoreStd.toFixed(0).padEnd(4) +
			b.winPct.toFixed(0).padStart(5) + '% wins' + d);
	}
}
console.log('OK -> experiments/results/' + file);
