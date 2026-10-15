// Renders real frames of the board to PNG through @napi-rs/canvas (experiments/tools,
// `npm install` there once), so a visual change can be looked at — and diffed — without
// a browser. Same stub technique as client-smoke.js, but with a real 2D context.
//   node experiments/render-frames.js [outDir]
// Writes one PNG per (ui theme × disk schema) of a fixed mid-game board.
const fs = require('fs');
const path = require('path');
const { createCanvas, Path2D } = require('./tools/node_modules/@napi-rs/canvas');
Object.assign(globalThis, require('../js/cfg.js'), require('../js/field.js'), require('../js/physics.js'),
	require('../js/score.js'), require('../js/players.js'), require('../js/rules.js'), require('../js/predict.js'),
	require('../js/bots.js'));

const outDir = process.argv[2] || path.join(__dirname, 'logs', 'frames');
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
	return { w: w, aim: aim, opts: { ring: true, preview: true, mode: 'zones', theme: 'classic' }, pred: pred, roster: roster, turn: 2, resolveT: 0, state: 'aim' };
}
const themes = Object.keys(Render.themes), schemas = Object.keys(DISK_SCHEMAS);
const schema0 = CFG.diskSchema;
for (const theme of themes) {
	for (const schema of schemas) {
		CFG.diskSchema = schema;
		const view = board();
		view.opts.theme = theme;
		Render.drawWorld(view);
		const file = path.join(outDir, theme + '-' + schema + '.png');
		fs.writeFileSync(file, cv.toBuffer('image/png'));
		console.log('wrote ' + path.relative(process.cwd(), file) + ' (' + cv.width + 'x' + cv.height + ')');
	}
}
CFG.diskSchema = schema0;
