// Log every keeper throw during a full 6-bot game.
// Run: node experiments/diag-game6.js [preset]
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

applyCfg(parseQuery('?preset=' + (process.argv[2] || 'notsobigdisk')));
const BOTS = ['random', 'keeper', 'hunter', 'retriever', 'blackhole', 'balanced'];
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
		console.log('keeper throw #' + throwNo + ' |v|=' + Math.hypot(s.vx, s.vy).toFixed(3) + ' stop=' + stop.toFixed(3) +
			' tgt1=(' + botTargets[1].x.toFixed(3) + ',' + botTargets[1].y.toFixed(3) + ')' +
			' tgt2=(' + botTargets[2].x.toFixed(3) + ',' + botTargets[2].y.toFixed(3) + ')' +
			' tgt3=(' + botTargets[3].x.toFixed(3) + ',' + botTargets[3].y.toFixed(3) + ')' +
			' pucks=' + w.n);
	}
	throwPuck(w, i, s.vx, s.vy);
	let t = 0;
	while (!isSettled(w) && t < CFG.handoffT) {
		for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
		scoreTick(w, roster, TICK * CFG.h);
		t += TICK * CFG.h;
	}
	if (roster[turn].type === 'keeper') {
		// find the keeper's pucks and report their state
		let mine = [];
		for (let k = 0; k < w.n; k++) if (w.own[k] === turn) mine.push('(' + w.x[k].toFixed(2) + ',' + w.y[k].toFixed(2) + ')d=' + Math.hypot(w.x[k] - CFG.diskX, w.y[k] - CFG.diskY).toFixed(3) + 'st=' + w.st[k]);
		console.log('   keeper pucks after handoff: ' + mine.join(' '));
	}
	recycled += recyclePucks(w, CFG.recycleMode, owner => roster[owner].balls++);
	turn = (turn + 1) % roster.length;
	if (w.thrown >= CFG.maxThrows) break;
}
beginSettle(w);
while (!w.settled) { for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h); scoreTick(w, roster, TICK * CFG.h); }
recyclePucks(w, CFG.recycleMode, owner => roster[owner].balls++);
console.log('final raw: ' + roster.map(r => r.type + '=' + r.score.toFixed(1)).join(' '));
