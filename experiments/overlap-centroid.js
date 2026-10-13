// Gates the two claims the patch-centroid friction rests on:
//   1. the reported overlap area fraction equals an independent lens formula;
//   2. the reported centroid IS the area centroid, so the disk's linear surface
//      velocity sampled there is its exact average over the patch (checked with a
//      linear test field: mean(f over patch) == f(centroid)).
Object.assign(globalThis, require('../js/cfg.js'), require('../js/physics.js'));
const cfg = Object.assign({}, CFG);
const out = { a: 0, cx: 0, cy: 0, d: 0 };
const r = cfg.puckR, R = cfg.diskR;
let fail = 0;
// Independent closed form (Heron + two circle segments), the 0.1.0 code path.
function lensArea(d) {
	if (d >= R + r) return 0;
	if (d <= Math.abs(R - r)) return d + r <= R ? Math.PI * r * r : Math.PI * R * R;
	const c1 = (d * d + r * r - R * R) / (2 * d * r), c2 = (d * d + R * R - r * r) / (2 * d * R);
	const heron = Math.sqrt(Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)));
	return r * r * Math.acos(c1) + R * R * Math.acos(c2) - 0.5 * heron;
}
// Dense grid quadrature over the puck disc: area, centroid and the mean of a
// linear test field f(p) = fx·px + fy·py + c inside the patch.
function grid(puckX, puckY, fx, fy, c) {
	const n = 1200, span = 2 * r, h = span / n;
	let cnt = 0, sx = 0, sy = 0, sf = 0;
	for (let gy = 0; gy < n; gy++) {
		const py = puckY - r + (gy + 0.5) * h;
		for (let gx = 0; gx < n; gx++) {
			const px = puckX - r + (gx + 0.5) * h;
			const ddx = px - puckX, ddy = py - puckY;
			if (ddx * ddx + ddy * ddy > r * r) continue;
			const ex = px - cfg.diskX, ey = py - cfg.diskY;
			if (ex * ex + ey * ey > R * R) continue;
			cnt++; sx += px; sy += py; sf += fx * px + fy * py + c;
		}
	}
	if (!cnt) return { a: 0, cx: puckX, cy: puckY, fm: NaN };
	return { a: cnt * h * h / (Math.PI * r * r), cx: sx / cnt, cy: sy / cnt, fm: sf / cnt };
}
const w = createWorld(cfg);
console.log('d/R      a(calc)   a(here)   a(gr)     |    centroid err (mm)   | mean(f)-f(c) mm');
let worstA = 0, worstG = 0, worstC = 0, worstL = 0;
for (let k = 0; k <= 24; k++) {
	const ang = (k * 0.13) % (2 * Math.PI); // walk positions around the rim
	const d = (R - r - 0.05) + (r * 2 + 0.1) * (k % 6) / 5;
	const px = cfg.diskX + Math.cos(ang) * d, py = cfg.diskY + Math.sin(ang) * d;
	const i = spawnPuck(w, px, py);
	const a = diskOverlap(w, i, out);
	const g = grid(px, py, 0.7, -0.31, 0.5);
	const refA = lensArea(d) / (Math.PI * r * r);
	const empty = a === 0;
	const dc = empty ? 0 : Math.hypot(out.cx - g.cx, out.cy - g.cy) * 1000;
	const dl = empty ? 0 : Math.abs(0.7 * out.cx - 0.31 * out.cy + 0.5 - g.fm) * 1000;
	worstA = Math.max(worstA, Math.abs(a - refA));
	worstG = Math.max(worstG, Math.abs(a - g.a)); // grid quadrature's own error (~2e-4)
	worstC = Math.max(worstC, dc);
	worstL = Math.max(worstL, dl);
	console.log((d / R).toFixed(3) + '\t' + a.toFixed(6) + '\t' + refA.toFixed(6) + '\t' + g.a.toFixed(6) +
		'\t| ' + dc.toFixed(5) + '\t' + dl.toFixed(5));
	w.n = 0; // fresh state each probe
	if (dc > 0.05 || dl > 0.05) { console.log('FAIL centroid probe k=' + k); fail = 1; } // 0.05 mm
}
console.log('worst |a - closed form| = ' + worstA.toExponential(2) + ', |a - grid| = ' + worstG.toExponential(2) +
	', worst centroid err = ' + worstC.toFixed(4) + ' mm, worst linear-mean err = ' + worstL.toFixed(4) + ' mm');
if (worstA > 1e-9) { console.log('FAIL area fraction vs closed form'); fail = 1; }
if (worstG > 3e-4) { console.log('FAIL area fraction vs grid'); fail = 1; }
// Edge cases: exactly touching, tangent inside, degenerate puck centre on the axis.
{
	const i = spawnPuck(w, cfg.diskX + R + r, cfg.diskY);
	if (diskOverlap(w, i, out) !== 0) { console.log('FAIL touching must be 0'); fail = 1; }
	w.n = 0;
	const j = spawnPuck(w, cfg.diskX, cfg.diskY);
	if (diskOverlap(w, j, out) !== 1 || out.cx !== cfg.diskX) { console.log('FAIL centred must be full'); fail = 1; }
}
console.log(fail ? 'FAIL' : 'OK (area + centroid agree with independent quadrature)');
process.exit(fail);
