// Rim-feed capture band: throw the puck from the launch lane along the tangent of
// the hold circle on the co-rotating side, around the solved feed speed, and report
// where it ends on the rim6 disk (state, radius, disk-local spot, red rate).
// A scoring bot only beats random on rim6 if a band of these strokes locks on a lobe.
Object.assign(globalThis, require('../js/field.js'), require('../js/physics.js'), require('../js/score.js'), require('../js/rules.js'));
CFG.diskSchema = 'rim6';

const w = createWorld(CFG);
// The same solve js/bots.js does for its group 4 target: tangent of the hold circle,
// speed that leaves the surface velocity at arrival after friction.
const dh = holdRadius(CFG), rf = Math.min(0.85 * dh, CFG.diskR - CFG.puckR - 0.01);
const ox = CFG.launchX - CFG.diskX, oy = CFG.launchY - CFG.diskY, od = Math.hypot(ox, oy);
const beta = Math.atan2(oy, ox), alpha = Math.acos(rf / od);
let tx = 0, ty = 0, base = 0;
for (const side of [-1, 1]) {
	const a = beta + side * alpha;
	const px = CFG.diskX + rf * Math.cos(a), py = CFG.diskY + rf * Math.sin(a);
	const along = ((px - CFG.launchX) * -Math.sin(a) + (py - CFG.launchY) * Math.cos(a)) * CFG.omega;
	if (along > 0 || side === 1) {
		tx = px; ty = py; base = Math.atan2(py - CFG.launchY, px - CFG.launchX);
		if (along > 0) break;
	}
}
const chord = Math.hypot(tx - CFG.launchX, ty - CFG.launchY), vs = Math.abs(CFG.omega) * rf;
const v0 = Math.sqrt(vs * vs + 2 * muKEff(CFG) * CFG.g * chord);
console.log('hold radius ' + dh.toFixed(3) + ' m, feed at r=' + rf.toFixed(3) + ' m, tangent (' + tx.toFixed(2) + ', ' + ty.toFixed(2) +
	'), chord ' + chord.toFixed(2) + ' m, surface ' + vs.toFixed(2) + ' m/s, solved v0 ' + v0.toFixed(2) + ' m/s');

function shot(da, kv, theta0) {
	resetWorld(w);
	w.theta = theta0 || 0;
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
	const v = v0 * kv;
	throwPuck(w, i, Math.cos(base + da) * v, Math.sin(base + da) * v);
	let t = 0;
	while (!isSettled(w) && t < 6) { stepWorld(w, CFG.h); t += CFG.h; }
	if (w.n === 0) return { state: 'holed', d: 0, loc: 0, rate: 0, t: t };
	const i0 = w.n - 1; // the only puck (swap-removal is irrelevant with n=1... keep the last slot)
	const dx = w.x[i0] - CFG.diskX, dy = w.y[i0] - CFG.diskY, d = Math.hypot(dx, dy);
	const c = Math.cos(w.theta), s = Math.sin(w.theta);
	const loc = Math.atan2(-s * dx + c * dy, c * dx + s * dy);
	return { state: w.st[i0] === ST_LOCKED ? 'LOCK ' : w.st[i0] === ST_SLEEP ? 'sleep' : 'slide',
		d: d / CFG.diskR, loc: loc, rate: puckRate(w, i0), t: t };
}

console.log('theta0=0:  da\\kv   0.70    0.85    1.00    1.15    1.30');
for (const da of [-0.10, -0.05, 0, 0.05, 0.10]) {
	let line = (da >= 0 ? ' ' : '') + da.toFixed(2) + '  ';
	for (const kv of [0.70, 0.85, 1.00, 1.15, 1.30]) {
		const r = shot(da, kv);
		line += '  ' + r.state + (r.d ? r.d.toFixed(2) : '--');
	}
	console.log(line);
}
// Wide scan for a lock band around the solved direction: da in [-0.30, +0.30] rad,
// kv in [0.4, 1.8]. + = locked, . = slid past / ejected, o = asleep on the ice,
// x = caught by a black hole.
console.log('scan: does any (angle offset, speed factor) of the feed direction lock?');
const kas = [];
for (let da = -0.30; da <= 0.3001; da += 0.02) kas.push(da);
const kvs = [];
for (let kv = 0.4; kv <= 1.8001; kv += 0.05) kvs.push(kv);
let locks = 0, first = null;
console.log('da\\kv ' + kvs.map(v => (v < 1 ? ' ' : '') + v.toFixed(2)).join(' '));
for (let krow = kas.length - 1; krow >= 0; krow--) {
	const da = kas[krow];
	let line = (da >= 0 ? ' ' : '') + da.toFixed(2) + '  ';
	for (const kv of kvs) {
		const r = shot(da, kv);
		const mark = r.state === 'holed' ? 'x' : r.state === 'LOCK ' ? '+' : r.state === 'sleep' && r.d < 1.02 ? '*' : '.';
		if (mark === '+') { locks++; if (!first) first = { da: da, kv: kv, r: r }; }
		line += '    ' + mark;
	}
	console.log(line);
}
console.log('locks in scan: ' + locks + ' of ' + (kas.length * kvs.length));
if (first) console.log('first lock: da ' + first.da.toFixed(2) + ' kv ' + first.kv.toFixed(2) + ' -> d/R ' + first.r.d.toFixed(3) +
	', disk-local ' + (first.r.loc * 180 / Math.PI).toFixed(0) + '°, rate ' + first.r.rate.toFixed(1) + '/s');

// The objective the bots actually chase: the 4 s score integral of one throw on an
// empty rim6 board, over the same (angle, speed) grid, at four disk phases.
// Cells are red·m²·s ×10³ (a perfect lobe lock for the full window would be ≈ 112).
Object.assign(globalThis, require('../js/predict.js'));
const pred = createPredictor(CFG);
function shotValue(da, kv, theta0) {
	resetWorld(w);
	w.theta = theta0;
	const i = spawnPuck(w, CFG.launchX, CFG.launchY, 0);
	const v = v0 * kv;
	predictStroke(pred, w, i, Math.cos(base + da) * v, Math.sin(base + da) * v, CFG.handoffT, true);
	return pred.scoreBySeat[0];
}
console.log('4 s score integral x1000 over (da, kv), empty board, theta0 = 0 / 30 / 60 / 90 deg:');
for (const theta0 of [0, 30, 60, 90]) {
	const rows = [];
	for (const da of kas) {
		let line = [];
		for (const kv of kvs) line.push(Math.round(1000 * shotValue(da, kv, theta0 * Math.PI / 180)));
		rows.push(line);
	}
	let best = { v: -1, da: 0, kv: 0 };
	console.log('theta0=' + theta0 + ':');
	console.log('da\\kv ' + kvs.map(v => String(Math.round(v * 100)).padStart(4)).join(''));
	for (let krow = kas.length - 1; krow >= 0; krow--) {
		for (let kvI = 0; kvI < kvs.length; kvI++) if (rows[krow][kvI] > best.v) best = { v: rows[krow][kvI], da: kas[krow], kv: kvs[kvI] };
		console.log((kas[krow] >= 0 ? ' ' : '') + kas[krow].toFixed(2) + ' ' + rows[krow].map(v => String(v).padStart(4)).join(''));
	}
	console.log('best at theta0=' + theta0 + ': da ' + best.da.toFixed(2) + ', kv ' + best.kv.toFixed(2) + ' -> ' + best.v);
}
