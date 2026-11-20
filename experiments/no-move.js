// Turns that move nothing: drives the real js/game.js flow frame by frame, in the
// order js/main.js runs it (tick -> beforeSteps -> fixed steps -> afterSteps), and
// records every throw — its speed, how far the thrown puck actually travelled, and
// how the turn ended (stayed / returned by the rule / lost to a void). Also flags a
// turn that ends without a throw and a seat that never throws.
//
// This is the harness behind the "sometimes players do not move" finding: a
// zero-speed stroke is a legal aim, sleeps on the launch spot in one step, hands the
// turn over at once, and the return rule then reclaims the puck from the launch lane
// without it ever having moved — which reads as the seat skipping its throw or
// teleporting the puck back to the start.
//
// Run: node experiments/no-move.js [games] [seed0]
Object.assign(globalThis, require('../js/field.js'), require('../js/physics.js'), require('../js/score.js'),
	require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'),
	require('../js/bots.js'), require('../js/vote.js'));
const { createGame } = require('../js/game.js');

const GAMES = parseInt(process.argv[2], 10) || 6;
const SEED0 = parseInt(process.argv[3], 10) || 90210;
// The default page roster with its human seat played by a bot (the harness has no
// pointer), plus the bot-league spread — between them every profile that showed a
// no-move pick in the candidate sweep.
const ROSTERS = [
	['random', 'balanced', 'blackhole', 'retriever'],
	['keeper', 'hunter', 'retriever', 'balanced'],
];
const NO_MOVE_SPEED = 0.15; // m/s: strokes at or under this cannot visibly cross the ice
const NO_MOVE_TRAVEL = 0.05; // m: the thrown puck never got this far from its launch spot
const AIM_STALL_FRAMES = 600; // 10 s of aiming with no throw in an all-bot game

// Every throw the real board receives — predictor copies and warp rollouts run on
// their own worlds and are filtered out by identity.
let watch = null, lastThrow = null;
const rawThrow = globalThis.throwPuck;
globalThis.throwPuck = function (w, i, vx, vy) {
	if (w === watch) lastThrow = { uid: w.uid[i], seat: w.own[i], speed: Math.hypot(vx, vy), x0: w.x[i], y0: w.y[i] };
	return rawThrow(w, i, vx, vy);
};

function runGame(types, seed) {
	const roster = createRoster(types, CFG.ballsPerPlayer);
	const game = createGame({ roster: roster, ghost: false });
	const w = game.world;
	watch = w; lastThrow = null;
	game.reset(); // reset deals its own rng seed; reseed after it so games differ by seed0
	game.setRngState(seed >>> 0);

	const rows = [];
	let frame = 0, thrownSeen = 0, thrownAtAim = 0, aimFrame = -1, aimStall = false;
	let live = null; // the throw being resolved: { ...lastThrow, maxTravel, gone }
	let losses0 = 0;
	const state0 = game.state;

	while (game.state !== 'scored' && frame < 60 * 600) {
		frame++;
		game.tick(1 / 60);
		game.beforeSteps();
		if (!game.planning) {
			for (let s = 0; s < 8; s++) stepWorld(w, CFG.h);
			game.afterSteps(8 * CFG.h);
		}
		const st = game.state;
		// A new throw: record it with the loss count it started from.
		if (w.thrown > thrownSeen) {
			thrownSeen = w.thrown;
			if (!lastThrow) { rows.push({ anomaly: 'throw without recorder' }); }
			else {
				live = Object.assign({ maxTravel: 0, gone: false }, lastThrow);
				losses0 = w.ownerLosses[live.seat];
			}
		}
		// Follow the thrown puck while the resolve runs.
		if (live && st === 'resolve') {
			const k = findPuckUid(w, live.uid);
			if (k < 0) live.gone = true;
			else {
				const d = Math.hypot(w.x[k] - live.x0, w.y[k] - live.y0);
				if (d > live.maxTravel) live.maxTravel = d;
			}
		}
		// Turn bookkeeping: aim entered / resolve ended. A throw can run, settle and
		// hand over inside one frame, so the state after the frame may already be the
		// vote — only an aim that ended with no new throw is an anomaly.
		if (st === 'aim' && aimFrame < 0) { aimFrame = frame; thrownAtAim = w.thrown; }
		if (st !== 'aim' && aimFrame >= 0) {
			const aimed = frame - aimFrame, threw = w.thrown > thrownAtAim;
			aimFrame = -1;
			if (!threw) rows.push({ anomaly: 'aim -> ' + st + ' without a throw', aimed });
			if (aimed > AIM_STALL_FRAMES) { aimStall = true; rows.push({ anomaly: 'aim stall', aimed }); }
		}
		if (live && st !== 'resolve') {
			// The handoff has run: classify how the thrown puck's turn ended.
			const stillThere = findPuckUid(w, live.uid) >= 0;
			const voided = !stillThere && w.ownerLosses[live.seat] > losses0;
			rows.push({
				seat: live.seat, type: roster[live.seat].type, speed: live.speed,
				travel: stillThere ? live.maxTravel : live.maxTravel,
				end: stillThere ? 'stayed' : (voided ? 'void' : 'returned'),
				noMove: live.speed < NO_MOVE_SPEED || live.maxTravel < NO_MOVE_TRAVEL,
			});
			live = null;
		}
	}
	watch = null;
	return { rows, frames: frame, ended: game.state, state0 };
}

function bucket(speed) {
	return speed < NO_MOVE_SPEED ? 'no-move(<0.15)' : speed < 0.5 ? 'slow(0.15-0.5)' : 'normal(>=0.5)';
}

const all = [];
let stalls = 0;
for (let g = 0; g < GAMES; g++) {
	const types = ROSTERS[g % ROSTERS.length];
	const t0 = Date.now();
	const r = runGame(types, SEED0 + g * 7919);
	for (const row of r.rows) all.push(Object.assign({ game: g, roster: types.join('+') }, row));
	const throws = r.rows.filter(x => !x.anomaly).length;
	console.log('game ' + g + ' [' + types.join(',') + '] ' + r.ended + ' in ' + (r.frames / 60).toFixed(0)
		+ ' s, ' + throws + ' throws, ' + (Date.now() - t0) + ' ms');
}

const throws = all.filter(x => !x.anomaly);
const anomalies = all.filter(x => x.anomaly);
const count = xs => xs.length;
const byBucket = {};
for (const row of throws) byBucket[bucket(row.speed)] = (byBucket[bucket(row.speed)] || 0) + 1;
const noMove = throws.filter(x => x.noMove);
const noMoveReturned = noMove.filter(x => x.end === 'returned');
const noMoveStayed = noMove.filter(x => x.end === 'stayed');
const slowButMoved = throws.filter(x => x.speed < NO_MOVE_SPEED && x.travel >= NO_MOVE_TRAVEL);
const fastButStill = throws.filter(x => x.speed >= NO_MOVE_SPEED && x.travel < NO_MOVE_TRAVEL);

console.log('');
console.log('throws: ' + count(throws) + '  by speed: ' + JSON.stringify(byBucket));
console.log('no-move throws (speed<0.15 or travel<0.05): ' + noMove.length
	+ ' — of which returned by the rule without moving: ' + noMoveReturned.length
	+ ', stayed on the board: ' + noMoveStayed.length);
console.log('slow but visible (speed<0.15, travel>=0.05): ' + slowButMoved.length);
console.log('normal speed but never moved (travel<0.05): ' + fastButStill.length
	+ '  <- the stale-slot signature, should be 0');
console.log('anomalies (turn without a throw / aim stall): ' + anomalies.length);
for (const a of anomalies.slice(0, 10)) console.log('  ! ' + JSON.stringify(a));
const worst = noMove.slice().sort((a, b) => a.speed - b.speed).slice(0, 8);
for (const row of worst) console.log('  e ' + row.type + ' speed=' + row.speed.toFixed(4)
	+ ' travel=' + row.travel.toFixed(4) + ' end=' + row.end);

process.exit(fastButStill.length || anomalies.length ? 1 : 0);
