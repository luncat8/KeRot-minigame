// Log every keeper throw during a full notsobigdisk game.
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

const applyCfgSetup = parseQuery('?preset=notsobigdisk');
applyCfg(applyCfgSetup);
const BOTS = ['keeper', 'hunter'];
const TICK = 8;
const w = createWorld(CFG);
const pred = createPredictor(CFG);
const roster = createRoster(BOTS, CFG.ballsPerPlayer);

resetWorld(w);
for (const s of roster) { s.balls = CFG.ballsPerPlayer; s.score = 0; }
let turn = 0, recycled = 0, throwNo = 0;
const rng = makeRng(777);
for (;;) {
	const seat = nextSeat(roster, turn);
	if (seat < 0) break;
	turn = seat;
	roster[turn].balls--;
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, turn);
	if (i < 0) { roster[turn].balls = 0; continue; }
	const s = chooseStroke(roster[turn].type, w, CFG, i, pred, rng, roster);
	throwNo++;
	if (roster[turn].type === 'keeper') {
		strategicTargets(w, CFG, i);
		const stop = Math.hypot(s.vx, s.vy) ** 2 / (2 * muKEff(CFG) * CFG.g);
		console.log('keeper throw #' + throwNo + ' launch(' + CFG.launchX.toFixed(2) + ',' + CFG.launchY.toFixed(2) + ')' +
			' |v|=' + Math.hypot(s.vx, s.vy).toFixed(3) + ' stop=' + stop.toFixed(3) +
			' tgt1=(' + botTargets[1].x.toFixed(3) + ',' + botTargets[1].y.toFixed(3) + ')' +
			' tgt4=(' + botTargets[4].x.toFixed(3) + ',' + botTargets[4].y.toFixed(3) + ') v0=' + botTargets[4].v0.toFixed(3) +
			' pucks=' + w.n);
	}
	throwPuck(w, i, s.vx, s.vy);
	let t = 0;
	while (!isSettled(w) && t < CFG.handoffT) {
		for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
		scoreTick(w, roster, TICK * CFG.h);
		t += TICK * CFG.h;
	}
	recycled += recyclePucks(w, CFG.recycleMode, owner => roster[owner].balls++);
	turn = (turn + 1) % roster.length;
	if (w.thrown >= CFG.maxThrows) break;
}
beginSettle(w);
while (!w.settled) { for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h); scoreTick(w, roster, TICK * CFG.h); }
recyclePucks(w, CFG.recycleMode, owner => roster[owner].balls++);
console.log('final keeper raw=' + roster[0].score.toFixed(1) + ' hunter raw=' + roster[1].score.toFixed(1) +
	' throws=' + w.thrown + ' recycled=' + recycled);
