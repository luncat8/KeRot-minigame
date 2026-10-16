// What a look-ahead's ranking is worth against real answers. Its rollouts cannot pay a
// full search for every seat they play (js/bots.js chooseStroke is ~190 ms against a
// rollout's ~13 ms per turn of physics), so the copy's seats answer with the *light*
// search — the same policy at a fraction of the samples. This takes the shortlist the
// planner works through, prices every line twice — once in the planner's own rollout
// (light replies, `W.tryOne`) and once with every later seat playing the real search —
// and asks whether the two rulers order the lines the same way, and what the line the
// light ruler picks is worth on the ruler of the game.
//
// It is a measurement, not a gate: it is the cheap way to see whether a reply policy can
// rank lines usefully before spending a warp-wins run on it, and the answer to "is the
// look-ahead's optimism about its answers what costs it games".
// Run: node experiments/warp-replies.js [boards] [schema] [table] [turns]
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
const BOARDS = parseInt(process.argv[2], 10) || 12;
const SCHEMA = process.argv[3] || 'classic';
const TABLE = (process.argv[4] || 'keeper,hunter,balanced').split(',');
const TURNS = process.argv[5] === undefined ? CFG.warpTurns : clamp(Math.round(parseFloat(process.argv[5])), 1, 8);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const stable = new Float64Array(CFG.maxPlayers);

// A game nothing plays by itself: every throw is handed to it, and the ones that are not
// the candidate are the real search, so the answers a line meets here are the answers the
// live game would give it. Its own cfg, because closeVote writes the module CFG.
function mkGame() {
	const cfg = Object.assign({}, CFG, {
		diskSchema: SCHEMA, ballsPerPlayer: 4, speedVote: 'off', botDelay: 1e9, warp: false,
	});
	const g = createGame({ world: createWorld(cfg), roster: createRoster(TABLE, cfg.ballsPerPlayer), cfg: cfg });
	g.reset();
	return g;
}
// One frame, in the order js/main.js runs the real game. Nothing here holds the board:
// a hand-driven turn is thrown as soon as the seat is armed.
function frame(g) {
	g.tick(WARP_TICK * g.cfg.h);
	if (g.planning) return;
	g.beforeSteps();
	for (let j = 0; j < WARP_TICK; j++) stepWorld(g.world, g.cfg.h);
	g.afterSteps(WARP_TICK * g.cfg.h);
}
function toAim(g) {
	for (let k = 0; k < 4000 && !(g.state === 'aim' && g.pending >= 0); k++) frame(g);
	return g.state === 'aim' && g.pending >= 0;
}
// The seat's own greedy line and the shortlist the planner is handed, asked for out
// loud. chooseStroke answers with a shared scratch record, so the stroke is copied.
function aimLine(g) {
	toAim(g);
	const rank = makeStrokeRank();
	const v = chooseStroke(g.roster[g.turn].type, g.world, g.cfg, g.pending, g.pred, makeRng(7), g.roster, rank);
	return { rank: rank, v: { vx: v.vx, vy: v.vy } };
}
function playTurn(g, v) {
	g.setAimVel(v.vx, v.vy);
	g.commitThrow();
	for (let k = 0; k < 4000 && g.state === 'resolve'; k++) frame(g);
}
function lightLine(g, seed) {
	toAim(g);
	return chooseStroke(g.roster[g.turn].type, g.world, g.cfg, g.pending, g.pred, makeRng(3 + seed * 977), g.roster, null, true);
}
function ballsLeft(g) {
	let n = 0;
	for (const s of g.roster) n += s.balls;
	return n;
}

// The ruler this measurement judges lines on, stated here so it is not the planner's own:
// what the seat has banked by the end of the playout, plus the annuity its pucks still
// pay for the windows the game has left (counted at the snapshot, so every line is read
// over the same horizon), less the mean of the same for its opponents. One parked puck's
// annuity is the unit, as everywhere else.
function positionValue(w, score, seat, future) {
	stableRates(w, stable);
	let other = 0, n = 0;
	for (let i = 0; i < score.length; i++) {
		if (i === seat) continue;
		other += score[i] + stable[i] * future; n++;
	}
	return score[seat] + stable[seat] * future - (n > 0 ? other / n : 0);
}
function scoreInto(g, out) {
	for (let i = 0; i < g.roster.length; i++) out[i] = g.roster[i].score;
	return out;
}
// Plays one stroke out and then hands the later turns to `answer` (the real search, or
// the light one), up to `turns` turns. The answer seeds are a function of the board and
// of the turn they are thrown on, so two lines meet the same answers and a difference is
// the line and not a different roll of the dice.
function playOut(g, v, board, future, seat, out, light) {
	let thrown = 0;
	const pred = g.pred;
	g.setAimVel(v.vx, v.vy);
	g.commitThrow();
	thrown++;
	for (let k = 0; k < 40000 && thrown < TURNS; k++) {
		frame(g);
		if (g.state !== 'aim' || g.pending < 0) continue;
		const s = chooseStroke(g.roster[g.turn].type, g.world, g.cfg, g.pending, pred, makeRng(board * 977 + thrown * 7919), g.roster, null, light);
		g.setAimVel(s.vx, s.vy);
		g.commitThrow();
		thrown++;
	}
	return positionValue(g.world, scoreInto(g, out), seat, future);
}
// Kendall's tau on one board's two orderings of the same lines: +1 is the two rulers
// agreeing completely, −1 is one of them reading the board upside down.
function tauOf(a, b) {
	let con = 0, dis = 0;
	for (let i = 0; i < a.length; i++) {
		for (let j = i + 1; j < a.length; j++) {
			const d = (a[i] - a[j]) * (b[i] - b[j]);
			if (d > 0) con++; else if (d < 0) dis++;
		}
	}
	return (con - dis) / Math.max(1, con + dis);
}

let g = mkGame();
const W = createWarp();
const endScore = new Float64Array(CFG.maxPlayers);
const taus = [], lightOverGreedy = [], bestOverGreedy = [];
// What the seat would have got from comparing only the first k lines of its own ranking
// (k = 1 is the greedy line it throws without looking): the line the light ruler picks
// among those k, scored by the game. This is the question a smaller warpTries asks —
// fewer lines compared, so more budget per line — answered without a warp-wins run.
const prefix = [];
let agree = 0, lightIsBest = 0, lightInTop2 = 0, boards = 0, changed = 0, msLight = 0, msReal = 0;
let bothRight = 0, optimism = 0, pessimism = 0;
// What one answer costs each way, on a board walked into the middle of the game.
{
	toAim(g);
	const t0 = now();
	for (let k = 0; k < 20; k++) chooseStroke(g.roster[g.turn].type, g.world, g.cfg, g.pending, g.pred, makeRng(k + 1), g.roster, null, true);
	msLight = (now() - t0) / 20;
	const t1 = now();
	for (let k = 0; k < 20; k++) chooseStroke(g.roster[g.turn].type, g.world, g.cfg, g.pending, g.pred, makeRng(k + 1), g.roster, null, false);
	msReal = (now() - t1) / 20;
}
// A board per game, walked a few turns in by the light search with a per-board seed: a
// deterministic walk on one game would only ever hand over boards from that one game,
// and half of them are the same position read twice.
for (let board = 0; board < BOARDS; board++) {
	g = mkGame();
	for (let d = 0; d < 2 + board % 6; d++) playTurn(g, lightLine(g, board));
	const { rank, v } = aimLine(g);
	if (!W.begin(g, g.turn, rank)) continue;
	const future = 2 + 0.9 * g.cfg.handoffT * ballsLeft(g);
	const seat = g.turn;
	const snapWorld = createWorld(g.cfg), snapFlow = {};
	const snapBalls = new Float64Array(CFG.maxPlayers), snapScore = new Float64Array(CFG.maxPlayers);
	cloneInto(snapWorld, g.world);
	g.saveFlow(snapFlow);
	for (let i = 0; i < g.roster.length; i++) { snapBalls[i] = g.roster[i].balls; snapScore[i] = g.roster[i].score; }
	const lines = [];
	for (let a = 0; a < rank.n; a++) lines.push({ vx: rank.vx[a], vy: rank.vy[a] });
	if (lines.length < 3) continue;
	boards++;
	const ruler = future * Math.PI * g.cfg.puckR * g.cfg.puckR * diskMeanRed(g.cfg);
	const rewind = () => {
		cloneInto(g.world, snapWorld);
		for (let i = 0; i < g.roster.length; i++) { g.roster[i].balls = snapBalls[i]; g.roster[i].score = snapScore[i]; }
		g.loadFlow(snapFlow);
	};
	// The planner's own rollout for every line, then the game's answer to the same lines.
	// A rewound board between them, so a line is read on the position the planner read it
	// on and not on whatever the line before it left behind.
	const rolled = lines.map(ln => W.tryOne(ln.vx, ln.vy, TURNS));
	const real = [];
	for (const ln of lines) { real.push(playOut(g, ln, board, future, seat, endScore, false)); rewind(); }
	const li = rolled.indexOf(Math.max(...rolled)), ri = real.indexOf(Math.max(...real));
	const sorted = real.slice().sort((a, b) => b - a);
	const gi = lines.findIndex(ln => Math.abs(ln.vx - v.vx) < 1e-12 && Math.abs(ln.vy - v.vy) < 1e-12);
	const g0 = Math.max(0, gi);
	if (gi >= 0) {
		changed += (Math.abs(lines[li].vx - v.vx) > 1e-12 || Math.abs(lines[li].vy - v.vy) > 1e-12) ? 1 : 0;
		lightOverGreedy.push((real[li] - real[g0]) / ruler);
		bestOverGreedy.push((sorted[0] - real[g0]) / ruler);
	}
	for (let k = 1; k <= lines.length; k++) {
		let bi = 0;
		for (let a = 1; a < k; a++) if (rolled[a] > rolled[bi]) bi = a;
		if (!prefix[k]) prefix[k] = [];
		if (gi >= 0) prefix[k].push((real[bi] - real[g0]) / ruler);
	}
	if (li === ri) agree++;
	if (li === real.indexOf(sorted[0])) lightIsBest++;
	if (real[li] === sorted[0] || real[li] === sorted[1]) lightInTop2++;
	// On the boards where the rollout overrode the greedy line: did the game agree that
	// the line it took was the better one? The planner's own margin and the game's are
	// different rulers (one is the seat's, one is this file's) but their signs are
	// comparable, and that is the optimism that costs games, if it is there.
	if (gi >= 0 && (Math.abs(lines[li].vx - v.vx) > 1e-12 || Math.abs(lines[li].vy - v.vy) > 1e-12)) {
		const hoped = rolled[li] - rolled[g0], got = real[li] - real[g0];
		if (hoped > 0 && got > 0) bothRight++; else if (hoped > 0 && got < 0) optimism++; else if (hoped < 0 && got > 0) pessimism++;
	}
	taus.push(tauOf(rolled, real));
	console.log('board ' + board + ' · ' + lines.length + ' lines · the rollout picks ' + (li + 1) + ', the game picks ' + (ri + 1) +
		' · the game scores the rollout\'s line ' + (((real[li] - real[g0]) / ruler) >= 0 ? '+' : '−') +
		Math.abs((real[li] - real[g0]) / ruler).toFixed(2) + ' of a ball over the greedy one' + (li === ri ? ' · same line' : ''));
}
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
console.log('\n' + SCHEMA + ' · ' + TABLE.join(',') + ' · ' + boards + ' boards · ' + TURNS + ' turns · ' + changed + ' of which the rollout changed the pick');
console.log('an answer costs ' + msLight.toFixed(1) + ' ms light against ' + msReal.toFixed(0) + ' ms searching (' + (msReal / msLight).toFixed(0) + '×)');
console.log('the rollout picks the game\'s own best line on ' + agree + ' of ' + boards + ' boards (' + lightIsBest + ' top, ' + lightInTop2 + ' in the top two)');
console.log('the line the rollout picks is worth ' + mean(lightOverGreedy).toFixed(3) + ' of a ball more than the greedy line on the game\'s ruler' +
	' (the best line on the board would have been ' + mean(bestOverGreedy).toFixed(3) + ')');
console.log('rank agreement: mean tau ' + mean(taus).toFixed(3) + ' · positive on ' + taus.filter(t => t > 0).length + ' of ' + taus.length +
	', negative on ' + taus.filter(t => t < 0).length);
console.log('where the rollout overrode the greedy line (' + (bothRight + optimism + pessimism) + ' boards): the game agreed on ' + bothRight +
	', the rollout was optimistic on ' + optimism + ', pessimistic on ' + pessimism);
const rows = [];
for (let k = 1; k < prefix.length; k++) if (prefix[k] && prefix[k].length) rows.push(k + ' lines: ' + mean(prefix[k]).toFixed(3));
console.log('what comparing only the first k lines of the ranking is worth over the greedy line, on the game\'s ruler: ' + rows.join(' · '));
