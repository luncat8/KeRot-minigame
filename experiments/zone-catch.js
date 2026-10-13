// Gates the eject-fan return rule: shape/area, the on-disk exemption, and what the
// rule does to a headless round (random bot, fixed seeds).
Object.assign(globalThis, require('../js/physics.js'), require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'));
const fs = require('fs');
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

// Shape: area share and the handful of points that define the rule.
{
	let inFan = 0, total = 0;
	const n = 600;
	for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
		const x = (gx + 0.5) * CFG.boardW / n, y = (gy + 0.5) * CFG.boardH / n;
		total++;
		if (inReturnZone(CFG, 'zones', x, y)) inFan++;
	}
	const share = 100 * inFan / total;
	console.log('fan share of the board = ' + share.toFixed(1) + ' %');
	check(share > 25 && share < 36, 'fan area is about a third of the board');
	check(inReturnZone(CFG, 'zones', CFG.launchX, CFG.launchY), 'the launch box is inside the fan');
	check(inReturnZone(CFG, 'zones', 2.3, 1.10), 'fan axis point returns');
	check(!inReturnZone(CFG, 'zones', 2.0, 0.15), 'top lane outside the fan stays');
	check(!inReturnZone(CFG, 'zones', 0.3, 1.10), 'left shelf stays (it scores)');
	check(!inReturnZone(CFG, 'zones', 3.5, 0.02), 'only the two far corners bound the fan');
	check(!inReturnZone(CFG, 'zones', CFG.diskX + 0.5, CFG.diskY), 'disk centre is guarded');
	check(inReturnZone(CFG, 'zones', CFG.boardW, 0) && inReturnZone(CFG, 'zones', CFG.boardW, CFG.boardH), 'far corners are the base');
	for (let d = 0; d <= CFG.diskR; d += 0.05) {
		if (inReturnZone(CFG, 'zones', CFG.diskX + d, CFG.diskY)) { console.log('FAIL on-disk point recycled at d=' + d); fail = 1; }
	}
	check(!inReturnZone(CFG, 'none', 2.9, 1.10), 'mode none recycles nothing');
}

// Round effect: same seeds, same bot, fan on/off. `none` also gives the a-priori
// death map — with nothing ever removed, every throw dies exactly once and stays.
function playGame(seed, mode, deaths) {
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	const rng = makeRng(seed);
	const seen = new Uint8Array(MAX_PUCKS);
	let recycled = 0;
	for (;;) {
		const i = spawnPuck(w, CFG.launchX, CFG.launchY);
		seen[i] = 0; // the pending puck is sleeping on purpose: not a death yet
		const s = chooseStroke('random', w, CFG, i, pred, rng);
		throwPuck(w, i, s.vx, s.vy);
		let t = 0;
		while (!isSettled(w) && t < CFG.maxResolve) { stepWorld(w, CFG.h); t += CFG.h; }
		if (deaths) for (let k = 0; k < w.n; k++) {
			if (w.st[k] === ST_SLEEP && !seen[k]) { seen[k] = 1; deaths.push({ x: w.x[k], y: w.y[k] }); }
			else if (w.st[k] === ST_SLIDE) seen[k] = 0;
		}
		recycled += recyclePucks(w, mode);
		if (roundOver(w, CFG)) break;
	}
	beginSettle(w);
	while (!w.settled) stepWorld(w, CFG.h);
	recycled += recyclePucks(w, mode);
	return { score: totalScore(w), thrown: w.thrown, board: w.n, recycled };
}
const GAMES = 40, SEED0 = 20261013;
const agg = { none: { r: 0, b: 0, t: 0 }, zones: { r: 0, b: 0, t: 0 } };
const dead = [];
let caught = 0, shelf = 0, lane = 0;
for (let g = 0; g < GAMES; g++) {
	const seed = SEED0 + g * 7919;
	for (const mode of ['none', 'zones']) {
		const r = playGame(seed, mode, mode === 'none' ? dead : null);
		agg[mode].r += r.recycled; agg[mode].b += r.board; agg[mode].t += r.thrown;
	}
}
for (const p of dead) {
	if (inReturnZone(CFG, 'zones', p.x, p.y)) caught++;
	else if (p.x < 0.6) shelf++;
	else lane++;
}
for (const mode of ['none', 'zones']) {
	const a = agg[mode];
	console.log(mode.padEnd(6) + ' mean throws ' + (a.t / GAMES).toFixed(1) + ', recycled ' + (a.r / GAMES).toFixed(1) +
		' (' + (100 * a.r / a.t).toFixed(0) + ' % of throws), board at the end ' + (a.b / GAMES).toFixed(1) + '/' + CFG.poolSize);
}
console.log('a-priori death map (' + dead.length + ' deaths over ' + GAMES + ' games): fan ' + (100 * caught / dead.length).toFixed(0) +
	' %, left shelf ' + (100 * shelf / dead.length).toFixed(0) + ' %, other lanes ' + (100 * lane / dead.length).toFixed(0) + ' %');
check(agg.none.t / GAMES === CFG.poolSize, 'mode none: fixed 8-throw rounds');
check(agg.zones.r > 0 && agg.none.r === 0, 'only the fan recycles');
check(agg.zones.t / GAMES > agg.none.t / GAMES, 'fan mode refunds throws (rounds run longer)');
check(agg.zones.b / GAMES <= CFG.poolSize + 0.001, 'the round still ends with a full board');
console.log(fail ? 'FAIL' : 'OK (fan shape, guards and round effect)');
process.exit(fail);
