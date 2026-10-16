// js/warp.js plays a bot's turn out in a copy of the game before the throw reaches the
// board, reloads the copy when the line is not good enough, and stops after a limited
// number of tries. Every part of that sentence is a claim — that a copy plays a turn
// exactly as the game does, that the page can hold the real board still while it works,
// and that the limits are the ones asked for — and this file is where they are checked,
// against the modules the page runs.
// Run: node experiments/time-warp.js [tries] [turns] [goal] [snapshots]
//
//	1 the copy's turn is the game's turn, bit for bit, at the handoff
//	2 the line the search settles on is never worse than the greedy line on its own measure
//	3 every ranked line is played out, and warpGoal buys the ladder (warpTries = budget)
//	4 a frame slice is one frame of the copy and where the frames are cut does not change the pick
//	5 a look-ahead with one line to look at is the same game as no look-ahead at all
//	6 a frozen board is frozen, and a table of bots plays a whole game with it on
//
// The last section is what the settings need as a default: what a try costs at each
// horizon, and how much better the looked-ahead line is than the greedy one.
Object.assign(globalThis, require('../js/physics.js'), require('../js/score.js'), require('../js/players.js'),
	require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'), require('../js/vote.js'),
	require('../js/game.js'), require('../js/warp.js'));
const TRIES = clamp(parseInt(process.argv[2], 10) || CFG.warpTries, 1, WARP_MAX_TRIES);
const TURNS = process.argv[3] === undefined ? CFG.warpTurns : clamp(Math.round(parseFloat(process.argv[3])), 0, 8);
const GOAL = process.argv[4] === undefined ? CFG.warpGoal : parseFloat(process.argv[4]);
const SNAPS = parseInt(process.argv[5], 10) || 10;
const TABLE = (process.env.KEROT_TABLE || 'keeper,hunter,balanced').split(',');
const SCHEMA = process.env.KEROT_SCHEMA || 'classic';
const now = () => Number(process.hrtime.bigint()) / 1e6;
let fails = 0;
function ok(name, cond, note) {
	console.log((cond ? 'ok   ' : 'FAIL ') + name + (note ? '  — ' + note : ''));
	if (!cond) fails++;
}
function timed(f) { const t = now(); f(); return now() - t; }

// A game with a cfg of its own: the shared CFG is what closeVote writes, so two boards in
// one process would otherwise steer each other's disk speed. botDelay 5 s leaves every
// seat armed and unmoving, so a test can hand it a stroke and start both boards on the
// turn at the same instant.
function mkGame(over) {
	const cfg = Object.assign({}, CFG, { diskSchema: SCHEMA, ballsPerPlayer: 4, warpTries: TRIES, warpTurns: TURNS, warpGoal: GOAL }, over || {});
	const g = createGame({ world: createWorld(cfg), roster: createRoster(TABLE, cfg.ballsPerPlayer), cfg: cfg });
	g.reset(); // as js/main.js does at boot: it is what seats the first puck
	return g;
}
// One frame, in the order js/main.js runs the real game; a copy steps the same 8 × 1/480 s.
function frame(g) {
	g.tick(WARP_TICK * g.cfg.h);
	if (g.planning) return true;
	g.beforeSteps();
	for (let j = 0; j < WARP_TICK; j++) stepWorld(g.world, g.cfg.h);
	g.afterSteps(WARP_TICK * g.cfg.h);
	return false;
}
function toAim(g) {
	for (let k = 0; k < 4000 && !(g.state === 'aim' && g.pending >= 0); k++) frame(g);
	return g.state === 'aim' && g.pending >= 0;
}
// The seat's own greedy line and the shortlist the look-ahead is handed: the search the
// game would run, asked for out loud so a test can be compared against it.
function aimLine(g) {
	if (g.state === 'scored') g.reset();
	toAim(g);
	const rank = makeStrokeRank();
	const v = chooseStroke(g.roster[g.turn].type, g.world, g.cfg, g.pending, g.pred, makeRng(7), g.roster, rank);
	// chooseStroke answers with one shared scratch object, so a stroke that is kept for
	// later has to be its own copy — otherwise every snapshot ends up holding the last one.
	return { rank: rank, v: { vx: v.vx, vy: v.vy } };
}
// Throws the stroke the caller holds and runs the turn to the frame the resolve ends on,
// which is where a rollout of `warpTurns: 1` stops too.
function playTurn(g, v) {
	g.setAimVel(v.vx, v.vy);
	g.commitThrow();
	for (let k = 0; k < 4000 && g.state === 'resolve'; k++) frame(g);
}
// Everything a turn can leave behind: the board, the scores, the flow around it.
function worldDiff(a, b) {
	const out = [];
	for (const k of Object.keys(a)) {
		const va = a[k], vb = b[k];
		if (va instanceof Float64Array || va instanceof Int32Array || va instanceof Uint32Array || va instanceof Uint8Array) {
			for (let i = 0; i < Math.max(a.n, b.n); i++) if (va[i] !== vb[i]) { out.push(k + '[' + i + '] ' + va[i] + ' ≠ ' + vb[i]); break; }
		} else if (typeof va === 'number' && va !== vb) out.push(k + ' ' + va + ' ≠ ' + vb);
		else if (typeof va === 'boolean' && va !== vb) out.push(k + ' ' + va + ' ≠ ' + vb);
	}
	return out.join(', ');
}
function rosterDiff(a, b) {
	const out = [];
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		for (const k of ['score', 'balls', 'type']) if (a[i][k] !== b[i][k]) out.push('seat' + i + '.' + k + ' ' + a[i][k] + ' ≠ ' + b[i][k]);
	}
	return out.join(', ');
}
function gameDiff(a, b) {
	return worldDiff(a.world, b.world) + rosterDiff(a.roster, b.roster) +
		(a.turn !== b.turn ? ' · turn ' + a.turn + ' ≠ ' + b.turn : '') +
		(a.state !== b.state ? ' · state ' + a.state + ' ≠ ' + b.state : '') +
		(a.pending !== b.pending ? ' · pending ' + a.pending + ' ≠ ' + b.pending : '');
}
// The ruler warp.js prices a line on: one ball's annuity over the windows left, with the
// windows counted from the snapshot — so a test uses the count the search itself saw.
function ballValue(cfg, turns) {
	return Math.PI * cfg.puckR * cfg.puckR * diskMeanRed(cfg) * (2 + 0.9 * cfg.handoffT * turns);
}
function ballsLeft(g) {
	let n = 0;
	for (const s of g.roster) n += s.balls;
	return n;
}

// --- 1 the copy's turn is the game's turn ------------------------------------------
function parityGate() {
	const W = createWarp(), A = mkGame({ warp: false, botDelay: 5 });
	for (let i = 0; i < 3; i++) {
		const { rank, v } = aimLine(A); // each turn played out leaves a different board for the next
		if (!W.begin(A, A.turn, rank)) { ok('the planner had lines to look at', false, 'one line only'); continue; }
		W.tryOne(v.vx, v.vy, 1);
		playTurn(A, v);
		const d = gameDiff(W.sim, A);
		ok('the copy plays the turn the game plays (' + v.vx.toFixed(3) + '/' + v.vy.toFixed(3) + ')', d === '',
			d || A.world.t.toFixed(6) + ' s, ' + A.world.n + ' pucks, ' + A.world.thrown + ' thrown');
	}
}

// --- 2 the search on its own ruler --------------------------------------------------
function searchGate() {
	const A = mkGame({ warp: false, botDelay: 5 });
	const W = createWarp();
	const spread = [], value = [];
	let worse = 0, slowest = 0, changed = 0, seats = 0, states = '';
	for (let s = 0; s < SNAPS; s++) {
		const { rank, v } = aimLine(A);
		if (!W.begin(A, A.turn, rank)) { playTurn(A, v); continue; }
		seats++;
		const ruler = ballValue(A.cfg, ballsLeft(A));
		const greedyGain = W.tryOne(v.vx, v.vy, TURNS);
		const cost = timed(() => W.runAll());
		if (W.gain < greedyGain - 1e-9) worse++;
		slowest = Math.max(slowest, cost / W.tries);
		if (W.tries > 1 && (Math.abs(W.vx - v.vx) > 1e-12 || Math.abs(W.vy - v.vy) > 1e-12)) changed++;
		spread.push((W.gain - greedyGain) / ruler);
		value.push(W.gain / ruler);
		states += ' ' + W.sim.state + (W.sim.state === 'aim' && W.sim.pending < 0 ? ' unarmed' : '');
		playTurn(A, { vx: W.vx, vy: W.vy }); // the board follows the line the search took
	}
	ok('no looked-ahead line is worse than the greedy one', worse === 0, worse + ' of ' + seats + ' seats');
	ok('a rollout stops where a turn stops', /aim/.test(states) === false || !/ unarmed/.test(states), states.trim());
	ok('a try is bounded work', slowest < 250, slowest.toFixed(1) + ' ms/try at ' + TURNS + ' turn horizon');
	return { spread: spread, value: value, changed: changed, seats: seats };
}

// --- 3 the two limits are the limits asked for -------------------------------------
function limitGate() {
	const A = mkGame({ warp: false, botDelay: 5 });
	const W = createWarp();
	const { rank } = aimLine(A);
	// The comparison is the whole search: a goal of nothing still plays out every ranked
	// line, and it is the ladder it skips. A goal out of reach buys the ladder as well,
	// which is the budget warpTries caps — the shortlist first, the rest around its
	// winner (the ladder has WARP_LADDER.length strokes to offer).
	A.cfg.warpGoal = 0;
	W.begin(A, A.turn, rank);
	W.runAll();
	const lines = W.lines, tried0 = W.tries;
	A.cfg.warpGoal = 99;
	W.begin(A, A.turn, rank);
	W.runAll();
	ok('a goal of nothing plays out the ranked lines and skips the ladder',
		tried0 === Math.min(TRIES, lines), tried0 + ' tries of ' + lines + ' ranked lines');
	ok('a goal out of reach plays out every try', W.tries === Math.min(TRIES, lines + WARP_LADDER.length),
		W.tries + ' tries of ' + Math.min(TRIES, lines + WARP_LADDER.length) + ' on offer (' + lines + ' ranked + ladder)');
	A.cfg.warpGoal = GOAL;
	const pick = [];
	for (let r = 0; r < 2; r++) {
		W.begin(A, A.turn, rank);
		W.runAll();
		pick.push(W.vx, W.vy, W.tries);
	}
	ok('the same board searched twice gives the same line', pick[0] === pick[3] && pick[1] === pick[4] && pick[2] === pick[5],
		pick[0].toFixed(6) + '/' + pick[1].toFixed(6) + ', ' + pick[2] + ' tries');
	// warpTries 1 is the floor of the setting, and it has to mean exactly one thing: the
	// line the bot picked without looking, handed back unchanged.
	A.cfg.warpTries = 1;
	W.begin(A, A.turn, rank);
	W.runAll();
	ok('a one-try search throws the greedy line', Math.abs(W.vx - rank.vx[0]) < 1e-12 && Math.abs(W.vy - rank.vy[0]) < 1e-12);
	A.cfg.warpTries = TRIES;
}

// --- 4 the frame budget -------------------------------------------------------------
// A slice is bounded by the copy's indivisible units of work, not by a number picked by
// hand: one simulated frame (8 physics steps) and, at most, one seat answering it — a
// seat answers when it is armed, and arming happens in the frame that ends the turn
// before. Both are measured here on the board the search is about to work on, so the
// gate says what the units cost instead of asserting a figure that goes stale.
function frameGate() {
	const A = mkGame({ warp: false, botDelay: 5 });
	const W = createWarp();
	const { rank } = aimLine(A);
	const physics = timed(() => { for (let j = 0; j < 8; j++) stepWorld(A.world, A.cfg.h); });
	const answer = timed(() => {
		for (let k = 0; k < 4; k++) chooseStroke(A.roster[A.turn].type, A.world, A.cfg, A.pending, A.pred, makeRng(k + 1), A.roster, null, true);
	}) / 4;
	let worst = 0, slices = 0;
	W.begin(A, A.turn, rank);
	while (true) {
		const t = now();
		const done = W.step(0.4);
		slices++; worst = Math.max(worst, now() - t);
		if (done) break;
	}
	const pick = { vx: W.vx, vy: W.vy, tries: W.tries };
	W.begin(A, A.turn, rank);
	W.runAll();
	ok('a frame slice stays inside one frame of the copy', worst < physics + 2 * answer,
		worst.toFixed(1) + ' ms worst of ' + slices + ' slices, against a frame of ' + physics.toFixed(1) +
		' ms of physics and a ' + answer.toFixed(1) + ' ms answer');
	ok('where the frames are cut does not change the pick',
		Math.abs(pick.vx - W.vx) < 1e-12 && Math.abs(pick.vy - W.vy) < 1e-12 && pick.tries === W.tries,
		pick.tries + ' tries either way');
}

// --- 5 and 6 the game itself --------------------------------------------------------
// A game with nothing to choose between is a game without a look-ahead: warpTries 1 is
// that setting, and the two boards have to play the same throws to the last bit.
function liveGate() {
	const off = mkGame({ warp: false }), on = mkGame({ warp: true, warpTries: 1, warpGoal: 0 });
	let same = '', frames = 0;
	while (off.state !== 'scored' && frames++ < 40000) {
		frame(on);
		frame(off);
		if (same === '' && gameDiff(on, off) !== '') same = gameDiff(on, off);
	}
	ok('a one-line look-ahead is the same game as none', same === '', frames + ' frames, ' + on.world.thrown + ' throws' + (same ? ': ' + same : ''));
	// A goal out of reach is the worst case for the page: every seat searches, so the
	// board is held still a frame or two per throw — and held *still*, not stepped twice.
	const g = mkGame({ warp: true, warpGoal: 99 });
	let f = 0, frozen = 0, frozenOk = true, held = null;
	const cost = timed(() => {
		while (g.state !== 'scored' && f++ < 40000) {
			if (!frame(g)) { held = null; continue; } // the frame the throw lands on is a normal one
			frozen++;
			if (!held) { held = createWorld(g.cfg); cloneInto(held, g.world); }
			else if (worldDiff(held, g.world) !== '') frozenOk = false;
		}
	});
	ok('a board held for a search does not move', frozenOk && frozen > 0, frozen + ' frames held still of ' + f);
	ok('a table of bots plays a whole game with the look-ahead on', g.state === 'scored',
		f + ' frames, ' + g.world.thrown + ' throws, ' + (cost / Math.max(1, g.world.thrown)).toFixed(0) + ' ms per throw');
	ok('the panel has something to say about it', /time-warp/.test(g.warpStatus), g.warpStatus);
}

// A frozen board per snapshot: each one is walked a turn deeper than the last with the
// light search (an answer, not a decision) and handed the search the game would run, so
// the list covers a whole game without one test waiting on another.
function lightLine(g) {
	toAim(g);
	return chooseStroke(g.roster[g.turn].type, g.world, g.cfg, g.pending, g.pred, makeRng(3), g.roster, null, true);
}
function snapshots() {
	const out = [];
	for (let k = 0; k < SNAPS; k++) {
		const A = mkGame({ warp: false, botDelay: 5 });
		for (let d = 0; d < k; d++) playTurn(A, lightLine(A));
		const { rank, v } = aimLine(A);
		if (rank.n >= 2) out.push({ g: A, rank: rank, v: v, ruler: ballValue(A.cfg, ballsLeft(A)) });
	}
	return out;
}
// What a goal is worth asking for: the same seats searched with each goal, so the default
// can be read off the tries it buys and the line it settles on.
function calibrate() {
	const W = createWarp(), snaps = snapshots(), rows = [];
	for (const goal of [0, 0.15, 0.3, 0.5, 0.8, 1.2, 2, 99]) {
		let tries = 0, gain = 0, diff = 0, n = 0;
		for (const sn of snaps) {
			sn.g.cfg.warpGoal = goal;
			if (!W.begin(sn.g, sn.g.turn, sn.rank)) continue;
			const greedyGain = W.tryOne(sn.v.vx, sn.v.vy, TURNS);
			W.runAll();
			tries += W.tries; gain += (W.gain - greedyGain) / sn.ruler; n++;
			if (Math.abs(W.vx - sn.v.vx) > 1e-12 || Math.abs(W.vy - sn.v.vy) > 1e-12) diff++;
		}
		rows.push('goal ' + goal + ' · ' + (tries / n).toFixed(1) + ' tries · +' + (gain / n).toFixed(2) +
			' of a ball over the greedy line · another line taken on ' + diff + '/' + n);
	}
	return rows;
}
// Every line has to start from the same slate, or a search is comparing positions that
// were never the same game. The value of the first line, measured on its own and taken out
// of the search's way, is the number the search itself has to land on.
function slateGate() {
	const A = mkGame({ warp: false, botDelay: 5 });
	const W = createWarp();
	const { rank } = aimLine(A);
	W.begin(A, A.turn, rank);
	const searched = W.runAll().gain;
	// Whatever the search settled on has to be worth, measured on its own, exactly what
	// the search said it was worth: every line in a slate is read on the snapshot it was
	// launched from, so the winner's number cannot depend on how many lines it beat.
	const after = W.tryOne(W.vx, W.vy, TURNS);
	ok('a line costs the same measured or searched', Math.abs(searched - after) < 1e-12 && W.tries > 1,
		searched.toFixed(6) + ' vs ' + after.toFixed(6) + ', the pick of ' + W.tries + ' tries');
}
function quantiles(list) {
	const a = list.slice().sort((x, y) => x - y);
	const p = q => a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0;
	return 'p50 ' + p(0.5).toFixed(3) + ' · p90 ' + p(0.9).toFixed(3) + ' · max ' + p(1).toFixed(3);
}
parityGate();
const stats = searchGate();
limitGate();
frameGate();
slateGate();
liveGate();
for (const r of calibrate()) console.log(r);
console.log('\n' + SCHEMA + ' · ' + TABLE.join(',') + ' · ' + stats.seats + ' seats looked ahead · ' + TRIES + ' tries · ' +
	TURNS + ' turns · goal ' + GOAL);
console.log('what looking ahead buys over the greedy line, in ball annuities: ' + quantiles(stats.spread));
console.log('the line it settles on, same ruler: ' + quantiles(stats.value));
console.log('a different line than the greedy one on ' + stats.changed + ' of ' + stats.seats + ' seats');
console.log(fails ? fails + ' FAILURES' : 'all gates passed');
process.exit(fails ? 1 : 0);
