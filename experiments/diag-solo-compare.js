// Each bot alone on default vs notsobigdisk, to isolate its own play.
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

const BOTS = ['random', 'keeper', 'hunter', 'retriever', 'blackhole', 'balanced'];
const TICK = 8;

function playGame(w, pred, roster, rng) {
	const giveBack = owner => roster[owner].balls++;
	resetWorld(w);
	for (const s of roster) { s.balls = CFG.ballsPerPlayer; s.score = 0; }
	let turn = 0, recycled = 0;
	for (;;) {
		const seat = nextSeat(roster, turn);
		if (seat < 0) break;
		turn = seat;
		roster[turn].balls--;
		const i = spawnPuck(w, CFG.launchX, CFG.launchY, turn);
		if (i < 0) { roster[turn].balls = 0; continue; }
		const s = chooseStroke(roster[turn].type, w, CFG, i, pred, rng, roster);
		throwPuck(w, i, s.vx, s.vy);
		let t = 0;
		while (!isSettled(w) && t < CFG.handoffT) {
			for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
			scoreTick(w, roster, TICK * CFG.h);
			t += TICK * CFG.h;
		}
		recycled += recyclePucks(w, CFG.recycleMode, giveBack);
		turn = (turn + 1) % roster.length;
		if (w.thrown >= CFG.maxThrows) break;
	}
	beginSettle(w);
	while (!w.settled) { for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h); scoreTick(w, roster, TICK * CFG.h); }
	recyclePucks(w, CFG.recycleMode, giveBack);
	return { raw: roster[0].score, thrown: w.thrown, recycled, board: w.n };
}

function run(label) {
	console.log('\n=== ' + label + ' (diskR ' + CFG.diskR.toFixed(3) + ', patternScale ' + patternScale(CFG).toFixed(3) + ') ===');
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	for (const b of BOTS) {
		const roster = createRoster([b], CFG.ballsPerPlayer);
		const r = playGame(w, pred, roster, makeRng(4242));
		console.log('  ' + b.padEnd(10) + ' raw=' + r.raw.toFixed(1).padStart(7) + ' throws=' + r.thrown + ' recycled=' + r.recycled + ' board=' + r.board);
	}
}

applyCfg(parseQuery('?preset=default'));
run('default');
applyCfg(parseQuery('?preset=notsobigdisk'));
run('notsobigdisk');
