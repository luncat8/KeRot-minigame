// Renders real frames of the board to PNG through @napi-rs/canvas (experiments/tools,
// `npm install` there once), so a visual change can be looked at — and diffed — without
// a browser. Same stub technique as client-smoke.js, but with a real 2D context.
//   node experiments/render-frames.js [outDir] [--glass] [--decor=radial|hex]
//     [--mode=zones|advance|none] [--zone=hatch|wavy|rounded|arcs]
//     [--holes=classic|rim|well|triangle] [--cards=round]
//   node experiments/render-frames.js --tone
// Writes one PNG per (ui theme × disk schema) of a fixed mid-game board; --glass
// attaches the optional presentation skin and gives the files a -glass suffix,
// --decor picks the glass disk's etched finish.
// --tone renders the same board plain and with the skin and compares real pixels: the
// ice may not lift the room's light, and a mirrored lamp must add local contrast rather
// than a grey haze. It exits 1 when a budget is missed, so it works as a gate.
const fs = require('fs');
const path = require('path');
const { createCanvas, Path2D } = require('./tools/node_modules/@napi-rs/canvas');
let fail = 0;
Object.assign(globalThis, require('../js/cfg.js'), require('../js/field.js'), require('../js/physics.js'),
	require('../js/score.js'), require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'),
	require('../js/bots.js'));

const args = process.argv.slice(2);
const glass = args.includes('--glass'), tone = args.includes('--tone');
const arg = name => (args.find(a => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);
const decorArg = arg('decor'), modeArg = arg('mode') || 'zones', cardsArg = arg('cards');
if (arg('zone')) CFG.zoneStyle = arg('zone');
if (arg('holes')) CFG.holeStyle = arg('holes');
// Non-default shapes and modes name their files, so a sweep never overwrites the baseline.
const tag = (modeArg !== 'zones' ? '-' + modeArg : '') + (CFG.zoneStyle !== 'hatch' ? '-' + CFG.zoneStyle : '') +
	(CFG.holeStyle !== 'classic' ? '-' + CFG.holeStyle : '') + (cardsArg ? '-cards' : '');
const outDir = args.find(a => !a.startsWith('--')) || path.join(__dirname, 'logs', 'frames');
fs.mkdirSync(outDir, { recursive: true });
globalThis.Path2D = Path2D;
globalThis.window = { devicePixelRatio: 2, addEventListener() { } };
globalThis.document = { createElement: () => createCanvas(2, 2), getElementById: () => null };
// Node modules come in through require; only the browser-only parts are evaluated:
// bakeFieldCanvas (field.js) and the renderer.
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
// --glass attaches the same optional add-on the page loads lazily, so a PNG shows
// the real baked textures and shadows without a browser.
const src = fs.readFileSync(path.join(__dirname, '../js/fx-glass.js'), 'utf8')
	.replace(/\bconst GlassFX =/, 'globalThis.GlassFX =')
	.replace(/^if \(typeof module !== 'undefined'\).*$/gm, '');
eval(src);
function attachSkin(on) {
	if (!on) { Render.attach(null); return; }
	GlassFX.set({ visual: true, sound: false, decor: decorArg === 'hex' ? 'hex' : 'radial' });
	Render.attach(GlassFX.skin);
}
if (glass) attachSkin(true);

// A fixed mid-game board: pucks of four seats riding, straddling the rim, sliding,
// asleep on the floor, plus the pending puck with a stroke and its ghost.
function board() {
	const w = createWorld(CFG);
	w.theta = 0.6;
	const put = (x, y, owner, st, om, th) => {
		const i = spawnPuck(w, x, y, owner);
		w.st[i] = st; w.om[i] = om || 0; w.th[i] = th || 0;
		return i;
	};
	put(CFG.diskX + 0.25, CFG.diskY - 0.30, 0, ST_LOCKED, CFG.omega, 0.4);
	put(CFG.diskX - 0.45, CFG.diskY + 0.20, 1, ST_LOCKED, CFG.omega, 1.9);
	put(CFG.diskX + 0.05, CFG.diskY + 0.55, 2, ST_LOCKED, CFG.omega, 2.7);
	put(CFG.diskX + 0.86, CFG.diskY + 0.10, 3, ST_SLIDE, 2.4, 0.9); // straddling the rim
	put(2.30, 0.55, 1, ST_SLEEP, 0, 0.3);
	put(2.75, 1.70, 0, ST_SLIDE, -1.2, 2.2);
	const pending = put(CFG.launchX, CFG.launchY, 2, ST_SLEEP, 0, 0);
	const pred = createPredictor(CFG);
	predictStroke(pred, w, pending, -1.35, -0.12, CFG.maxResolve);
	const roster = createRoster(['human', 'balanced', 'blackhole', 'retriever'], CFG.ballsPerPlayer);
	roster[0].score = 160; roster[1].score = 420; roster[2].score = 90; roster[3].score = 230;
	roster[0].balls = 2; roster[1].balls = 2; roster[2].balls = 2; roster[3].balls = 3;
	const aim = { pending: pending, hasStroke: true, vx: -1.35, vy: -0.12 };
	return { w: w, aim: aim, opts: { ring: true, preview: true, mode: modeArg, theme: 'classic', cards: cardsArg }, pred: pred, roster: roster, turn: 2, resolveT: 0, state: 'aim' };
}
const themes = arg('theme') ? [arg('theme')] : Object.keys(Render.themes), schemas = arg('schema') ? [arg('schema')] : Object.keys(DISK_SCHEMAS);
const schema0 = CFG.diskSchema;
// Rec. 709 luma of the frame, and of a board-space patch of it: the mean says how much
// light the ice holds, the max says whether a single pixel still reads as a lamp.
const PATCH = {
	floor: [0.05, 0.90, 0.15, 0.40], // bare ice at the left edge, no paint under it
	plate: [1.20, 1.15, 0.30, 0.30], // the polished disk, clear of every lamp and its glow
	frame: [0, 0, CFG.boardW, CFG.boardH],
};
function luma(pixels, patch) {
	const kx = cv.width / CFG.boardW, ky = cv.height / CFG.boardH;
	const x0 = Math.round(patch[0] * kx), y0 = Math.round(patch[1] * ky);
	const w = Math.round(patch[2] * kx), h = Math.round(patch[3] * ky);
	let sum = 0, max = 0;
	for (let j = y0; j < y0 + h; j++) {
		for (let i = x0, o = (j * cv.width + i) * 4; i < x0 + w; i++, o += 4) {
			const l = 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
			sum += l; if (l > max) max = l;
		}
	}
	return { mean: sum / (w * h), max: max };
}
// The skin's own light: the frame is averaged into 16 px blocks first, because the thing
// worth gating is a *fog* — a lift of the local average — and not the grain of the ice,
// which is zero-mean and belongs to the material. Then: how much light the skin adds,
// and how much of it sits in a lamp's footprint. Light spread over the board is fog;
// light inside the tubes is a reflection.
const TONE_BLOCK = 16;
function downLuma(pixels) {
	const bw = Math.floor(cv.width / TONE_BLOCK), bh = Math.floor(cv.height / TONE_BLOCK);
	const out = new Float32Array(bw * bh);
	for (let by = 0; by < bh; by++) {
		for (let bx = 0; bx < bw; bx++) {
			let sum = 0;
			for (let j = by * TONE_BLOCK; j < (by + 1) * TONE_BLOCK; j++) {
				for (let i = bx * TONE_BLOCK, o = (j * cv.width + i) * 4; i < (bx + 1) * TONE_BLOCK; i++, o += 4) {
					sum += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
				}
			}
			out[by * bw + bx] = sum / (TONE_BLOCK * TONE_BLOCK);
		}
	}
	return { bw: bw, bh: bh, luma: out };
}
function addLight(plain, glass) {
	const a = downLuma(plain), b = downLuma(glass), bw = a.bw, bh = a.bh;
	const mask = new Uint8Array(bw * bh), lamps = GlassFX.lamps;
	const kx = bw / CFG.boardW, ky = bh / CFG.boardH;
	for (let k = 0; k < lamps.length; k++) {
		const l = lamps[k], hw = l.len * 0.62 * kx, hh = l.len * 0.56 * ky;
		const x0 = Math.max(0, Math.floor(l.x * kx - hw)), x1 = Math.min(bw, Math.ceil(l.x * kx + hw));
		const y0 = Math.max(0, Math.floor(l.y * ky - hh)), y1 = Math.min(bh, Math.ceil(l.y * ky + hh));
		for (let j = y0; j < y1; j++) mask.fill(1, j * bw + x0, j * bw + x1);
	}
	let added = 0, near = 0;
	for (let k = 0; k < bw * bh; k++) {
		const dl = b.luma[k] - a.luma[k];
		if (dl <= 0) continue;
		added += dl; if (mask[k]) near += dl;
	}
	return { mean: added / (bw * bh), share: added ? near / added : 1 };
}
function toneCheck(theme) {
	CFG.diskSchema = 'classic';
	const view = board();
	view.opts.theme = theme;
	const shot = [];
	for (const skin of [false, true]) {
		attachSkin(skin);
		Render.drawWorld(view);
		shot.push(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data);
	}
	attachSkin(false);
	const plain = {}, glass = {};
	for (const name in PATCH) { plain[name] = luma(shot[0], PATCH[name]); glass[name] = luma(shot[1], PATCH[name]); }
	const added = addLight(shot[0], shot[1]);
	// Three gates: the skin may deepen the ice, never lift the room — and the plate may get
	// glossier, but not milky. All are deltas against the same board drawn plain, so they
	// hold in either scheme.
	const rows = [
		{ name: ': the ice does not lift the floor light', value: glass.floor.mean - plain.floor.mean, budget: 5 },
		{ name: ': the ice does not lift the polished plate', value: glass.plate.mean - plain.plate.mean, budget: 12 },
		{ name: ': the ice does not lift the whole frame', value: glass.frame.mean - plain.frame.mean, budget: 5 },
	];
	for (let i = 0; i < rows.length; i++) {
		const gate = rows[i], ok = gate.value <= gate.budget;
		console.log((ok ? 'ok   ' : 'FAIL ') + theme + gate.name + ' (' + gate.value.toFixed(1) +
			' of max ' + gate.budget + ')');
		if (!ok) fail = 1;
	}
	// Reported, not gated: the skin also repaints the pucks and the polished plate, so part
	// of the added light is theirs and a share near 1 is not achievable.
	console.log('     ' + theme + ': light added ' + added.mean.toFixed(2) + ' luma, ' +
		Math.round(100 * added.share) + '% of it inside a lamp footprint');
}
if (tone) {
	for (const theme of themes) toneCheck(theme);
	process.exit(fail);
}
for (const theme of themes) {
	for (const schema of schemas) {
		CFG.diskSchema = schema;
		const view = board();
		view.opts.theme = theme;
		Render.drawWorld(view);
		const file = path.join(outDir, theme + '-' + schema + (glass ? '-glass' : '') + (glass && decorArg === 'hex' ? '-hex' : '') + tag + '.png');
		fs.writeFileSync(file, cv.toBuffer('image/png'));
		const pixels = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
		const tone = luma(pixels, PATCH.frame).mean;
		console.log('wrote ' + path.relative(process.cwd(), file) + ' (' + cv.width + 'x' + cv.height +
			', mean luma ' + tone.toFixed(1) + ')');
	}
}
CFG.diskSchema = schema0;
