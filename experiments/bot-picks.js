// What each bot profile picks, on six fixed boards: the strokes `chooseStroke` returns and
// the votes `chooseVote` asks for, printed to six decimals. It is a diff tool, not a
// measurement — a change to the bots' *machinery* (a new argument, a shared scratch record,
// a candidate group reordered) is only safe if the picks themselves did not move, and this
// says so in a second. Run the same file against two checkouts and diff the output:
//	git worktree add ../base HEAD --detach
//	diff <(node experiments/bot-picks.js) <(node experiments/bot-picks.js ../base)
//	git worktree remove --force ../base
// Boards 0…5 hold one to six pucks (locked and asleep, three owners), so a pick that
// depends on riders, on whose throw comes next, or on the stock a seat has left is covered.
const dir = process.argv[2] || require('path').join(__dirname, '..');
Object.assign(globalThis, require(dir + '/js/physics.js'), require(dir + '/js/score.js'), require(dir + '/js/players.js'),
	require(dir + '/js/rules.js'), require(dir + '/js/predict.js'), require(dir + '/js/bots.js'), require(dir + '/js/vote.js'));
const w = createWorld(CFG), pred = createPredictor(CFG);
const rows = [];
for (let t = 0; t < 6; t++) {
	resetWorld(w);
	for (let k = 0; k < 4 + t; k++) {
		const i = spawnPuck(w, 0.9 + 0.13 * k, 0.7 + 0.11 * ((k * 7) % 5), k % 3);
		w.st[i] = k % 2 ? ST_LOCKED : ST_SLEEP; w.om[i] = CFG.omega;
	}
	const roster = createRoster(['keeper', 'hunter', 'blackhole', 'random'], 3);
	for (let s = 0; s < 4; s++) { roster[s].balls = 1 + ((s + t) % 3); roster[s].score = 10 * s; }
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, t % 4);
	for (const name of ['keeper', 'hunter', 'retriever', 'blackhole', 'balanced', 'random']) {
		const s = chooseStroke(name, w, CFG, i, pred, makeRng(1000 + t), roster);
		rows.push(name + ' ' + s.vx.toFixed(6) + ' ' + s.vy.toFixed(6));
		const v = chooseVote(name, w, CFG, t % 4, roster, (t + 1) % 4, makeRng(77 + t));
		rows.push('  vote ' + v.kind + ' ' + v.value.toFixed(4));
	}
}
console.log(rows.join('\n'));
