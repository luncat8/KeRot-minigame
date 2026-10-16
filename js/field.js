// Scalar field painted on the big disk: v ∈ [−1, 1] in disk-local metres, blue −1,
// pale 0, red +1. It is fixed in the disk's frame and turns with it. The score is the
// red channel of this paint (js/score.js), so a schema is a score map as much as a look —
// which is why every schema shares the one palette below: its red channel rises with v,
// so nothing pays more than it looks like it should.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));

// A circle of a 'rings' schema, given in units of the disk radius like the reference
// draft: v = 1 inside r − w, 0 at r − w/2, −1 from r outward.
function ring(x, y, r, w) { return { x: x * CFG.diskR, y: y * CFG.diskR, r: r * CFG.diskR, w: w * CFG.diskR }; }
// n circles centred on the rim: the disk shows the inner half of each.
function rimRings(n, r, w, phase) {
	const out = [];
	for (let k = 0; k < n; k++) { const a = phase + k * 2 * Math.PI / n; out.push(ring(Math.cos(a), Math.sin(a), r, w)); }
	return out;
}
function centres(rings) { return rings.map(c => ({ x: c.x, y: c.y })); }
function rimAims(n, d, phase) {
	const out = [];
	for (let k = 0; k < n; k++) { const a = phase + k * 2 * Math.PI / n; out.push({ x: d * CFG.diskR * Math.cos(a), y: d * CFG.diskR * Math.sin(a) }); }
	return out;
}
// Disk schemas (CFG.diskSchema). 'blobs' sums Gaussian sources over a bias (soft lobes);
// 'rings' takes the strongest circle distance field, so circles merge without adding up.
// aims: disk-local hot spots the bots steer at (js/bots.js) — on the rim schema they sit
// inside the hold radius, because a puck parked on the rim itself is flung off.
const DISK_SCHEMAS = {
	classic: {
		label: 'soft lobes', bias: -0.30,
		blobs: [
			{ x: 0.00, y: 0.00, w: 1.25, sigma: 0.256 },
			{ x: 0.36, y: 0.00, w: 0.85, sigma: 0.240 },
			{ x: -0.36, y: 0.36, w: -0.85, sigma: 0.240 },
			{ x: -0.36, y: -0.36, w: -0.85, sigma: 0.240 },
		],
		aims: [{ x: 0.36, y: 0.00 }],
	},
	// The kerot-s draft's zones, y flipped into this board's y-down frame.
	circles: {
		label: '3 red circles',
		rings: [ring(-0.30, -0.18, 0.55, 0.22), ring(0.24, 0.30, 0.45, 0.20), ring(0.36, -0.32, 0.35, 0.16)],
	},
	// r = 0.42 R leaves a 0.16 R blue gap between neighbours on the rim, and a puck centred
	// 0.70 R out on an axis still earns ~87 % of the maximum (experiments/field-preview.js).
	rim6: {
		label: '6 rim hemispheres',
		rings: rimRings(6, 0.42, 0.16, 0),
		aims: rimAims(6, 0.78, 0),
		lobes: 6, // six equivalent lobes: the bots lead rotating aims modulo one lobe period
	},
};
DISK_SCHEMAS.circles.aims = centres(DISK_SCHEMAS.circles.rings);
function blobField(s, ux, uy) {
	let v = s.bias;
	for (let i = 0; i < s.blobs.length; i++) {
		const b = s.blobs[i], dx = ux - b.x, dy = uy - b.y;
		v += b.w * Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
	}
	return v < -1 ? -1 : v > 1 ? 1 : v;
}
function ringField(s, ux, uy) {
	let best = 0;
	for (let i = 0; i < s.rings.length; i++) {
		const c = s.rings[i], dx = ux - c.x, dy = uy - c.y, v = (c.r - Math.sqrt(dx * dx + dy * dy)) / c.w;
		if (v > best) best = v;
	}
	return 2 * (best > 1 ? 1 : best) - 1;
}
function fieldLocal(cfg, ux, uy) {
	const s = DISK_SCHEMAS[cfg.diskSchema];
	return s.rings ? ringField(s, ux, uy) : blobField(s, ux, uy);
}
// World point -> rotate by -theta into disk-local frame, then evaluate.
function fieldWorld(cfg, x, y, theta) {
	const dx = x - cfg.diskX, dy = y - cfg.diskY;
	const c = Math.cos(theta), s = Math.sin(theta);
	return fieldLocal(cfg, c * dx + s * dy, -s * dx + c * dy);
}
// Diverging palette: -1 blue -> 0 pale -> +1 red. Writes rgb into out[0..2].
function fieldColor(v, out) {
	const t = v < 0 ? -v : v;
	if (v < 0) { out[0] = 245 - 190 * t; out[1] = 245 - 155 * t; out[2] = 250 - 10 * t; }
	else { out[0] = 245 + 10 * t; out[1] = 245 - 165 * t; out[2] = 250 - 190 * t; }
	return out;
}
// Bake the field over a box in disk-local metres into a canvas. Browser only.
function bakeFieldCanvas(box, ppm, cfg) {
	const wpx = Math.max(2, Math.round(box.w * ppm)), hpx = Math.max(2, Math.round(box.h * ppm));
	const cv = document.createElement('canvas');
	cv.width = wpx; cv.height = hpx;
	const ctx = cv.getContext('2d');
	const img = ctx.createImageData(wpx, hpx);
	const rgb = [0, 0, 0];
	for (let py = 0; py < hpx; py++) {
		for (let px = 0; px < wpx; px++) {
			fieldColor(fieldLocal(cfg, box.x + (px + 0.5) / ppm, box.y + (py + 0.5) / ppm), rgb);
			const o = (py * wpx + px) * 4;
			img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return cv;
}

if (typeof module !== 'undefined') module.exports = { DISK_SCHEMAS, fieldLocal, fieldWorld, fieldColor, bakeFieldCanvas };
