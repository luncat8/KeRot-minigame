// Per-seat breakdown of one roster, uniform or mixed. Same rules as compete.js:
// seats rotate every game, displayed score is what the page shows. Adds where the
// score came from — seconds on the disk, mean rate while there, locks still held at
// handoff, permanent losses, returned balls — so a profile that outscores another
// can be told apart from one that only threw first.
// Run: node experiments/matchup.js [games] [seed0] [seat0,seat1,seat2] [schema]
Object.assign(globalThis,
	require('../js/field.js'), require('../js/physics.js'), require('../js/score.js'),
	require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'));
const fs = require('fs');
const path = require('path');

const GAMES = parseInt(process.argv[2], 10) || 8;
const SEED0 = parseInt(process.argv[3], 10) || 20261013;
const BOTS = (process.argv[4] || 'random,keeper,hunter').split(',');
const SCHEMA = process.argv[5] || CFG.diskSchema;
if (!DISK_SCHEMAS[SCHEMA]) { console.log('unknown disk schema ' + SCHEMA); process.exit(1); }
CFG.diskSchema = SCHEMA;
const TICK = 8;

function playGame(w, pred, roster, rng, rows) {
	const giveBack = owner => { roster[owner].balls++; rows[owner].ret++; };
	resetWorld(w);
	for (const s of roster) { s.balls = CFG.ballsPerPlayer; s.score = 0; }
	let turn = 0;
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
			for (let p = 0; p < w.n; p++) {
				const dx = w.x[p] - CFG.diskX, dy = w.y[p] - CFG.diskY;
				if (dx * dx + dy * dy > CFG.diskR * CFG.diskR) continue;
				const row = rows[w.own[p]];
				row.diskT += TICK * CFG.h;
				row.rateSum += puckRate(w, p);
				row.rateN++;
			}
		}
		for (let p = 0; p < w.n; p++) if (w.st[p] === ST_LOCKED) rows[w.own[p]].locks++;
		recyclePucks(w, CFG.recycleMode, giveBack);
		turn = (turn + 1) % roster.length;
		if (w.thrown >= CFG.maxThrows) break;
	}
	beginSettle(w);
	while (!w.settled) {
		for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
		scoreTick(w, roster, TICK * CFG.h);
	}
	recyclePucks(w, CFG.recycleMode, giveBack);
	const best = leader(roster);
	for (let i = 0; i < roster.length; i++) {
		rows[i].shown += displayScore(CFG, roster.length, roster[i].score);
		rows[i].raw += roster[i].score;
		rows[i].lost += w.ownerLosses[i];
		if (i === best) rows[i].wins++;
		rows[i].games++;
	}
}

function run() {
	const w = createWorld(CFG), pred = createPredictor(CFG);
	const roster = createRoster(BOTS, CFG.ballsPerPlayer);
	const acc = {};
	for (const b of BOTS) acc[b] = { shown: 0, raw: 0, diskT: 0, rateSum: 0, rateN: 0, locks: 0, lost: 0, ret: 0, wins: 0, games: 0 };
	for (let g = 0; g < GAMES; g++) {
		for (let i = 0; i < roster.length; i++) roster[i].type = BOTS[(i + g) % BOTS.length];
		const rows = roster.map(s => acc[s.type]);
		// A uniform roster shares one bucket; give each seat its own row and fold after.
		const own = BOTS.length === 1 ? null : rows;
		if (own) playGame(w, pred, roster, makeRng(SEED0 + g * 7919), own);
		else {
			const tmp = roster.map(() => ({ shown: 0, raw: 0, diskT: 0, rateSum: 0, rateN: 0, locks: 0, lost: 0, ret: 0, wins: 0, games: 0 }));
			playGame(w, pred, roster, makeRng(SEED0 + g * 7919), tmp);
			const a = acc[BOTS[0]];
			for (const t of tmp) {
				a.shown += t.shown; a.raw += t.raw; a.diskT += t.diskT; a.rateSum += t.rateSum; a.rateN += t.rateN;
				a.locks += t.locks; a.lost += t.lost; a.ret += t.ret; a.wins += t.wins; a.games += t.games;
			}
		}
	}
	return acc;
}

const t0 = Date.now();
const acc = run();
const bots = [];
console.log(SCHEMA + '  ' + BOTS.join(',') + '  ' + GAMES + ' games, seats rotate');
console.log('bot        shown   raw   diskT  rate  locks  lost   ret  win%');
for (const b of BOTS) {
	const a = acc[b], n = a.games || 1;
	const row = {
		name: b, games: a.games, scoreMean: a.shown / n, rawMean: a.raw / n,
		diskT: a.diskT / n, rate: a.rateN ? a.rateSum / a.rateN : 0,
		locks: a.locks / n, lost: a.lost / n, ret: a.ret / n, winPct: 100 * a.wins / n,
	};
	bots.push(row);
	console.log(b.padEnd(10) + row.scoreMean.toFixed(0).padStart(6) + row.rawMean.toFixed(0).padStart(7) +
		row.diskT.toFixed(1).padStart(8) + row.rate.toFixed(2).padStart(6) + row.locks.toFixed(1).padStart(7) +
		row.lost.toFixed(2).padStart(6) + row.ret.toFixed(2).padStart(6) + row.winPct.toFixed(0).padStart(6));
}
const out = {
	date: new Date().toISOString(), schema: SCHEMA, games: GAMES, seed0: SEED0, seats: BOTS, bots: bots,
};
const dir = path.join(__dirname, 'results');
fs.mkdirSync(dir, { recursive: true });
const file = 'matchup-' + SCHEMA + '-' + BOTS.join('-') + '.json';
fs.writeFileSync(path.join(dir, file), JSON.stringify(out, null, '\t') + '\n');
console.log('OK (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s) -> experiments/results/' + file);
