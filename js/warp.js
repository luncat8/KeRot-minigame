// Time-warp: before a bot's throw reaches the real board, a copy of the game plays it
// out. The copy is made by the same factory the page runs (js/game.js createGame), so
// the look-ahead is not a model of the rules — it is the rules, stepped without drawing,
// scoring as it goes. "Undo the turn" costs nothing here: the throw went into the copy,
// and taking it back is loading the snapshot again for the next candidate.
//
// What it searches is the shortlist js/bots.js puts on the table — the greedy pick, then
// the best stroke of each other line of play — and every line of it is played out: the
// comparison is the point, and a search that stops at the first line to clear its bar
// only ever shops on the turns where the greedy pick already looks bad (measured, in
// wins, in archive/0.5.1-worklog.md). If the best of the ranked lines is still worth
// less than `warpGoal` of one ball's annuity over the snapshot, the tries that are left
// go to a ladder of perturbations around *that* winner, so the goal buys the extra look
// and not a shortcut through the comparison. Each try plays out `warpTurns` turns: the
// seat's own throw, then the seats after it answering with the *light* search (the same
// policy at every other sample: a full search per rollout seat costs ~190 ms against a
// rollout's ~13 ms a turn, and an answer that does not simulate at all is a weak one —
// measured in experiments/warp-replies.js). The board waits only as long as `warpTries`
// rollouts take.
//
// The search is spread over frames (warpFrameMs bounds one) while the real board is held
// still, so a look-ahead never drops a frame and the stroke lands on exactly the state it
// was planned against. Where the frames are cut cannot change the outcome: a try is read
// when its rollout ends, never when the budget does.
//
// Node-safe and synchronous; every buffer it uses is allocated here, once.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./physics.js'), require('./score.js'), require('./players.js'), require('./vote.js'), require('./predict.js'), require('./bots.js'), require('./game.js'));

const WARP_TICK = 8; // physics steps per simulated frame — the 60 Hz batch js/main.js runs
const WARP_MAX_TRIES = 16; // a longer list is a different setting, not a longer array
const WARP_MAX_STEPS = 480 * 90; // the fuse: no rollout runs past a minute and a half of play
// Around the winner of the comparison (the greedy stroke, when that is the winner), in
// increasing distance: half a degree of aim and 5 % of speed first (a lock band is a few
// cm/s wide), a wider swing after that.
const WARP_LADDER = [[0.03, 1], [-0.03, 1], [0, 1.05], [0, 0.95], [0.09, 1], [-0.09, 1], [0.03, 1.05], [-0.03, 0.95]];

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// The copy's roster grows and shrinks with the live one; the seats it drops go back to
// the pool, so editing the table mid-game costs no allocation. A seat keeps what a
// rollout needs to play it: who it is, what he has left, and what he has banked. Votes
// are the copy's own business, and it starts with none.
function fitRoster(roster, pool, live) {
	while (roster.length > live.length) pool.push(roster.pop());
	while (roster.length < live.length) roster.push(pool.pop() || makeSeat('random', 0));
	for (let i = 0; i < roster.length; i++) {
		const d = roster[i], s = live[i];
		d.type = s.type; d.balls = s.balls; d.score = s.score;
	}
	clearVotes(roster);
}
// A seat that has voted keeps its vote on its record until the tally closes, so a copy
// has to be wiped before every line it plays: a leftover vote is worth a disk speed, and
// the first line of a search would leave the second one starting from a different game.
function clearVotes(roster) {
	for (let i = 0; i < roster.length; i++) {
		roster[i].vote = VOTE_NONE; roster[i].voteValue = 0; roster[i].voteLabel = '';
	}
}

function createWarp() {
	const cfg = Object.assign({}, CFG);
	cfg.warp = false; cfg.botDelay = 0;
	const world = createWorld(cfg);
	const roster = [], pool = [];
	for (let k = 0; k < CFG.maxPlayers; k++) pool.push(makeSeat('random', 0));
	const sim = createGame({ world: world, roster: roster, cfg: cfg, sim: true });
	// The snapshot: the board as it stood at the throw, and the flow around it.
	const saved = createWorld(CFG);
	const flow = { state: '', turn: 0, pending: -1, resolveT: 0, voteT: 0, botT: 0, omega: 0, omegaBase: 0, rng: 0 };
	const snapBalls = new Float64Array(CFG.maxPlayers), snapScore = new Float64Array(CFG.maxPlayers);
	const snapType = [];
	for (let k = 0; k < CFG.maxPlayers; k++) snapType.push('random');
	const simScore = new Float64Array(CFG.maxPlayers), stable = new Float64Array(CFG.maxPlayers);
	const candVx = new Float64Array(WARP_MAX_TRIES), candVy = new Float64Array(WARP_MAX_TRIES);
	// The search, in the order step() walks it. `ladder` says which phase the search is
	// in: the ranked lines first (never cut short), then the perturbations around the
	// best of them if the goal is still unmet.
	const run = {
		live: null, seat: 0, n: 0, lines: 0, cap: 1, k: 0, total: 0, tried: 0, turns: 0, steps: 0, rolling: false, ladder: false, done: true,
		best: 0, bestK: 0, bestVx: 0, bestVy: 0, base: 0, future: 0, ball: 1, goal: 0, horizon: 3,
		p: BOT_PROFILES.balanced, scale: 1, recPrice: 0, lifePrice: 0, urgency: 1,
	};
	const out = { vx: 0, vy: 0, status: '' };

	// What a seat has to look forward to in a position: the terms js/bots.js prices a
	// stroke on, read off a board instead of off a prediction. Banked score and the
	// annuity the pucks it holds still pay for the windows left are weighted by the
	// terms of the seat's *own* profile — score, opportunity — and the mean enemy by its
	// denial, because a search that re-ranks every profile's lines on one generic "mine
	// minus the mean enemy" share is not pricing the style it is playing: measured, the
	// most style-bound profile (keeper: opportunity 1.2 against denial 0.15) was the one
	// the look-ahead cost the most wins. A puck gone to a hole costs its seat the throws
	// it would have had (risk) and gains the killer that much (kill), and a puck sitting
	// where the recycle rule will return it is a throw coming back. `future` is the
	// snapshot's, so every line is read on one ruler instead of on however much game was
	// left when its own rollout happened to end.
	function positionValue(w, score, s, future) {
		const p = run.p;
		stableRates(w, stable);
		let other = 0, losses = 0, n = 0;
		for (let i = 0; i < roster.length; i++) {
			if (i === s) continue;
			other += score[i] + stable[i] * future;
			losses += w.ownerLosses[i];
			n++;
		}
		const mine = p.score * score[s] + p.opportunity * stable[s] * future;
		let value = mine - (n > 0 ? p.denial * other / n : 0);
		value += run.lifePrice * (p.kill * (n > 0 ? losses / n : 0) - p.risk * w.ownerLosses[s]);
		value += run.recPrice * (p.recovery + p.reserve * run.urgency) * recoverableCount(w, s, cfg.recycleMode, -1);
		// In the seat's own units, one ball is one parked puck's annuity *the way this
		// seat prices its own play*: dividing by its opportunity weight makes that
		// coefficient 1 for every profile, so `warpGoal` and the status line mean the
		// same thing for a keeper (which weights its own play 1.2) and a random seat
		// (0.1), and no profile's lines are read on a ruler whose bullets are 10× off.
		return value * run.scale;
	}
	// Candidates: the ranked lines of play first, then the ladder around the best of
	// them. A search that only refined would agree with the one-ply pick too often; one
	// that only replaced it would throw the fine tuning away.
	function fillShortlist(rank, cap) {
		const n = Math.min(rank.n, cap, WARP_MAX_TRIES);
		for (let a = 0; a < n; a++) { candVx[a] = rank.vx[a]; candVy[a] = rank.vy[a]; }
		return n;
	}
	// The ladder is built around a stroke that is already known, so it is filled when the
	// phase turns over rather than up front: the winner of the comparison is not known
	// until every ranked line has been played.
	function fillLadder(vx, vy, cap) {
		const ang0 = Math.atan2(vy, vx), sp0 = Math.hypot(vx, vy), top = Math.min(cap, WARP_MAX_TRIES);
		let n = 0;
		for (let a = 0; a < WARP_LADDER.length && n < top; a++) {
			const sp = clamp(sp0 * WARP_LADDER[a][1], cfg.vMin, cfg.vMax);
			if (sp <= 0) continue;
			const ang = ang0 + WARP_LADDER[a][0];
			candVx[n] = Math.cos(ang) * sp; candVy[n] = Math.sin(ang) * sp; n++;
		}
		return n;
	}
	// Snapshots the live game and gets ready. False when there is nothing to compare —
	// then the caller simply throws the stroke its own search picked.
	function begin(live, seat, rank) {
		run.live = live; run.seat = seat;
		Object.assign(cfg, live.cfg);
		cfg.warp = false; cfg.botDelay = 0;
		cloneInto(saved, live.world);
		live.saveFlow(flow);
		cfg.omega = flow.omega;
		fitRoster(roster, pool, live.roster);
		let turns = 0;
		for (let i = 0; i < roster.length; i++) {
			snapBalls[i] = roster[i].balls; snapScore[i] = roster[i].score; snapType[i] = roster[i].type;
			turns += roster[i].balls;
		}
		run.future = 2 + 0.9 * cfg.handoffT * turns;
		// The seat's own ruler (js/bots.js evaluateStroke): its profile's weights, the
		// prices of a lost puck and of one coming back, and the urgency its stock gives
		// the recovery terms. `run.ball` stays the generic ball annuity, so warpGoal and
		// every status line are in the same units whatever seat is looking ahead.
		run.p = BOT_PROFILES[roster[seat].type] || BOT_PROFILES.balanced;
		run.scale = 1 / Math.max(0.05, run.p.opportunity);
		run.ball = Math.PI * cfg.puckR * cfg.puckR * diskMeanRed(cfg) * run.future;
		run.recPrice = 0.2 * run.ball;
		run.lifePrice = run.ball / Math.max(1, roster.length);
		run.urgency = 1 + (cfg.ballsPerPlayer - snapBalls[seat]) * 0.55;
		run.base = positionValue(saved, snapScore, seat, run.future);
		run.goal = clamp(live.cfg.warpGoal, 0, 8) * run.ball;
		run.horizon = live.cfg.warpTurns > 0 ? Math.round(live.cfg.warpTurns) : 1e9;
		run.cap = clamp(Math.round(cfg.warpTries), 1, WARP_MAX_TRIES);
		run.lines = fillShortlist(rank, run.cap);
		run.n = run.lines;
		run.total = run.lines;
		run.k = 0; run.tried = 0; run.turns = 0; run.steps = 0; run.rolling = false; run.ladder = false; run.done = false;
		run.best = -Infinity; run.bestK = 0; run.bestVx = 0; run.bestVy = 0;
		if (run.cap < 2 || rank.n < 1) {
			run.done = true;
			if (rank.n > 0) { out.vx = candVx[0]; out.vy = candVy[0]; }
			status('one line to look at');
			return false;
		}
		status('ready');
		return true;
	}
	// One candidate, from the same snapshot as every other: the undo is the reload.
	function launch() {
		cloneInto(world, saved);
		for (let i = 0; i < roster.length; i++) { roster[i].balls = snapBalls[i]; roster[i].score = snapScore[i]; roster[i].type = snapType[i]; }
		clearVotes(roster);
		cfg.omega = flow.omega;
		sim.loadFlow(flow);
		sim.setAimVel(candVx[run.k], candVy[run.k]);
		sim.commitThrow();
		run.turns = 0; run.steps = 0; run.rolling = true;
	}
	// One frame of the copy: exactly the order js/main.js runs the real game in.
	function advance() {
		sim.tick(WARP_TICK * cfg.h);
		sim.beforeSteps();
		for (let j = 0; j < WARP_TICK; j++) stepWorld(world, cfg.h);
		const was = sim.state;
		sim.afterSteps(WARP_TICK * cfg.h);
		if (was === 'resolve' && sim.state !== 'resolve') run.turns++;
		run.steps++;
	}
	function over() {
		return run.turns >= run.horizon || sim.state === 'scored' || sim.state === 'settle' || run.steps >= WARP_MAX_STEPS;
	}
	// What the finished rollout is worth to the seat, on the ruler of the snapshot it
	// started from — and the same number a test can ask for without joining the search.
	function measure() {
		for (let i = 0; i < roster.length; i++) simScore[i] = roster[i].score;
		return positionValue(world, simScore, run.seat, run.future) - run.base;
	}
	function read() {
		const gain = measure();
		run.tried++;
		if (gain > run.best) {
			run.best = gain; run.bestK = run.k;
			run.bestVx = candVx[run.k]; run.bestVy = candVy[run.k];
		}
		return gain;
	}
	function finish(reason) {
		run.done = true;
		out.vx = run.bestVx; out.vy = run.bestVy;
		status(reason);
	}
	// What the end of a phase means. The shortlist is played to its last line — that is
	// the comparison, and no goal cuts it short. The ladder is the extra: it is worth its
	// frames only while the best ranked line is still short of what the seat asked for
	// (warpGoal), and it is centred on that best line, not on the greedy one.
	function afterRun() {
		if (run.k < run.n) return;
		if (run.ladder) { finish('best of them'); return; }
		if (run.best >= run.goal) { finish('good enough'); return; }
		if (run.tried >= run.cap) { finish('best of them'); return; }
		run.n = fillLadder(run.bestVx, run.bestVy, run.cap - run.tried);
		run.total = run.tried + run.n;
		run.k = 0; run.ladder = true;
		if (run.n < 1) finish('best of them');
	}
	function status(reason) {
		const v = isFinite(run.best) ? run.best / run.ball : 0;
		out.status = 'time-warp: ' + run.tried + ' of ' + run.total + ' lines played out · best ' +
			(v < 0 ? '−' : '+') + Math.abs(v).toFixed(2) + ' of a ball' +
			(run.tried > 1 ? ' (line ' + (run.bestK + 1) + ')' : '') + ' · ' + reason;
	}

	return {
		begin,
		// Works the search for budgetMs; true when it is over and vx/vy hold the pick.
		step(budgetMs) {
			const stop = nowMs() + (budgetMs > 0 ? budgetMs : 8);
			while (!run.done) {
				if (!run.rolling) launch();
				else {
					advance();
					if (over()) {
						const gain = read();
						run.k++; run.rolling = false;
						// A perturbation that clears the bar ends the ladder; the ranked
						// lines are never cut short, so their reads never stop anything.
						if (run.ladder && gain >= run.goal) finish('good enough');
						else afterRun();
					}
				}
				if (nowMs() >= stop) return false;
			}
			return true;
		},
		// The copy and one rollout of it, for the gates in experiments/time-warp.js:
		// tryOne plays the given stroke out from the snapshot begin() just took, so a
		// test can set it against the real game playing the same throw and see that the
		// look-ahead is the same rules and not an imitation of them. It leaves the search
		// exactly where it stood, so a measurement and a search can share a snapshot.
		get sim() { return sim; },
		get steps() { return run.steps; },
		get turns() { return run.turns; },
		tryOne(vx, vy, turns) {
			const keep = Object.assign({}, run), kx = candVx[0], ky = candVy[0];
			candVx[0] = vx; candVy[0] = vy;
			run.horizon = turns > 0 ? turns : 1e9;
			run.k = 0; run.turns = 0; run.steps = 0; run.tried = 0; run.best = -Infinity; run.bestK = 0; run.rolling = false; run.done = false;
			launch();
			while (!over() && run.steps < WARP_MAX_STEPS) advance();
			const gain = measure();
			Object.assign(run, keep);
			candVx[0] = kx; candVy[0] = ky;
			return gain;
		},
		// The whole search in one call, for a headless harness that has no frames.
		runAll() { while (!this.step(1e9)); return this; },
		get vx() { return out.vx; },
		get vy() { return out.vy; },
		get status() { return out.status; },
		get tries() { return run.tried; },
		// The ranked lines the comparison had to work through, whatever phase the search
		// has since moved to.
		get lines() { return run.lines; },
		get gain() { return run.best; },
		get done() { return run.done; },
	};
}

if (typeof module !== 'undefined') module.exports = { createWarp, WARP_TICK, WARP_MAX_TRIES, WARP_MAX_STEPS, WARP_LADDER, fitRoster, clearVotes };
