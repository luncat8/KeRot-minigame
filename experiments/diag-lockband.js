// Map the feed lock band: for each feed radius and kv, which FEED_DA angles lock
// on default vs notsobigdisk. Run: node experiments/diag-lockband.js
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

const FEED_FRAC = [0.70, 0.82, 0.92];
const FEED_DA = [-0.02618, 0, 0.02618, 0.05236];

function sweep(label) {
	console.log('\n=== ' + label + ' ===');
	console.log('diskR ' + CFG.diskR.toFixed(4) + ' puckR ' + CFG.puckR.toFixed(4) + ' omega ' + CFG.omega.toFixed(4) +
		' holdR ' + holdRadius(CFG).toFixed(4) + ' muK ' + CFG.muK + ' launch(' + CFG.launchX.toFixed(3) + ',' + CFG.launchY.toFixed(3) + ')');
	const dh = holdRadius(CFG), cap = CFG.diskR - CFG.puckR - 0.01;
	const w = createWorld(CFG);
	for (let r = 0; r < FEED_FRAC.length; r++) {
		const rf = Math.min(FEED_FRAC[r] * dh, cap);
		if (rf <= CFG.puckR) continue;
		const f = feedTangent(CFG, CFG.launchX, CFG.launchY, rf);
		if (!f) continue;
		// fraction of the chord over the disk: contact circle diskR + puckR, full
		// coverage diskR - puckR; report both.
		const chord = Math.hypot(f.x - CFG.launchX, f.y - CFG.launchY);
		const inContact = chordInside(CFG, f, CFG.diskR + CFG.puckR);
		const inFull = chordInside(CFG, f, CFG.diskR - CFG.puckR);
		console.log('\nrf=' + rf.toFixed(4) + ' v0=' + f.v0.toFixed(4) + ' chord=' + chord.toFixed(4) +
			' overDisk(contact)=' + (100 * inContact / chord).toFixed(1) + '% full=' + (100 * inFull / chord).toFixed(1) + '%');
		console.log('  kv    ' + FEED_DA.map(a => (a * 180 / Math.PI).toFixed(1).padStart(6)).join('') + '   (x = LOCK)');
		for (let kv = 0.82; kv <= 1.141; kv += 0.02) {
			const speed = f.v0 * kv;
			if (speed < CFG.vThrowMin) continue;
			let row = kv.toFixed(2).padStart(5) + ' ';
			for (let a = 0; a < FEED_DA.length; a++) {
				const ang = f.ang + FEED_DA[a];
				resetWorld(w);
				w.n = 0;
				const j = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
				throwPuck(w, j, Math.cos(ang) * speed, Math.sin(ang) * speed);
				let t = 0;
				while (!isSettled(w) && t < CFG.handoffT) { stepWorld(w, CFG.h); t += CFG.h; }
				const locked = w.st[0] === ST_LOCKED;
				const d = Math.hypot(w.x[0] - CFG.diskX, w.y[0] - CFG.diskY);
				row += (locked ? '  X' : (d <= CFG.diskR + CFG.puckR ? ' . ' : '   ')).padStart(6);
			}
			console.log(row);
		}
	}
}

function chordInside(cfg, f, rad) {
	// length of segment launch->tangent inside the circle of `rad` about the disk
	const x0 = cfg.launchX, y0 = cfg.launchY, x1 = f.x, y1 = f.y;
	const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
	const fx = x0 - cfg.diskX, fy = y0 - cfg.diskY;
	const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - rad * rad;
	const disc = b * b - 4 * a * c;
	if (disc <= 0) return 0;
	const sq = Math.sqrt(disc);
	let t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
	t0 = Math.max(0, Math.min(1, t0)); t1 = Math.max(0, Math.min(1, t1));
	return (t1 - t0) * L;
}

applyCfg(PRESETS.default);
sweep('default');
applyCfg(parseQuery('?preset=notsobigdisk'));
sweep('notsobigdisk');