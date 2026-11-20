// Headless smoke of the browser-only layers: js/render.js, js/score.js,
// js/players.js and js/game.js driven through stub DOM/canvas objects. Catches
// "the frame loop throws" and input mapping regressions that the physics
// experiments cannot see.
Object.assign(globalThis, require('../js/physics.js'), require('../js/score.js'), require('../js/players.js'),
	require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'), require('../js/vote.js'), require('../js/presets.js'));
const fs = require('fs');
const path = require('path');
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

const ops = [];
const linearGradients = []; // floor fills: recreated when the board's geometry changes
let bakes = 0; // createImageData calls: one per field texture baked
function makeCtx() {
	return {
		fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1, textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
		save() { }, restore() { }, translate() { }, rotate(a) { ops.push('rotate' + (a === undefined ? '' : ':' + a.toFixed(3))); }, scale() { }, setTransform() { },
		beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, rect() { }, strokeRect() { ops.push('strokeRect'); }, fillRect() { ops.push('fillRect'); },
		stroke() { ops.push('stroke'); }, fill(p, rule) { ops.push('fill' + (rule ? ':' + rule : '')); },
		clip(p, rule) { ops.push('clip' + (rule ? ':' + rule : '')); }, setLineDash() { }, drawImage() { },
		fillText(t) { ops.push('text:' + t); }, strokeText(t) { ops.push('outline:' + t); },
		createRadialGradient() { return { addColorStop() { } }; },
		createLinearGradient(x0, y0, x1, y1) { const g = { x0, y0, x1, y1, stops: [] }; linearGradients.push(g); g.addColorStop = at => g.stops.push(at); return g; },
		createImageData(w, h) { bakes++; return { data: new Uint8ClampedArray(w * h * 4) }; },
		putImageData() { },
	};
}
// Recording Path2D: the zone shapes are baked into Path2D objects the stub canvas
// never sees, so the geometry has to be checked where it is built.
const paths = [];
const num = v => (Math.round(v * 1000) / 1000).toFixed(3);
class Path2D {
	constructor() { this.ops = []; paths.push(this); }
	moveTo(x, y) { this.ops.push('moveTo:' + num(x) + ',' + num(y)); }
	lineTo(x, y) { this.ops.push('lineTo:' + num(x) + ',' + num(y)); }
	arc(x, y, r) { this.ops.push('arc:' + num(x) + ',' + num(y) + ',' + num(r)); }
	rect(x, y, w, h) { this.ops.push('rect:' + num(x) + ',' + num(y) + ',' + num(w) + ',' + num(h)); }
	closePath() { this.ops.push('close'); }
	addPath(p) { for (const o of p.ops) this.ops.push(o); }
}
function makeCanvas() {
	return { width: 0, height: 0, style: {}, clientWidth: 640, parentElement: { dataset: {}, clientWidth: 900, clientHeight: 550 },
		getContext: () => makeCtx(), getBoundingClientRect() { return { left: 0, top: 0, width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; },
		_events: {}, _captured: -1,
		addEventListener(type, fn) { (this._events[type] = this._events[type] || []).push(fn); },
		removeEventListener(type, fn) { this._events[type] = (this._events[type] || []).filter(f => f !== fn); },
		dispatch(type, ev) { for (const fn of this._events[type] || []) fn(ev); },
		setPointerCapture(id) { this._captured = id; },
		hasPointerCapture(id) { return this._captured === id; },
	};
}
globalThis.Path2D = Path2D;
const winListeners = {};
globalThis.window = { devicePixelRatio: 2, addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); } };
function fireWindow(type, ev) { for (const fn of winListeners[type] || []) fn(ev); }
globalThis.document = { createElement: () => makeCanvas(), getElementById: () => null };
// Browser layer files as they run on the page: classic scripts, no modules, their
// top-level consts become real globals (node would keep them module-local). Strict
// mode turns an assignment to an undeclared name — a silent implicit global in a
// classic script — into a ReferenceError the moment the code runs.
for (const f of ['../js/field.js', '../js/score.js', '../js/players.js', '../js/render.js', '../js/game.js', '../js/warp.js', '../js/ui.js', '../js/help.js', '../js/view.js']) {
	const src = fs.readFileSync(require('path').join(__dirname, f), 'utf8')
		.replace(/^if \(typeof module !== 'undefined'\).*$/gm, '') // node-only require/export guards
		.replace(/\bconst (Render|Game|UI|Help|View|SEAT_COLORS|SEAT_TYPES|SEAT_LABELS|SEAT_NAMES|SC_LUT_N|SC_LUT_W|RED_MAX|WARP_MAX_TRIES) =/, 'globalThis.$1 =')
		.replace(/\bfunction (bakeFieldCanvas|createGame|createWarp)/, 'globalThis.$1 = function $1');
	eval('"use strict";' + src);
}

// Render: zones on/off, every puck state, the ghost path, the seat HUD and the fan paths.
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
	const roster = createRoster(['human', 'hunter'], CFG.ballsPerPlayer);
	roster[1].score = 123.4;
	const view = { w: w, aim: aim, opts: { ring: true, preview: true, mode: 'zones', theme: 'classic' }, pred: pred, roster: roster, turn: 1, resolveT: 1.5, state: 'resolve' };
	ops.length = 0;
	Render.drawWorld(view);
	const withZones = ops.length;
	check(ops.includes('fill:evenodd') && ops.includes('clip:evenodd'), 'fan drawn with the on-disk hole (evenodd)');
	check(ops.includes('text:RETURN'), 'fan labelled');
	check(ops.includes('text:VOID'), 'both permanent black holes are visible');
	check(ops.includes('rotate:' + w.th[a].toFixed(3)), 'puck face rotates by the material angle');
	check(ops.filter(o => o.startsWith('rotate')).length >= 2, 'disk texture and puck sectors both rotate');
	// The HUD: one score per seat, the balls of each, and the turn window draining.
	const want = 'text:' + displayScore(CFG, 2, roster[1].score);
	check(ops.includes('text:0') && ops.includes(want), 'a score is drawn for every seat', want);
	check(want !== 'text:0', 'a seat that earned shows a score', want);
	const bars = ops.filter(o => o === 'fillRect').length;
	check(bars >= 2 * 2 + 2, 'seat cells and the turn-window bar are filled', String(bars));
	// A speed vote: each seat's vote in its cell, the vote's time under the whole row.
	roster[1].voteLabel = '+.10'; view.state = 'vote'; view.voteT = 0.4;
	ops.length = 0;
	Render.drawWorld(view);
	check(ops.includes('text:+.10'), 'a seat\'s speed vote is shown in its cell');
	check(ops.filter(o => o === 'fillRect').length === bars, 'the vote bar replaces the turn-window bar', String(ops.filter(o => o === 'fillRect').length));
	const rule0 = CFG.speedVote;
	CFG.speedVote = 'off'; ops.length = 0;
	Render.drawWorld(view);
	check(!ops.includes('text:+.10'), 'no vote badge while the rule is off');
	CFG.speedVote = rule0; roster[1].voteLabel = ''; view.state = 'resolve';
	// The other return rule: same hole, plus the launch lane, and two labels.
	ops.length = 0;
	view.opts = { ring: false, preview: false, mode: 'advance', theme: 'classic' };
	Render.drawWorld(view);
	const wedge = ops.length;
	check(ops.includes('fill:evenodd') && ops.includes('clip:evenodd'), 'wedge+lane drawn with the on-disk hole (evenodd)');
	check(ops.filter(o => o === 'text:RETURN').length === 2, 'both halves of wedge+lane are labelled');
	const zoned = paths.filter(p => p.ops.some(o => o.startsWith('arc:')));
	const lanes = zoned.filter(p => p.ops.some(o => o.startsWith('rect:')));
	check(lanes.length >= 1, 'the launch lane is baked into a zone path');
	check(zoned.length - lanes.length >= 1, 'the fan path stays a plain triangle');
	check(lanes.some(p => p.ops.some(o => o === 'arc:' + num(CFG.diskX) + ',' + num(CFG.diskY) + ',' + num(CFG.diskR + CFG.puckR))),
		'the lane shares the fan\'s on-disk guard');
	ops.length = 0;
	view.opts = { ring: false, preview: false, mode: 'none', theme: 'classic' };
	Render.drawWorld(view);
	check(!ops.includes('text:RETURN') && ops.length > 0, 'mode none draws no zone, still renders');
	check(withZones > ops.length, 'zones mode costs extra draw calls only');
	// The board is sized to fit its box, not to the window: it keeps its aspect, never
	// exceeds the box on either axis, and fills it on the tight one — that is what
	// keeps the page from ever growing a scrollbar.
	Render.resize();
	const cssW = parseFloat(cv.style.width), cssH = parseFloat(cv.style.height);
	check(Math.abs(cssW / cssH - CFG.boardW / CFG.boardH) < 0.01, 'the fitted board keeps the board aspect');
	check(cssW <= 900.5 && cssH <= 550.5, 'the fitted board fits its box', cssW + 'x' + cssH);
	check(cssW >= 899.5 || cssH >= 549.5, 'the fitted board fills its box on the tight axis', cssW + 'x' + cssH);
	const wide = makeCanvas();
	wide.parentElement = { clientWidth: 1200, clientHeight: 400 }; // the height binds here
	Render.setup(wide);
	check(parseFloat(wide.style.height) === 400 && Math.abs(parseFloat(wide.style.width) - 400 * CFG.boardW / CFG.boardH) < 1,
		'a wide box fits the board by its height', wide.style.width + 'x' + wide.style.height);
	check(wide.width <= 1200 * 3, 'the backing store is capped by a pixel budget', String(wide.width));
	// Smartphone horizontal widescreen (e.g. 740x284 visible below mobile URL bar):
	// height binds, CSS size never exceeds the available box on either axis.
	const phoneLand = makeCanvas();
	phoneLand.parentElement = { clientWidth: 521, clientHeight: 280 };
	Render.setup(phoneLand);
	check(parseFloat(phoneLand.style.height) === 280 && parseFloat(phoneLand.style.width) <= 521,
		'horizontal smartphone box fits strictly inside visible height', phoneLand.style.width + 'x' + phoneLand.style.height);
	const fitBox = makeCanvas();
	fitBox.parentElement = { clientWidth: 900, clientHeight: 300, dataset: { fit: '1' } };
	Game.fitBoard(3);
	Render.setup(fitBox);
	check(Math.abs(fitBox.width / CFG.boardW - fitBox.height / CFG.boardH) < 0.001, 'fit keeps circles round');
	check(parseFloat(fitBox.style.height) === 300 && parseFloat(fitBox.style.width) === 900,
		'a fit canvas fills both pane dimensions', fitBox.style.width + 'x' + fitBox.style.height);
	check(Render.toWorld(0, 0).x === 0 && Math.abs(Render.toWorld(0, 0).y) < 0.01,
		'a fit board is pinned to the top left, not centred', JSON.stringify(Render.toWorld(0, 0)));
	const corner = Render.toWorld(900, 300);
	check(Math.abs(corner.x - CFG.boardW) + Math.abs(corner.y - CFG.boardH) < 1e-9, 'the pane corner maps to the board corner');
	// Refitting changes boardH, so the kerot-s floor gradient has to be rebuilt too;
	// otherwise the lower part of the ice keeps the old gradient's last colour.
	const grads0 = linearGradients.length;
	Render.resize(Game.fitBoard(1));
	check(linearGradients.slice(grads0).some(g => Math.abs(g.y1 - CFG.boardH) < 1e-9),
		'a geometry change rebakes the floor fills at the new height', String(CFG.boardH));
	Render.resize(Game.fitBoard(3.6 / 2.2));
	const sideBox = makeCanvas();
	sideBox.parentElement = { clientWidth: 900, clientHeight: 300, dataset: { fit: '0' } };
	Render.setup(sideBox);
	check(Math.abs(parseFloat(sideBox.style.height) - 300) < 1, 'the side layout still letterboxes both ways', sideBox.style.width + 'x' + sideBox.style.height);
	const huge = makeCanvas();
	huge.parentElement = { clientWidth: 4000, clientHeight: 2444 };
	Render.setup(huge);
	huge.parentElement = { clientWidth: 3200, clientHeight: 1955 };
	Render.resize();
	check(parseFloat(huge.style.width) <= 3200 && parseFloat(huge.style.height) <= 1955,
		'CSS dimensions update even when the backing store stays at the pixel cap', huge.style.width + 'x' + huge.style.height);
	// A window resize is a backing-store change, not a repaint of the disk texture: the
	// sprite is a stepped map that only grows when the surface outgrows it, so a drag or a
	// rotation just moves its draw scale.
	{
		const b0 = bakes;
		huge.parentElement = { clientWidth: 1200, clientHeight: 733 };
		Render.resize();
		check(bakes === b0, 'a refit without a geometry change repaints no disk texture', String(bakes - b0));
	}
	{
		// The map never shrinks: a phone-sized surface keeps the sharper texture a desktop
		// surface bought, and going back up to the large box repaints nothing.
		const b1 = bakes;
		huge.parentElement = { clientWidth: 360, clientHeight: 220 };
		Render.resize();
		check(bakes === b1, 'a phone-sized refit keeps the disk texture it has', String(bakes - b1));
		huge.parentElement = { clientWidth: 3200, clientHeight: 1955 };
		Render.resize();
		check(bakes === b1, 'growing back inside the same texture step repaints nothing', String(bakes - b1));
	}
	console.log('render smoke: ' + withZones + ' ops with the fan, ' + wedge + ' with wedge+lane, ' + ops.length +
		' without, board fitted to ' + cssW + 'x' + cssH + ' css px, no exceptions');
	// Every colour scheme over every disk schema. A schema change rebakes the disk
	// texture once, on the next frame, and nothing else; a scheme change rebakes nothing.
	const schema0 = CFG.diskSchema;
	view.opts = { ring: true, preview: true, mode: 'zones', theme: 'classic' };
	Render.drawWorld(view);
	let rebakes = 0, schemeBakes = 0;
	for (const theme of Object.keys(Render.themes)) {
		view.opts.theme = theme;
		let b0 = bakes;
		Render.drawWorld(view);
		schemeBakes += bakes - b0;
		for (const schema of Object.keys(DISK_SCHEMAS)) {
			if (schema === CFG.diskSchema) continue;
			CFG.diskSchema = schema;
			b0 = bakes;
			ops.length = 0;
			Render.drawWorld(view);
			Render.drawWorld(view);
			rebakes += bakes - b0;
			check(bakes - b0 === 1, 'a disk schema change rebakes the disk texture exactly once', theme + '/' + schema + ': ' + (bakes - b0));
			const tags = ops.filter(o => o.startsWith('outline:') && o.endsWith('%')).length;
			if (theme === 'kerot') check(tags >= 2, 'kerot-s pucks on the disk carry their outlined rate tag', theme + '/' + schema + ': ' + tags);
			else check(tags === 0, 'classic pucks carry no rate tag', schema);
		}
	}
	check(schemeBakes === 0, 'a colour scheme change rebakes nothing', String(schemeBakes));
	CFG.diskSchema = schema0;
	Render.drawWorld(view);
	// The optional presentation has six hook points. A probe skin proves every one is
	// reached and that detaching it restores the exact base draw path.
	const hooks = [];
	const probeSkin = {
		setup() { hooks.push('setup'); }, floor() { hooks.push('floor'); }, disk() { hooks.push('disk'); },
		surface() { hooks.push('surface'); }, shadow() { hooks.push('shadow'); }, puck() { hooks.push('puck'); },
	};
	Render.attach(probeSkin);
	Render.drawWorld(view);
	for (const hook of ['setup', 'floor', 'disk', 'surface', 'shadow', 'puck'])
		check(hooks.includes(hook), 'the optional ' + hook + ' hook is reachable');
	check(hooks.filter(h => h === 'shadow').length === w.n && hooks.filter(h => h === 'puck').length === w.n,
		'shadow and puck hooks run once per puck', hooks.length);
	check(hooks.filter(h => h === 'surface').length === 1, 'the ice-surface hook runs once per frame', hooks.length);
	hooks.length = 0;
	Render.attach(null);
	Render.drawWorld(view);
	check(hooks.length === 0, 'detaching the skin leaves no optional hook work');
	console.log('scheme smoke: ' + Object.keys(Render.themes).length + ' colour schemes × ' + Object.keys(DISK_SCHEMAS).length +
		' disk schemas drawn, ' + rebakes + ' disk rebakes on schema change, none on scheme change');
}
// Scoring: off the disk nothing is earned, on it the rate is the covered red area,
// and the integral does not care how the frame loop is chopped up.
{
	const off = createWorld(CFG), on = createWorld(CFG);
	const roster = createRoster(['human'], CFG.ballsPerPlayer);
	spawnPuck(off, 3.0, 0.3, 0); // far corner: nowhere near the disk
	scoreTick(off, roster, 1);
	check(roster[0].score === 0, 'a puck off the disk earns nothing');
	const i = spawnPuck(on, CFG.diskX, CFG.diskY, 0);
	check(Math.abs(puckArea(on, i) - Math.PI * CFG.puckR * CFG.puckR) < 1e-9, 'a puck wholly on the disk covers all of itself');
	check(puckRate(on, i) > 0, 'a puck on the disk earns');
	const outside = spawnPuck(on, CFG.diskX + CFG.diskR + CFG.puckR + 0.01, CFG.diskY, 0);
	check(puckRate(on, outside) === 0 && puckArea(on, outside) === 0, 'a puck clear of the rim earns nothing');
	// Same two seconds of board, paid in 1-h ticks or in 8-h ticks.
	const fine = createWorld(CFG), coarse = createWorld(CFG);
	const rf = createRoster(['human'], CFG.ballsPerPlayer), rc = createRoster(['human'], CFG.ballsPerPlayer);
	const fi = spawnPuck(fine, CFG.diskX, CFG.diskY, 0), ci = spawnPuck(coarse, CFG.diskX, CFG.diskY, 0);
	throwPuck(fine, fi, 0.4, 0.1); throwPuck(coarse, ci, 0.4, 0.1);
	for (let k = 0; k < 960; k++) { stepWorld(fine, CFG.h); scoreTick(fine, rf, CFG.h); }
	for (let k = 0; k < 120; k++) { for (let s = 0; s < 8; s++) stepWorld(coarse, CFG.h); scoreTick(coarse, rc, 8 * CFG.h); }
	console.log('score integration over 2 s: ' + rf[0].score.toFixed(3) + ' (every step) vs ' + rc[0].score.toFixed(3) + ' (every 8 steps)');
	check(Math.abs(rf[0].score - rc[0].score) < 0.02 * rf[0].score, 'the score integral is frame-rate independent');
	check(displayScore(CFG, 2, scoreRef(CFG, 2)) === CFG.scoreDisplayMax, 'a reference game displays as scoreDisplayMax');
	check(displayScore(CFG, 2, 0) === 0 && displayScore(CFG, 2, 1e9) === CFG.scoreDisplayMax, 'the display clamps to 0..scoreDisplayMax');
}
// Game: stroke mapping (plain + shift precision), ghost refresh on physics change,
// seats added and removed live, and a full two-seat bot game through the real state
// machine.
{
	Game.reset();
	check(Game.state === 'aim' && Game.pending >= 0, 'reset arms a pending puck');
	check(Game.roster.length === 4 && Game.roster[0].balls === CFG.ballsPerPlayer - 1 && Game.roster[1].balls === CFG.ballsPerPlayer,
		'four default seats: the seat on turn has taken a ball, the others still have four');
	check(Game.seatTypes.join() === 'human,balanced,blackhole,retriever', 'the default table is one human vs balanced, black hole, retriever', Game.seatTypes.join());
	check(Game.world.own[Game.pending] === 0, 'the pending puck belongs to the seat on turn');
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
	// Shift precision: a preciseGain share of further drag on speed, a preciseAimGain
	// share on aim, continuous across the press and release on both.
	Game.setStroke(-0.45, 0, false);
	const base = speed();
	Game.setStroke(-0.45 - 0.09, 0, false);
	const coarse = speed() - base;
	Game.setStroke(-0.45, 0, false); // back to the anchor length
	Game.setStroke(-0.45, 0, true); // shift down: rebase at the current speed, no jump
	const press = speed();
	Game.setStroke(-0.45 - 0.09, 0, true); // only now does the finer slope act
	const fine = speed() - base;
	console.log('precision: 0.09 m of drag -> ' + coarse.toFixed(4) + ' m/s plain, ' + fine.toFixed(4) + ' m/s with shift');
	check(Math.abs(coarse - 0.09 * (CFG.vMax - CFG.vMin) / CFG.dragFull) < 1e-9, 'plain drag slope');
	check(Math.abs(fine - coarse * CFG.preciseGain) < 1e-9, 'shift speed gain = preciseGain');
	check(Math.abs(press - base) < 1e-9, 'no jump at the shift press');
	check(Math.abs(speed() - (base + fine)) < 1e-9, 'fine slope acts after the press');
	Game.setStroke(-0.45 - 0.09, 0, false);
	check(Math.abs(speed() - (base + fine)) < 1e-9, 'no jump at the shift release');
	// The aim, same shape but its own gain: a sideways step turns the stroke, and with
	// shift only a preciseAimGain share of that turn counts.
	const aimAng = () => Math.atan2(Game.aim.vy, Game.aim.vx);
	Game.setStroke(-0.45, 0, false);
	const baseAng = aimAng();
	Game.setStroke(-0.45, 0.09, false);
	const coarseAng = aimAng() - baseAng;
	Game.setStroke(-0.45, 0, false);
	Game.setStroke(-0.45, 0, true);
	const pressAng = aimAng();
	Game.setStroke(-0.45, 0.09, true);
	const fineAng = aimAng() - baseAng;
	console.log('aim precision: 0.09 m sideways -> ' + (coarseAng * 180 / Math.PI).toFixed(3) + '° plain, ' + (fineAng * 180 / Math.PI).toFixed(4) + '° with shift');
	check(Math.abs(coarseAng - (Math.atan2(0.09, -0.45) - baseAng)) < 1e-9, 'plain aim follows the drag');
	check(Math.abs(fineAng - coarseAng * CFG.preciseAimGain) < 1e-9, 'shift aim gain = preciseAimGain');
	check(Math.abs(pressAng - baseAng) < 1e-9, 'no aim jump at the shift press');
	Game.setStroke(-0.45, 0.09, false);
	check(Math.abs(aimAng() - (baseAng + fineAng)) < 1e-9, 'no aim jump at the shift release');
	// Arrow nudges, the same two gains: 1° / (2 % + 0.01 m/s) plain, the aim gain on the
	// angle and the speed gain on the speed with shift.
	Game.bindInput(makeCanvas());
	const fireArrow = (key, shift) => fireWindow('keydown', { code: '', key: key, shiftKey: !!shift, preventDefault() { } });
	Game.setStroke(-0.45, 0, false);
	const n0 = aimAng();
	fireArrow('ArrowLeft', false);
	const nPlain = n0 - aimAng();
	fireArrow('ArrowRight', false);
	const nBack = aimAng();
	fireArrow('ArrowLeft', true);
	const nFine = nBack - aimAng();
	console.log('nudge aim: ← ' + (nPlain * 180 / Math.PI).toFixed(4) + '° plain, ' + (nFine * 180 / Math.PI).toFixed(5) + '° with shift');
	check(Math.abs(nPlain - Math.PI / 180) < 1e-12, 'plain nudge step is 1°');
	check(Math.abs(nFine - nPlain * CFG.preciseAimGain) < 1e-12, 'shift nudge aim gain = preciseAimGain');
	const sN0 = speed();
	fireArrow('ArrowUp', false);
	const sPlain = speed() - sN0;
	Game.setAimVel(Math.cos(aimAng()) * sN0, Math.sin(aimAng()) * sN0);
	fireArrow('ArrowUp', true);
	const sFine = speed() - sN0;
	console.log('nudge speed: ↑ ' + sPlain.toFixed(5) + ' m/s plain, ' + sFine.toFixed(6) + ' m/s with shift');
	check(Math.abs(sFine - sPlain * CFG.preciseGain) < 1e-12, 'shift nudge speed gain = preciseGain');
	// Ghost refresh: a physics change must re-simulate the preview.
	Game.setStroke(-CFG.dragFull, 0.2, false);
	Game.tick(1 / 60);
	const before = Game.pred.endX;
	CFG.omega = 3.5;
	Game.invalidateGhost();
	Game.tick(1 / 60);
	const after = Game.pred.endX;
	const ghostT = Game.pred.duration;
	CFG.omega = autoOmega(CFG);
	console.log('ghost vs ω: endX ' + before.toFixed(4) + ' at ' + CFG.omega.toFixed(3) + ' -> ' + after.toFixed(4) + ', ' + ghostT.toFixed(2) + ' s simulated');
	check(before !== after, 'ghost re-simulated after a physics change');
	check(before === before && isFinite(after), 'ghost finite');
	// The preview is a drag-time cost on the frame that also steps the board, so it is
	// simulated to the window the throw is paid by, not to the spin-down horizon.
	check(ghostT <= CFG.handoffT + 1e-9, 'the ghost stops at the handoff window', ghostT.toFixed(2) + ' s > ' + CFG.handoffT + ' s');
	// A puck swallowed while a seat aims swap-moves the armed puck (the last one spawned)
	// into the freed slot. `pending` is an index, not an identity: the aim, the ghost and
	// the throw must follow the puck, or the preview comes up empty and the throw lands in
	// a slot the step loop never visits.
	{
		Game.reset(); // seat 0 (human) armed at index 0
		const w = Game.world;
		spawnPuck(w, 1.70, 0.70, 1); spawnPuck(w, 1.70, 1.50, 1); // two earlier throws in play
		Game.addPlayer('random');
		Game.removePlayer(4); // the leaving seat re-arms the turn: the armed puck is spawned last
		const armedUid = w.uid[Game.pending];
		check(Game.pending === w.n - 1 && w.n === 3, 'the armed puck is the last slot', Game.pending + '/' + w.n);
		const sx = w.x[Game.pending], sy = w.y[Game.pending];
		w.x[0] = CFG.holes[0].x; w.y[0] = CFG.holes[0].y; w.st[0] = ST_SLIDE; // hole-bound
		stepWorld(w, CFG.h);
		check(w.n === 2 && w.uid[0] === armedUid, 'the hole swap-moves the armed puck into slot 0');
		check(Game.pending === 2, 'and the game still points at the slot it left', String(Game.pending));
		Game.setAimVel(-1.2, 0.1);
		Game.tick(1 / 60);
		check(Game.pending === 0 && w.uid[Game.pending] === armedUid, 'the aim follows the armed puck');
		const reach = Math.hypot(Game.pred.endX - sx, Game.pred.endY - sy);
		check(Game.pred.n > 4 && reach > 0.2, 'the ghost still leaves the launch spot', Game.pred.n + ' samples, ' + reach.toFixed(3) + ' m');
		Game.commitThrow();
		check(w.st[0] === ST_SLIDE, 'the throw reaches the armed puck');
		stepWorld(w, CFG.h);
		check(Math.hypot(w.x[0] - sx, w.y[0] - sy) > 1e-4, 'and the thrown puck moves');
	}
	// Seats are edited live: no reset, and the turn that is running is not lost.
	Game.reset();
	const board0 = Game.world.n, balls0 = Game.roster[0].balls;
	Game.addPlayer('random');
	check(Game.roster.length === 5 && Game.roster[4].balls === CFG.ballsPerPlayer, 'a seat joins with his balls');
	Game.removePlayer(4);
	check(Game.roster.length === 4, 'a seat leaves at once');
	check(Game.world.n === board0 && Game.roster[0].balls === balls0, 'leaving refunds the puck on the spot and re-arms');
	check(Game.state === 'aim' && Game.world.own[Game.pending] === Game.turn, 'the game is still aiming');
	const seat1 = Game.roster[1];
	const survivor = spawnPuck(Game.world, CFG.diskX, CFG.diskY, 1), survivorUid = Game.world.uid[survivor];
	Game.world.ownerLosses[1] = 2;
	Game.removePlayer(0); // the seat on turn leaves: the turn moves to the next seat
	check(Game.roster.length === 3 && Game.roster[0] === seat1 && Game.turn === 0, 'removing the seat on turn passes it on');
	check(Game.world.own[0] === 0 && Game.world.uid[0] === survivorUid && Game.world.ownerLosses[0] === 2, 'surviving puck identity, owner and loss counter reindex');
	const beforeSurvivorScore = Game.roster[0].score;
	scoreTick(Game.world, Game.roster, 1);
	check(Game.roster[0].score > beforeSurvivorScore, 'the remaining puck still scores after removing an earlier seat');
	check(Game.state === 'aim' && Game.world.own[Game.pending] === 0, 'the new seat on turn has his own puck');
	Game.addPlayer('human');
	check(Game.roster.length === 4 && Game.turn === 0, 'adding a seat does not move the turn');
	// The last throw ends the game, and a puck that comes to rest in the return zone while
	// the disk brakes is still cleared — but its ball must not come back: a stock that grew
	// after the last throw reads as a game that should have continued and did not.
	{
		Game.reset();
		const w = Game.world;
		Game.setAimVel(-0.6, 0.1); // stops ~2.6 m out: in play, outside both return rules
		Game.commitThrow();
		for (const seat of Game.roster) seat.balls = 0; // the throw was the last ball of the game
		let g2 = 0;
		while (Game.state !== 'settle' && g2++ < 600) { for (let s = 0; s < 8; s++) stepWorld(w, CFG.h); Game.afterSteps(8 * CFG.h); }
		check(Game.state === 'settle', 'the last throw ends the game', Game.state);
		const plant = spawnPuck(w, CFG.boardW - 0.15, 0.15, 1); // asleep inside the launch lane
		const plantUid = w.uid[plant];
		check(w.st[plant] === ST_SLEEP && inReturnZone(CFG, CFG.recycleMode, w.x[plant], w.y[plant]),
			'the planted puck is asleep in the return zone');
		while (Game.state !== 'scored' && g2++ < 9000) { for (let s = 0; s < 8; s++) stepWorld(w, CFG.h); Game.afterSteps(8 * CFG.h); }
		check(Game.state === 'scored', 'the spin-down reaches SCORED');
		check(findPuckUid(w, plantUid) < 0, 'the return rule still clears the zone at the end');
		check(Game.roster[1].balls === 0, 'a spent board returns no balls', String(Game.roster[1].balls));
	}
	// Full two-seat bot game through the real state machine.
	Game.reset();
	Game.setSeatType(0, 'keeper');
	Game.setSeatType(1, 'hunter');
	Game.setSeatType(2, 'blackhole');
	Game.setSeatType(3, 'retriever');
	check(Game.roster.every(s => s.type !== 'human'), 'the auto-played game has no human seat');
	let guard = 0, turns = 0, last = -1, votes = 0, wasVote = false, allThrown = null;
	while (Game.state !== 'scored' && guard++ < 60000) {
		Game.tick(1 / 60);
		Game.beforeSteps();
		for (let s = 0; s < 8; s++) stepWorld(Game.world, CFG.h);
		Game.afterSteps(8 * CFG.h);
		if (Game.turn !== last) { last = Game.turn; turns++; }
		if (Game.state === 'vote' && !wasVote) votes++;
		wasVote = Game.state === 'vote';
		if (Game.state === 'settle' && allThrown === null) allThrown = Game.roster.every(s => s.balls === 0);
	}
	const r = Game.roster;
	console.log(r.length + '-seat game: state = ' + Game.state + ', throws = ' + Game.world.thrown + ', board = ' + Game.world.n +
		', turns = ' + turns + ', speed votes = ' + votes + ' (ω ' + Game.omegaStart.toFixed(3) + ' -> ' + CFG.omega.toFixed(3) + ')' +
		', winner = P' + (Game.winner + 1) +
		', scores ' + r.map(s => displayScore(CFG, r.length, s.score)).join(' / ') +
		' (raw ' + r.map(s => s.score.toFixed(1)).join(' / ') + ')');
	check(Game.state === 'scored', 'game reaches SCORED');
	check(Game.world.thrown <= CFG.maxThrows, 'throw cap respected');
	check(turns >= 2 * CFG.ballsPerPlayer, 'every seat took his throws', String(turns));
	check(r[0].score >= 0 && r[1].score >= 0 && isFinite(r[0].score) && isFinite(r[1].score), 'scores are finite and non-negative');
	let top = 0;
	for (let i = 1; i < r.length; i++) if (r[i].score > r[top].score) top = i;
	check(Game.winner === top, 'the winner is the top score');
	// The look-ahead through the same state machine: a seat that searches holds the board
	// still for a frame or two, then throws, and the game still finishes.
	const warp0 = Game.cfg.warp, tries0 = Game.cfg.warpTries, turns0 = Game.cfg.warpTurns;
	Game.setWarp(true);
	Game.cfg.warpTries = 3; Game.cfg.warpTurns = 1; // one turn per line keeps the smoke quick
	Game.reset();
	let held = 0, guard2 = 0;
	while (Game.state !== 'scored' && guard2++ < 60000) {
		Game.tick(1 / 60);
		if (Game.planning) { held++; continue; }
		Game.beforeSteps();
		for (let s = 0; s < 8; s++) stepWorld(Game.world, CFG.h);
		Game.afterSteps(8 * CFG.h);
	}
	console.log('time-warp smoke: state = ' + Game.state + ', throws = ' + Game.world.thrown +
		', frames the board was held for a search = ' + held);
	check(Game.state === 'scored', 'a searched game reaches SCORED');
	check(held > 0, 'a searching board stands still');
	check(/time-warp/.test(Game.warpStatus), 'the panel gets a line about the search', Game.warpStatus);
	Game.setWarp(warp0);
	Game.cfg.warpTries = tries0; Game.cfg.warpTurns = turns0;
	// The settled board still returns what lies in the fan, so look when the spin-down began.
	check(allThrown === true, 'every ball was thrown before the disk spun down');
	check(CFG.speedVote !== 'round' || votes >= CFG.ballsPerPlayer - 1, 'a speed vote before every round after the first', String(votes));
}
// UI: the panel is built against the *real* ids of index.html — the stub only knows
// those, so an id renamed on one side fails here instead of in the browser.
{
	const ids = new Set([...fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(m => m[1]));
	const els = {};
	function makeEl(id) {
		const el = {
			id: id, children: [], cls: {}, style: {}, textContent: '', innerHTML: '', value: '', checked: false, title: '', className: '',
			classList: {
				toggle(name, on) { el.cls[name] = on === undefined ? !el.cls[name] : !!on; },
				contains(name) { return !!el.cls[name]; },
			},
			setAttribute(name, value) { el.attrs[name] = value; },
			attrs: {},
			contains() { return false; },
			appendChild(c) { c.parent = this; this.children.push(c); return c; },
			append(...cs) { for (const c of cs) { c.parent = this; this.children.push(c); } },
			remove() { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); },
			// Like the DOM: every listener fires, not just the last one bound. A control
			// bound twice (the settings switch was) must show up here, not only in a browser.
			handlers: {},
			addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); (this.on = this.on || {})[type] = fn; },
			click() { for (const fn of this.handlers.click || []) fn(); },
		};
		return el;
	}
	// The radio groups of index.html, by name; pick() is a user click on one.
	const radioSets = {};
	for (const [name, values] of [['recycle', ['none', 'zones', 'advance']], ['speedVote', ['off', 'turn', 'round']], ['voteMode', ['delta', 'exact']]])
		radioSets[name] = values.map(v => ({ value: v, checked: false, addEventListener(type, fn) { this.on = fn; } }));
	const pick = (name, value) => { for (const r of radioSets[name]) r.checked = r.value === value; radioSets[name].find(r => r.value === value).on(); };
	globalThis.document = {
		createElement: tag => makeEl(tag),
		getElementById: id => ids.has(id) ? (els[id] = els[id] || makeEl(id)) : null,
		querySelectorAll: sel => radioSets[/name=(\w+)/.exec(sel)[1]] || [],
		addEventListener() { },
		body: Object.assign(makeEl('body'), { dataset: {} }),
	};
	check(CFG.recycleMode === 'advance', 'startup uses wedge + lane before binding controls');
		const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
		check(/id="recAdvance" checked/.test(html) && !/id="recZones" checked/.test(html), 'HTML default matches wedge + lane');
		const buildSrc = fs.readFileSync(path.join(__dirname, '../tools/build-minigame.js'), 'utf8');
		check(/<script src="js\/fx\.js"><\/script>/.test(html) && !/<script[^>]+js\/fx-glass\.js/.test(html),
			'the page loads the lazy controller but not the heavy add-on at boot');
		check(!/fx(?:-glass)?\.js/.test(buildSrc), 'the Snowfall bundle carries no optional presentation file');
		check(/id="fx"/.test(html) && /id="chkSfx"/.test(html), 'the page exposes both presentation switches');
	// The disk speed is a game control: its bar sits directly under the transport bar, not
	// buried in the settings, and the panel keeps only one ω slider.
	const actionsAt = html.indexOf('id="actions"'), speedAt = html.indexOf('id="speedBar"');
	const firstRowAfterSpeed = html.indexOf('class="row', speedAt);
	check(actionsAt >= 0 && speedAt > actionsAt && speedAt < firstRowAfterSpeed, 'the speed bar follows the transport bar, before the settings');
	check((html.match(/id="omega"/g) || []).length === 1, 'one ω slider on the page');
	check(/id="speedBar"[\s\S]*?id="speedMode"[\s\S]*?id="omega"[\s\S]*?id="btnAuto"[\s\S]*?id="voteBox"/.test(html),
		'the bar holds the speed rule, the ω slider, auto-ω and the votes in that order');
	// auto-ω lives in the bar, so the fit rail cannot hide it behind a drawer.
	const actionsEnd = html.indexOf('</div>', actionsAt);
	check(html.indexOf('id="btnAuto"') > actionsEnd, 'auto-ω is not in the transport bar (the fit rail drops that row)');
	UI.bind(() => Game.reset());
	check(radioSets.recycle.find(r => r.checked).value === 'advance', 'startup radio selects wedge + lane');
	UI.update(Game.world); // the game above ended in SCORED
	check(els.roster.children.length === Game.roster.length, 'a panel row per seat', String(els.roster.children.length));
	const options = els.roster.children[0].children[1].children.map(o => o.value);
	check(options.includes('retriever') && options.includes('blackhole') && options.includes('balanced'), 'new bot strategies are selectable');
	check(els.breakdown.innerHTML.includes('winner'), 'the final scores are listed with the winner');
	check(String(els.liveScore.textContent).includes('/s'), 'the live rate is shown');
	check(String(els.puckCount.textContent).includes('seat'), 'the board readout counts seats');
	check(els.result.hidden === false, 'the result card is up when the game is over');
	check(String(els.resultWinner.textContent).includes('wins'), 'the card names the winner', els.resultWinner.textContent);
	check(String(els.resultScores.textContent).startsWith('P1 ') && /P4 /.test(els.resultScores.textContent),
		'the card lists every seat score', els.resultScores.textContent);
	const savedScores = Game.roster.map(s => s.score);
	for (const s of Game.roster) s.score = 500;
	UI.update(Game.world);
	check(els.resultWinner.textContent === 'draw', 'equal scores read as a draw', els.resultWinner.textContent);
	for (let i = 0; i < Game.roster.length; i++) Game.roster[i].score = savedScores[i];
	UI.update(Game.world);
	els.btnAdd.click(); // "+ add player" on a finished game starts a new one
	UI.update(Game.world);
	check(Game.roster.length === 5 && els.roster.children.length === 5, 'add player adds a row and a seat');
	check(Game.state === 'aim', 'adding a seat to a finished game starts a new one');
	const removeBtn = els.roster.children[0].children.find(c => c.title === 'remove this player');
	removeBtn.click();
	UI.update(Game.world);
	check(Game.roster.length === 4 && els.roster.children.length === 4, '× removes the row and the seat');
	els.chkRing.checked = true; els.chkPreview.checked = true; // the stub cannot read the HTML attribute
	const opts = UI.opts();
	check(opts.ring && opts.preview && opts.mode === 'advance', 'the draw options are read from the checkboxes');
	els.btnThrow.click();
	Game.beforeSteps();
	check(Game.state === 'aim' || Game.state === 'resolve', 'the throw button queues a throw');
	els.btnReset.click();
	UI.update(Game.world);
	check(Game.state === 'aim' && Game.roster.every((s, i) => s.balls === CFG.ballsPerPlayer - (i === Game.turn ? 1 : 0)), 'reset re-deals every seat');
	check(els.result.hidden === true, 'the result card hides again on a new game');
	// Help drawer: the pointer near the left edge opens it, the tab pins it, a tap out
	// on the board closes it, and a swipe in from the edge does the same on touch.
	Help.bind();
	const help = els.help, tab = els.helpTab;
	fireWindow('pointermove', { pointerType: 'mouse', clientX: 8 });
	check(help.cls.open === true, 'a pointer near the left edge opens the help');
	fireWindow('pointermove', { pointerType: 'mouse', clientX: 900 });
	check(!help.cls.open, 'it closes again once the pointer leaves');
	tab.click();
	check(help.cls.open === true && tab.attrs['aria-expanded'] === 'true', 'the tab pins it open');
	fireWindow('pointermove', { pointerType: 'mouse', clientX: 900 });
	check(help.cls.open === true, 'pinned, it stays open when the pointer leaves');
	fireWindow('pointerdown', { target: { id: 'board' } });
	check(!help.cls.open, 'a tap out on the board closes it');
	fireWindow('pointermove', { pointerType: 'touch', clientX: 8 });
	check(!help.cls.open, 'a touch move is not a hover');
	console.log('help smoke: drawer opens, pins and closes, no exceptions');
	// Disk pattern, colour scheme and puck mass — the three controls this round added.
	const schemaKeys = els.diskSchema.children.map(o => o.value), themeKeys = els.theme.children.map(o => o.value);
	check(schemaKeys.join() === Object.keys(DISK_SCHEMAS).join(), 'the disk pattern select lists every schema', schemaKeys.join());
	check(themeKeys.join() === Object.keys(Render.themes).join(), 'the colour scheme select lists every scheme', themeKeys.join());
	check((els.legendBar.style.background.match(/rgb\(/g) || []).length === 3 && els.legendText.textContent.includes('pays'),
		'the legend shows the three paint anchors and what they pay', els.legendText.textContent);
	const probe = createWorld(CFG), pi = spawnPuck(probe, CFG.diskX, CFG.diskY, 0); // dead centre
	const rateClassic = puckRate(probe, pi);
	els.diskSchema.value = 'rim6'; els.diskSchema.on.change();
	check(CFG.diskSchema === 'rim6', 'picking a pattern sets the schema');
	const rateRim = puckRate(probe, pi);
	check(rateRim < 0.5 * rateClassic, 'the score map follows the pattern (the rim schema pays little at the centre)',
		rateClassic.toFixed(2) + ' -> ' + rateRim.toFixed(2));
	els.diskSchema.value = 'classic'; els.diskSchema.on.change();
	check(puckRate(probe, pi) === rateClassic, 'switching back restores the original score map exactly');
	els.theme.value = 'kerot'; els.theme.on.change();
	check(document.body.dataset.theme === 'kerot' && UI.opts().theme === 'kerot', 'picking a scheme restyles the page and the board');
	els.theme.value = 'classic'; els.theme.on.change();
	const holdRef = holdRadius(CFG), m0 = CFG.puckM, live = Game.world.n;
	check(Math.abs(10 ** parseFloat(els.mass.value) - CFG.puckM) < 1e-9, 'the mass slider starts on the configured mass', els.mass.value);
	els.mass.value = String(Math.log10(20)); els.mass.on.input();
	let allHeavy = live > 0;
	for (let i = 0; i < Game.world.n; i++) if (Math.abs(Game.world.m[i] - 20) > 1e-9) allHeavy = false;
	check(Math.abs(CFG.puckM - 20) < 1e-9 && allHeavy, 'the mass slider retunes every puck on the board', live + ' pucks');
	check(holdRadius(CFG) < holdRef, 'a heavier puck is held less: the eject ring shrinks', holdRef.toFixed(3) + ' -> ' + holdRadius(CFG).toFixed(3));
	check(els.massVal.textContent.startsWith('20.00 kg') && els.muKVal.textContent.includes('→'),
		'the readouts show the mass and the coefficients it runs on', els.massVal.textContent + ' | ' + els.muKVal.textContent);
	Game.setPuckMass(m0); UI.update(Game.world);
	check(holdRadius(CFG) === holdRef && !els.muKVal.textContent.includes('→'), 'back at the reference mass nothing is rescaled');
	console.log('controls smoke: ' + schemaKeys.length + ' patterns, ' + themeKeys.length + ' schemes, mass 4 → 20 kg moves d_hold ' +
		holdRef.toFixed(3) + ' → ' + (holdRef * Math.cbrt(m0 / 20)).toFixed(3) + ' m');
	// Speed votes in the panel: the rule radios mirror CFG, a row per human seat, and
	// a real tally moves the ω slider while the link keeps the configured speed.
	{
		const historyCalls = [];
		globalThis.history = { replaceState(a, b, url) { historyCalls.push(url); } };
		globalThis.location = { pathname: '/index.html', hash: '', search: '' };
		const om0 = CFG.omega;
		Game.setSeatTypes(['human', 'balanced', 'blackhole', 'retriever']); // the human back in seat 1
		UI.update(Game.world);
		check(radioSets.speedVote.find(r => r.checked).value === CFG.speedVote && radioSets.voteMode.find(r => r.checked).value === CFG.voteMode,
			'the speed rule radios show the configured rule');
		check(!els.voteBox.hidden && els.voteRows.children.length === 1, 'one vote row for the one human seat', String(els.voteRows.children.length));
		const row = els.voteRows.children[0], line = row.children[0], range = row.children[1];
		const noneBox = line.children[1].children[0], keepBox = line.children[2].children[0], valText = line.children[3];
		check(noneBox.checked && !keepBox.checked, 'a vote starts at don\'t care');
		check(range.min === String(-CFG.voteDeltaMax) && range.max === String(CFG.voteDeltaMax), 'a change vote spans ±voteDeltaMax', range.min + '..' + range.max);
		keepBox.checked = true; keepBox.on.change();
		check(Game.roster[0].vote === VOTE_KEEP, 'keep is a vote');
		range.value = '0.5'; range.on.input(); UI.update(Game.world);
		check(Game.roster[0].vote === VOTE_SET && valText.textContent === '+.50' && !keepBox.checked, 'the slider casts a change vote', valText.textContent);
		Game.setAimVel(-0.6, 0.05); Game.commitThrow();
		UI.update(Game.world);
		check(Game.state === 'resolve' && els.state.textContent.includes('scoring window closes in') &&
			!els.state.textContent.includes('next seat'), 'a resolve names its window, not an unpromised next seat', els.state.textContent);
		let k = 0;
		const frame = () => { Game.tick(1 / 60); Game.beforeSteps(); for (let s = 0; s < 8; s++) stepWorld(Game.world, CFG.h); Game.afterSteps(8 * CFG.h); };
		while (Game.state !== 'vote' && k++ < 20000) frame();
		UI.update(Game.world);
		check(Game.state === 'vote' && els.state.textContent.startsWith('speed vote') && els.voteStatus.textContent.includes('closes in'),
			'the readouts show the open vote', els.state.textContent + ' | ' + els.voteStatus.textContent);
		check(Game.roster[0].vote === VOTE_SET, 'a vote cast during the turns is still standing when the vote opens');
		while (Game.state === 'vote' && k++ < 20000) frame();
		UI.update(Game.world);
		console.log('panel vote: ' + Game.tally.labels.join(' / ') + ' -> ω ' + Game.tally.from.toFixed(3) + ' -> ' + Game.tally.to.toFixed(3) +
			'; readout "' + els.omegaVal.textContent + '"');
		check(CFG.omega !== om0 && els.omega.value === String(Game.omegaNow) && els.omegaVal.textContent.includes('ramping to') && els.omegaVal.textContent.includes('voted'),
			'a tally keeps the slider on live speed and labels the voted setpoint', els.omegaVal.textContent);
		for (let s = 0; s < 240; s++) stepWorld(Game.world, CFG.h);
		UI.update(Game.world);
		check(Math.abs(Game.omegaNow - om0) > 1e-4 && Math.abs(Game.omegaNow - CFG.omega) > 1e-4 && els.omega.value === String(Game.omegaNow),
			'the ω slider follows the motor halfway through its ramp', els.omega.value + ' vs ' + Game.omegaNow.toFixed(3));
		check(els.voteStatus.textContent.startsWith('last vote') && noneBox.checked && range.value === '0',
			'after the tally the row is back at don\'t care and the status reports it', els.voteStatus.textContent);
		// A standing vote survives a row rebuild (a human seat joins): the new row must
		// show the vote that is actually held, not "no change". (Changing the vote MODE
		// drops the votes, deliberately: a change and an exact speed are different votes.)
		range.value = '0.3'; range.on.input();
		Game.addPlayer('human'); UI.update(Game.world);
		const rebuilt = els.voteRows.children.find(r => r.children[0].children[1].children[0].checked === false);
		check(els.voteRows.children.length === 2 && Game.roster[0].vote === VOTE_SET && rebuilt.children[1].value === String(Game.roster[0].voteValue),
			'a rebuilt vote row shows the vote that is standing', rebuilt && (rebuilt.children[1].value + ' vs ' + Game.roster[0].voteValue));
		Game.removePlayer(1); UI.update(Game.world);
		pick('voteMode', 'exact');
		const exactRow = els.voteRows.children[0].children[1];
		check(CFG.voteMode === 'exact' && exactRow.min === '0' && exactRow.max === String(CFG.omegaMax), 'exact votes span 0..omegaMax');
		check(historyCalls[historyCalls.length - 1].startsWith('?votemode=exact'), 'the link names the rule and keeps the configured speed', historyCalls[historyCalls.length - 1]);
		Game.setSeatTypes(['human', 'balanced', 'blackhole', 'retriever']); // the human back in seat 1, one seat each
		UI.update(Game.world);
		pick('speedVote', 'off');
		UI.update(Game.world);
		check(CFG.speedVote === 'off' && els.voteBox.hidden, 'the rule off hides the vote block');
		// The speed bar's own select is the same rule, in both directions.
		check(els.speedMode.value === 'off' && els.speedMode.children.map(o => o.value).join() === 'off,turn,round',
			'the speed bar lists every rule and follows the radios', els.speedMode.value);
		els.speedMode.value = 'turn'; els.speedMode.on.change();
		check(CFG.speedVote === 'turn' && radioSets.speedVote.find(r => r.checked).value === 'turn' && !els.voteBox.hidden,
			'the speed bar sets the rule and the drawer radios follow', CFG.speedVote);
		const q = parseQuery('?vote=TURN&votemode=exact&vote2=x');
		check(q && q.vote === 'turn' && q.voteMode === 'exact', 'vote and votemode are URL keys');
		check(parseQuery('?vote=sometimes') === null, 'an unknown rule is dropped');
		pick('speedVote', 'round'); pick('voteMode', 'delta');
		Game.reset(); UI.update(Game.world);
		check(CFG.omega === om0 && els.omega.value === String(om0), 'a new game starts from the configured speed again');
		check(els.voteStatus.textContent.startsWith('the speed is voted'), 'a new game has no last vote', els.voteStatus.textContent);
	}
	console.log('ui smoke: ' + els.roster.children.length + ' rows, breakdown ' +
		(els.breakdown.innerHTML ? 'filled' : 'empty') + ', result card up on SCORED and gone on reset, no exceptions');
	// Presets and URL parameters: the same setup objects applied at boot or from the
	// panel — CFG clamped to the ranges, the controls pulled to what was applied,
	// the roster swapped for a table preset, and a named bundle echoed into the
	// address bar. Restored to the default preset afterwards.
	{
		const historyCalls = [];
		globalThis.history = { replaceState(a, b, url) { historyCalls.push(url); } };
		globalThis.location = { pathname: '/index.html', hash: '', search: '' };
		check(parseQuery('') === null && parseQuery('?nonsuch=1&muK=abc') === null, 'a query without usable keys changes nothing');
		const mixed = parseQuery('?Preset=Stones&Schema=RIM6&seats=Human, Hunter&recycle=ZONES');
		check(mixed && mixed.preset === 'stones' && mixed.schema === 'rim6' && mixed.recycle === 'zones' && mixed.seats.join() === 'human,hunter',
			'names in a link are case-insensitive and seats tolerate a space', mixed && mixed.seats && mixed.seats.join());
		UI.applySetup(parseQuery('?preset=stones&omega=2'));
		check(historyCalls.length === 0, 'opening a link does not rewrite it, so preset overrides survive a refresh');
		check(CFG.omega === 2 && Math.abs(CFG.puckM - 20) < 1e-9, 'a named preset applies first and individual keys override it', CFG.omega + '/' + CFG.puckM);
		const seatCount = Game.roster.length;
		UI.applySetup(parseQuery('?schema=rim6&seats=human,hunter&mass=8&muK=0.09&muS=0.002&ring=0&ghost=0'));
		check(Math.abs(CFG.puckM - 8) < 1e-9 && CFG.muK === 0.09 && CFG.muS >= CFG.muK, 'URL parameters apply, μs is clamped to μk', CFG.muK + '/' + CFG.muS);
		check(CFG.diskSchema === 'rim6' && Game.seatTypes.join() === 'human,hunter', 'URL sets the schema and swaps the roster', Game.seatTypes.join());
		check(els.mass.value === String(Math.log10(8)) && els.diskSchema.value === 'rim6' && els.muS.value === String(CFG.muS),
			'the controls are pulled to the applied values', els.muS.value);
		check(!els.chkRing.checked && !els.chkPreview.checked, 'ring/ghost toggles apply to the view options');
		check(Game.state === 'aim' && Game.roster.length === 2 && Game.roster[0].balls + Game.roster[1].balls === 2 * CFG.ballsPerPlayer - 1,
			'a fresh board is dealt for the new table');
		check(seatCount !== 2 || historyCalls.length === 0, 'an anonymous setup leaves the address bar alone');
		UI.applyPreset('stones');
		check(Math.abs(CFG.puckM - 20) < 1e-9 && CFG.muS === 0.09 && CFG.omega === autoOmega(CFG),
			'the stones preset sets only its keys and auto-ω solves for the applied mass', CFG.puckM + '/' + CFG.omega.toFixed(4));
		check(els.preset.value === 'stones', 'the preset select shows the applied bundle');
		check(historyCalls.length === 1 && historyCalls[0] === '?preset=stones&ring=0&ghost=0', 'the preset is echoed into the address bar, with view toggles that differ', historyCalls.join(','));
		check(els.omega.value === String(CFG.omega) && els.massVal.textContent.startsWith('20.00 kg'), 'sliders and readouts follow the preset');
		els.omega.value = '1.5'; els.omega.on.input();
		check(CFG.omega === 1.5 && els.preset.value === '', 'a manual touch marks the bundle as custom');
		check(historyCalls[historyCalls.length - 1].indexOf('preset=') < 0 && historyCalls[historyCalls.length - 1].indexOf('omega=1.5') >= 0,
			'leaving a preset rewrites the link to the settings that differ, not the stale bundle', historyCalls[historyCalls.length - 1]);
		UI.applyPreset('speedplay');
		UI.applyPreset('foresight');
		check(CFG.botSpeed === 'park' && CFG.warp && CFG.warpTries === 8, 'special presets enable their bot settings');
		UI.applySetup(parseQuery('?warpturns=6&warpgoal=3'));
		UI.applyPreset('default');
		UI.update(Game.world);
		check(Math.abs(CFG.puckM - 4) < 1e-9 && Math.abs(CFG.muK - 0.03) < 1e-9 && CFG.diskSchema === 'classic' && CFG.recycleMode === 'advance' &&
			Game.seatTypes.join() === 'human,balanced,blackhole,retriever', 'the default preset restores the shipped table', Game.seatTypes.join());
		check(document.body.dataset.theme === 'classic' && historyCalls[historyCalls.length - 1] === '?preset=default&ring=0&ghost=0', 'scheme and link follow the default preset');
		check(CFG.botSpeed === 'auto' && !CFG.warp && CFG.warpTries === 6 && CFG.warpTurns === 3 && CFG.warpGoal === 0.5,
			'default preset restores bot strategy and all look-ahead settings');
		check(!els.chkWarp.checked && els.warpRows.hidden && els.botSpeed.value === 'auto', 'default bot controls match restored configuration');
		UI.applySetup(parseQuery('?preset=default&recycle=zones&warp=1&botspeed=park'));
		check(CFG.recycleMode === 'zones' && UI.opts().mode === 'zones' && CFG.warp && CFG.botSpeed === 'park', 'explicit URL keys override default preset');
		check(radioSets.recycle.find(r => r.checked).value === 'zones', 'URL return override selects the matching radio');
		pick('recycle', 'advance');
		check(!historyCalls[historyCalls.length - 1].includes('recycle='), 'shipped return mode is omitted from custom links');
			pick('recycle', 'zones');
			check(historyCalls[historyCalls.length - 1].includes('recycle=zones'), 'non-default fan mode is preserved in custom links');
			UI.applyPreset('default');
			const fxSetup = parseQuery('?fx=GLASS&sfx=ON');
			check(fxSetup && fxSetup.fx === 'glass' && fxSetup.sfx === true, 'glass and sound are case-insensitive URL keys');
			UI.applySetup(fxSetup);
			check(els.fx.value === 'glass' && els.chkSfx.checked && UI.opts().fx === 'glass' && UI.opts().sfx &&
				document.body.dataset.fx === 'glass', 'a presentation link drives controls, view options and page chrome');
			els.fx.value = 'plain'; els.fx.on.change();
			check(historyCalls[historyCalls.length - 1].includes('sfx=1') && !/(?:^|&)fx=/.test(historyCalls[historyCalls.length - 1]),
				'turning glass off keeps sound in the link and drops the shipped fx key');
			els.chkSfx.checked = false; els.chkSfx.on.change();
			check(UI.opts().fx === 'plain' && !UI.opts().sfx && document.body.dataset.fx === 'plain', 'plain and silent restore the shipped presentation');
			check(!/(?:^|&)fx=/.test(historyCalls[historyCalls.length - 1]) && !/(?:^|&)sfx=/.test(historyCalls[historyCalls.length - 1]),
				'plain and silent leave no presentation keys in a custom link');
		UI.applyPreset('crystal');
		check(els.fx.value === 'glass' && els.chkSfx.checked && historyCalls[historyCalls.length - 1].includes('preset=crystal'),
			'the crystal preset turns glass and sound on together');
		// The decor, listener and volume keys: a link drives the controls and the page
		// options, and a manual move echoes into the address bar only while non-default.
		UI.applySetup(parseQuery('?decor=hex&face=bottom&vol=0.8'));
		check(els.decor.value === 'hex' && els.face.value === 'bottom' && els.vol.value === '0.8',
			'decor, listener and volume URL keys pull the controls');
		check(UI.opts().decor === 'hex' && UI.opts().face === 'bottom' && Math.abs(UI.opts().vol - 0.8) < 1e-9,
			'the options carry the decor, the listener and the volume');
		check(els.volVal.textContent === '80 %', 'the volume readout shows the percentage', els.volVal.textContent);
		els.decor.value = 'radial'; els.decor.on.change();
		check(!/(?:^|&)decor=/.test(historyCalls[historyCalls.length - 1]) && historyCalls[historyCalls.length - 1].includes('face=bottom'),
			'the shipped decor leaves the link, the moved listener stays', historyCalls[historyCalls.length - 1]);
		els.face.value = 'launch'; els.face.on.change();
		els.vol.value = '1.3'; els.vol.on.input();
		const tail = historyCalls[historyCalls.length - 1];
		check(!/(?:^|&)face=/.test(tail) && !/(?:^|&)vol=/.test(tail), 'shipped listener and volume leave no keys in the link', tail);
		UI.applyPreset('default');
			console.log('presets/url smoke: ' + Object.keys(PRESETS).length + ' presets, parameters applied and clamped, sliders pulled, roster swapped, link echoed');
		els.chkRing.checked = true; els.chkPreview.checked = true;
	}
	// Drive actual pointer handlers through the renderer's client-to-world mapping.
	{
		Game.setSeatTypes(['human', 'balanced']);
		Game.reset();
		const cv = makeCanvas();
		Game.bindInput(cv);
		const w = Game.world, grab = aimGrab(CFG);
		const o0 = Render.toWorld(0, 0), o1 = Render.toWorld(1, 0), o2 = Render.toWorld(0, 1);
		const kx = 1 / (o1.x - o0.x), ky = 1 / (o2.y - o0.y); // world -> client px of the renderer
		const px = w.x[Game.pending], py = w.y[Game.pending];
		const cx = dx => (px + dx - o0.x) * kx, cy = dy => (py + dy - o0.y) * ky;
		const ev = (x, y, o) => Object.assign({ pointerId: 1, clientX: x, clientY: y, shiftKey: false, timeStamp: 1000, pointerType: 'touch', preventDefault() { } }, o || {});
		const fire = (type, dx, dy, o) => cv.dispatch(type, ev(cx(dx), cy(dy), { type, ...o }));
		const speed = () => Math.hypot(Game.aim.vx, Game.aim.vy);
		const angDeg = () => Math.atan2(Game.aim.vy, Game.aim.vx) * 180 / Math.PI;
		const near = (a, b) => Math.abs(a - b) < 1e-6;
		const mouse = { pointerType: 'mouse' }, fine = { ...mouse, shiftKey: true };
		fire('pointerdown', 0, 0); fire('pointerup', 0, 0);
		Game.beforeSteps();
		check(!Game.aim.hasStroke && Game.state === 'aim', 'an unaimed tap does nothing');
		fire('pointerdown', grab + 0.25, 0, mouse);
		fire('pointermove', 0, grab + 0.45, mouse);
		check(near(speed(), 1.5) && near(angDeg(), 90), 'the first mouse drag follows the pointer');
		fire('pointermove', 0, grab + 0.45, fine);
		check(near(speed(), 1.5) && near(angDeg(), 90), 'pressing Shift does not jump');
		fire('pointermove', -(grab + 0.54), 0, fine);
		const fineSpeed = 1.5 + 0.09 / CFG.dragFull * CFG.vMax * CFG.preciseGain;
		const fineAngle = 90 + 90 * CFG.preciseAimGain;
		check(near(speed(), fineSpeed) && near(angDeg(), fineAngle), 'Shift scales both pointer power and angle changes');
		fire('pointermove', -(grab + 0.54), 0, mouse);
		check(near(speed(), fineSpeed) && near(angDeg(), fineAngle), 'releasing Shift does not jump');
		fire('pointerup', -(grab + 0.63), 0, mouse);
		check(!Game.aim.dragging && near(speed(), fineSpeed + 0.3), 'release uses its final position at normal gain');
		fire('pointerdown', grab + 0.45, 0, fine);
		check(near(speed(), fineSpeed + 0.3) && near(angDeg(), fineAngle), 'starting a Shift drag preserves the existing stroke');
		fire('pointercancel', grab + 0.45, 0, fine);
		fire('pointerdown', 0, 0);
		fire('pointermove', -(grab + 3), 0, { pointerId: 2 });
		check(!Game.aim.dragging, 'another pointer cannot hijack the gesture');
		fire('pointerup', -(grab + 3), 0);
		Game.beforeSteps();
		check(Game.state === 'aim' && near(speed(), CFG.vMax), 'a drag from the puck aims, clamps and does not throw');
		fire('pointerdown', 0, 0); fire('pointercancel', 0, 0);
		Game.beforeSteps();
		check(Game.state === 'aim', 'a canceled tap does not throw');
		fire('pointerdown', 0, 0);
		Game.beforeSteps();
		check(Game.state === 'aim', 'a press does not throw before release');
		fire('pointerup', 0, 0);
		Game.beforeSteps();
		check(Game.state === 'resolve' && Game.world.thrown === 1, 'one touch tap throws on release');
		Game.reset();
		fire('pointerdown', -(grab + 0.4), 0, mouse); fire('pointerup', -(grab + 0.4), 0, mouse);
		fire('pointerdown', 0, 0, mouse); fire('pointerup', 0, 0, mouse);
		Game.beforeSteps();
		check(Game.state === 'resolve', 'a mouse click throws the placed stroke');
		// A focused panel control owns Space and the arrow keys; the game must not move
		// the stroke or throw underneath it.
		Game.setSeatTypes(['human', 'balanced']);
		Game.setStroke(-CFG.dragFull * 0.5, 0.1, false);
		const guardAng = angDeg();
		const control = { closest: () => ({ tagName: 'INPUT' }) };
		fireWindow('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', target: control, preventDefault() { } });
		check(angDeg() === guardAng, 'an arrow key on a focused control does not nudge the stroke');
		fireWindow('keydown', { code: 'Space', key: ' ', target: control, preventDefault() { } });
		Game.beforeSteps();
		check(Game.state === 'aim', 'Space on a focused control does not throw the stroke');
		// A paused board reads neither the arrows nor Space; the stroke waits as it was.
		Game.togglePause();
		const pauseAng = angDeg();
		fireWindow('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', preventDefault() { } });
		check(angDeg() === pauseAng, 'a paused board ignores the arrow keys');
		fireWindow('keydown', { code: 'Space', key: ' ', timeStamp: 5000, preventDefault() { } });
		Game.beforeSteps();
		check(Game.state === 'aim' && Game.world.thrown === 0, 'a paused board ignores Space');
		Game.togglePause();
		// The spent board is the play-again button: two taps (a mouse double-click) deal
		// a new game; a pair far apart or too slow does not, and reset unpauses.
		const balls0 = CFG.ballsPerPlayer;
		CFG.ballsPerPlayer = 1;
		Game.setSeatTypes(['human', 'balanced']);
		let sc = 0;
		while (Game.state !== 'scored' && sc++ < 60000) {
			if (Game.state === 'aim' && Game.roster[Game.turn].type === 'human') { Game.setStroke(-CFG.dragFull, 0.05, false); Game.commitThrow(); }
			Game.tick(1 / 60); Game.beforeSteps();
			for (let s = 0; s < 8; s++) stepWorld(Game.world, CFG.h);
			Game.afterSteps(8 * CFG.h);
		}
		check(Game.state === 'scored', 'a one-ball game reaches SCORED', String(sc));
		const tap = (x, y, ts) => cv.dispatch('pointerup', { pointerId: 1, button: 0, clientX: x, clientY: y, timeStamp: ts, preventDefault() { } });
		tap(300, 200, 1000);
		check(Game.state === 'scored', 'one tap on the spent board does not restart it');
		tap(900, 500, 1300);
		check(Game.state === 'scored', 'two taps far apart are not the play-again gesture');
		tap(900, 500, 2600);
		check(Game.state === 'scored', 'two taps too slow are not the play-again gesture');
		Game.togglePause();
		check(Game.paused, 'the spent board can be paused');
		tap(900, 500, 2750);
		Game.beforeSteps();
		check(Game.state === 'aim' && Game.world.thrown === 0 && !Game.paused,
			'a double-click on the spent board deals a live new game');
		CFG.ballsPerPlayer = balls0;
		Game.setSeatTypes(['human', 'balanced']);
		console.log('restart smoke: the spent board restarts on a double-click (' + sc + ' frames to SCORED), ignores stray and slow taps, and unpauses');
	}
	// View: fit is the default and a URL key; the panel is the rail with a settings
	// drawer in it, and the body attribute is what the CSS keys both shapes off.
	{
		const html2 = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
		check(/<body data-fit="1">/.test(html2), 'the page boots in the fit view');
		document.body.dataset.fit = '1'; // the page's own body starts in fit (the UI stub above replaced it)
		View.set('side'); View.set('fit');
		check(View.isFit() && document.body.dataset.fit === '1', 'fit is the shipped view mode');
		let fits = 0;
		els.panel = Object.assign(makeEl('panel'), { scrollTop: 0, contains() { return false; } });
		els.btnSettings = makeEl('btnSettings');
		const panel = els.panel, b = els.btnSettings;
		View.bind(() => { fits++; });
		b.click();
		check(panel.cls.open === true && b.attrs['aria-expanded'] === 'true', 'the settings switch opens the drawer', String(panel.cls.open));
		check(fits > 0, 'opening the drawer refits the board it just narrowed');
		b.click();
		check(!panel.cls.open, 'and closes it again');
		// A tap out on the board closes the drawer; a touch hover never opens anything.
		b.click();
		fireWindow('pointerdown', { target: { id: 'c' } });
		check(!panel.cls.open, 'a tap out on the board closes the drawer');
		fireWindow('pointermove', { pointerType: 'touch', clientX: 8 });
		check(!panel.cls.open, 'a touch move does not open it');
		const swipe = (target, dx) => {
			fireWindow('pointerdown', { target, button: 0, pointerId: 7, clientX: 200, clientY: 100 });
			fireWindow('pointerup', { pointerId: 7, clientX: 200 + dx, clientY: 100 });
		};
		els.btnCollapse.click();
		check(panel.hidden && !els.menuTab.hidden, 'collapse leaves a menu tab');
		els.menuTab.click();
		check(!panel.hidden && View.open, 'tab restores full menu');
		const menuSurface = { closest() { return null; } };
		panel.contains = target => target === menuSurface;
		swipe(menuSurface, 80);
		check(panel.hidden && !els.menuTab.hidden, 'swiping the menu right collapses it');
		Game.reset(); Game.setSeatType(Game.turn, 'human');
		swipe(els.c, 80);
		check(!help.cls.open, 'aim drag does not open help');
		Game.setSeatType(Game.turn, 'balanced');
		swipe(els.c, 80);
		check(help.cls.open, 'spectator swipe right opens help');
		swipe(els.c, -80);
		check(!help.cls.open && View.open, 'spectator swipe left opens menu');
		// The view select switches to the side layout, which is a link key.
		const historyCalls2 = [];
		globalThis.history = { replaceState(a, b2, url) { historyCalls2.push(url); } };
		globalThis.location = { pathname: '/index.html', hash: '', search: '' };
		els.view.value = 'side'; els.view.on.change();
		check(!View.isFit() && document.body.dataset.fit === '0', 'the view select switches to the side layout');
		check(/view=side/.test(historyCalls2[historyCalls2.length - 1] || ''), 'the side layout is named in the link', historyCalls2.join(','));
		const qSide = parseQuery('?view=SIDE');
		check(qSide && qSide.view === 'side', 'view is a URL key, case-insensitive');
		check(parseQuery('?view=nowhere') === null, 'an unknown view is dropped');
		UI.applySetup(parseQuery('?view=fit'));
		check(View.isFit() && els.view.value === 'fit', 'a link switches back to fit', View.isFit() + ' ' + els.view.value);
		UI.applySetup(parseQuery('?view=fit'));
		historyCalls2.length = 0;
		check(!/view=/.test(historyCalls2[historyCalls2.length - 1] || ''), 'fit is the shipped view: it is not written into links');
		console.log('view smoke: fit -> side -> fit, the drawer toggles, the link names side only');
	}
	// Mobile layout + live visualViewport sync: #app avoids 100vh overflow, #boardWrap
	// top-aligns the canvas without wasted centering gap, horizontal widescreen phones
	// stay in row layout, and main.js pins #app to visualViewport height when unzoomed.
	{
		check(!/#app\s*\{[^}]*100vh/.test(html) && /#app\s*\{[^}]*position:\s*fixed/.test(html),
			'#app avoids 100vh overflow and pins to the layout viewport');
		check(/body\[data-fit=1\] #boardWrap\s*\{[^}]*position:\s*relative/.test(html) &&
			/body\[data-fit=1\] canvas\s*\{[^}]*left:\s*0;\s*top:\s*0/.test(html),
			'the fit board box hangs off the pinned #app and the canvas sits at its top left');
		check(/@media\s*\(max-width:\s*960px\),\s*\(max-height:\s*600px\)/.test(html) &&
			/@media\s*\(orientation:\s*portrait\)/.test(html),
			'small/short screens compact chrome and only portrait stacks the panel under the board');
		const prevCreate = globalThis.document.createElement;
		globalThis.document.createElement = tag => tag === 'canvas' ? makeCanvas() : makeEl(tag);
		globalThis.location = { pathname: '/index.html', hash: '', search: '' };
		const vvListeners = {};
		const appEl = els.app || (els.app = makeEl('app'));
		els.c = makeCanvas();
		globalThis.performance = { now: () => 0 };
		globalThis.requestAnimationFrame = () => 1;
		globalThis.window.innerHeight = 360;
		globalThis.window.visualViewport = {
			height: 284, offsetTop: 12, scale: 1,
			addEventListener(type, fn) { (vvListeners[type] = vvListeners[type] || []).push(fn); },
		};
		eval('"use strict";' + fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8'));
		check(appEl.style.height === '284px' && appEl.style.top === '12px',
			'main.js shrinks #app to visualViewport height/offset below mobile browser bars', appEl.style.top + '+' + appEl.style.height);
		globalThis.window.visualViewport.scale = 2; // pinch-zoom: keep layout height, reset offset
		globalThis.window.visualViewport.height = 142;
		for (const fn of vvListeners.resize || []) fn();
		check(appEl.style.height === '360px' && appEl.style.top === '0px',
			'pinch-zoom does not crush #app to the zoomed visualViewport slice', appEl.style.top + '+' + appEl.style.height);
		globalThis.document.createElement = prevCreate;
	}
}
console.log(fail ? 'FAIL' : 'OK (render + score + seats + ui smoke)');
process.exit(fail);
