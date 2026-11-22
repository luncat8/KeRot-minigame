// Motion-ended turns (CFG.turnEnd 'motion') and the staller bot. Every claim of the rule is
// checked against the modules the page runs:
//
//	1 rule: an unsettled turn outlives handoffT; a quiet board hands off at once; locked
//	  riders never hold a turn open; without friction the fixed window stays in force
//	2 agreement: the predictor ends the turn where the game does, a speed vote opens only
//	  on a settled board, and the score display / bots share one nominal turn length
//	3 staller, paired boards: it extends the turn when ahead in positional income and
//	  plays for position when behind; banked score never changes its pick; the fixed
//	  window pays no duration
//
// Run: node experiments/motion-turns.js            (gates, ~10 s)
//      node experiments/motion-turns.js --bench 8  (+ seeded leagues in both modes: turn
//      lengths, watchdog margin, CPU per decision, standings; writes results/motion-turns.json)
//      node experiments/motion-turns.js --span     (+ mean motion turn across μk against
//      the MOTION_SPAN_S / MOTION_SPAN_K fit in js/cfg.js, ~10 min)
'use strict';
const fs = require('fs'), path = require('path');
Object.assign(globalThis, require('../js/cfg.js'), require('../js/field.js'), require('../js/physics.js'),
	require('../js/score.js'), require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'),
	require('../js/bots.js'), require('../js/vote.js'), require('../js/game.js'));

const TICK = 8; // the 60 Hz batch js/main.js steps per frame
let fails = 0;
function ok(name, cond, note) {
	console.log((cond ? 'ok   ' : 'FAIL ') + name + (note ? '  — ' + note : ''));
	if (!cond) fails++;
}
function mkCfg(over) { return Object.assign({}, CFG, { speedVote: 'off', botDelay: 0 }, over || {}); }
function mkGame(cfg, seats) {
	const g = createGame({ cfg, roster: createRoster(seats || ['human'], cfg.ballsPerPlayer), ghost: false });
	g.reset();
	return g;
}
function frame(g) {
	g.tick(TICK * g.cfg.h);
	g.beforeSteps();
	for (let j = 0; j < TICK; j++) stepWorld(g.world, g.cfg.h);
	g.afterSteps(TICK * g.cfg.h);
}
// Throws (vx, vy) and plays the turn out; what the board looked like when it handed over.
function playTurn(g, vx, vy) {
	const t0 = g.world.t;
	g.setAimVel(vx, vy);
	g.commitThrow();
	let frames = 0;
	while (g.state === 'resolve' && frames++ < 60 * 600) frame(g);
	return { t: g.world.t - t0, settled: isSettled(g.world), state: g.state };
}
function lockAt(w, cfg, x, y, own) {
	const i = spawnPuck(w, x, y, own);
	w.st[i] = ST_LOCKED; w.om[i] = cfg.omega;
	w.vx[i] = -cfg.omega * (y - cfg.diskY); w.vy[i] = cfg.omega * (x - cfg.diskX);
	return i;
}
const FAST = [-3.0, 0.35]; // a full stroke that rattles the walls: slides well past 4 s
const SLOW = [-0.5, 0]; // stops on bare ice in ~1.7 s, short of the disk

// --- 1 rule ---------------------------------------------------------------------------
function ruleGates() {
	const win = playTurn(mkGame(mkCfg()), FAST[0], FAST[1]);
	ok('fixed window: a sliding board hands over at handoffT', !win.settled && Math.abs(win.t - CFG.handoffT) <= TICK * CFG.h + 1e-9,
		win.t.toFixed(3) + ' s, settled ' + win.settled);
	const mcfg = mkCfg({ turnEnd: 'motion' });
	const mot = playTurn(mkGame(mcfg), FAST[0], FAST[1]);
	ok('motion: the same throw outlives handoffT and hands over settled', mot.settled && mot.t > CFG.handoffT && mot.t < turnLimit(mcfg),
		mot.t.toFixed(3) + ' s (watchdog ' + turnLimit(mcfg).toFixed(1) + ' s)');
	const qw = playTurn(mkGame(mkCfg()), SLOW[0], SLOW[1]), qm = playTurn(mkGame(mcfg), SLOW[0], SLOW[1]);
	ok('a quiet board hands over the moment it settles, in either mode', qw.settled && qm.settled && qw.t === qm.t && qm.t < CFG.handoffT,
		'window ' + qw.t.toFixed(3) + ' s · motion ' + qm.t.toFixed(3) + ' s');
	// Riders travel with the disk for ever; a turn that waited for them would never end.
	const g = mkGame(mcfg), aims = DISK_SCHEMAS[mcfg.diskSchema].aims, riders = [];
	for (let k = 0; k < 3; k++) riders.push(g.world.uid[lockAt(g.world, mcfg, mcfg.diskX + aims[k % aims.length].x * 0.8, mcfg.diskY + aims[k % aims.length].y * 0.8, 0)]);
	const lr = playTurn(g, SLOW[0], SLOW[1]);
	let still = 0;
	for (const uid of riders) { const i = findPuckUid(g.world, uid); if (i >= 0 && g.world.st[i] === ST_LOCKED) still++; }
	ok('locked riders do not hold a motion turn open', lr.settled && lr.t < CFG.handoffT && still === 3,
		lr.t.toFixed(3) + ' s, ' + still + '/3 still riding');
	const icy = mkCfg({ turnEnd: 'motion', muK: 0 });
	const ice = playTurn(mkGame(icy), SLOW[0], SLOW[1]);
	ok('no friction: motion turns fall back to the fixed window', !motionTurns(icy) && turnLimit(icy) === icy.handoffT && Math.abs(ice.t - icy.handoffT) <= TICK * CFG.h + 1e-9,
		ice.t.toFixed(3) + ' s');
	ok('the watchdog is finite and never below the window', ['slick', 'default', 'grippy'].every(name => {
		const c = mkCfg({ turnEnd: 'motion', muK: name === 'slick' ? 0.012 : name === 'grippy' ? 0.08 : 0.03 });
		return Number.isFinite(turnLimit(c)) && turnLimit(c) >= c.handoffT;
	}));
}

// --- 2 agreement ----------------------------------------------------------------------
function agreementGates() {
	const mcfg = mkCfg({ turnEnd: 'motion' });
	for (const [vx, vy, name] of [[FAST[0], FAST[1], 'fast'], [SLOW[0], SLOW[1], 'quiet'], [-1.2, -0.2, 'disk']]) {
		const g = mkGame(mcfg), pred = createPredictor(mcfg);
		predictStroke(pred, g.world, g.pending, vx, vy, turnLimit(mcfg));
		const real = playTurn(g, vx, vy);
		// The game tests the turn once per 8-step frame, the predictor every step.
		const frames = Math.ceil(pred.duration / (TICK * mcfg.h) - 1e-9) * TICK * mcfg.h;
		ok('the predictor ends the ' + name + ' turn where the game does', pred.settled && Math.abs(real.t - frames) < 1e-9,
			'predicted ' + pred.duration.toFixed(4) + ' s · game ' + real.t.toFixed(4) + ' s');
	}
	const vcfg = mkCfg({ turnEnd: 'motion', speedVote: 'turn' });
	const g = mkGame(vcfg, ['human', 'human']), t0 = g.world.t;
	g.setAimVel(FAST[0], FAST[1]); g.commitThrow();
	let frames = 0;
	while (g.state === 'resolve' && frames++ < 60 * 600) frame(g);
	ok('a speed vote opens only once the motion turn has settled', g.state === 'vote' && isSettled(g.world) && g.world.t - t0 > vcfg.handoffT,
		'state ' + g.state + ' at ' + (g.world.t - t0).toFixed(2) + ' s');
	const span = turnSpan(mcfg), ref = scoreRef(mcfg, 4) / scoreRef(mkCfg(), 4);
	ok('the score display and the bots share one nominal turn length', Math.abs(ref - span / CFG.handoffT) < 1e-12 && futurePay(mcfg, 1) === 2 + 0.9 * span,
		'motion span ' + span.toFixed(2) + ' s vs window ' + CFG.handoffT + ' s');
}

// --- 3 staller ------------------------------------------------------------------------
// A twin with the staller's weights minus the stall term: what it would pick if extra
// time were worth nothing. Same name lookup, same rng stream, same candidates.
BOT_PROFILES.stallerTwin = Object.assign({}, BOT_PROFILES.staller, { stall: 0 });
function pairedBoard(cfg, ahead, riders) {
	const w = createWorld(cfg), aims = DISK_SCHEMAS[cfg.diskSchema].aims;
	for (let k = 0; k < riders; k++) lockAt(w, cfg, cfg.diskX + aims[k % aims.length].x, cfg.diskY + aims[k % aims.length].y, ahead ? 0 : 1);
	return { w, i: spawnPuck(w, cfg.launchX, cfg.launchY, 0) };
}
function pick(cfg, name, ahead, riders, scores) {
	const { w, i } = pairedBoard(cfg, ahead, riders), pred = createPredictor(cfg);
	const roster = createRoster(['staller', 'balanced'], cfg.ballsPerPlayer);
	roster[0].score = scores[0]; roster[1].score = scores[1];
	const s = chooseStroke(name, w, cfg, i, pred, makeRng(5), roster, null, false), vx = s.vx, vy = s.vy;
	predictStroke(pred, w, i, vx, vy, predictHorizon(cfg), true);
	const lead = pred.stallLead;
	predictStroke(pred, w, i, vx, vy, turnLimit(cfg)); // the whole turn, past the search horizon
	return { vx, vy, t: pred.duration, lead };
}
function stallerGates() {
	const mcfg = mkCfg({ turnEnd: 'motion' }), wcfg = mkCfg();
	for (const riders of [1, 2]) {
		const sa = pick(mcfg, 'staller', true, riders, [0, 0]), ta = pick(mcfg, 'stallerTwin', true, riders, [0, 0]);
		const sb = pick(mcfg, 'staller', false, riders, [0, 0]), tb = pick(mcfg, 'stallerTwin', false, riders, [0, 0]);
		ok('ahead by ' + riders + ' rider(s): the staller keeps the board moving longer', sa.t > ta.t + 0.5 && sa.lead > 0,
			'staller ' + sa.t.toFixed(2) + ' s vs twin ' + ta.t.toFixed(2) + ' s, lead·time ' + sa.lead.toFixed(1));
		ok('behind by ' + riders + ' rider(s): it plays for position, not for time (its twin\'s stroke)', sb.vx === tb.vx && sb.vy === tb.vy,
			'staller ' + sb.t.toFixed(2) + ' s vs twin ' + tb.t.toFixed(2) + ' s');
		let same = true;
		for (const ahead of [true, false]) {
			const base = pick(mcfg, 'staller', ahead, riders, [0, 0]);
			for (const scores of [[900, 0], [0, 900]]) {
				const p = pick(mcfg, 'staller', ahead, riders, scores);
				same = same && p.vx === base.vx && p.vy === base.vy;
			}
		}
		ok('banked score alone never flips its pick (' + riders + ' rider(s))', same);
		let fixed = true;
		for (const ahead of [true, false]) {
			const s = pick(wcfg, 'staller', ahead, riders, [0, 0]), t = pick(wcfg, 'stallerTwin', ahead, riders, [0, 0]);
			fixed = fixed && s.vx === t.vx && s.vy === t.vy && s.lead === 0;
		}
		ok('fixed window: no duration reward, the staller plays its twin (' + riders + ' rider(s))', fixed);
	}
}

// --- bench ----------------------------------------------------------------------------
// A seeded league with the full search the page runs (not a copy's light one). Seats
// rotate every game; turn lengths are recorded by the seat that threw.
const LEAGUE = ['staller', 'keeper', 'balanced', 'timing'];
function league(turnEnd, games, over) {
	const acc = {};
	for (const t of LEAGUE) acc[t] = { score: 0, wins: 0, ms: 0, decisions: 0, turns: [] };
	const turns = [];
	let watch = 0, limit = 0;
	for (let n = 0; n < games; n++) {
		const cfg = mkCfg(Object.assign({ turnEnd, speedVote: CFG.speedVote }, over || {}));
		if (over && over.muK) { cfg.muS = Math.max(cfg.muS, cfg.muK * 1.5); cfg.omega = autoOmega(cfg); }
		limit = turnLimit(cfg);
		const seats = LEAGUE.map((_, i) => LEAGUE[(i + n) % LEAGUE.length]);
		const g = createGame({ cfg, roster: createRoster(seats, cfg.ballsPerPlayer), ghost: false });
		for (let k = 0; k <= n; k++) g.reset(); // a fresh seed per game, the same per mode
		let t0 = 0, thrower = 0, frames = 0;
		while (g.state !== 'scored' && frames++ < 60 * 3600) {
			const pre = g.state, tick = process.hrtime.bigint();
			g.tick(TICK * cfg.h);
			if (pre === 'aim' && g.state === 'resolve') {
				acc[seats[g.turn]].ms += Number(process.hrtime.bigint() - tick) / 1e6;
				acc[seats[g.turn]].decisions++;
				t0 = g.world.t; thrower = g.turn;
			}
			g.beforeSteps();
			for (let j = 0; j < TICK; j++) stepWorld(g.world, cfg.h);
			const was = g.state;
			g.afterSteps(TICK * cfg.h);
			if (was === 'resolve' && g.state !== 'resolve') {
				const d = g.world.t - t0;
				turns.push(d); acc[seats[thrower]].turns.push(d);
				if (d >= limit - 1e-9) watch++;
			}
		}
		const best = leader(g.roster);
		for (let i = 0; i < seats.length; i++) {
			acc[seats[i]].score += displayScore(cfg, seats.length, g.roster[i].score) / games;
			if (i === best) acc[seats[i]].wins++;
		}
	}
	return { acc, turns, watch, limit };
}
function quant(a, p) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function summary(r) {
	return { turns: r.turns.length, mean: mean(r.turns), p50: quant(r.turns, 0.5), p90: quant(r.turns, 0.9), max: quant(r.turns, 1),
		watchdog: r.limit, watchdogHits: r.watch };
}
function bench(games) {
	const out = { date: new Date().toISOString(), games, league: LEAGUE, modes: {} };
	for (const mode of ['window', 'motion']) {
		const r = league(mode, games), s = summary(r);
		out.modes[mode] = { turnLength: s, bots: {} };
		console.log('\n' + mode + ': ' + s.turns + ' turns · mean ' + s.mean.toFixed(2) + ' s · p50 ' + s.p50.toFixed(2) + ' · p90 ' + s.p90.toFixed(2) +
			' · max ' + s.max.toFixed(2) + ' s · limit ' + s.watchdog.toFixed(1) + ' s (' + s.watchdogHits + ' hits)');
		console.log('bot        score  wins  turn mean  turn p90  ms/decision');
		for (const t of LEAGUE) {
			const a = r.acc[t], row = { score: a.score, wins: a.wins, turnMean: mean(a.turns), turnP90: quant(a.turns, 0.9), msPerDecision: a.ms / Math.max(1, a.decisions) };
			out.modes[mode].bots[t] = row;
			console.log(t.padEnd(10) + row.score.toFixed(0).padStart(6) + String(row.wins).padStart(6) + row.turnMean.toFixed(2).padStart(11) +
				row.turnP90.toFixed(2).padStart(10) + row.msPerDecision.toFixed(0).padStart(13));
		}
	}
	const file = path.join(__dirname, 'results', 'motion-turns.json');
	fs.writeFileSync(file, JSON.stringify(out, null, '\t') + '\n');
	console.log('\nwrote ' + path.relative(process.cwd(), file));
	ok('no motion turn ran into the watchdog', out.modes.motion.turnLength.watchdogHits === 0);
}
// The mean motion turn across friction against the turnSpan model (fit by least squares
// of mean/0.9 on ln slideTime). Its error is what the score reference and futurePay are
// off by at that friction.
function spanFit() {
	console.log('\nmean motion turn by friction (2 games each) — turnSpan fit:');
	let worst = 0;
	for (const muK of [0.008, 0.012, 0.02, 0.03, 0.05, 0.08, 0.15]) {
		const r = league('motion', 2, { muK }), cfg = mkCfg({ turnEnd: 'motion', muK });
		cfg.muS = Math.max(cfg.muS, muK * 1.5); cfg.omega = autoOmega(cfg);
		const m = mean(r.turns), model = 0.9 * turnSpan(cfg);
		worst = Math.max(worst, Math.abs(model / m - 1));
		console.log('μk ' + muK + ' · slideTime ' + slideTime(cfg).toFixed(1) + ' s · mean turn ' + m.toFixed(2) + ' s · 0.9·turnSpan ' + model.toFixed(2) +
			' s · max ' + quant(r.turns, 1).toFixed(2) + ' of ' + turnLimit(cfg).toFixed(1) + ' s');
	}
	ok('turnSpan tracks the measured mean within 20 % at every friction', worst < 0.2, 'worst ' + (100 * worst).toFixed(0) + ' %');
}

ruleGates();
agreementGates();
stallerGates();
const at = process.argv.indexOf('--bench');
if (at >= 0) bench(parseInt(process.argv[at + 1], 10) || 8);
if (process.argv.includes('--span')) spanFit();
console.log(fails ? fails + ' gate(s) failed' : 'all gates passed');
process.exit(fails ? 1 : 0);
