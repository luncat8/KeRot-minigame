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
assert.equal(CFG.diskScale, true);
assert(Math.abs(CFG.omega - autoOmega(CFG)) < 1e-6, 'the preset speed is the auto-ω of its own disk');
const smallParsed = parseQuery('?preset=notsobigdisk');
assert(smallParsed && smallParsed.preset === 'notsobigdisk', 'the preset is a URL key');
applyCfg(smallParsed);
assert.deepEqual(boardGeometry(CFG), small.geometry, 'the preset link reopens the same board');
CFG.holes[0].x = 5;
resetBoardGeometry(CFG);
assert.deepEqual(boardGeometry(CFG), defaults, 'default snapshot cannot be mutated through an applied board');
Object.assign(CFG, original);
console.log('OK (geometry validation, derived zones, projection, clean paused preview, viewport stability, preset round-trip)');
