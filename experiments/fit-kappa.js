// Fit the on-disk friction retention kappa so the geometry-aware feed factor
// reproduces the measured lock band on default, then report it on both boards.
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/presets.js'));

function chordSplit(cfg, f, rad) {
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

function factors(cfg, rf, kappa) {
	const f = feedTangent(cfg, cfg.launchX, cfg.launchY, rf);
	const L = Math.hypot(f.x - cfg.launchX, f.y - cfg.launchY);
	const Ld = chordSplit(cfg, f, cfg.diskR + cfg.puckR);
	const mu = muKEff(cfg) * cfg.g;
	const vs = Math.abs(cfg.omega) * rf, vs2 = vs * vs;
	const v02 = vs2 + 2 * mu * L;
	const vg2 = vs2 + 2 * mu * (L - Ld + kappa * Ld);
	return { f, L, Ld, frac: Ld / L, v0: Math.sqrt(v02), kv: Math.sqrt(vg2 / v02) };
}
// solve kappa so kv(default, middle radius) === 0.90 exactly
applyCfg(PRESETS.default);
const dh = holdRadius(CFG), cap = CFG.diskR - CFG.puckR - 0.01;
const rfMid = Math.min(0.82 * dh, cap);
let lo = 0, hi = 2;
for (let it = 0; it < 80; it++) {
	const mid = (lo + hi) / 2;
	if (factors(CFG, rfMid, mid).kv < 0.90) lo = mid; else hi = mid;
}
const kappa = (lo + hi) / 2;
console.log('kappa = ' + kappa.toFixed(6));

for (const preset of ['default', 'notsobigdisk']) {
	applyCfg(parseQuery('?preset=' + preset));
	const dh2 = holdRadius(CFG), cap2 = CFG.diskR - CFG.puckR - 0.01;
	console.log('\n=== ' + preset + ' (muK ' + CFG.muK + ', omega ' + CFG.omega.toFixed(4) + ') ===');
	for (const fr of [0.70, 0.82, 0.92]) {
		const rf = Math.min(fr * dh2, cap2);
		if (rf <= CFG.puckR) continue;
		const r = factors(CFG, rf, kappa);
		console.log('  rf=' + rf.toFixed(4) + ' frac=' + (100 * r.frac).toFixed(1) + '%' +
			' v0=' + r.v0.toFixed(4) + ' kv_geo=' + r.kv.toFixed(4) +
			' shipped=' + r.f.kv.toFixed(4) +
			' grid=' + [-0.04, 0, 0.04].map(o => (r.f.kv + o).toFixed(3)).join(', '));
	}
}