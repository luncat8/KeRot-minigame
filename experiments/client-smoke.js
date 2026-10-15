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
		createLinearGradient() { return { addColorStop() { } }; },
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
	return { width: 0, height: 0, style: {}, clientWidth: 640, parentElement: { clientWidth: 900, clientHeight: 550 }, getContext: () => makeCtx(), addEventListener() { }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
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
for (const f of ['../js/field.js', '../js/score.js', '../js/players.js', '../js/render.js', '../js/game.js', '../js/ui.js', '../js/help.js']) {
	const src = fs.readFileSync(require('path').join(__dirname, f), 'utf8')
		.replace(/^if \(typeof module !== 'undefined'\).*$/gm, '') // node-only require/export guards
		.replace(/\bconst (Render|Game|UI|Help|SEAT_COLORS|SEAT_TYPES|SEAT_LABELS|SEAT_NAMES|SC_LUT_N|SC_LUT_W|RED_MAX) =/, 'globalThis.$1 =')
		.replace(/\bfunction bakeFieldCanvas/, 'globalThis.bakeFieldCanvas = function bakeFieldCanvas');
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
			addEventListener(type, fn) { (this.on = this.on || {})[type] = fn; },
			click() { if (this.on && this.on.click) this.on.click(); },
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
		body: Object.assign(makeEl('body'), { dataset: {} }),
	};
	UI.bind(() => Game.reset());
	UI.update(Game.world); // the game above ended in SCORED
	check(els.roster.children.length === Game.roster.length, 'a panel row per seat', String(els.roster.children.length));
	const options = els.roster.children[0].children[1].children.map(o => o.value);
	check(options.includes('retriever') && options.includes('blackhole') && options.includes('balanced'), 'new bot strategies are selectable');
	check(els.breakdown.innerHTML.includes('winner'), 'the final scores are listed with the winner');
	check(String(els.liveScore.textContent).includes('/s'), 'the live rate is shown');
	check(String(els.puckCount.textContent).includes('seat'), 'the board readout counts seats');
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
	check(opts.ring && opts.preview && opts.mode === 'zones', 'the draw options are read from the checkboxes');
	els.btnThrow.click();
	Game.beforeSteps();
	check(Game.state === 'aim' || Game.state === 'resolve', 'the throw button queues a throw');
	els.btnReset.click();
	UI.update(Game.world);
	check(Game.state === 'aim' && Game.roster.every((s, i) => s.balls === CFG.ballsPerPlayer - (i === Game.turn ? 1 : 0)), 'reset re-deals every seat');
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
	fireWindow('touchstart', { touches: [{ clientX: 4, clientY: 300 }], timeStamp: 1000 });
	fireWindow('touchmove', { touches: [{ clientX: 64, clientY: 305 }], timeStamp: 1100 });
	check(help.cls.open === true, 'a swipe in from the edge opens it on touch');
	fireWindow('touchstart', { touches: [{ clientX: 300, clientY: 300 }], timeStamp: 2000 });
	fireWindow('touchmove', { touches: [{ clientX: 240, clientY: 305 }], timeStamp: 2100 });
	check(!help.cls.open, 'a swipe left on it closes it');
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
		check(CFG.omega !== om0 && els.omega.value === String(CFG.omega) && els.omegaVal.textContent.includes('voted'),
			'a tally moves the ω slider and the readout says it was voted', els.omegaVal.textContent);
		check(els.voteStatus.textContent.startsWith('last vote') && noneBox.checked && range.value === '0',
			'after the tally the row is back at don\'t care and the status reports it', els.voteStatus.textContent);
		pick('voteMode', 'exact');
		const exactRow = els.voteRows.children[0].children[1];
		check(CFG.voteMode === 'exact' && exactRow.min === '0' && exactRow.max === String(CFG.omegaMax), 'exact votes span 0..omegaMax');
		check(historyCalls[historyCalls.length - 1] === '?votemode=exact', 'the link names the rule and keeps the configured speed', historyCalls[historyCalls.length - 1]);
		pick('speedVote', 'off');
		UI.update(Game.world);
		check(CFG.speedVote === 'off' && els.voteBox.hidden, 'the rule off hides the vote block');
		const q = parseQuery('?vote=TURN&votemode=exact&vote2=x');
		check(q && q.vote === 'turn' && q.voteMode === 'exact', 'vote and votemode are URL keys');
		check(parseQuery('?vote=sometimes') === null, 'an unknown rule is dropped');
		pick('speedVote', 'round'); pick('voteMode', 'delta');
		Game.reset(); UI.update(Game.world);
		check(CFG.omega === om0 && els.omega.value === String(om0), 'a new game starts from the configured speed again');
		check(els.voteStatus.textContent.startsWith('the speed is voted'), 'a new game has no last vote', els.voteStatus.textContent);
	}
	console.log('ui smoke: ' + els.roster.children.length + ' rows, breakdown ' +
		(els.breakdown.innerHTML ? 'filled' : 'empty') + ', no exceptions');
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
		UI.applyPreset('default');
		UI.update(Game.world);
		check(Math.abs(CFG.puckM - 4) < 1e-9 && Math.abs(CFG.muK - 0.03) < 1e-9 && CFG.diskSchema === 'classic' && CFG.recycleMode === 'zones' &&
			Game.seatTypes.join() === 'human,balanced,blackhole,retriever', 'the default preset restores the shipped table', Game.seatTypes.join());
		check(document.body.dataset.theme === 'classic' && historyCalls[historyCalls.length - 1] === '?preset=default&ring=0&ghost=0', 'scheme and link follow the default preset');
		console.log('presets/url smoke: ' + Object.keys(PRESETS).length + ' presets, parameters applied and clamped, sliders pulled, roster swapped, link echoed');
		els.chkRing.checked = true; els.chkPreview.checked = true;
	}
}
console.log(fail ? 'FAIL' : 'OK (render + score + seats + ui smoke)');
process.exit(fail);
