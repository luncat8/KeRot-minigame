// Scalar field: sum of Gaussian blobs in disk-local coords, plus a global bias.
// Rotating sources with the disk lets one expression score pucks on and off it.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));
function fieldLocal(cfg, ux, uy) {
	let v = FIELD_BIAS;
	for (let i = 0; i < FIELD_SOURCES.length; i++) {
		const s = FIELD_SOURCES[i];
		const dx = ux - s.x, dy = uy - s.y;
		v += s.w * Math.exp(-(dx * dx + dy * dy) / (2 * s.sigma * s.sigma));
	}
	return v < -1 ? -1 : v > 1 ? 1 : v;
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
// Bake the field over a box (world or disk-local coords) into a canvas. Browser only.
function bakeFieldCanvas(box, ppm, theta, cfg) {
	const wpx = Math.max(2, Math.round(box.w * ppm)), hpx = Math.max(2, Math.round(box.h * ppm));
	const cv = document.createElement('canvas');
	cv.width = wpx; cv.height = hpx;
	const ctx = cv.getContext('2d');
	const img = ctx.createImageData(wpx, hpx);
	const rgb = [0, 0, 0];
	for (let py = 0; py < hpx; py++) {
		for (let px = 0; px < wpx; px++) {
			const x = box.x + (px + 0.5) / ppm, y = box.y + (py + 0.5) / ppm;
			fieldColor(theta === null ? fieldLocal(cfg, x, y) : fieldWorld(cfg, x, y, theta), rgb);
			const o = (py * wpx + px) * 4;
			img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
		}
	}
	ctx.putImageData(img, 0, 0);
	return cv;
}

if (typeof module !== 'undefined') module.exports = { fieldLocal, fieldWorld, fieldColor };
