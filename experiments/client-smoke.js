// Headless smoke of the browser-only layers: js/render.js and js/game.js driven
// through stub DOM/canvas objects. Catches "the frame loop throws" and input
// mapping regressions that the physics experiments cannot see.
Object.assign(globalThis, require('../js/physics.js'), require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'));
const fs = require('fs');
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

const ops = [];
function makeCtx() {
	return {
		fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1, textAlign: '', textBaseline: '', lineCap: '',
		save() { }, restore() { }, translate() { }, rotate(a) { ops.push('rotate' + (a === undefined ? '' : ':' + a.toFixed(3))); }, scale() { }, setTransform() { },
		beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, rect() { }, strokeRect() { }, fillRect() { },
		stroke() { ops.push('stroke'); }, fill(p, rule) { ops.push('fill' + (rule ? ':' + rule : '')); },
		clip(p, rule) { ops.push('clip' + (rule ? ':' + rule : '')); }, setLineDash() { }, drawImage() { },
		fillText(t) { ops.push('text:' + t); },
		createRadialGradient() { return { addColorStop() { } }; },
		createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
		putImageData() { },
	};
}
class Path2D {
	moveTo() { } lineTo() { } arc() { } rect() { } closePath() { } addPath() { }
}
function makeCanvas() {
	return { width: 0, height: 0, style: {}, clientWidth: 640, getContext: () => makeCtx(), addEventListener() { }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
}
globalThis.Path2D = Path2D;
globalThis.window = { devicePixelRatio: 2, addEventListener() { } };
globalThis.document = { createElement: () => makeCanvas(), getElementById: () => null };
// Browser layer files as they run on the page: classic scripts, no modules, their
// top-level consts become real globals (node would keep them module-local).
for (const f of ['../js/field.js', '../js/render.js', '../js/game.js']) {
	const src = fs.readFileSync(require('path').join(__dirname, f), 'utf8')
		.replace(/^if \(typeof module !== 'undefined'\).*$/m, '') // node-only export guard
		.replace(/\bconst (Render|Game) =/, 'globalThis.$1 =')
		.replace(/\bfunction bakeFieldCanvas/, 'globalThis.bakeFieldCanvas = function bakeFieldCanvas');
	eval(src);
}

// Render: zones on/off, every puck state, the ghost path, and the fan paths.
{
	const cv = makeCanvas();
	Render.setup(cv);
	const w = createWorld(CFG);
	const a = spawnPuck(w, 1.0, 1.8); throwPuck(w, a, 0.5, -0.2); w.om[a] = 3.5; w.th[a] = 1.1; // sliding + spinning
	const b = spawnPuck(w, CFG.diskX + 0.4, CFG.diskY); w.st[b] = ST_LOCKED; w.om[b] = CFG.omega;
	const c = spawnPuck(w, 2.6, 0.4); // sleeping
	const pred = createPredictor(CFG);
	const d = spawnPuck(w, CFG.launchX, CFG.launchY); // pending
	predictStroke(pred, w, d, -1.4, 0.1, CFG.maxResolve);
	const aim = { pending: d, hasStroke: true, vx: -1.4, vy: 0.1 };
	ops.length = 0;
	Render.drawWorld(w, aim, { ring: true, preview: true, mode: 'zones' }, pred);
	const withZones = ops.length;
	check(ops.includes('fill:evenodd') && ops.includes('clip:evenodd'), 'fan drawn with the on-disk hole (evenodd)');
	check(ops.includes('text:RETURN'), 'fan labelled');
	check(ops.includes('rotate:' + w.th[a].toFixed(3)), 'puck face rotates by the material angle');
	check(ops.filter(o => o.startsWith('rotate')).length >= 2, 'disk texture and puck sectors both rotate');
	ops.length = 0;
	Render.drawWorld(w, aim, { ring: false, preview: false, mode: 'none' }, null);
	check(!ops.includes('text:RETURN') && ops.length > 0, 'mode none draws no zone, still renders');
	check(withZones > ops.length, 'zones mode costs extra draw calls only');
	Render.resize();
	console.log('render smoke: ' + withZones + ' ops with the fan, ' + ops.length + ' without, no exceptions');
}
// Game: stroke mapping (plain + shift precision), ghost refresh on physics change,
// and a full bot round through the real state machine.
{
	Game.reset();
	check(Game.state === 'aim' && Game.pending >= 0, 'reset arms a pending puck');
	const speed = () => Math.hypot(Game.aim.vx, Game.aim.vy);
	Game.setStroke(-CFG.dragFull / 2, 0, false);
	const half = speed();
	Game.setStroke(-CFG.dragFull * 2, 0, false);
	const over = speed();
	Game.setStroke(-CFG.dragFull, 0, false);
	const full = speed();
	console.log('stroke mapping: half-drag ' + half.toFixed(3) + ', over-drag ' + over.toFixed(3) + ', full-drag ' + full.toFixed(3));
	check(Math.abs(half - (CFG.vMin + CFG.vMax) / 2) < 1e-9, 'half drag = mid range');
	check(over === CFG.vMax && full === CFG.vMax, 'over/at full drag clamp to vMax');
	// Shift precision: 4x finer per metre, continuous across the press and release.
	Game.setStroke(-0.45, 0, false);
	const base = speed();
	Game.setStroke(-0.45 - 0.09, 0, false);
	const coarse = speed() - base;
	Game.setStroke(-0.45, 0, false); // back to the anchor length
	Game.setStroke(-0.45, 0, true); // shift down: rebase at the current speed, no jump
	Game.setStroke(-0.45 - 0.09, 0, true); // only now does the finer slope act
	const fine = speed() - base;
	console.log('precision: 0.09 m of drag -> ' + coarse.toFixed(4) + ' m/s plain, ' + fine.toFixed(4) + ' m/s with shift');
	check(Math.abs(coarse - 0.09 * (CFG.vMax - CFG.vMin) / CFG.dragFull) < 1e-9, 'plain drag slope');
	check(Math.abs(fine - coarse * CFG.preciseGain) < 1e-9, 'shift gain = preciseGain');
	check(Math.abs(speed() - (base + fine)) < 1e-9, 'no jump at the shift press');
	Game.setStroke(-0.45 - 0.09, 0, false);
	check(Math.abs(speed() - (base + fine)) < 1e-9, 'no jump at the shift release');
	// Ghost refresh: a physics change must re-simulate the preview.
	Game.setStroke(-CFG.dragFull, 0.2, false);
	Game.tick(1 / 60);
	const before = Game.pred.endX;
	CFG.omega = 3.5;
	Game.invalidateGhost();
	Game.tick(1 / 60);
	const after = Game.pred.endX;
	CFG.omega = autoOmega(CFG);
	console.log('ghost vs ω: endX ' + before.toFixed(4) + ' at ' + CFG.omega.toFixed(3) + ' -> ' + after.toFixed(4) + '');
	check(before !== after, 'ghost re-simulated after a physics change');
	check(before === before && isFinite(after), 'ghost finite');
	// Full bot round through the real state machine.
	Game.reset();
	Game.setPlayer('hunter');
	let guard = 0;
	while (Game.state !== 'scored' && guard++ < 20000) {
		Game.tick(1 / 60);
		Game.beforeSteps();
		for (let s = 0; s < 8; s++) stepWorld(Game.world, CFG.h);
		Game.afterSteps(8 * CFG.h);
	}
	console.log('bot round: state = ' + Game.state + ', throws = ' + Game.world.thrown + ', board = ' + Game.world.n +
		', finalScore = ' + (Game.finalScore === null ? 'n/a' : Game.finalScore.toFixed(2)));
	check(Game.state === 'scored', 'round reaches SCORED');
	check(Game.world.thrown <= CFG.maxThrows, 'throw cap respected');
}
console.log(fail ? 'FAIL' : 'OK (render + game smoke)');
process.exit(fail);
