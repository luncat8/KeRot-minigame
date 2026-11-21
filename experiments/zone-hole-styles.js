// Renders every (zoneStyle, holeShape) combination to PNG through @napi-rs/canvas
// (experiments/tools, `npm install` there once), so the new field markings can be
// looked at — and diffed — without a browser. Same stub technique as
// render-frames.js.
//   node experiments/zone-hole-styles.js [outDir]
// Writes one PNG per combination of a fixed board with the advance return rule,
// and prints a pixel sanity check per file: the share of zone-marking pixels, the
// hole body's mean colour, and the hole centres in board metres.
const fs = require('fs');
const path = require('path');
const { createCanvas, Path2D } = require('./tools/node_modules/@napi-rs/canvas');
Object.assign(globalThis, require('../js/cfg.js'), require('../js/field.js'), require('../js/physics.js'),
	require('../js/score.js'), require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'),
	require('../js/bots.js'));

const outDir = process.argv[2] || path.join(__dirname, 'logs', 'zone-hole');
fs.mkdirSync(outDir, { recursive: true });
globalThis.Path2D = Path2D;
globalThis.window = { devicePixelRatio: 2, addEventListener() { } };
globalThis.document = { createElement: () => createCanvas(2, 2), getElementById: () => null };
for (const f of ['../js/field.js', '../js/render.js']) {
	const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
		.replace(/^if \(typeof module !== 'undefined'\).*$/gm, '')
		.replace(/\bconst Render =/, 'globalThis.Render =')
		.replace(/\bfunction bakeFieldCanvas/, 'globalThis.bakeFieldCanvas = function bakeFieldCanvas');
	eval(src);
}
const BOX_W = 900, BOX_H = 550;
const cv = createCanvas(2, 2);
cv.style = {};
cv.parentElement = { clientWidth: BOX_W, clientHeight: BOX_H };
cv.getBoundingClientRect = () => ({ left: 0, top: 0 });
Render.setup(cv);

// A quiet board: the disk at θ = 0, two asleep pucks, no aim, advance rule on.
function board() {
	const w = createWorld(CFG);
	w.theta = 0;
	spawnPuck(w, CFG.diskX + 0.25, CFG.diskY - 0.30, 0);
	spawnPuck(w, 2.30, 0.55, 1);
	w.st[0] = ST_LOCKED; w.st[1] = ST_SLEEP;
	const roster = createRoster(['human', 'balanced'], CFG.ballsPerPlayer);
	return { w: w, aim: { pending: -1, hasStroke: false }, opts: { ring: true, preview: false, mode: 'advance', theme: 'classic' }, pred: null, roster: roster, turn: 0, resolveT: 0, state: 'aim' };
}
const ZONE_STYLES = ['straight', 'wavy', 'arc'];
const HOLE_SHAPES = ['flush', 'rounded', 'hemis'];
function frame() {
	Render.drawWorld(board());
	return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
}
// The shipped look (straight + flush) is the baseline: every other frame is
// reported by how much of it differs, which is exactly what a style switch moves.
let base = null;
for (const zone of ZONE_STYLES) {
	for (const hole of HOLE_SHAPES) {
		CFG.zoneStyle = zone;
		CFG.holeShape = hole;
		CFG.holes = holePositions(CFG);
		Render.resize(true);
		const px = frame();
		fs.writeFileSync(path.join(outDir, zone + '-' + hole + '.png'), cv.toBuffer('image/png'));
		let diff = 0;
		if (base) {
			for (let o = 0; o < px.length; o += 4) {
				if (Math.abs(px[o] - base[o]) + Math.abs(px[o + 1] - base[o + 1]) + Math.abs(px[o + 2] - base[o + 2]) > 24) diff++;
			}
		} else base = px;
		const kx = cv.width / CFG.boardW, ky = cv.height / CFG.boardH;
		const bodies = CFG.holes.map(h => {
			let s = [0, 0, 0], n = 0;
			const x0 = Math.max(0, Math.round((h.x - h.r * 0.6) * kx)), x1 = Math.min(cv.width, Math.round((h.x + h.r * 0.6) * kx));
			const y0 = Math.max(0, Math.round((h.y - h.r * 0.6) * ky)), y1 = Math.min(cv.height, Math.round((h.y + h.r * 0.6) * ky));
			for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
				const o = (y * cv.width + x) * 4;
				s[0] += px[o]; s[1] += px[o + 1]; s[2] += px[o + 2]; n++;
			}
			return n ? s.map(v => Math.round(v / n)).join(',') : '-';
		});
		const centres = CFG.holes.map(h => h.x.toFixed(2) + ',' + h.y.toFixed(2)).join(' ');
		console.log((zone + '-' + hole).padEnd(16), 'diff ' + (base ? (100 * diff / (px.length / 4)).toFixed(2) + '%' : '-') + ' baseline', 'body ' + bodies.join(' | '), 'centres ' + centres);
	}
}
console.log('wrote ' + (ZONE_STYLES.length * HOLE_SHAPES.length) + ' frames to ' + outDir);
