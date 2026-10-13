// Gates the return rules: shape/area, the on-disk exemption, and what each rule does
// to a headless round (random bot, fixed seeds). 'zones' is the eject fan, 'advance'
// the wedge behind the disk plus the launch lane.
Object.assign(globalThis, require('../js/physics.js'), require('../js/score.js'), require('../js/players.js'),
	require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'));
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

// The other rule: the wedge the disk stands in front of, plus the lane it is thrown
// from — mirror image of the fan, so a puck has to get past the disk and out of its
// own box. Area is ½·boardH·diskX + lane, less the disk quarter inside the wedge.
{
	const v = ADVANCE_ZONES;
	let inZone = 0, total = 0;
	const n = 600;
	for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
		const x = (gx + 0.5) * CFG.boardW / n, y = (gy + 0.5) * CFG.boardH / n;
		total++;
		if (inReturnZone(CFG, 'advance', x, y)) inZone++;
	}
	const share = 100 * inZone / total;
	console.log('wedge+lane share of the board = ' + share.toFixed(1) + ' %');
	check(share > 18 && share < 28, 'wedge + lane covers about a quarter of the board');
	check(inReturnZone(CFG, 'advance', CFG.launchX, CFG.launchY), 'the launch box is in the lane');
	check(inReturnZone(CFG, 'advance', 0.15, 0.30) && inReturnZone(CFG, 'advance', 0.15, 1.90), 'both corners behind the disk return');
	check(inReturnZone(CFG, 'advance', 0.15, CFG.diskY), 'the wedge axis is live just past the disk guard');
	check(!inReturnZone(CFG, 'advance', CFG.diskX - 0.85, CFG.diskY), 'a puck still touching the disk is exempt');
	check(!inReturnZone(CFG, 'advance', 2.0, 0.15), 'the far lane stays (it scores)');
	check(!inReturnZone(CFG, 'advance', v.lx - 0.05, CFG.diskY), 'the lane starts at the throw box');
	check(inReturnZone(CFG, 'advance', CFG.boardW, CFG.boardH), 'the lane runs to the right wall');
	check(inReturnZone(CFG, 'advance', 0, 0) && inReturnZone(CFG, 'advance', 0, CFG.boardH), 'the wedge base is the whole left wall');
	check(!inReturnZone(CFG, 'advance', CFG.diskX + 0.5, CFG.diskY), 'disk centre is guarded');
	for (let d = 0; d <= CFG.diskR; d += 0.05) {
		if (inReturnZone(CFG, 'advance', CFG.diskX - d, CFG.diskY)) { console.log('FAIL on-disk point recycled at d=' + d); fail = 1; }
	}
}

// Round effect: same seeds, same bot, fan on/off. `none` also gives the a-priori
// death map — with nothing ever removed, every throw dies exactly once and stays.
// One seat plays alone here: what is being measured is the return rule, not the game.
function playGame(seed, mode, deaths) {
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	const rng = makeRng(seed);
	const roster = createRoster(['random'], CFG.ballsPerPlayer);
	const seen = new Uint8Array(MAX_PUCKS);
	let recycled = 0;
	for (;;) {
		const seat = nextSeat(roster, 0);
		if (seat < 0) break;
		roster[seat].balls--;
		const i = spawnPuck(w, CFG.launchX, CFG.launchY, seat);
		if (i < 0) { roster[seat].balls = 0; continue; }
		seen[i] = 0; // the pending puck is sleeping on purpose: not a death yet
		const s = chooseStroke('random', w, CFG, i, pred, rng);
		throwPuck(w, i, s.vx, s.vy);
		let t = 0;
		while (!isSettled(w) && t < CFG.maxResolve) { stepWorld(w, CFG.h); t += CFG.h; }
		if (deaths) for (let k = 0; k < w.n; k++) {
			if (w.st[k] === ST_SLEEP && !seen[k]) { seen[k] = 1; deaths.push({ x: w.x[k], y: w.y[k] }); }
			else if (w.st[k] === ST_SLIDE) seen[k] = 0;
		}
		recycled += recyclePucks(w, mode, owner => roster[owner].balls++);
		if (w.thrown >= CFG.maxThrows) break;
	}
	beginSettle(w);
	while (!w.settled) stepWorld(w, CFG.h);
	recycled += recyclePucks(w, mode, owner => roster[owner].balls++);
	return { thrown: w.thrown, board: w.n, recycled };
}
const GAMES = 40, SEED0 = 20261013;
const agg = { none: { r: 0, b: 0, t: 0 }, zones: { r: 0, b: 0, t: 0 }, advance: { r: 0, b: 0, t: 0 } };
const dead = [];
let caught = 0, shelf = 0, lane = 0, wedge = 0, home = 0;
for (let g = 0; g < GAMES; g++) {
	const seed = SEED0 + g * 7919;
	for (const mode of ['none', 'zones', 'advance']) {
		const r = playGame(seed, mode, mode === 'none' ? dead : null);
		agg[mode].r += r.recycled; agg[mode].b += r.board; agg[mode].t += r.thrown;
	}
}
for (const p of dead) {
	if (inReturnZone(CFG, 'advance', p.x, p.y)) { if (p.x < ADVANCE_ZONES.lx) wedge++; else home++; }
	if (inReturnZone(CFG, 'zones', p.x, p.y)) caught++;
	else if (p.x < 0.6) shelf++;
	else lane++;
}
for (const mode of ['none', 'zones', 'advance']) {
	const a = agg[mode];
	console.log(mode.padEnd(6) + ' mean throws ' + (a.t / GAMES).toFixed(1) + ', recycled ' + (a.r / GAMES).toFixed(1) +
		' (' + (100 * a.r / a.t).toFixed(0) + ' % of throws), board at the end ' + (a.b / GAMES).toFixed(1) + '/' + CFG.ballsPerPlayer);
}
console.log('a-priori death map (' + dead.length + ' deaths over ' + GAMES + ' games): fan ' + (100 * caught / dead.length).toFixed(0) +
	' %, left shelf ' + (100 * shelf / dead.length).toFixed(0) + ' %, other lanes ' + (100 * lane / dead.length).toFixed(0) + ' %');
console.log('same deaths under wedge+lane: wedge ' + (100 * wedge / dead.length).toFixed(0) +
	' %, launch lane ' + (100 * home / dead.length).toFixed(0) + ' %');
check(agg.none.t / GAMES === CFG.ballsPerPlayer, 'mode none: one throw per ball, no more');
check(agg.zones.r > 0 && agg.advance.r > 0 && agg.none.r === 0, 'only the return rules recycle');
check(agg.zones.t / GAMES > agg.none.t / GAMES && agg.advance.t / GAMES > agg.none.t / GAMES, 'return modes refund throws (rounds run longer)');
check(agg.zones.b / GAMES <= CFG.ballsPerPlayer + 0.001 && agg.advance.b / GAMES <= CFG.ballsPerPlayer + 0.001, 'the game still ends with every ball on the board');
check(wedge > 0 && home > 0, 'both halves of wedge+lane catch something');
console.log(fail ? 'FAIL' : 'OK (fan + wedge/lane shape, guards and round effect)');
process.exit(fail);
