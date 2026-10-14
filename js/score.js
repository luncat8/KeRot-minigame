// Scoring: a seat is paid for the red area of the big disk his pucks cover.
//   seat.score += dt * Σ_pucks ∫∫_{puck ∩ disk} R(x, y) dA
// R is the red channel of the pixel field.js paints there (0…255), so what is bright
// on the board is what pays. It is monotone in the field value — 55 at v = −1,
// 245 at v = 0, 255 at v = +1 — which is all the score needs: the cold lobes are
// what a player pays for, and nothing pays more than it looks like it should.
//
// Two things keep it cheap enough to run over every puck every frame:
//   - R is read from a grid baked once over the disk (SC_LUT_N), so a cell costs a
//     bilinear lookup instead of the four exp() of the field itself;
//   - the covered area is the exact circle-circle lens physics already integrates
//     (diskOverlap, one acos per puck), and the puck's sample pattern — the same
//     equal-area cells the friction uses — only estimates the mean red over it, so a
//     puck hanging over the rim is not quantised down to the cell size.
// Both are measured in experiments/scoring.js. Node-safe.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./field.js'), require('./physics.js'));

const SC_LUT_N = 96; // red grid over the disk's bounding square: 1.7 cm cells at R = 0.8
const SC_LUT_W = SC_LUT_N + 1; // nodes per side (cell corners, so the rim is a node)
const RED_MAX = 255; // fieldColor's ceiling (v = +1); the display reference uses it

let _lut = null;
const _rgb = [0, 0, 0];
// Red channel over the disk, in disk-local metres, baked once. The field is fixed in
// the disk's frame, so this never needs rebuilding: the disk's rotation is applied to
// the sample point, never to the grid.
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
function scoreLUT(cfg) { if (!_lut) _lut = bakeScoreLUT(cfg); return _lut; }

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
const _rate = { red: 0, area: 0 };
const _sov = { a: 0, cx: 0, cy: 0, d: 0, qd: 0, qf: 0, px: 0, py: 0 };
// One puck's contribution. The covered area is exact — the circle-circle lens physics
// already integrates (diskOverlap) — and the pattern only estimates the *mean* red
// over the covered part, so a puck hanging over the rim is not quantised down to the
// cell size, which is the error the shortcut would otherwise show.
// Cells keep their world-axis offsets, so the pattern is rotated by −θ once, at the
// puck's centre, and both the clip test and the lookup happen in the disk's frame.
function rateOf(w, i) {
	const cfg = w.cfg, r = cfg.puckR;
	const a = diskOverlap(w, i, _sov);
	if (a <= 0) { _rate.red = 0; _rate.area = 0; return; }
	const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
	const c = _geo.c, s = _geo.s;
	const lx = c * dx + s * dy, ly = -s * dx + c * dy;
	const near = cfg.diskR - r;
	const whole = dx * dx + dy * dy <= near * near; // every cell lands on the disk
	let sum = 0, cells = 0;
	for (let k = 0; k < FR_RINGS; k++) {
		const rad = FR_RAD[k] * r;
		for (let j = 0; j < FR_RAYS; j++) {
			const rx = rad * FR_COS[j], ry = rad * FR_SIN[j];
			const px = lx + c * rx + s * ry, py = ly - s * rx + c * ry;
			if (!whole && px * px + py * py > _geo.R2) continue;
			sum += lutRed(px, py); cells++;
		}
	}
	_rate.area = a * Math.PI * r * r;
	_rate.red = cells > 0 ? _rate.area * (sum / cells) : 0;
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

if (typeof module !== 'undefined') module.exports = { scoreRate, scoreRates, scoreTick, puckRate, puckArea, scoreRef, displayScore };
