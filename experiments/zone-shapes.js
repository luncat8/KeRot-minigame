// The zone and hole shapes are rules, so the picture has to be the rule. Checks:
//  - every soft zone outline the renderer traces (marching squares over zoneField)
//    encloses the same points inZone() accepts, except within a grid cell of the
//    boundary; the outline comes out as closed loops, the inset lines as polylines;
//  - 'rounded' keeps clear of the guard and of every hole's reach and bridges the
//    hole ↔ guard gap; 'arcs' puts the holes inside the zone; the lane stays in;
//  - the triangle void: semicircle area, sides parallel to the wedge side, and the
//    swept entry time agrees with brute-force stepping on random rays;
//  - the circle void's entry time is unchanged;
//  - every zone × hole × return-rule combination draws, rounded cards included, and
//    the URL keys zones= holes= cards= reach CFG and the page options.
//   node experiments/zone-shapes.js
const fs = require('fs');
const path = require('path');
Object.assign(globalThis, require('../js/cfg.js'), require('../js/field.js'), require('../js/physics.js'),
	require('../js/score.js'), require('../js/players.js'), require('../js/rules.js'), require('../js/presets.js'));
let fail = 0;
function check(ok, name, extra) { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!ok) fail = 1; }

// Recording Path2D: subpaths as point lists, closed or open.
class Path2D {
	constructor() { this.subs = []; this.cur = null; }
	moveTo(x, y) { this.cur = { pts: [x, y], closed: false }; this.subs.push(this.cur); }
	lineTo(x, y) { this.cur.pts.push(x, y); }
	arc() { }
	rect() { }
	closePath() { if (this.cur) this.cur.closed = true; }
	addPath() { }
}
globalThis.Path2D = Path2D;
const noop = () => { };
const gradient = () => ({ addColorStop: noop });
const ctx = new Proxy({ createRadialGradient: gradient, createLinearGradient: gradient }, { get: (t, k) => k in t ? t[k] : noop, set: (t, k, v) => { t[k] = v; return true; } });
const canvas = { width: 0, height: 0, style: {}, parentElement: { dataset: {}, clientWidth: 900, clientHeight: 550 }, getContext: () => ctx };
globalThis.window = { devicePixelRatio: 1, addEventListener: noop };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: noop, drawImage: noop, beginPath: noop, arc: noop, fill: noop }) }) };
// The renderer's zone baking is internal; expose it the way the page would never need to.
const src = fs.readFileSync(path.join(__dirname, '../js/render.js'), 'utf8')
	.replace(/^if \(typeof module !== 'undefined'\).*$/gm, '')
	.replace(/\bconst Render =/, 'globalThis.Render =')
	.replace(/return \{ setup, resize, attach, drawWorld, toWorld, themes: THEMES \};/,
		'return { setup, resize, attach, drawWorld, toWorld, themes: THEMES, zones: () => ({ fan: zoneFan, adv: zoneAdv }) };');
(0, eval)(src); // global scope, as a classic script runs: a direct eval would time scope lookups, not the bake
Render.setup(canvas, CFG);

function evenOdd(subs, x, y) {
	let inside = false;
	for (const s of subs) {
		const p = s.pts, n = p.length / 2;
		for (let a = 0, b = n - 1; a < n; b = a++) {
			const ya = p[2 * a + 1], yb = p[2 * b + 1];
			if ((ya > y) !== (yb > y) && x < p[2 * a] + (y - ya) * (p[2 * b] - p[2 * a]) / (yb - ya)) inside = !inside;
		}
	}
	return inside;
}
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

for (const style of ['rounded', 'arcs']) {
	CFG.zoneStyle = style;
	Render.resize(true); // warm: the timing below is a rebake, what a board resize pays
	const t0 = Date.now();
	Render.resize(true);
	const ms = Date.now() - t0;
	const zones = Render.zones();
	for (const [mode, z] of [['zones', zones.fan], ['advance', zones.adv]]) {
		const loops = z.path.subs;
		check(loops.length > 0 && loops.every(s => s.closed), style + '/' + mode + ': the outline is closed loops', loops.length + ' loop(s)');
		if (style === 'rounded') check(z.hatch.subs.length > 3 && z.hatch.subs.every(s => s.pts.length >= 4), style + '/' + mode + ': inset lines traced');
		let bad = 0, near = 0;
		for (let k = 0; k < 40000; k++) {
			const x = rnd() * CFG.boardW, y = rnd() * CFG.boardH;
			if (evenOdd(loops, x, y) === inReturnZone(CFG, mode, x, y)) continue;
			if (Math.abs(zoneField(CFG, mode, x, y)) < 0.012) near++; else bad++;
		}
		check(bad === 0, style + '/' + mode + ': drawn region = rule region', bad + ' off, ' + near + ' within a grid cell of the edge');
	}
	console.log('     ' + style + ': both modes baked in ' + ms + ' ms');
}

// 'rounded': nothing inside the guard or a hole's reach; the bridge between them is
// closed (no zone point on the segment hole edge → guard), the lane is in.
CFG.zoneStyle = 'rounded';
let leaks = 0;
for (let k = 0; k < 40000; k++) {
	const x = rnd() * CFG.boardW, y = rnd() * CFG.boardH;
	if (!inReturnZone(CFG, 'advance', x, y)) continue;
	if (inGuard(CFG, x, y)) leaks++;
	for (const h of CFG.holes) if (holeGap(CFG, h, x, y) <= CFG.puckR) leaks++;
}
check(leaks === 0, 'rounded: no zone point inside the guard or a hole\'s reach', String(leaks));
for (const holeStyle of ['classic', 'triangle']) {
	CFG.holeStyle = holeStyle;
	let open = 0;
	for (const h of CFG.holes) {
		for (let u = 0; u <= 1; u += 0.01) {
			const x = h.x + (CFG.diskX - h.x) * u, y = h.y + (CFG.diskY - h.y) * u;
			if (inReturnZone(CFG, 'advance', x, y)) open++;
		}
	}
	check(open === 0, 'rounded/' + holeStyle + ': the hole ↔ guard gap is bridged', open + ' zone points on the hole → centre segments');
}
CFG.holeStyle = 'classic';
check(inReturnZone(CFG, 'advance', 0.05, CFG.diskY) && inReturnZone(CFG, 'advance', CFG.launchX, 0.3), 'rounded: wedge side and lane are in');
// 'arcs': the whole reach of each hole that lies on the board is inside the zone.
CFG.zoneStyle = 'arcs';
let outside = 0;
for (const h of CFG.holes) {
	for (let a = 0; a < 2 * Math.PI; a += 0.05) {
		for (let r = 0; r <= h.r + CFG.puckR; r += 0.02) {
			const x = h.x + r * Math.cos(a), y = h.y + r * Math.sin(a);
			if (y < 0 || y > CFG.boardH) continue;
			if (!inReturnZone(CFG, 'advance', x, y)) outside++;
		}
	}
}
check(outside === 0, 'arcs: the holes lie inside the return zone', String(outside));
CFG.zoneStyle = 'hatch';

// The triangle void.
CFG.holeStyle = 'triangle';
const t = holeTriangle(CFG, CFG.holes[0], new Float64Array(6));
const area = Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[3] - t[1]) * (t[4] - t[0])) / 2;
const r0 = CFG.holes[0].r;
check(Math.abs(area - Math.PI * r0 * r0 / 2) < 1e-9, 'triangle: the semicircle\'s area', area.toFixed(4) + ' m²');
const sideSlope = (t[5] - t[1]) / (t[4] - t[0]), wedgeSlope = CFG.diskY / CFG.diskX;
check(Math.abs(sideSlope - wedgeSlope) < 1e-9, 'triangle: its side is parallel to the wedge side', sideSlope.toFixed(3));
const tb = holeTriangle(CFG, CFG.holes[1], new Float64Array(6));
check(tb[5] < CFG.holes[1].y && t[5] > CFG.holes[0].y, 'triangle: both apexes point into the board');
// Swept entry against brute force: tiny steps until holeGap <= r.
function bruteEntry(w, hole, rem) {
	const dt = 2e-5;
	for (let s = 0; s * dt <= rem; s++) {
		const x = w.x[0] + w.vx[0] * s * dt, y = w.y[0] + w.vy[0] * s * dt;
		if (holeGap(w.cfg, hole, x, y) <= w.r[0]) return s * dt;
	}
	return -1;
}
function rays(style) {
	CFG.holeStyle = style;
	const w = createWorld(CFG);
	spawnPuck(w, 0, 0, 0);
	let worst = 0, mism = 0, hits = 0;
	for (let k = 0; k < 400; k++) {
		const hole = CFG.holes[k & 1];
		w.x[0] = hole.x + (rnd() - 0.5) * 1.6; w.y[0] = Math.abs(hole.y - (0.35 + rnd() * 0.6));
		const aim = Math.atan2(hole.y - w.y[0], hole.x + (rnd() - 0.5) * 0.9 - w.x[0]), sp = 0.5 + rnd() * 2.5;
		w.vx[0] = sp * Math.cos(aim); w.vy[0] = sp * Math.sin(aim);
		if (holeGap(CFG, hole, w.x[0], w.y[0]) <= w.r[0]) continue;
		const a = holeEntryTime(w, 0, hole, 1), b = bruteEntry(w, hole, 1);
		if ((a < 0) !== (b < 0)) { mism++; continue; }
		if (a < 0) continue;
		hits++;
		worst = Math.max(worst, Math.abs(a - b));
	}
	check(mism === 0 && worst < 1e-4, style + ': swept hole entry = brute force on 400 rays', hits + ' hits, worst Δt ' + worst.toExponential(1) + ' s, ' + mism + ' disagreements');
}
rays('triangle');
rays('classic');

{
	const w = createWorld(CFG);
	spawnPuck(w, 0.4, 1.1, 0); spawnPuck(w, 2.0, 0.6, 1);
	const view = { w: w, aim: null, opts: { ring: true, preview: false, mode: 'advance', theme: 'classic', cards: 'round' },
		pred: null, roster: createRoster(['human', 'keeper'], CFG.ballsPerPlayer), turn: 0, resolveT: 0, state: 'aim' };
	let drawn = 0;
	for (const zones of ZONE_STYLES) {
		for (const holes of HOLE_STYLES) {
			for (const mode of ['none', 'zones', 'advance']) {
				CFG.zoneStyle = zones; CFG.holeStyle = holes; view.opts.mode = mode;
				Render.drawWorld(view); drawn++;
			}
		}
	}
	check(drawn === 48, 'every zone × hole × rule combination draws', drawn + ' frames');
}
const setup = parseQuery('zones=Arcs&holes=triangle&cards=round');
applyCfg(setup);
check(CFG.zoneStyle === 'arcs' && CFG.holeStyle === 'triangle' && setup.cards === 'round', 'URL keys reach CFG and the page options');
check(parseQuery('zones=diamond&holes=hex') === null, 'unknown shapes are dropped');
applyCfg(PRESETS.default);
check(CFG.zoneStyle === 'hatch' && CFG.holeStyle === 'classic', 'the default preset restores the shipped shapes');
if (!fail) console.log('OK (zone and hole shapes: drawn = rule, swept entry, every combination, URL keys)');
process.exit(fail);
