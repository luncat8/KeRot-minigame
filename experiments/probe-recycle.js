// Where do the recycled pucks sleep on notsobigdisk? Solo keeper, log every
// throw's end state and every recyclable position before it is taken.
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

applyCfg(parseQuery('?preset=notsobigdisk'));
const TICK = 8;
const w = createWorld(CFG);
const pred = createPredictor(CFG);
const roster = createRoster(['keeper'], CFG.ballsPerPlayer);
const rng = makeRng(4242);
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
	const sp = Math.hypot(s.vx, s.vy), idx = w.n - 1;
	let t = 0;
	while (!isSettled(w) && t < CFG.handoffT) {
		for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h);
		scoreTick(w, roster, TICK * CFG.h);
		t += TICK * CFG.h;
	}
	const d = Math.hypot(w.x[idx] - CFG.diskX, w.y[idx] - CFG.diskY);
	// recyclable pucks before the take
	const will = [];
	for (let k = 0; k < w.n; k++) if (puckWouldRecycle(w, k, CFG.recycleMode)) will.push('(' + w.x[k].toFixed(2) + ',' + w.y[k].toFixed(2) + ',st' + w.st[k] + ')');
	console.log('throw #' + w.thrown + ' |v|=' + sp.toFixed(3) + ' ang=' + Math.atan2(s.vy, s.vx).toFixed(3) +
		' end(' + w.x[idx].toFixed(2) + ',' + w.y[idx].toFixed(2) + ') d=' + d.toFixed(3) + ' st=' + w.st[idx] +
		(will.length ? '  RECYCLABLE: ' + will.join(' ') : ''));
	recycled += recyclePucks(w, CFG.recycleMode, giveBack);
	turn = (turn + 1) % roster.length;
	if (w.thrown >= CFG.maxThrows) break;
}
beginSettle(w);
while (!w.settled) { for (let k = 0; k < TICK; k++) stepWorld(w, CFG.h); scoreTick(w, roster, TICK * CFG.h); }
recycled += recyclePucks(w, CFG.recycleMode, giveBack);
console.log('final raw=' + roster[0].score.toFixed(1) + ' throws=' + w.thrown + ' recycled=' + recycled + ' board=' + w.n);