// Scoring: a seat is paid for the red area of the big disk his pucks cover.
//   seat.score += dt * Σ_pucks ∫∫_{puck ∩ disk} R(x, y) dA
// R is the red channel of the pixel field.js paints there (0…255), so what is bright
// on the board is what pays. It is monotone in the field value — 55 at v = −1,
// 245 at v = 0, 255 at v = +1 — which is all the score needs: blue is what a player
// pays for, and nothing pays more than it looks like it should.
//
// Two things keep it cheap enough to run over every puck every frame:
//   - R is read from a grid baked once per schema over the disk (SC_LUT_N), so a cell
//     costs a bilinear lookup instead of evaluating the field itself;
//   - the covered area is the exact circle-circle lens physics already integrates
//     (diskOverlap, one acos per puck), and the puck's sample pattern — the same
//     equal-area cells the friction uses — only estimates the mean red over it, so a
//     puck hanging over the rim is not quantised down to the cell size.
// Both are measured in experiments/scoring.js. Node-safe.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./field.js'), require('./physics.js'));

const SC_LUT_N = 128; // red grid over the disk's bounding square: 1.25 cm cells at R = 0.8 —
// finer only sharpens the edges the whole-puck pattern then aliases (experiments/scoring.js)
const SC_LUT_W = SC_LUT_N + 1; // nodes per side (cell corners, so the rim is a node)
const RED_MAX = 255; // fieldColor's ceiling (v = +1); the display reference uses it

const _luts = {}; // per disk schema
const _rgb = [0, 0, 0];
// Red channel over the disk, in disk-local metres, baked once per schema. The field is
// fixed in the disk's frame, so turning never rebuilds it: the disk's rotation is
// applied to the sample point, never to the grid.
function bakeScoreLUT(cfg) {
	const out = new Float32Array(SC_LUT_W * SC_LUT_W), step = 2 * cfg.diskR / SC_LUT_N;
	for (let j = 0; j < SC_LUT_W; j++) {
		const y = -cfg.diskR + j * step;
		for (let i = 0; i < SC_LUT_W; i++) {
			fieldColor(fieldLocal(cfg, -cfg.diskR + i * step, y), _rgb);
			out[j * SC_LUT_W + i] = _rgb[0];
		}
	}
	return out;
}
function scoreLUT(cfg) { return _luts[cfg.diskSchema] || (_luts[cfg.diskSchema] = bakeScoreLUT(cfg)); }

// Per-world geometry, refreshed once per score pass (not per puck): the disk's
// rotation and the grid scale.
const _geo = { c: 1, s: 0, lut: null, R: 0, R2: 0, k: 0 };
function setGeo(w) {
	const cfg = w.cfg;
	_geo.c = Math.cos(w.theta); _geo.s = Math.sin(w.theta);
	_geo.lut = scoreLUT(cfg);
	_geo.R = cfg.diskR; _geo.R2 = cfg.diskR * cfg.diskR;
	_geo.k = SC_LUT_N / (2 * cfg.diskR); // grid cells per metre
}
// Bilinear read of the baked grid at a disk-local point; clamped, so a point a hair
// outside the square (a cell straddling the rim) reads the rim value.
function lutRed(x, y) {
	const lut = _geo.lut, n = SC_LUT_N;
	let fx = (x + _geo.R) * _geo.k, fy = (y + _geo.R) * _geo.k;
	fx = fx < 0 ? 0 : fx > n ? n : fx;
	fy = fy < 0 ? 0 : fy > n ? n : fy;
	const ix = fx < n ? fx | 0 : n - 1, iy = fy < n ? fy | 0 : n - 1;
	const tx = fx - ix, ty = fy - iy;
	const r0 = iy * SC_LUT_W + ix, r1 = r0 + SC_LUT_W;
	const a = lut[r0], b = lut[r0 + 1], c = lut[r1], d = lut[r1 + 1];
	const top = a + (b - a) * tx;
	return top + (c + (d - c) * tx - top) * ty;
}
// Gauss–Legendre nodes and weights on [−1, 1], by Newton on the Legendre recurrence.
function gaussLegendre(n) {
	const x = new Float64Array(n), w = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), dp = 1;
		for (let it = 0; it < 100; it++) {
			let p0 = 1, p1 = z;
			for (let k = 2; k <= n; k++) { const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
			dp = n * (z * p1 - p0) / (z * z - 1);
			const dz = p1 / dp;
			z -= dz;
			if (Math.abs(dz) < 1e-15) break;
		}
		x[i] = z; w[i] = 2 / ((1 - z * z) * dp * dp);
	}
	return { x: x, w: w };
}
const LENS_A = gaussLegendre(16), LENS_T = gaussLegendre(4); // in angle, along each ray
const _rate = { red: 0, area: 0 };
const _sov = { a: 0, cx: 0, cy: 0, d: 0, qd: 0, qf: 0, px: 0, py: 0 };
const _lens = { sf: 0, sw: 0 };
// One puck's contribution. The covered area is exact — the circle-circle lens physics
// already integrates (diskOverlap) — and only the *mean* red over it is estimated.
// A puck wholly on the disk takes it from the friction's sample pattern; its cells
// keep their world-axis offsets, so the pattern is rotated by −θ once, at the puck's
// centre, and the lookups happen in the disk's frame.
function rateOf(w, i) {
	const cfg = w.cfg, r = cfg.puckR;
	const a = diskOverlap(w, i, _sov);
	if (a <= 0) { _rate.red = 0; _rate.area = 0; return; }
	const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
	const c = _geo.c, s = _geo.s;
	const lx = c * dx + s * dy, ly = -s * dx + c * dy;
	const near = cfg.diskR - r;
	_rate.area = a * Math.PI * r * r;
	if (dx * dx + dy * dy > near * near) { _rate.red = _rate.area * lensRed(lx, ly, r); return; }
	let sum = 0;
	for (let k = 0; k < FR_RINGS; k++) {
		const rad = FR_RAD[k] * r;
		for (let j = 0; j < FR_RAYS; j++) {
			const rx = rad * FR_COS[j], ry = rad * FR_SIN[j];
			sum += lutRed(lx + c * rx + s * ry, ly - s * rx + c * ry);
		}
	}
	_rate.red = _rate.area * (sum / FR_N);
}
// A puck over the rim covers a lens, often a thin one, and too few pattern cells land
// on it: a sliver got none and earned nothing, and where colour edges meet the rim
// (the rim schema) half-covered pucks were off by 6 %. So a lens is integrated on its
// own terms: rays from the puck centre (lx, ly, disk frame), each clipped to the disk
// exactly, with Gauss points along it (weight t, the polar area element) and Gauss
// points in angle over the arcs between the two points where the circles cross —
// inside an arc the clipped length is smooth, which is what Gauss needs.
function lensRed(lx, ly, r) {
	const R2 = _geo.R2, d2 = lx * lx + ly * ly, d = Math.sqrt(d2);
	const cg = (R2 - d2 - r * r) / (2 * r * d), gam = Math.acos(cg < -1 ? -1 : cg > 1 ? 1 : cg);
	const out = Math.atan2(ly, lx); // the crossings sit at out ± gam
	_lens.sf = 0; _lens.sw = 0;
	if (d2 < R2) lensArc(lx, ly, d2 - R2, r, out - gam, out + gam); // rays that leave the disk inside the puck
	lensArc(lx, ly, d2 - R2, r, out + gam, out + 2 * Math.PI - gam); // the rest: all of it, from off the disk
	return _lens.sw > 0 ? _lens.sf / _lens.sw : 0;
}
function lensArc(lx, ly, c2, r, a0, a1) {
	const am = 0.5 * (a0 + a1), ah = 0.5 * (a1 - a0);
	for (let k = 0; k < LENS_A.x.length; k++) {
		const phi = am + ah * LENS_A.x[k], ux = Math.cos(phi), uy = Math.sin(phi);
		const b = lx * ux + ly * uy, disc = b * b - c2;
		if (disc <= 0) continue;
		const q = Math.sqrt(disc), t0 = Math.max(0, -b - q), t1 = Math.min(r, -b + q);
		if (t1 <= t0) continue;
		const tm = 0.5 * (t0 + t1), th = 0.5 * (t1 - t0), wa = ah * LENS_A.w[k] * th;
		for (let g = 0; g < LENS_T.x.length; g++) {
			const t = tm + th * LENS_T.x[g], wt = wa * LENS_T.w[g] * t;
			_lens.sf += wt * lutRed(lx + t * ux, ly + t * uy); _lens.sw += wt;
		}
	}
}
// Red area a seat is holding right now (per second, before the dt).
function scoreRate(w, seat) {
	setGeo(w);
	let sum = 0;
	for (let i = 0; i < w.n; i++) if (w.own[i] === seat) { rateOf(w, i); sum += _rate.red; }
	return sum;
}
// All seat rates in one puck pass, used by the predictor at its score samples.
function scoreRates(w, out) {
	out.fill(0);
	setGeo(w);
	for (let i = 0; i < w.n; i++) {
		const owner = w.own[i];
		if (owner >= out.length) continue;
		rateOf(w, i); out[owner] += _rate.red;
	}
	return out;
}
// One pass over the pucks, every seat paid at once: O(pucks), not O(seats × pucks).
// dt is simulated seconds, so the total is frame-rate independent.
function scoreTick(w, roster, dt) {
	setGeo(w);
	for (let i = 0; i < w.n; i++) {
		rateOf(w, i);
		if (_rate.red > 0) roster[w.own[i]].score += dt * _rate.red;
	}
}
function puckRate(w, i) { setGeo(w); rateOf(w, i); return _rate.red; }
function puckArea(w, i) { setGeo(w); rateOf(w, i); return _rate.area; }

// Raw score is red·m²·s — an arbitrary unit that doubles when the game does. The
// reference is a perfect game of this size: every ball of a seat parked on the
// reddest pixel (RED_MAX) for the average life of a ball in the game (a ball thrown
// on turn t is live for the turns after it, so the average is (turns+1)/2 windows).
function scoreRef(cfg, seats) {
	const turns = seats * cfg.ballsPerPlayer;
	const rateMax = Math.PI * cfg.puckR * cfg.puckR * RED_MAX;
	return cfg.ballsPerPlayer * rateMax * cfg.handoffT * (turns + 1) / 2;
}
function displayScore(cfg, seats, raw) {
	const v = Math.round(cfg.scoreDisplayMax * raw / scoreRef(cfg, seats));
	return v < 0 ? 0 : v > cfg.scoreDisplayMax ? cfg.scoreDisplayMax : v;
}

if (typeof module !== 'undefined') module.exports = { scoreRate, scoreRates, scoreTick, puckRate, puckArea, scoreRef, displayScore, RED_MAX };
