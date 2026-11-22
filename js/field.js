// Scalar field painted on the big disk: v ∈ [−1, 1] in disk-local metres, blue −1,
// pale 0, red +1. It is fixed in the disk's frame and turns with it. The score is the
// red channel of this paint (js/score.js), so a schema is a score map as much as a look —
// which is why every schema shares the one palette below: its red channel rises with v,
// so nothing pays more than it looks like it should.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));
// Shipped disk radius the schemas' coordinates are authored at: patternScale(cfg)
// scales every schema proportionally to cfg.diskR and cfg.scoreScale (1 = 100%).
const DISK_REF_R = CFG.diskR;

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
function patternScale(cfg) { return (cfg.diskR / DISK_REF_R) * (cfg.scoreScale || 1); }
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
	const s = DISK_SCHEMAS[cfg.diskSchema], f = patternScale(cfg);
	if (f !== 1) { ux /= f; uy /= f; }
	return s.rings ? ringField(s, ux, uy) : blobField(s, ux, uy);
}
// World point -> rotate by -theta into disk-local frame, then evaluate.
function fieldWorld(cfg, x, y, theta) {
	const dx = x - cfg.diskX, dy = y - cfg.diskY;
	const c = Math.cos(theta), s = Math.sin(theta);
	return fieldLocal(cfg, c * dx + s * dy, -s * dx + c * dy);
}
// Diverging palette: -1 blue -> 0 pale -> +1 red. Writes rgb into out[0..2]. The red
// channel is the pay curve (js/score.js): CFG.payBlue is its blue endpoint, CFG.payBend
// the exponent that bends it between the anchors — below 1 lifts the mid values toward
// pale, above 1 presses them toward the endpoint. Monotone for every allowed setting
// (experiments/curve.js), and the ceiling at v = +1 stays 255, so RED_MAX holds. G and
// B run on the same bent curve, so the colour path from blue through pale to red never
// changes hue — only where along v it sits.
const PALE = 245; // the red channel at v = 0; the blue endpoint bends toward it
function fieldColor(v, out) {
	const e = Math.pow(v < 0 ? -v : v, CFG.payBend);
	if (v < 0) { out[0] = PALE + (CFG.payBlue - PALE) * e; out[1] = PALE - 155 * e; out[2] = 250 - 10 * e; }
	else { out[0] = PALE + 10 * e; out[1] = PALE - 165 * e; out[2] = 250 - 190 * e; }
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

if (typeof module !== 'undefined') module.exports = { DISK_REF_R, DISK_SCHEMAS, patternScale, fieldLocal, fieldWorld, fieldColor, bakeFieldCanvas };
