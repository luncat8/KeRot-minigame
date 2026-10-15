// Deterministic headless comparison of all strategic profiles.
// Run: node experiments/bot-strategies.js [games] [seed0] [disk schema]
// The classic disk writes results/bot-strategies.json, any other bot-strategies-<schema>.json.
Object.assign(globalThis,
	require('../js/field.js'),
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'));
const fs = require('fs');
const path = require('path');

const GAMES = parseInt(process.argv[2], 10) || 12;
const SEED0 = parseInt(process.argv[3], 10) || 20261014;
const SCHEMA = process.argv[4] || CFG.diskSchema;
if (!DISK_SCHEMAS[SCHEMA]) { console.log('unknown disk schema ' + SCHEMA + ' — one of ' + Object.keys(DISK_SCHEMAS).join(', ')); process.exit(1); }
CFG.diskSchema = SCHEMA;
const BOTS = ['random', 'keeper', 'hunter', 'retriever', 'blackhole', 'balanced'];
const TICK = 8;
let fail = 0;
function check(ok, name) { if (!ok) { console.log('FAIL ' + name); fail = 1; } }

function modelGates() {
	for (const hole of BLACK_HOLES) {
		const separation = Math.hypot(hole.x - CFG.diskX, hole.y - CFG.diskY);
		check(separation > CFG.diskR + 2 * CFG.puckR + hole.r, 'black-hole capture bounds stay clear of the scoring disk');
	}
	const lost = createWorld(CFG);
	const moving = spawnPuck(lost, BLACK_HOLES[0].x + BLACK_HOLES[0].r + CFG.puckR + 0.15, CFG.puckR, 3);
	throwPuck(lost, moving, -1, 0);
	let captureSteps = 0;
	while (lost.n && captureSteps++ < 480) stepWorld(lost, CFG.h);
	check(lost.n === 0 && lost.ownerLosses[3] === 1, 'entering a black hole permanently removes the puck and records its owner');
	const grazing = createWorld(CFG);
	const edge = spawnPuck(grazing, BLACK_HOLES[0].x + 0.05, BLACK_HOLES[0].r + CFG.puckR - 0.001, 2);
	throwPuck(grazing, edge, -48, 0);
	stepWorld(grazing, CFG.h);
	check(grazing.n === 0 && grazing.ownerLosses[2] === 1, 'swept capture catches a high-speed grazing entry between steps');
	const safe = createWorld(CFG);
	spawnPuck(safe, BLACK_HOLES[0].x, BLACK_HOLES[0].r + CFG.puckR + 0.08, 0);
	stepWorld(safe, CFG.h);
	check(safe.n === 1 && safe.ownerLosses[0] === 0, 'the capture boundary is finite');

	const w = createWorld(CFG), pred = createPredictor(CFG);
	spawnPuck(w, BLACK_HOLES[0].x, 0.10, 1); // removed first; the thrown puck shifts into its slot
	const shooter = spawnPuck(w, CFG.launchX, CFG.launchY, 0), shooterUid = w.uid[shooter];
	predictStroke(pred, w, shooter, -1.1, 0.1, CFG.handoffT, false);
	check(!pred.removed && pred.world.uid[0] === shooterUid, 'prediction follows the thrown puck across another puck\'s removal');

	const rec = createWorld(CFG), rp = createPredictor(CFG);
	const pending = spawnPuck(rec, CFG.launchX, CFG.launchY, 0);
	check(puckWouldRecycle(rec, pending, CFG.recycleMode), 'launch-zone puck is recoverable under the active return rule');
	predictStroke(rp, rec, pending, 0, 0, CFG.handoffT, true);
	check(rp.recoveryDelta === 1, 'predicted recovery returns one reserve ball');
	check(rp.scoreBySeat[0] === 0, 'recovery prediction does not pretend an off-disk puck scored');

	const turn = createWorld(CFG), tp = createPredictor(CFG);
	const hot = DISK_SCHEMAS[CFG.diskSchema].aims[0];
	const locked = spawnPuck(turn, CFG.diskX + hot.x, CFG.diskY + hot.y, 0);
	turn.st[locked] = ST_LOCKED;
	turn.vx[locked] = -CFG.omega * (turn.y[locked] - CFG.diskY);
	turn.vy[locked] = CFG.omega * (turn.x[locked] - CFG.diskX);
	turn.om[locked] = CFG.omega;
	const pending2 = spawnPuck(turn, CFG.launchX, CFG.launchY, 0);
	predictStroke(tp, turn, pending2, 0, 1.8, CFG.handoffT, true);
	const expected = tp.initialRates[0] * tp.duration;
	check(tp.world.theta > turn.theta + 0.5, 'prediction advances the rotating disk through the turn');
	check(Math.abs(tp.scoreBySeat[0] - expected) < Math.max(0.02, expected * 0.01),
		'locked-puck score opportunity stays in its rotating disk-local field');
	// A puck that is only crossing red at handoff must not be priced as a capture.
	// The feed below is the measured rim6 lock from the launch lane; the fast shot
	// down the centre line is on the paint at 4 s and then leaves.
	const prevSchema = CFG.diskSchema;
	CFG.diskSchema = 'rim6';
	const rim = createWorld(CFG), rp2 = createPredictor(CFG);
	const pending3 = spawnPuck(rim, CFG.launchX, CFG.launchY, 0);
	const feed = feedTangent(CFG, CFG.launchX, CFG.launchY, Math.min(0.82 * holdRadius(CFG), CFG.diskR - CFG.puckR - 0.01));
	let feedStable = 0;
	for (const kv of [0.86, 0.90, 0.94]) {
		for (const da of [-0.02618, 0, 0.02618, 0.05236]) {
			predictStroke(rp2, rim, pending3, Math.cos(feed.ang + da) * feed.v0 * kv, Math.sin(feed.ang + da) * feed.v0 * kv, CFG.handoffT, true);
			if (rp2.stableRates[0] > feedStable) feedStable = rp2.stableRates[0];
		}
	}
	check(feedStable > 5, 'a co-rotating rim feed is an annuity', feedStable.toFixed(2));
	// 185° at 2.4 m/s crosses a lobe during the window (final rate ~8) and is flung.
	// Straight down the centre at the same speed actually locks on the blue middle,
	// which is a real capture — the gate has to use a shot that leaves.
	const pass = 185 * Math.PI / 180;
	predictStroke(rp2, rim, pending3, Math.cos(pass) * 2.4, Math.sin(pass) * 2.4, CFG.handoffT, true);
	check(rp2.finalRates[0] > 5 && rp2.stableRates[0] < 1, 'a puck merely passing over red is not an annuity',
		'final ' + rp2.finalRates[0].toFixed(2) + ' stable ' + rp2.stableRates[0].toFixed(2));
	CFG.diskSchema = prevSchema;
	return !fail;
}

function playGame(w, pred, roster, rng) {
	const recovered = new Uint16Array(roster.length);
	const enemyKills = new Uint16Array(roster.length), decisionMs = new Float64Array(roster.length);
	const decisions = new Uint16Array(roster.length);
	resetWorld(w);
	for (const seat of roster) { seat.balls = CFG.ballsPerPlayer; seat.score = 0; }
	let turn = 0, recycled = 0;
	const giveBack = owner => { roster[owner].balls++; recovered[owner]++; };
	for (;;) {
		const seat = nextSeat(roster, turn);
		if (seat < 0) break;
		turn = seat;
		roster[turn].balls--;
		const i = spawnPuck(w, CFG.launchX, CFG.launchY, turn);
		if (i < 0) { roster[turn].balls = 0; continue; }
		const decisionStart = process.hrtime.bigint();
		const stroke = chooseStroke(roster[turn].type, w, CFG, i, pred, rng, roster);
		decisionMs[turn] += Number(process.hrtime.bigint() - decisionStart) / 1e6;
		decisions[turn]++;
		if (!Number.isFinite(stroke.vx) || !Number.isFinite(stroke.vy)) throw new Error('non-finite action: ' + roster[turn].type);
		const lossesBefore = Uint16Array.from(w.ownerLosses);
		throwPuck(w, i, stroke.vx, stroke.vy);
		let t = 0;
		while (!isSettled(w) && t < CFG.handoffT) {
			for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
			scoreTick(w, roster, TICK * CFG.h);
			t += TICK * CFG.h;
		}
		for (let owner = 0; owner < roster.length; owner++) {
			const losses = w.ownerLosses[owner] - lossesBefore[owner];
			if (losses <= 0) continue;
			if (owner !== turn) enemyKills[turn] += losses;
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
	return { thrown: w.thrown, recycled, recovered, lost: Uint16Array.from(w.ownerLosses), enemyKills,
		decisionMs, decisions, board: w.n, time: w.t };
}
function stats(values) {
	const n = values.length;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
	return { mean, std, min: Math.min(...values), max: Math.max(...values) };
}
function run() {
	if (!modelGates()) throw new Error('model gate failed');
	const world = createWorld(CFG), pred = createPredictor(CFG), roster = createRoster(BOTS, CFG.ballsPerPlayer);
	const acc = {};
	for (const type of BOTS) acc[type] = { shown: [], raw: [], recovered: 0, lost: 0, enemyKills: 0, wins: 0, decisionMs: 0, decisions: 0 };
	const throws = [], recycled = [], lostTotal = [], time = [];
	for (let g = 0; g < GAMES; g++) {
		for (let i = 0; i < roster.length; i++) roster[i].type = BOTS[(i + g) % BOTS.length];
		const result = playGame(world, pred, roster, makeRng(SEED0 + g * 7919));
		throws.push(result.thrown); recycled.push(result.recycled);
		lostTotal.push(result.lost.reduce((a, b) => a + b, 0)); time.push(result.time);
		const best = leader(roster);
		for (let i = 0; i < roster.length; i++) {
			const a = acc[roster[i].type];
			a.shown.push(displayScore(CFG, roster.length, roster[i].score));
			a.raw.push(roster[i].score); a.recovered += result.recovered[i]; a.lost += result.lost[i];
			a.enemyKills += result.enemyKills[i];
			a.decisionMs += result.decisionMs[i]; a.decisions += result.decisions[i];
			if (i === best) a.wins++;
		}
	}
	const bots = [];
	for (const type of BOTS) {
		const a = acc[type], shown = stats(a.shown), raw = stats(a.raw);
		bots.push({ type, scoreMean: shown.mean, scoreStd: shown.std, scoreMin: shown.min, scoreMax: shown.max,
			rawMean: raw.mean, winPct: 100 * a.wins / GAMES, recoveredPerGame: a.recovered / GAMES,
			lostPerGame: a.lost / GAMES, enemyEliminationsPerGame: a.enemyKills / GAMES,
			msPerAction: a.decisionMs / Math.max(1, a.decisions) });
	}
	return { bots, throws: stats(throws), recycled: stats(recycled), lost: stats(lostTotal), time: stats(time) };
}

const started = Date.now();
const result = run();
const output = {
	date: new Date().toISOString(),
	config: { games: GAMES, seed0: SEED0, diskSchema: SCHEMA, seats: BOTS.length, ballsPerPlayer: CFG.ballsPerPlayer,
		blackHoles: BLACK_HOLES, recycleMode: CFG.recycleMode, samplesPerAction: BOT_SAMPLES,
		scoreSampleHz: 1 / (PRED_SCORE_EVERY * CFG.h),
		note: 'Seats rotate every game. Score includes turn-integrated red area; recovery is a return to the active rule; black-hole captures permanently consume a ball.' },
	bots: result.bots,
	game: { throws: result.throws, recycled: result.recycled, permanentlyLost: result.lost, simTime: result.time },
};
const resultFile = SCHEMA === 'classic' ? 'bot-strategies.json' : 'bot-strategies-' + SCHEMA + '.json';
const resultPath = path.join(__dirname, 'results', resultFile);
fs.mkdirSync(path.dirname(resultPath), { recursive: true });
fs.writeFileSync(resultPath, JSON.stringify(output, null, '\t') + '\n');
console.log('bot        score 0..' + CFG.scoreDisplayMax + '     win%  recovered   lost   kills  ms/action');
for (const b of result.bots) {
	console.log(b.type.padEnd(11) + b.scoreMean.toFixed(0).padStart(4) + ' ± ' + b.scoreStd.toFixed(0).padEnd(5)
		+ b.winPct.toFixed(0).padStart(5) + b.recoveredPerGame.toFixed(2).padStart(11)
		+ b.lostPerGame.toFixed(2).padStart(7) + b.enemyEliminationsPerGame.toFixed(2).padStart(8)
		+ b.msPerAction.toFixed(1).padStart(12));
}
console.log('game: ' + result.throws.mean.toFixed(1) + ' throws, ' + result.recycled.mean.toFixed(1)
	+ ' returned, ' + result.lost.mean.toFixed(1) + ' lost to holes, ' + result.time.mean.toFixed(1) + ' s simulated');
console.log(fail ? 'FAIL' : 'OK (' + GAMES + ' seeded games on ' + SCHEMA + ' in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s) -> experiments/results/' + resultFile);
process.exit(fail);
