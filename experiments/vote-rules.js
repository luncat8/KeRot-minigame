// The speed rules compared through the real game (js/game.js): the same bot table and
// the same seeds under every rule — a fixed speed, a vote every turn or every round,
// votes as a change or as an exact speed. It measures what a rule does to a game:
// how often the speed is voted and how far it moves, the riders a tally sheds (the
// ramp's own friction test, js/physics.js), the pace (seconds of play per game) and
// who wins. The table rotates every game, so no profile always throws first.
// Run: node experiments/vote-rules.js [games] [schema] [table] [variant,...]
//   table: a comma list of bot profiles (default keeper,hunter,balanced,random)
//   variants: off, turn-delta, turn-exact, round-delta, round-exact (default all)
// Writes experiments/results/vote-rules-<schema>-<table>.json.
Object.assign(globalThis, require('../js/physics.js'), require('../js/score.js'), require('../js/players.js'),
	require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'), require('../js/vote.js'));
const fs = require('fs'), path = require('path');
const GAME_SRC = fs.readFileSync(path.join(__dirname, '../js/game.js'), 'utf8')
	.replace(/^if \(typeof module !== 'undefined'\).*$/m, '')
	.replace(/\bconst (Game) =/, 'globalThis.$1 =');
const GAMES = parseInt(process.argv[2], 10) || 12;
const SCHEMA = process.argv[3] || 'classic';
const TABLE = (process.argv[4] || 'keeper,hunter,balanced,random').split(',');
const VARIANTS = (process.argv[5] || 'off,turn-delta,turn-exact,round-delta,round-exact').split(',');
const OM0 = CFG.omega, holdG = () => muSEff(CFG) * CFG.g;
CFG.diskSchema = SCHEMA;

// Riders a tally sheds on its ramp, by the same test the physics runs every step.
function shedByRamp(w, from, to) {
	const top = Math.max(from, to), acc = Math.hypot(top * top, (to - from) / CFG.spinRampT);
	let n = 0;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] === ST_LOCKED && Math.hypot(w.x[i] - CFG.diskX, w.y[i] - CFG.diskY) * acc > holdG()) n++;
	}
	return n;
}
function playVariant(variant) {
	const [rule, mode] = variant === 'off' ? ['off', 'delta'] : variant.split('-');
	CFG.speedVote = rule; CFG.voteMode = mode; CFG.omega = OM0;
	eval(GAME_SRC); // a fresh Game: its seed restarts, so every variant plays the same seeds
	const out = { variant, games: 0, throws: 0, simT: 0, votes: 0, changes: 0, absDelta: 0, shed: 0, omMin: Infinity, omMax: -Infinity, omMean: 0, ms: 0 };
	const byBot = {};
	for (const b of TABLE) byBot[b] = { score: 0, wins: 0, games: 0 };
	const t0 = Date.now();
	for (let g = 0; g < GAMES; g++) {
		const table = TABLE.map((_, k) => TABLE[(k + g) % TABLE.length]);
		Game.setSeatTypes(table);
		const w = Game.world;
		let omT = 0, playT = 0, guard = 0;
		while (Game.state !== 'scored' && guard++ < 200000) {
			Game.tick(1 / 60);
			Game.beforeSteps();
			for (let s = 0; s < 8; s++) stepWorld(w, CFG.h);
			const was = Game.state, from = CFG.omega;
			Game.afterSteps(8 * CFG.h);
			if (!w.settling) { omT += spinNow(w) * 8 * CFG.h; playT += 8 * CFG.h; } // the speed in play, not the spin-down
			if (was !== 'vote' && Game.state === 'vote') out.votes++;
			if (was === 'vote' && Game.state !== 'vote' && CFG.omega !== from) {
				out.changes++; out.absDelta += Math.abs(CFG.omega - from);
				out.shed += shedByRamp(w, from, CFG.omega);
			}
			out.omMin = Math.min(out.omMin, CFG.omega); out.omMax = Math.max(out.omMax, CFG.omega);
		}
		out.games++; out.throws += w.thrown; out.simT += w.t; out.omMean += omT / playT;
		const win = Game.winner;
		for (let k = 0; k < table.length; k++) {
			const b = byBot[table[k]];
			b.games++; b.score += displayScore(CFG, table.length, Game.roster[k].score);
			if (k === win) b.wins++;
		}
	}
	out.ms = (Date.now() - t0) / GAMES;
	const n = out.games;
	return {
		variant, rule, mode, games: n, throws: out.throws / n, simT: out.simT / n, votes: out.votes / n, changes: out.changes / n,
		meanAbsDelta: out.changes ? out.absDelta / out.changes : 0, shedPerGame: out.shed / n,
		omegaMin: out.omMin, omegaMax: out.omMax, omegaMean: out.omMean / n, msPerGame: out.ms,
		bots: TABLE.map(b => ({ name: b, score: byBot[b].score / byBot[b].games, winPct: 100 * byBot[b].wins / byBot[b].games })),
	};
}

const results = VARIANTS.map(playVariant);
const pad = (s, n) => String(s).padEnd(n);
console.log(SCHEMA + '  ' + TABLE.join(',') + '  ' + GAMES + ' games per rule, table rotates, ω starts at ' + OM0);
console.log(pad('rule', 12) + pad('s/game', 8) + pad('throws', 8) + pad('votes', 7) + pad('moved', 7) + pad('|Δω|', 7) + pad('ω mean [min, max]', 22) +
	pad('shed', 6) + TABLE.map(b => pad(b + ' (win%)', 18)).join(''));
for (const r of results) {
	console.log(pad(r.variant, 12) + pad(r.simT.toFixed(1), 8) + pad(r.throws.toFixed(1), 8) + pad(r.votes.toFixed(1), 7) + pad(r.changes.toFixed(1), 7) +
		pad(r.meanAbsDelta.toFixed(3), 7) + pad(r.omegaMean.toFixed(3) + ' [' + r.omegaMin.toFixed(2) + ', ' + r.omegaMax.toFixed(2) + ']', 22) +
		pad(r.shedPerGame.toFixed(2), 6) + r.bots.map(b => pad(b.score.toFixed(0) + ' (' + b.winPct.toFixed(0) + ')', 18)).join(''));
}
const file = path.join(__dirname, 'results', 'vote-rules-' + SCHEMA + '-' + TABLE.join('-') + '.json');
fs.writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), schema: SCHEMA, games: GAMES, table: TABLE, omega0: OM0,
	voteT: CFG.voteT, spinRampT: CFG.spinRampT, voteDeltaMax: CFG.voteDeltaMax, results }, null, 1));
console.log('OK -> ' + path.relative(path.join(__dirname, '..'), file));
