// Sweep the feed launch speed and report where the puck ends / locks.
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

function sweep(label) {
	console.log('\n=== ' + label + ' ===');
	console.log('diskR ' + CFG.diskR.toFixed(4) + ' puckR ' + CFG.puckR.toFixed(4) + ' omega ' + CFG.omega.toFixed(4) +
		' holdR ' + holdRadius(CFG).toFixed(4) + ' launch(' + CFG.launchX.toFixed(3) + ',' + CFG.launchY.toFixed(3) + ')');
	const dh = holdRadius(CFG), cap = CFG.diskR - CFG.puckR - 0.01;
	const rf = Math.min(0.82 * dh, cap);
	const f = feedTangent(CFG, CFG.launchX, CFG.launchY, rf);
	console.log('feed rf=' + rf.toFixed(4) + ' (cap ' + cap.toFixed(4) + ') tangent(' + f.x.toFixed(3) + ',' + f.y.toFixed(3) + ') v0=' + f.v0.toFixed(4) +
		' chord=' + Math.hypot(f.x - CFG.launchX, f.y - CFG.launchY).toFixed(4));
	console.log('feed band speeds: ' + FEED_DKV.map(d => (f.v0 * (f.kv + d)).toFixed(3)).join(', ') +
		' (kv centre ' + f.kv.toFixed(3) + ', v0 ' + f.v0.toFixed(4) + ')');
	const w = createWorld(CFG);
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
	console.log('speed  stopD   endD    locked  st   note');
	for (let kv = 0.80; kv <= 1.101; kv += 0.02) {
		const speed = f.v0 * kv;
		if (speed < CFG.vThrowMin) continue;
		resetWorld(w);
		w.n = 0;
		const j = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
		throwPuck(w, j, Math.cos(f.ang) * speed, Math.sin(f.ang) * speed);
		let t = 0;
		while (!isSettled(w) && t < CFG.handoffT) { stepWorld(w, CFG.h); t += CFG.h; }
		const d = Math.hypot(w.x[0] - CFG.diskX, w.y[0] - CFG.diskY);
		const stopD = speed * speed / (2 * muKEff(CFG) * CFG.g);
		const locked = w.st[0] === ST_LOCKED;
		const note = locked ? 'LOCK' : (d <= CFG.diskR + CFG.puckR ? 'on-disk' : (d < CFG.diskR + CFG.puckR + 0.1 ? 'near' : 'off'));
		console.log(speed.toFixed(3).padStart(6) + ' ' + stopD.toFixed(3).padStart(6) + ' ' + d.toFixed(3).padStart(6) + ' ' +
			String(locked).padStart(6) + ' ' + String(w.st[0]).padStart(3) + '  ' + note);
	}
}

const FEED_DKV = [-0.04, 0, 0.04];
applyCfg(parseQuery('?preset=default'));
sweep('default');
applyCfg(parseQuery('?preset=notsobigdisk'));
sweep('notsobigdisk');
