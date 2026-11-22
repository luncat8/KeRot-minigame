// Diagnostic: what does a single bot throw look like on the default vs notsobigdisk board?
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

function diagnose(label) {
	console.log('\n=== ' + label + ' ===');
	console.log('board ' + CFG.boardW.toFixed(3) + 'x' + CFG.boardH.toFixed(3) + ' disk(' + CFG.diskX.toFixed(3) + ',' + CFG.diskY.toFixed(3) + ') diskR ' + CFG.diskR.toFixed(4) +
		' puckR ' + CFG.puckR.toFixed(4) + ' omega ' + CFG.omega.toFixed(4) + ' holdR ' + holdRadius(CFG).toFixed(4) +
		' muK ' + muKEff(CFG).toFixed(4) + ' patternScale ' + patternScale(CFG).toFixed(4));
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	const roster = createRoster(['keeper'], CFG.ballsPerPlayer);
	const rng = makeRng(12345);
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
	// strategicTargets targets
	strategicTargets(w, CFG, 0);
	for (let g = 0; g < 5; g++) {
		const t = botTargets[g];
		console.log('  target[' + g + '] = (' + t.x.toFixed(3) + ',' + t.y.toFixed(3) + ') v0=' + t.v0.toFixed(3));
	}
	const s = chooseStroke('keeper', w, CFG, i, pred, rng, roster);
	console.log('  chosen stroke: vx=' + s.vx.toFixed(3) + ' vy=' + s.vy.toFixed(3) + ' |v|=' + Math.hypot(s.vx, s.vy).toFixed(3));
	const stopDist = Math.hypot(s.vx, s.vy) ** 2 / (2 * muKEff(CFG) * CFG.g);
	console.log('  bare-ice stop distance from launch: ' + stopDist.toFixed(3) + ' m');
	throwPuck(w, i, s.vx, s.vy);
	let t = 0, n = 0;
	while (!isSettled(w) && t < CFG.handoffT) {
		stepWorld(w, CFG.h); t += CFG.h; n++;
	}
	console.log('  after handoff: puck at (' + w.x[0].toFixed(3) + ',' + w.y[0].toFixed(3) + ') st=' + w.st[0] +
		' dist from disk centre ' + Math.hypot(w.x[0] - CFG.diskX, w.y[0] - CFG.diskY).toFixed(4));
	console.log('  puck red rate (puckRate): ' + puckRate(w, 0).toFixed(4));
	// also what the rate is if parked exactly on the aim
	const aim = botTargets[1];
	console.log('  aim point dist from disk centre: ' + Math.hypot(aim.x - CFG.diskX, aim.y - CFG.diskY).toFixed(4) +
		' (full-cover limit ' + (CFG.diskR - CFG.puckR).toFixed(4) + ')');
}

applyCfg(PRESETS.default);
diagnose('default board');
const setup = parseQuery('?preset=notsobigdisk');
applyCfg(setup);
diagnose('notsobigdisk preset');
