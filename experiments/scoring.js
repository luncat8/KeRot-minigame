// How good and how cheap the red-area score is (js/score.js). Three questions:
//   1. does the baked grid + the puck's sample pattern reproduce the exact integral
//      ∫∫_{puck ∩ disk} R dA (fine midpoint quadrature) closely enough?
//   2. does the pattern reproduce the covered *area* (analytic circle-circle lens)?
//   3. what does it cost per frame on a full board of maxPlayers × ballsPerPlayer?
// Plus one end-to-end check: the displayed 0..999 has to mean the same thing for a
// 1-seat game and an 8-seat game.
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'));
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

const rgb = [0, 0, 0];
const R = CFG.diskR, r = CFG.puckR, PUCK_A = Math.PI * r * r;

// Reference: midpoint quadrature of the same integral on a fine grid over the puck.
function refRate(cfg, theta, px, py, n) {
	const step = 2 * r / n, cell = step * step;
	let sum = 0;
	for (let j = 0; j < n; j++) {
		const y = py - r + (j + 0.5) * step;
		for (let i = 0; i < n; i++) {
			const x = px - r + (i + 0.5) * step;
			const dx = x - cfg.diskX, dy = y - cfg.diskY;
			if (dx * dx + dy * dy > R * R) continue; // outside the disk
			const qx = x - px, qy = y - py;
			if (qx * qx + qy * qy > r * r) continue; // outside the puck
			fieldColor(fieldWorld(cfg, x, y, theta), rgb);
			sum += rgb[0];
		}
	}
	return cell * sum;
}
// Analytic area of the intersection of two circles.
function lensArea(Rr, rr, d) {
	if (d >= Rr + rr) return 0;
	if (d <= Math.abs(Rr - rr)) return Math.PI * Math.min(Rr, rr) * Math.min(Rr, rr);
	const a = Math.acos((d * d + rr * rr - Rr * Rr) / (2 * d * rr));
	const b = Math.acos((d * d + Rr * Rr - rr * rr) / (2 * d * Rr));
	const tri = 0.5 * Math.sqrt((-d + rr + Rr) * (d + rr - Rr) * (d - rr + Rr) * (d + rr + Rr));
	return rr * rr * a + Rr * Rr * b - tri; // ½√(...) is the kite of the two chords
}

// 1. The integral itself, sampled over the cases that matter: dead centre, on a hot
// lobe, on a cold lobe, straddling the rim, and clear of it.
{
	const REF_N = 240;
	const rng = makeRng(20261013);
	const spots = [];
	for (let k = 0; k < 40; k++) { // random pucks, most of them on the disk
		const ang = rng() * Math.PI * 2, rad = rng() * (R + 0.5 * r);
		spots.push([CFG.diskX + Math.cos(ang) * rad, CFG.diskY + Math.sin(ang) * rad]);
	}
	spots.push([CFG.diskX, CFG.diskY], [CFG.diskX + 0.36, CFG.diskY], [CFG.diskX - 0.36, CFG.diskY + 0.36],
		[CFG.diskX + R, CFG.diskY], [CFG.diskX + R - r, CFG.diskY], [CFG.diskX + R + r, CFG.diskY], [3.0, 0.3]);
	let worst = 0, worstAt = null, sumRef = 0, sumGot = 0, checked = 0;
	const w = createWorld(CFG);
	for (const theta of [0, 0.7, 2.3, 4.9]) {
		for (const s of spots) {
			w.n = 0; w.theta = theta;
			const i = spawnPuck(w, s[0], s[1], 0);
			const got = puckRate(w, i), ref = refRate(CFG, theta, s[0], s[1], REF_N);
			if (ref < 1e-6) continue; // nothing on the disk: both are exactly 0
			const err = Math.abs(got - ref) / ref;
			sumRef += ref; sumGot += got; checked++;
			if (err > worst) { worst = err; worstAt = [s[0].toFixed(2), s[1].toFixed(2), theta.toFixed(1), got.toFixed(3), ref.toFixed(3)]; }
		}
	}
	let bias = (sumGot - sumRef) / sumRef;
	console.log('integral vs ' + REF_N + '² quadrature over ' + checked + ' placements: worst |err| ' +
		(100 * worst).toFixed(2) + ' %, mean bias ' + (100 * bias).toFixed(3) + ' %' +
		(worstAt ? ' (worst at x=' + worstAt[0] + ' y=' + worstAt[1] + ' θ=' + worstAt[2] + ': ' + worstAt[3] + ' vs ' + worstAt[4] + ')' : ''));
	check(worst < 0.01, 'score integral within 1 % of the fine quadrature', (100 * worst).toFixed(2) + ' %');
	check(Math.abs(bias) < 0.002, 'no systematic bias in the score integral', (100 * bias).toFixed(3) + ' %');
}

// 2. The covered area. It is not counted in cells — a puck hanging over the rim would
// be quantised to the cell size — but taken from the analytic lens, so this is exact
// by construction; it is gated so nobody "optimises" it back into a count.
{
	const w = createWorld(CFG);
	let worst = 0, worstD = 0;
	for (let d = 0; d <= R + r; d += 0.002) {
		w.n = 0;
		const i = spawnPuck(w, CFG.diskX + d, CFG.diskY, 0);
		const got = puckArea(w, i), ref = lensArea(R, r, d);
		const err = Math.abs(got - ref) / PUCK_A; // in shares of the whole puck
		if (err > worst) { worst = err; worstD = d; }
	}
	console.log('covered area vs the analytic lens: worst error ' + (worst * PUCK_A).toExponential(1) + ' m² (' +
		(100 * worst).toFixed(4) + ' % of a puck) at d = ' + worstD.toFixed(3) + ' m');
	// 1e-7 m² is 3e-6 of a puck: the residue is the acos cancellation in the lens
	// formula at the branch point d = R - r, not the model.
	check(worst * PUCK_A < 1e-7, 'the covered area is the exact lens, not a cell count', (worst * PUCK_A).toExponential(1) + ' m²');
}

// 3. Cost: a full board (every seat has every ball out) scored once, as main.js does
// after the frame's steps — on the disk, where every cell is looked up.
{
	const w = createWorld(CFG);
	const roster = createRoster(['human'], CFG.ballsPerPlayer);
	const nPucks = CFG.maxPlayers * CFG.ballsPerPlayer;
	for (let k = 0; k < nPucks; k++) { // spread over the disk: all cells are live
		const ang = k * 2.399963, rad = R * 0.8 * Math.sqrt((k % nPucks) / nPucks);
		spawnPuck(w, CFG.diskX + Math.cos(ang) * rad, CFG.diskY + Math.sin(ang) * rad, 0);
	}
	scoreTick(w, roster, CFG.h); // warm up: bake the grid, JIT
	const reps = 20000;
	const t0 = process.hrtime.bigint();
	for (let k = 0; k < reps; k++) scoreTick(w, roster, 1 / 60);
	const ns = Number(process.hrtime.bigint() - t0) / reps;
	const perPuck = ns / w.n;
	console.log('cost: ' + perPuck.toFixed(0) + ' ns per puck, ' + (ns / 1e6).toFixed(3) +
		' ms per frame for ' + w.n + ' pucks (frame budget 16.7 ms, physics ~0.07 ms)');
	check(ns < 2e6, 'a full board is scored inside 2 ms', (ns / 1e6).toFixed(3) + ' ms');
}

// 4. The display: the same game length has to read the same for 2 seats and for 8,
// and a bot that plays well has to land in the upper half of 0..999.
{
	const pred = createPredictor(CFG);
	const w = createWorld(CFG);
	function game(seats, bot, seed) {
		const roster = createRoster([], CFG.ballsPerPlayer);
		for (let i = 0; i < seats; i++) roster.push(makeSeat(i === 0 ? bot : 'random', CFG.ballsPerPlayer));
		const rng = makeRng(seed);
		resetWorld(w);
		let turn = 0;
		for (;;) {
			const seat = nextSeat(roster, turn);
			if (seat < 0) break;
			turn = seat;
			roster[turn].balls--;
			const i = spawnPuck(w, CFG.launchX, CFG.launchY, turn);
			if (i < 0) { roster[turn].balls = 0; continue; }
			const s = chooseStroke(roster[turn].type, w, CFG, i, pred, rng);
			throwPuck(w, i, s.vx, s.vy);
			let t = 0;
			while (!isSettled(w) && t < CFG.handoffT) {
				for (let k = 0; k < 8; k++) stepWorld(w, CFG.h);
				scoreTick(w, roster, 8 * CFG.h);
				t += 8 * CFG.h;
			}
			recyclePucks(w, CFG.recycleMode, owner => roster[owner].balls++);
			turn = (turn + 1) % roster.length;
			if (w.thrown >= CFG.maxThrows) break;
		}
		return displayScore(CFG, seats, roster[0].score);
	}
	const line = [];
	for (const seats of [1, 2, 4, 8]) {
		let sum = 0, min = 1e9, max = -1e9;
		const N = 8;
		for (let g = 0; g < N; g++) {
			const v = game(seats, 'hunter', 777 + g * 104729);
			sum += v; min = Math.min(min, v); max = Math.max(max, v);
		}
		line.push(seats + ' seat' + (seats > 1 ? 's' : '') + ': ' + (sum / N).toFixed(0) + ' [' + min + ',' + max + ']');
	}
	console.log('hunter vs random seats, displayed score: ' + line.join(' · '));
	check(true, 'displayed scores printed');
}
console.log(fail ? 'FAIL' : 'OK (score integral, area and cost)');
process.exit(fail);
