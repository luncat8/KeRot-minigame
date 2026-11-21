// Node-only geometry/editor model gates. No browser or dependencies.
const assert = require('node:assert/strict');
const { CFG, boardGeometry, validBoardGeometry, applyBoardGeometry, resetBoardGeometry, autoOmega } = require('../js/cfg.js');
const { applyCfg, parseQuery, PRESETS } = require('../js/presets.js');
const { createGame } = require('../js/game.js');
const { zoneField } = require('../js/rules.js');
const Editor = require('../js/zone-editor.js');
const clone = v => JSON.parse(JSON.stringify(v));
const original = clone(CFG), defaults = boardGeometry(CFG);
assert(validBoardGeometry(defaults));
for (const value of [null, {}, [], { ...defaults, diskX: NaN }, { ...defaults, diskR: Infinity },
	{ ...defaults, holes: [null, null] }, { ...defaults, puckR: 0 }, { ...defaults, launchMinX: 0 },
	{ ...defaults, holes: [{ x: CFG.diskX, y: CFG.diskY, r: 0.2 }, defaults.holes[1]] },
	{ ...defaults, holes: [{ x: CFG.launchX, y: CFG.launchY, r: 0.18 }, defaults.holes[1]] },
	{ ...defaults, zoneReach: 0 }, { ...defaults, boardW: 1000 }]) {
	const cfg = clone(CFG), before = clone(cfg);
	assert.equal(applyBoardGeometry(cfg, value), false);
	assert.deepEqual(cfg, before, 'invalid geometry is ignored atomically');
}
const cfg = clone(CFG), board = boardGeometry(cfg);
board.diskX = 1.2; board.diskY = 1.13; board.diskR = 0.73;
board.puckR = 0.08; board.zoneCutGap = 0.11; board.zoneReach = 0.8;
board.holes[0].x = 0.43; board.holes[1].r = 0.16;
assert(applyBoardGeometry(cfg, board));
assert.equal(cfg.returnZone.ax, 1.2);
assert.equal(cfg.returnZone.bx, 1.2 + (3.6 - 1.2) * 0.8);
assert.equal(cfg.advanceZone.cx, 1.2);
assert.equal(cfg.advanceZone.lx, cfg.launchMinX);
assert.equal(cfg.advanceZone.lw, cfg.boardW - cfg.launchMinX);
board.holes[0].x = 99;
assert.equal(cfg.holes[0].x, 0.43, 'import must not alias its source');
assert.deepEqual(boardGeometry(CFG), defaults, 'editing a clone leaves defaults alone');
const game = createGame({ cfg });
game.reset();
const beforeFit = boardGeometry(cfg);
assert.equal(game.fitBoard(0.5), false);
assert.deepEqual(boardGeometry(cfg), beforeFit, 'custom geometry is viewport independent');
game.setAimVel(-1.4, 0);
game.queueThrow(0);
game.setEditing(true);
assert.equal(game.canAim(), false);
game.commitThrow(); game.beforeSteps(); game.tick(1);
assert.equal(game.world.thrown, 0);
assert(game.paused);
assert.equal(game.planning, false);
const resized = boardGeometry(cfg); resized.puckR = 0.09;
assert(applyBoardGeometry(cfg, resized)); game.reset();
assert.equal(game.world.r[game.pending], cfg.puckR, 'clean preview uses the new puck size');
assert(game.editing && game.paused, 'reset cannot unpause editing');
game.setEditing(false); game.reset();
assert(game.canAim() && !game.paused);

const proposed = boardGeometry(cfg); proposed.diskX = -10;
const projected = Editor.project(boardGeometry(cfg), proposed);
assert(validBoardGeometry(projected));
assert(projected.diskX >= cfg.diskR && projected.diskX < cfg.diskX);
assert.deepEqual(Editor.project(defaults, defaults), defaults);

const setup = Editor.setupOf(cfg, game, { theme: 'classic', cards: 'round', fx: 'plain', sfx: false,
	decor: 'radial', face: 'launch', vol: 1.3, ring: false, preview: true, holeFill: false });
setup.seats = ['human', 'timing']; setup.maxThrows = 73; setup.balls = 5;
const query = Editor.setupQuery(setup), parsed = parseQuery('?' + query);
assert.deepEqual(parsed, setup, 'every exported setting round-trips through the URL');
applyCfg(parsed);
assert.deepEqual(boardGeometry(CFG), setup.geometry);
assert.equal(CFG.maxThrows, 73);
assert.equal(CFG.ballsPerPlayer, 5);
assert(Editor.descriptor(setup).includes('"timing"'));
assert(Editor.descriptor(setup).includes('"muK":'));
assert(!Editor.descriptor(setup).includes('staller'));
assert.equal(parseQuery('?geometry=%7Bbad'), null);
assert.equal(parseQuery('?holefill=1').holeFill, true, 'the holefill URL key parses to the setup key');
assert.equal(parseQuery('?holefill=maybe'), null, 'a malformed view toggle drops the whole link');
assert.equal(parseQuery('?geometry=%7B%7D&omega=1').omega, 1);
assert.equal(parseQuery('?maxthrows=900').maxThrows, 512);
assert.equal(parseQuery('?maxthrows=-3').maxThrows, 1);
assert.equal(parseQuery('?maxthrows=NaN'), null);
CFG.zoneStyle = '6-hemi';
assert(zoneField(CFG, 'advance', CFG.diskX - CFG.diskR - CFG.puckR - 0.05, CFG.diskY) < 0);
CFG.zoneCutGap = 0;
assert(zoneField(CFG, 'advance', CFG.diskX - CFG.diskR - CFG.puckR - 0.05, CFG.diskY) > 0);
applyCfg(PRESETS.default);
assert.deepEqual(boardGeometry(CFG), defaults);
assert.equal(CFG.customGeometry, false);
assert.equal(CFG.maxThrows, 96);
// The not-so-big-disk preset is a whole-board bundle: valid, applied verbatim and
// reproducible from its own link.
const small = PRESETS['notsobigdisk'];
assert(small && small.geometry, 'the not-so-big-disk preset exists');
assert(validBoardGeometry(small.geometry), 'the preset board is valid');
applyCfg(Object.assign({}, small, { seats: small.seats.slice() }));
assert.deepEqual(boardGeometry(CFG), small.geometry, 'the preset board applies verbatim');
assert.equal(CFG.customGeometry, true);
assert.equal(CFG.zoneStyle, '3-rounded');
assert.equal(CFG.holeStyle, 'well');
assert.equal(CFG.scoreScale, 1);
assert(Math.abs(patternScale(CFG) - small.geometry.diskR / DISK_REF_R) < 1e-9, 'score pattern scales with diskR by default');
assert(Math.abs(CFG.omega - autoOmega(CFG)) < 1e-6, 'the preset speed is the auto-ω of its own disk');
const smallParsed = parseQuery('?preset=notsobigdisk');
assert(smallParsed && smallParsed.preset === 'notsobigdisk', 'the preset is a URL key');
applyCfg(smallParsed);
assert.deepEqual(boardGeometry(CFG), small.geometry, 'the preset link reopens the same board');
// Score-pattern scale and swap-zones round-trip through parseQuery/applyCfg and physics.
const customUrl = parseQuery('?scorescale=1.5&swap=1&recycle=advance');
assert.equal(customUrl.scoreScale, 1.5);
assert.equal(customUrl.swap, true);
applyCfg(Object.assign({}, PRESETS.default, customUrl));
assert.equal(CFG.scoreScale, 1.5);
assert.equal(CFG.swapZones, true);
assert(Math.abs(fieldLocal(CFG, 0.30, 0.15) - fieldLocal(Object.assign({}, CFG, { scoreScale: 1 }), 0.20, 0.10)) < 1e-9, 'scoreScale scales fieldLocal homothetically');
assert.equal(inSwapVoid(CFG, 'advance', 0.12, CFG.diskY), true, 'left return wedge becomes void when swapped');
assert.equal(inSwapVoid(CFG, 'advance', CFG.launchX, CFG.launchY), false, 'right return zone near start never becomes void');
assert.equal(inSwapVoid(CFG, 'advance', CFG.holes[0].x, CFG.holes[0].y + 0.05), false, 'old holes stay out of the swapped void');
assert.equal(inSwappedReturnZone(CFG, 'advance', CFG.holes[0].x, CFG.holes[0].y + 0.05), true, 'old holes become circular return zones');
assert.equal(inSwappedReturnZone(CFG, 'advance', CFG.launchX, CFG.launchY), true, 'right return zone near start stays a return zone');
assert.equal(inSwappedReturnZone(CFG, 'advance', 0.12, CFG.diskY), false, 'old left wedge is no longer a return zone');
{
	const w = createWorld(CFG);
	const holePuck = spawnPuck(w, CFG.holes[0].x, CFG.holes[0].y + 0.05, 0);
	w.st[holePuck] = ST_SLEEP;
	absorbBlackHoles(w);
	assert.equal(w.n, 1, 'old hole does not swallow pucks when swapped');
	const voidPuck = spawnPuck(w, 0.12, CFG.diskY, 1);
	w.st[voidPuck] = ST_SLIDE;
	absorbBlackHoles(w);
	assert.equal(w.n, 1, 'old return zone swallows pucks when swapped');
	assert.equal(w.ownerLosses[1], 1);
	const lanePuck = spawnPuck(w, CFG.launchX, CFG.launchY, 2);
	w.st[lanePuck] = ST_SLEEP;
	absorbBlackHoles(w);
	assert.equal(w.n, 2, 'right return zone near start never swallows pucks');
	const recycled = [];
	assert.equal(recyclePucks(w, 'advance', owner => recycled.push(owner)), 2, 'both old-hole puck and right-lane puck recycle');
	assert.deepEqual(recycled.sort(), [0, 2]);
}
applyCfg(PRESETS.default);
// Drive ZoneEditor on-map handles ('disk size' and 'score pattern') and verify drawer checkboxes.
{
	const mkCtx = () => ({ clearRect() {}, save() {}, restore() {}, scale() {}, strokeRect() {}, beginPath() {}, arc() {},
		fill() {}, stroke() {}, setLineDash() {}, strokeText() {}, fillText() {} });
	const mkEl = tag => {
		const handlers = {};
		return {
			tag, id: '', style: {}, dataset: {}, children: [], textContent: '', value: '', checked: false,
			appendChild(c) { this.children.push(c); return c; },
			setAttribute() {}, focus() {}, select() {}, remove() {},
			addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
			removeEventListener() {},
			setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
			getContext: mkCtx,
			dispatch(ev, payload) { for (const fn of handlers[ev] || []) fn(Object.assign({ type: ev, preventDefault() {} }, payload)); },
		};
	};
	const host = mkEl('div');
	globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
	globalThis.document = { activeElement: null, body: { dataset: {} }, head: mkEl('head'),
		createElement: mkEl, getElementById: id => id === 'app' ? host : null };
	const cv = mkEl('canvas');
	cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 550 });
	const game = createGame(CFG);
	const render = { resize() {}, toWorld: (cx, cy) => ({ x: cx / 900 * CFG.boardW, y: cy / 550 * CFG.boardH }) };
	const opts = { ring: true, preview: true, holeFill: false, mode: CFG.recycleMode, theme: 'classic', cards: 'square',
		fx: 'plain', sfx: false, decor: 'radial', face: 'launch', vol: 1.3 };
	Editor.open({ canvas: cv, game, render, button: mkEl('button'), refit() {},
		ui: { opts: () => opts, refreshEditor() {}, changesQuery: () => '', applySetup: applyCfg } });
	const overlay = host.children.find(c => c.id === 'zoneEditorOverlay');
	const drawer = host.children.find(c => c.id === 'zoneEditorDrawer');
	const collectLabels = n => [n.textContent || ''].concat(...(n.children || []).map(collectLabels));
	const allText = collectLabels(drawer).join(' | ');
	assert(!allText.includes('Big-disk scales contents'), 'panel checkbox for big-disk scaling is removed');
	assert(allText.includes('Swap return zone and holes (except right return zone)'), 'swap checkbox is in editor drawer');
	const toPx = (wx, wy) => ({ clientX: wx / CFG.boardW * 900, clientY: wy / CFG.boardH * 550 });
	// Drag handler 1 ('disk size') from (diskX + diskR, diskY) to diskR = 0.60: updates diskR + autoOmega, keeps scoreScale = 1.
	let p0 = toPx(CFG.diskX + CFG.diskR, CFG.diskY), p1 = toPx(CFG.diskX + 0.60, CFG.diskY);
	overlay.dispatch('pointerdown', { pointerId: 1, button: 0, clientX: p0.clientX, clientY: p0.clientY });
	overlay.dispatch('pointermove', { pointerId: 1, clientX: p1.clientX, clientY: p1.clientY });
	overlay.dispatch('pointerup', { pointerId: 1 });
	assert(Math.abs(CFG.diskR - 0.60) < 1e-6, 'disk size handle resizes diskR');
	assert(Math.abs(game.omegaStart - autoOmega(CFG)) < 1e-6, 'disk size handle updates default speed to autoOmega');
	assert.equal(CFG.scoreScale, 1, 'score pattern stays 100% of disk size by default');
	assert(Math.abs(patternScale(CFG) - 0.60 / DISK_REF_R) < 1e-9, 'patternScale follows disk size proportionally');
	// Drag handler 2 ('score pattern') from 100% of diskR (0.60) to 75% of diskR (0.45), without resetting customGeometry.
	resetBoardGeometry(CFG);
	assert.equal(CFG.customGeometry, false);
	p0 = toPx(CFG.diskX + CFG.diskR * Math.cos(0.38), CFG.diskY + CFG.diskR * Math.sin(0.38));
	p1 = toPx(CFG.diskX + 0.60 * Math.cos(0.38), CFG.diskY + 0.60 * Math.sin(0.38));
	overlay.dispatch('pointerdown', { pointerId: 2, button: 0, clientX: p0.clientX, clientY: p0.clientY });
	overlay.dispatch('pointermove', { pointerId: 2, clientX: p1.clientX, clientY: p1.clientY });
	overlay.dispatch('pointerup', { pointerId: 2 });
	assert(Math.abs(CFG.scoreScale - 0.75) < 1e-4, 'score pattern handle scales relative to diskR');
	assert.equal(CFG.customGeometry, false, 'score pattern handle does not mark customGeometry');
	// Pointer cancel on score pattern restores startScore.
	p0 = toPx(CFG.diskX + CFG.diskR * CFG.scoreScale * Math.cos(0.38), CFG.diskY + CFG.diskR * CFG.scoreScale * Math.sin(0.38));
	p1 = toPx(CFG.diskX + CFG.diskR * 1.4 * Math.cos(0.38), CFG.diskY + CFG.diskR * 1.4 * Math.sin(0.38));
	overlay.dispatch('pointerdown', { pointerId: 3, button: 0, clientX: p0.clientX, clientY: p0.clientY });
	overlay.dispatch('pointermove', { pointerId: 3, clientX: p1.clientX, clientY: p1.clientY });
	assert(CFG.scoreScale > 1.3);
	overlay.dispatch('pointercancel', { pointerId: 3 });
	assert(Math.abs(CFG.scoreScale - 0.75) < 1e-4, 'pointercancel restores scoreScale');
	Editor.close();
	applyCfg(PRESETS.default);
}
CFG.holes[0].x = 5;
resetBoardGeometry(CFG);
assert.deepEqual(boardGeometry(CFG), defaults, 'default snapshot cannot be mutated through an applied board');
Object.assign(CFG, original);
console.log('OK (geometry validation, derived zones, projection, clean paused preview, viewport stability, preset round-trip, scoreScale + swapZones + handles)');
