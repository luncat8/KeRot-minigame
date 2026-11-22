// Canvas renderer. Each board gets its own surfaces, textures and coordinate transform;
// the default page uses one instance and an embedded minigame creates one per session.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./field.js'), require('./physics.js'), require('./score.js'), require('./players.js'), require('./rules.js'));
function createRenderer() {
	let cfg = CFG;
	let cv, ctx, sx = 100, sy = 100, dpr = 1;
	// Optional presentation skin (js/fx.js). Null on the shipped page: the base frame
	// pays one check per hook, and no texture or audio code is fetched. disk() runs in
	// the disk's rotated local frame; the others draw in world coordinates. surface()
	// is the top of the ice — over every marking already painted, including the voids,
	// the aim ghost and the stones.
	let skin = null;
	let texDisk = null, texSchema = '', texRadius = 0, ppmDisk = 0, texScore = 1, texBlue = 55, texBend = 1, puckGrad = null, wallPath = null, gridPath = null;
	let zoneFan = null, zoneAdv = null, sectorPath = null, bandPath = null, holeClip = null;
	let swapZoneNone = null, swapZoneAdv = null, swapZoneFan = null, swapVoidAdv = null, swapVoidFan = null;
	let builtZone = '', builtHole = '', builtSwap = false; // the shape styles the zone and hole paths were baked for
	const holeTri = new Float64Array(6);
	const Z_FILL = 'rgba(32,178,170,0.16)', Z_LINE = 'rgba(46,204,196,0.55)', Z_HATCH = 'rgba(46,204,196,0.16)';
	const SECTOR_SHADE = 'rgba(45,52,54,0.42)'; // 3 of the 6 face sectors
	let labelRot = 0;
	const HUD_Y = 0.04, HUD_H = 0.23, HUD_GAP = 0.02, HUD_MAX = 0.46;
	const RIM_W = 0.020; // puck ring; stroked inside the fill so the edge stays crisp
	const KR_RIM = 0.012; // seat ring of the kerot-s puck, over the outline it replaces
	const MAX_BACKING = 6e6; // device px the canvas may ask for, however big the window
	const TAU = 2 * Math.PI, GOLDEN = 2.399963; // golden angle: per-puck rim marks never line up
	const GHOST_CHUNKS = 6;
	// Every per-frame string, made once: puck numbers and the kerot-s rate tags.
	const NUM = [], PCT = [];
	for (let k = 0; k <= MAX_PUCKS; k++) NUM.push(String(k + 1));
	for (let k = 0; k <= 100; k++) PCT.push(k + '%');
	// UI colour schemes. The game colours — the disk paint (it is the score map), seats,
	// zones, black holes — are rules and stay put; a scheme restyles the board's chrome
	// and the pucks. index.html restyles the page from body.dataset.theme.
	const THEMES = {
		classic: {
			label: 'classic', bg: '#0b1c26', floor: ['#49586f'], grid: null,
			wall: '#dfe6e9', wallW: 0.020, rim: '#dfe6e9', ring: '#ffffff', tick: '#2d3436',
			hud: 'rgba(0,0,0,0.28)', hudLine: null,
			ink: '255,234,167', text: '#dfe6e9', font: 'sans-serif', puck: drawPuckClassic,
		},
		// The kerot-s draft: navy ice under a faint grid, amber ink, monospace, cream pucks.
		kerot: {
			label: 'kerot-s', bg: '#070b10', floor: ['#131c27', '#0e1620', '#0a1119'], grid: 'rgba(120,160,200,0.07)',
			wall: 'rgba(140,180,220,0.35)', wallW: 0.012, rim: '#080d13', ring: 'rgba(255,235,180,0.45)', tick: '#1a222c',
			hud: 'rgba(15,22,31,0.82)', hudLine: '#24344a',
			ink: '255,192,120', text: '#dce7f3', font: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', puck: drawPuckKerot,
		},
	};
	let theme = THEMES.classic, themeName = '';
	// Gradients belong to this renderer's canvas and board height. The theme table is
	// shared by every renderer on the page, so the fills live here instead.
	const floorFill = {};
	const font = { hud: '', label: '', zone: '', holeZone: '', hole: '', num: '', tag: '' };
	const ghostInk = [];
	function setup(canvas, config) {
		cfg = config || CFG;
		cv = canvas; ctx = cv.getContext('2d');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		buildPuckGradient();
		buildFloorFills();
		applyTheme('classic');
		buildZonePaths();
		resize();
		if (skin && skin.setup) skin.setup(cfg, sx, sy, dpr);
	}
	function attach(addon) {
		skin = addon || null;
		if (skin && cv && skin.setup) skin.setup(cfg, sx, sy, dpr);
	}
	function buildPuckGradient() {
		puckGrad = ctx.createRadialGradient(-0.03, -0.03, 0.01, 0, 0, cfg.puckR);
		puckGrad.addColorStop(0, '#f5f6fa'); puckGrad.addColorStop(0.7, '#b2bec3'); puckGrad.addColorStop(1, '#636e72');
	}
	function buildFloorFills() {
		for (const name in THEMES) {
			const colors = THEMES[name].floor;
			if (colors.length === 1) { floorFill[name] = colors[0]; continue; }
			const grad = ctx.createLinearGradient(0, 0, 0, cfg.boardH);
			for (let k = 0; k < colors.length; k++) grad.addColorStop(k / (colors.length - 1), colors[k]);
			floorFill[name] = grad;
		}
	}
	function applyTheme(name) {
		themeName = name; theme = THEMES[name];
		const f = theme.font;
		font.hud = 'bold 0.088px ' + f; font.label = '0.075px ' + f; font.zone = '0.09px ' + f; font.holeZone = '0.055px ' + f;
		font.hole = '0.045px ' + f; font.num = 'bold ' + (cfg.puckR * 0.55) + 'px ' + f; font.tag = '0.06px ' + f;
		for (let c = 0; c < GHOST_CHUNKS; c++) ghostInk[c] = 'rgba(' + theme.ink + ',' + (0.10 + 0.07 * (GHOST_CHUNKS - c)).toFixed(3) + ')';
		theme.inkSolid = 'rgb(' + theme.ink + ')';
	}
	function buildZonePaths() {
		const z = cfg.returnZone, v = cfg.advanceZone;
		builtZone = cfg.zoneStyle; builtHole = cfg.holeStyle; builtSwap = !!cfg.swapZones;
		// Both return rules: a fill with the on-disk guard (diskR + puckR) punched
		// out of it, so the exemption is drawn instead of implied, plus the outline
		// to stroke and the lines that fill it. The 'advance' rule adds the launch lane.
		if (isFieldZone(cfg)) { zoneFan = softZone('zones'); zoneAdv = softZone('advance'); }
		else {
			const hatch = cfg.zoneStyle === 'wavy' ? wavyHatch() : straightHatch();
			zoneFan = bakeZone(z, null, hatch);
			zoneAdv = bakeZone(v, [v.lx, 0, v.lw, cfg.boardH], hatch);
		}
		buildHoleClip();
		if (cfg.swapZones) buildSwapPaths();
		else { swapZoneNone = swapZoneAdv = swapZoneFan = swapVoidAdv = swapVoidFan = null; }
		// Puck face: 6 sectors, 3 shaded, unit radius (scaled per puck at draw time).
		sectorPath = new Path2D();
		for (let k = 0; k < 3; k++) {
			const a0 = k * 2 * Math.PI / 3;
			sectorPath.moveTo(0, 0);
			sectorPath.arc(0, 0, 1, a0, a0 + Math.PI / 3);
			sectorPath.closePath();
		}
		// kerot-s puck rim: two opposite quarters of the band 0.74…1, unit radius.
		bandPath = new Path2D();
		for (let k = 0; k < 2; k++) {
			const a0 = k * Math.PI, a1 = a0 + Math.PI / 2;
			bandPath.moveTo(Math.cos(a0), Math.sin(a0));
			bandPath.arc(0, 0, 1, a0, a1);
			bandPath.arc(0, 0, 0.74, a1, a0, true);
			bandPath.closePath();
		}
		// kerot-s floor grid: 8 × 4 cells over the board.
		gridPath = new Path2D();
		for (let k = 1; k < 8; k++) { gridPath.moveTo(k * cfg.boardW / 8, 0); gridPath.lineTo(k * cfg.boardW / 8, cfg.boardH); }
		for (let k = 1; k < 4; k++) { gridPath.moveTo(0, k * cfg.boardH / 4); gridPath.lineTo(cfg.boardW, k * cfg.boardH / 4); }
		labelRot = Math.atan2(z.by - z.ay, z.bx - z.ax); // fan edge -> readable label angle
	}
	// The zone is the triangle (plus the launch lane, in 'advance') minus the on-disk
	// guard — a disk of diskR + puckR around the disk centre, the same guard the rule
	// exempts. Only the part of that disk inside the wedge exists as a hole: each rule
	// table gives the wedge a vertex on the disk centre, so the wedge's interior angle
	// is exactly the sector to cut. Cutting the full circle leaked instead — evenodd
	// fills a region covered by an odd number of subpaths, and the circle's part
	// outside the triangle is covered once, so it drew as a strange teal halo hugging
	// the disk. The outline strokes the wedge's true boundary: its two sides, cut where
	// they enter the guard, then the arc that closes the fill on the interior side.
	function bakeZone(t, rect, hatch) {
		const Rg = cfg.diskR + cfg.puckR;
		// The apex is the table vertex that sits on the disk centre; the other two give
		// the wedge's two edge directions.
		const dx = t.ax - cfg.diskX, dy = t.ay - cfg.diskY;
		const dd = dx * dx + dy * dy;
		const ex = t.bx - cfg.diskX, ey = t.by - cfg.diskY, ee = ex * ex + ey * ey;
		const fx = t.cx - cfg.diskX, fy = t.cy - cfg.diskY, ff = fx * fx + fy * fy;
		let v1x, v1y, v2x, v2y, d1x, d1y, d2x, d2y;
		if (dd <= ee && dd <= ff) { v1x = t.bx; v1y = t.by; v2x = t.cx; v2y = t.cy; }
		else if (ee <= ff) { v1x = t.ax; v1y = t.ay; v2x = t.cx; v2y = t.cy; }
		else { v1x = t.ax; v1y = t.ay; v2x = t.bx; v2y = t.by; }
		d1x = v1x - cfg.diskX; d1y = v1y - cfg.diskY;
		d2x = v2x - cfg.diskX; d2y = v2y - cfg.diskY;
		const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
		const a0 = Math.atan2(d1y, d1x), a1 = Math.atan2(d2y, d2x);
		const sweep = (a1 - a0 + TAU) % TAU; // arc a0 -> a1 the +angle way
		const am = Math.atan2(d1y / l1 + d2y / l2, d1x / l1 + d2x / l2);
		const ccw = (am - a0 + TAU) % TAU > sweep; // interior lies off the +angle way
		const p1x = cfg.diskX + Rg * d1x / l1, p1y = cfg.diskY + Rg * d1y / l1;
		const p2x = cfg.diskX + Rg * d2x / l2, p2y = cfg.diskY + Rg * d2y / l2;
		const fill = new Path2D(), line = new Path2D();
		fill.moveTo(t.ax, t.ay); fill.lineTo(t.bx, t.by); fill.lineTo(t.cx, t.cy); fill.closePath();
		// Outline: the wedge's true boundary — out along the first side to its vertex, the
		// edge between the two vertices, back along the second side, then the guard arc
		// closing the fill. Must be one subpath built in order: a rect()/closePath() in the
		// middle makes canvas continue from *its* corner, which drew long stray diagonals.
		line.moveTo(p1x, p1y); line.lineTo(v1x, v1y); line.lineTo(v2x, v2y); line.lineTo(p2x, p2y);
		line.arc(cfg.diskX, cfg.diskY, Rg, a1, a0, !ccw);
		line.closePath();
		if (rect) { fill.rect(rect[0], rect[1], rect[2], rect[3]); line.rect(rect[0], rect[1], rect[2], rect[3]); }
		const hole = new Path2D();
		hole.moveTo(cfg.diskX, cfg.diskY);
		hole.lineTo(p1x, p1y);
		hole.arc(cfg.diskX, cfg.diskY, Rg, a0, a1, ccw);
		hole.closePath();
		const path = new Path2D();
		path.addPath(fill); path.addPath(hole);
		// A shortened wedge can end inside the guard; clip both sides of the subtraction.
		const guardClip = new Path2D();
		guardClip.rect(0, 0, cfg.boardW, cfg.boardH);
		guardClip.moveTo(cfg.diskX + Rg, cfg.diskY); guardClip.arc(cfg.diskX, cfg.diskY, Rg, 0, TAU);
		return { path: path, line: line, hatch: hatch, clip: fill, guardClip };
	}
	const HATCH_STEP = 0.14;
	function straightHatch() {
		const p = new Path2D();
		for (let s = -cfg.boardH; s < cfg.boardW; s += HATCH_STEP) { // 45° stripes across the board
			p.moveTo(s, 0); p.lineTo(s + cfg.boardH, cfg.boardH);
		}
		return p;
	}
	// The same stripes, each wavering on two incommensurate sines; the golden-angle phase
	// step keeps neighbours from ever running in step.
	function wavyHatch() {
		const p = new Path2D(), len = cfg.boardH * Math.SQRT2, du = 0.02;
		for (let s = -cfg.boardH, n = 0; s < cfg.boardW; s += HATCH_STEP, n++) {
			const phase = n * GOLDEN;
			for (let u = 0; u <= len + du / 2; u += du) {
				const off = 0.024 * Math.sin(u * 10.5 + phase) + 0.007 * Math.sin(u * 27 + 2 * phase);
				const x = s + (u + off) / Math.SQRT2, y = (u - off) / Math.SQRT2;
				if (u === 0) p.moveTo(x, y); else p.lineTo(x, y);
			}
		}
		return p;
	}
	// A field zone (js/rules.js zoneField) is traced from the rule's own field on a grid
	// that overhangs the board. The outline is the field's zero level closed off just
	// outside the walls, so it fills as loops and its wall pieces fall outside the board
	// clip; the lines are the field's higher levels — inset copies of the outline — or,
	// for 'arcs', circles around the disk centre.
	// The outline is traced on a 1 cm grid: it is the rule's edge. The inset lines are
	// decoration and solid, so a 2.5 cm grid draws them as smoothly at a sixth of the cost
	// — this bake reruns whenever the board's geometry changes.
	const SOFT_GRID = 0.01, SOFT_LINE_GRID = 0.025, SOFT_PAD = 0.03, SOFT_LINE_GAP = 0.08;
	function softZone(mode) {
		const path = new Path2D(), hatch = new Path2D();
		sampleField(mode, SOFT_GRID, true, path);
		if (cfg.zoneStyle !== 'arcs') { sampleField(mode, SOFT_LINE_GRID, false, hatch); return { path: path, line: path, hatch: hatch }; }
		const far = Math.hypot(Math.max(cfg.diskX, cfg.boardW - cfg.diskX), Math.max(cfg.diskY, cfg.boardH - cfg.diskY));
		for (let r = cfg.diskR + cfg.puckR + SOFT_LINE_GAP; r < far; r += SOFT_LINE_GAP) {
			hatch.moveTo(cfg.diskX + r, cfg.diskY); hatch.arc(cfg.diskX, cfg.diskY, r, 0, TAU);
		}
		return { path: path, line: path, hatch: hatch };
	}
	// outline: the zero level, closed just outside the walls; otherwise the inset levels.
	function sampleField(mode, step, outline, out) {
		const nx = Math.ceil((cfg.boardW + 2 * SOFT_PAD) / step) + 1, ny = Math.ceil((cfg.boardH + 2 * SOFT_PAD) / step) + 1;
		const vals = new Float32Array(nx * ny);
		let top = 0;
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				const x = i * step - SOFT_PAD, y = j * step - SOFT_PAD, f = zoneField(cfg, mode, x, y);
				vals[j * nx + i] = outline ? Math.min(f, Math.min(x, cfg.boardW - x, y, cfg.boardH - y) + SOFT_PAD / 2) : f;
				if (f > top && x > 0 && y > 0 && x < cfg.boardW && y < cfg.boardH) top = f;
			}
		}
		const trace = contourTracer(nx, ny, -SOFT_PAD, -SOFT_PAD, step);
		if (outline) { trace(out, vals, 0); return; }
		for (let level = SOFT_LINE_GAP; level < top; level += SOFT_LINE_GAP) trace(out, vals, level);
	}
	// Marching squares with the segments chained into polylines, so a dash pattern runs
	// on along a contour instead of restarting in every grid cell. A segment joins two
	// cell edges; every crossed edge belongs to at most two segments, so two link slots
	// per edge hold the whole graph. Saddles are split by the cell's centre value.
	// Edge order per case: top, right, bottom, left (0..3).
	const MS_CASES = [[], [3, 0], [0, 1], [3, 1], [1, 2], null, [0, 2], [3, 2], [2, 3], [0, 2], null, [1, 2], [3, 1], [0, 1], [3, 0], []];
	const MS_SADDLE_IN = [[0, 1, 2, 3], [3, 0, 1, 2]], MS_SADDLE_OUT = [[3, 0, 1, 2], [0, 1, 2, 3]]; // cases 5, 10
	function contourTracer(nx, ny, x0, y0, step) {
		const nh = (nx - 1) * ny, ne = nh + nx * (ny - 1);
		const l1 = new Int32Array(ne), l2 = new Int32Array(ne), seen = new Uint8Array(ne), cell = new Int32Array(4);
		let vals = null, level = 0;
		function link(a, b) {
			if (l1[a] < 0) l1[a] = b; else l2[a] = b;
			if (l1[b] < 0) l1[b] = a; else l2[b] = a;
		}
		function at(e, path, first) {
			let i, j, ia, ib;
			if (e < nh) { j = Math.floor(e / (nx - 1)); i = e - j * (nx - 1); ia = j * nx + i; ib = ia + 1; }
			else { const f = e - nh; j = Math.floor(f / nx); i = f - j * nx; ia = j * nx + i; ib = ia + nx; }
			const t = (level - vals[ia]) / (vals[ib] - vals[ia]);
			const x = x0 + (i + (e < nh ? t : 0)) * step, y = y0 + (j + (e < nh ? 0 : t)) * step;
			if (first) path.moveTo(x, y); else path.lineTo(x, y);
		}
		function walk(path, start, loop) {
			let prev = -1, cur = start;
			at(cur, path, true);
			for (;;) {
				seen[cur] = 1;
				const next = l1[cur] !== prev ? l1[cur] : l2[cur];
				if (next < 0 || (seen[next] && next !== start)) break;
				at(next, path, false);
				if (next === start) break;
				prev = cur; cur = next;
			}
			if (loop) path.closePath();
		}
		return function trace(path, values, lv) {
			vals = values; level = lv;
			l1.fill(-1); l2.fill(-1); seen.fill(0);
			for (let j = 0; j < ny - 1; j++) {
				for (let i = 0; i < nx - 1; i++) {
					const a = vals[j * nx + i], b = vals[j * nx + i + 1], c = vals[(j + 1) * nx + i + 1], d = vals[(j + 1) * nx + i];
					const code = (a > lv ? 1 : 0) | (b > lv ? 2 : 0) | (c > lv ? 4 : 0) | (d > lv ? 8 : 0);
					if (code === 0 || code === 15) continue;
					cell[0] = j * (nx - 1) + i; cell[1] = nh + j * nx + i + 1; cell[2] = (j + 1) * (nx - 1) + i; cell[3] = nh + j * nx + i;
					let seg = MS_CASES[code];
					if (!seg) seg = ((a + b + c + d) / 4 > lv ? MS_SADDLE_IN : MS_SADDLE_OUT)[code === 5 ? 0 : 1];
					for (let k = 0; k < seg.length; k += 2) link(cell[seg[k]], cell[seg[k + 1]]);
				}
			}
			for (let e = 0; e < ne; e++) if (!seen[e] && l1[e] >= 0 && l2[e] < 0) walk(path, e, false); // open ends first
			for (let e = 0; e < ne; e++) if (!seen[e] && l1[e] >= 0) walk(path, e, true);
		};
	}
	// Where the voids swallow a puck: each hole's shape grown by the puck radius. The
	// glass skin's surface pass is clipped to it.
	function buildHoleClip() {
		holeClip = new Path2D();
		for (let k = 0; k < cfg.holes.length; k++) {
			const h = cfg.holes[k];
			if (cfg.holeStyle === 'triangle') growTriangle(holeClip, holeTriangle(cfg, h, holeTri), cfg.puckR);
			else { holeClip.moveTo(h.x + h.r + cfg.puckR, h.y); holeClip.arc(h.x, h.y, h.r + cfg.puckR, 0, TAU); }
		}
	}
	// Triangle t grown by r: each edge pushed out along its normal, the corners rounded.
	function growTriangle(path, t, r) {
		const cw = (t[2] - t[0]) * (t[5] - t[1]) - (t[3] - t[1]) * (t[4] - t[0]) > 0; // increasing canvas angle
		for (let k = 0; k < 3; k++) {
			const ax = t[2 * k], ay = t[2 * k + 1], bx = t[(2 * k + 2) % 6], by = t[(2 * k + 3) % 6];
			const cx = t[(2 * k + 4) % 6], cy = t[(2 * k + 5) % 6];
			const a0 = Math.atan2(cw ? -(bx - ax) : bx - ax, cw ? by - ay : -(by - ay)); // outward normal of a→b
			const a1 = Math.atan2(cw ? -(cx - bx) : cx - bx, cw ? cy - by : -(cy - by)); // and of b→c
			if (k === 0) path.moveTo(ax + r * Math.cos(a0), ay + r * Math.sin(a0));
			path.lineTo(bx + r * Math.cos(a0), by + r * Math.sin(a0));
			path.arc(bx, by, r, a0, a1, !cw);
		}
		path.closePath();
	}
	// Swapped board markings: the old holes become circular return zones (plus the
	// right strip near start, which stays a return zone), and the old return zone
	// (minus that right strip) becomes the void. Pre-baked so drawWorld allocates nothing.
	function bakeSwapVoid(mode) {
		const step = SOFT_GRID;
		const nx = Math.ceil((cfg.boardW + 2 * SOFT_PAD) / step) + 1, ny = Math.ceil((cfg.boardH + 2 * SOFT_PAD) / step) + 1;
		const raw = new Float32Array(nx * ny), closed = new Float32Array(nx * ny);
		let top = 0;
		for (let j = 0; j < ny; j++) {
			const y = j * step - SOFT_PAD;
			for (let i = 0; i < nx; i++) {
				const x = i * step - SOFT_PAD, f = swapVoidField(cfg, mode, x, y);
				raw[j * nx + i] = f;
				if (x > 0.04 && x < cfg.boardW - 0.04 && y > 0.04 && y < cfg.boardH - 0.04 && f > top) top = f;
			}
		}
		if (top <= 0) return null;
		const inset = Math.min(cfg.puckR * 0.75, top * 0.38);
		let upBest = -1e9, upX = 0, upY = 0, dnBest = -1e9, dnX = 0, dnY = 0;
		for (let j = 0; j < ny; j++) {
			const y = j * step - SOFT_PAD;
			if (y < 0.06 || y > cfg.boardH - 0.06) continue;
			for (let i = 0; i < nx; i++) {
				const x = i * step - SOFT_PAD;
				if (x < 0.09 || x > cfg.boardW - 0.09) continue;
				const f = raw[j * nx + i];
				if (f <= 0.02) continue;
				const w = Math.min(f - inset, x - 0.09, cfg.boardW - 0.09 - x, y - 0.06, cfg.boardH - 0.06 - y);
				if (y < cfg.diskY && w > upBest) { upBest = w; upX = x; upY = y; }
				if (y >= cfg.diskY && w > dnBest) { dnBest = w; dnX = x; dnY = y; }
			}
		}
		const trace = contourTracer(nx, ny, -SOFT_PAD, -SOFT_PAD, step);
		function closeLoop(lv) {
			const path = new Path2D();
			for (let j = 0; j < ny; j++) {
				const y = j * step - SOFT_PAD;
				for (let i = 0; i < nx; i++) {
					const x = i * step - SOFT_PAD;
					closed[j * nx + i] = Math.min(raw[j * nx + i] - lv, Math.min(x, cfg.boardW - x, y, cfg.boardH - y) + SOFT_PAD / 2);
				}
			}
			trace(path, closed, 0);
			return path;
		}
		const reachOut = closeLoop(-RING_HALF), capture = closeLoop(0), core = closeLoop(inset);
		const mid = closeLoop(inset + (top - inset) * 0.42), deep = closeLoop(inset + (top - inset) * 0.70);
		const labels = [];
		if (upBest > -0.04) labels.push([upX, upY]);
		if (dnBest > -0.04 && (!labels.length || Math.hypot(dnX - upX, dnY - upY) > 0.25)) labels.push([dnX, dnY]);
		return { reachOut, capture, core, mid, deep, labels };
	}
	function buildSwapPaths() {
		const v = cfg.advanceZone, z = cfg.returnZone;
		let hatch;
		if (isFieldZone(cfg)) {
			hatch = new Path2D();
			for (let k = 0; k < cfg.holes.length; k++) {
				const h = cfg.holes[k], R = h.r + cfg.puckR;
				for (let r = R - SOFT_LINE_GAP; r > 0.02; r -= SOFT_LINE_GAP) { hatch.moveTo(h.x + r, h.y); hatch.arc(h.x, h.y, r, 0, TAU); }
			}
			for (let x = v.lx + SOFT_LINE_GAP; x < cfg.boardW - 0.01; x += SOFT_LINE_GAP) { hatch.moveTo(x, 0); hatch.lineTo(x, cfg.boardH); }
		} else hatch = cfg.zoneStyle === 'wavy' ? wavyHatch() : straightHatch();
		const holeLabels = [];
		for (let k = 0; k < cfg.holes.length; k++) {
			const h = cfg.holes[k], R = h.r + cfg.puckR;
			const dy = h.y <= 0.05 ? R * 0.42 : h.y >= cfg.boardH - 0.05 ? -R * 0.42 : 0;
			holeLabels.push([clamp(h.x, 0.12, cfg.boardW - 0.12), clamp(h.y + dy, 0.08, cfg.boardH - 0.08), 0, true]);
		}
		const nonePath = new Path2D(); nonePath.addPath(holeClip);
		swapZoneNone = { path: nonePath, line: nonePath, hatch, labels: holeLabels };
		const advPath = new Path2D(); advPath.addPath(holeClip); advPath.rect(v.lx, 0, v.lw, cfg.boardH);
		swapZoneAdv = { path: advPath, line: advPath, hatch, labels: holeLabels.concat([[v.lx + v.lw / 2, cfg.diskY * 0.75, -Math.PI / 2, false]]) };
		const fanPath = new Path2D(); fanPath.addPath(holeClip);
		const fanLabels = holeLabels.slice();
		if (z.bx > v.lx) {
			const t = clamp((v.lx - z.ax) / (z.bx - z.ax), 0, 1);
			const y0 = z.ay + (z.by - z.ay) * t, y1 = z.ay + (z.cy - z.ay) * t;
			fanPath.moveTo(v.lx, y0); fanPath.lineTo(z.bx, z.by); fanPath.lineTo(z.cx, z.cy); fanPath.lineTo(v.lx, y1); fanPath.closePath();
			fanLabels.push([0.5 * (v.lx + z.bx), cfg.diskY * 0.75, -Math.PI / 2, false]);
		}
		swapZoneFan = { path: fanPath, line: fanPath, hatch, labels: fanLabels };
		swapVoidAdv = bakeSwapVoid('advance');
		swapVoidFan = bakeSwapVoid('zones');
	}
	function resize(geometryChanged = false) {
		const box = cv.parentElement;
		const availW = box.clientWidth || 960;
		const availH = box.clientHeight || Math.round(availW * cfg.boardH / cfg.boardW);
		const aspect = cfg.boardW / cfg.boardH;
		const fit = !!box.dataset && box.dataset.fit === '1';
		const wpx = Math.max(1, Math.floor(fit ? availW : Math.min(availW, availH * aspect)));
		const hpx = Math.max(1, Math.floor(fit ? availH : Math.min(availH, availW / aspect)));
		// Supersampling is the cheap antialiasing: draw at the device ratio, capped so
		// a huge window cannot ask for a backing store no frame loop could fill.
		dpr = Math.min(3, window.devicePixelRatio || 1);
		if (wpx * hpx * dpr * dpr > MAX_BACKING) dpr = Math.max(1, Math.sqrt(MAX_BACKING / (wpx * hpx)));
		const cssW = wpx + 'px', cssH = hpx + 'px';
		if (cv.style.width !== cssW) cv.style.width = cssW;
		if (cv.style.height !== cssH) cv.style.height = cssH;
		const bw = Math.round(wpx * dpr), bh = Math.round(hpx * dpr);
		if (!geometryChanged && bw === cv.width && bh === cv.height) return;
		if (geometryChanged) {
			buildZonePaths(); buildFloorFills(); applyTheme(themeName);
			buildPuckGradient();
			if (skin && skin.setup) skin.setup(cfg, sx, sy, dpr);
		}
		cv.width = bw; cv.height = bh;
		sx = cv.width / cfg.boardW;
		sy = cv.height / cfg.boardH;
		// The disk sprite is only repainted when the surface asks for more detail than it
		// holds, never because the window moved: its resolution grows a step at a time
		// (128/256/512 device px per world unit) and never shrinks, so a drag, a phone
		// rotation or the drawer opening costs a backing store and a transform, not the
		// whole texture. It used to be rebaked on every resize at a resolution that
		// followed the window, which is a 12–48 ms repaint per step of a window drag.
		if (needPpm() > ppmDisk) bakeDisk(needPpm()); // stepped, so this fires at setup and on a step up
		wallPath = new Path2D();
		wallPath.rect(0, 0, cfg.boardW, cfg.boardH);
	}
	// The disk sprite is cut to the circle once, at bake time. Clipping the drawn image
	// to an arc every frame costs more and reads worse: a clip edge is a hard edge,
	// while a pre-cut sprite gets smoothed by the rotation and the bilinear filter.
	// Rebaked when the disk schema changes (drawWorld compares texSchema) and when the
	// surface outgrows it. The bake grows as the square of the resolution (measured: 12 ms
	// at 256, 48 ms at 512), so the map is kept at the coarsest step that still gives the
	// raster one texel per device pixel or better — 128 dominates a phone, 512 a desktop.
	const DISK_TEX_MIN = 128, DISK_TEX_MAX = 512;
	function needPpm() { return Math.min(DISK_TEX_MAX, Math.max(DISK_TEX_MIN, sx > 384 ? 512 : sx > 192 ? 256 : 128)); }
	function bakeDisk(ppm) {
		if (ppm === undefined) ppm = ppmDisk || needPpm();
		const tex = bakeFieldCanvas({ x: -cfg.diskR, y: -cfg.diskR, w: 2 * cfg.diskR, h: 2 * cfg.diskR }, ppm, cfg);
		const cut = document.createElement('canvas');
		cut.width = tex.width; cut.height = tex.height;
		const g = cut.getContext('2d');
		g.drawImage(tex, 0, 0);
		g.globalCompositeOperation = 'destination-in';
		g.fillStyle = '#ffffff';
		g.beginPath(); g.arc(tex.width / 2, tex.height / 2, cfg.diskR * ppm, 0, Math.PI * 2); g.fill();
		texDisk = cut; texSchema = cfg.diskSchema; texRadius = cfg.diskR; texScore = cfg.scoreScale; texBlue = cfg.payBlue; texBend = cfg.payBend; ppmDisk = ppm;
	}
	function toWorld(clientX, clientY) {
		const r = cv.getBoundingClientRect();
		return { x: (clientX - r.left) * cfg.boardW / r.width, y: (clientY - r.top) * cfg.boardH / r.height };
	}
	function swapZoneFor(mode) { return mode === 'advance' ? swapZoneAdv : mode === 'zones' ? swapZoneFan : swapZoneNone; }
	function drawZones(mode) {
		if (cfg.swapZones) {
			const z = swapZoneFor(mode);
			if (!z) return;
			ctx.save();
			ctx.fillStyle = Z_FILL; ctx.fill(z.path, 'evenodd');
			ctx.save(); ctx.clip(z.path, 'evenodd');
			ctx.strokeStyle = Z_HATCH; ctx.lineWidth = 0.012; ctx.stroke(z.hatch);
			ctx.restore();
			ctx.setLineDash([0.05, 0.04]); ctx.lineWidth = 0.012; ctx.strokeStyle = Z_LINE;
			ctx.stroke(z.line); ctx.setLineDash([]);
			for (let i = 0; i < z.labels.length; i++) {
				const l = z.labels[i];
				drawZoneLabel(l[0], l[1], l[2], l[3] ? font.holeZone : font.zone);
			}
			ctx.restore();
			return;
		}
		if (mode === 'none') return;
		const z = mode === 'advance' ? zoneAdv : zoneFan;
		ctx.save();
		if (z.clip) { ctx.clip(z.clip); ctx.clip(z.guardClip, 'evenodd'); }
		ctx.fillStyle = Z_FILL;
		ctx.fill(z.path, 'evenodd');
		ctx.save(); ctx.clip(z.path, 'evenodd');
		ctx.strokeStyle = Z_HATCH; ctx.lineWidth = 0.012; ctx.stroke(z.hatch);
		ctx.restore();
		ctx.setLineDash([0.05, 0.04]); ctx.lineWidth = 0.012; ctx.strokeStyle = Z_LINE;
		ctx.stroke(z.line); ctx.setLineDash([]);
		if (mode === 'advance') {
			const v = cfg.advanceZone;
			// upright in both halves: the wedge's live part is its left edge, the only
			// stretch of it the disk guard does not cover, and the lane is the strip
			drawZoneLabel(0.10, cfg.diskY, -Math.PI / 2);
			drawZoneLabel(v.lx + v.lw / 2, cfg.diskY * 0.75, -Math.PI / 2);
		} else {
			drawZoneLabel(2.55, 0.75 * 0.75, labelRot); // inside the fan, along its edges
			drawZoneLabel(2.55, (cfg.boardH - 0.75) * 0.75, -labelRot);
		}
		ctx.restore();
	}
	const HOLE_DARK = '#090812', HOLE_RIM = '#9b59b6', HOLE_REACH = 'rgba(186, 104, 200, 0.65)';
	const RING_HALF = 0.006; // half the reach-ring stroke: keeps dashes on the ice outside a black-filled capture disk
	function drawReachRing(hole, extra) {
		ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r + cfg.puckR + extra, 0, TAU);
		ctx.strokeStyle = HOLE_REACH; ctx.lineWidth = 0.012; ctx.setLineDash([0.035, 0.025]); ctx.stroke();
		ctx.setLineDash([]);
	}
	// The black-inside view option fills every hole's capture region — the shape grown
	// by the puck radius (holeClip) — so a puck visibly slides onto the black and falls
	// when its centre reaches the dashed ring, not when its edge touches the void rim.
	// Every reach ring goes down before any black fill (and shifted outward by RING_HALF
	// when filled black) so dashes stay on the ice and never paint over black.
	function drawBlackHoles(fill, mode) {
		if (cfg.swapZones) { drawSwappedVoid(fill, mode); return; }
		ctx.save();
		ctx.beginPath(); ctx.rect(0, 0, cfg.boardW, cfg.boardH); ctx.clip();
		if (cfg.holeStyle !== 'triangle' && cfg.holeStyle !== 'rim') {
			for (let i = 0; i < cfg.holes.length; i++) drawReachRing(cfg.holes[i], fill ? RING_HALF : 0);
		}
		if (fill) { ctx.fillStyle = HOLE_DARK; ctx.fill(holeClip); }
		for (let i = 0; i < cfg.holes.length; i++) {
			const hole = cfg.holes[i];
			if (!fill) {
				if (cfg.holeStyle === 'triangle') drawTriangleHole(hole);
				else drawRoundHole(hole, cfg.holeStyle);
			}
			ctx.fillStyle = '#e5c3ff'; ctx.font = font.hole;
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VOID', hole.x, hole.y + (hole.y < cfg.diskY ? 0.055 : -0.055));
		}
		ctx.restore();
	}
	function drawSwappedVoid(fill, mode) {
		const v = mode === 'advance' ? swapVoidAdv : mode === 'zones' ? swapVoidFan : null;
		if (!v) return;
		const style = cfg.holeStyle;
		ctx.save();
		ctx.beginPath(); ctx.rect(0, 0, cfg.boardW, cfg.boardH); ctx.clip();
		if (fill) {
			if (style !== 'rim') {
				ctx.strokeStyle = HOLE_REACH; ctx.lineWidth = 0.012; ctx.setLineDash([0.035, 0.025]);
				ctx.stroke(v.reachOut); ctx.setLineDash([]);
			}
			ctx.fillStyle = HOLE_DARK; ctx.fill(v.capture, 'evenodd');
		} else {
			if (style !== 'rim') {
				ctx.strokeStyle = HOLE_REACH; ctx.lineWidth = 0.012; ctx.setLineDash([0.035, 0.025]);
				ctx.stroke(v.capture); ctx.setLineDash([]);
			}
			ctx.fillStyle = HOLE_DARK; ctx.fill(v.core, 'evenodd');
			ctx.strokeStyle = HOLE_RIM; ctx.lineWidth = 0.018; ctx.stroke(v.core);
			if (style === 'well') {
				ctx.fillStyle = '#16131f'; ctx.fill(v.mid, 'evenodd');
				ctx.strokeStyle = 'rgba(155, 89, 182, 0.42)'; ctx.lineWidth = 0.010; ctx.stroke(v.mid);
				ctx.fillStyle = '#030206'; ctx.fill(v.deep, 'evenodd');
			} else if (style !== 'rim') {
				ctx.strokeStyle = 'rgba(155, 89, 182, 0.15)'; ctx.lineWidth = 0.012; ctx.stroke(v.mid);
			}
		}
		ctx.fillStyle = '#e5c3ff'; ctx.font = font.hole;
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		for (let i = 0; i < v.labels.length; i++) ctx.fillText('VOID', v.labels[i][0], v.labels[i][1]);
		ctx.restore();
	}
	function drawRoundHole(hole, style) {
		ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r, 0, TAU);
		ctx.fillStyle = HOLE_DARK; ctx.fill();
		ctx.strokeStyle = HOLE_RIM; ctx.lineWidth = 0.018; ctx.stroke();
		if (style === 'rim') return;
		ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r * 0.58, 0, TAU);
		if (style === 'classic') { // a true violet, deliberately very faint: the middle of the void, not lifted out of the ice
			ctx.strokeStyle = 'rgba(155, 89, 182, 0.15)'; ctx.lineWidth = 0.012; ctx.stroke();
			return;
		}
		ctx.fillStyle = '#16131f'; ctx.fill();
		ctx.strokeStyle = 'rgba(155, 89, 182, 0.42)'; ctx.lineWidth = 0.010; ctx.stroke();
		ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r * 0.30, 0, TAU);
		ctx.fillStyle = '#030206'; ctx.fill();
	}
	// The triangle and a smaller copy of it on the same wall point, so the inner one
	// nests toward the wall like the rings of the round void.
	function drawTriangleHole(hole) {
		const t = holeTriangle(cfg, hole, holeTri);
		ctx.lineJoin = 'miter';
		ctx.beginPath(); ctx.moveTo(t[0], t[1]); ctx.lineTo(t[2], t[3]); ctx.lineTo(t[4], t[5]); ctx.closePath();
		ctx.fillStyle = HOLE_DARK; ctx.fill();
		ctx.strokeStyle = HOLE_RIM; ctx.lineWidth = 0.018; ctx.stroke();
		const k = 0.6;
		ctx.beginPath();
		ctx.moveTo(hole.x + k * (t[0] - hole.x), hole.y); ctx.lineTo(hole.x + k * (t[2] - hole.x), hole.y);
		ctx.lineTo(hole.x, hole.y + k * (t[5] - hole.y)); ctx.closePath();
		ctx.strokeStyle = 'rgba(155, 89, 182, 0.45)'; ctx.lineWidth = 0.012; ctx.stroke();
	}
	function drawZoneLabel(x, y, rot, f) {
		ctx.save();
		ctx.translate(x, y); ctx.rotate(rot);
		ctx.fillStyle = Z_LINE; ctx.font = f || font.zone;
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText('RETURN', 0, 0);
		ctx.restore();
	}
	function drawGhost(pred, aim) {
		if (!pred || pred.n < 2) return;
		const path = pred.path, n = pred.n, per = Math.ceil(n / GHOST_CHUNKS);
		ctx.save();
		ctx.lineWidth = 0.014; ctx.lineCap = 'round';
		for (let c = 0; c < GHOST_CHUNKS; c++) {
			const i0 = c * per, i1 = Math.min(n - 1, i0 + per);
			if (i1 <= i0) break;
			ctx.strokeStyle = ghostInk[c];
			ctx.beginPath();
			ctx.moveTo(path[i0 * 2], path[i0 * 2 + 1]);
			for (let k = i0 + 1; k <= i1; k++) ctx.lineTo(path[k * 2], path[k * 2 + 1]);
			ctx.stroke();
		}
		ctx.globalAlpha = 0.35;
		ctx.fillStyle = theme.inkSolid;
		ctx.beginPath(); ctx.arc(pred.endX, pred.endY, cfg.puckR, 0, Math.PI * 2); ctx.fill();
		if (pred.locked) {
			ctx.globalAlpha = 0.8; ctx.strokeStyle = theme.inkSolid; ctx.lineWidth = 0.012;
			ctx.setLineDash([0.04, 0.03]);
			ctx.beginPath(); ctx.arc(pred.endX, pred.endY, cfg.puckR * 1.5, 0, Math.PI * 2); ctx.stroke();
			ctx.setLineDash([]);
		}
		ctx.restore();
	}
	// view = {w, aim, opts, pred, roster, turn, resolveT, state}: one object main
	// mutates in place every frame, so drawing allocates nothing.
	function drawWorld(view) {
		const w = view.w, aim = view.aim, opts = view.opts, pred = view.pred;
		if (opts.theme !== themeName) applyTheme(opts.theme);
		if (cfg.diskSchema !== texSchema || cfg.diskR !== texRadius || cfg.scoreScale !== texScore ||
			cfg.payBlue !== texBlue || cfg.payBend !== texBend) bakeDisk();
		if (cfg.zoneStyle !== builtZone || cfg.holeStyle !== builtHole || !!cfg.swapZones !== builtSwap) buildZonePaths();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, cv.width, cv.height);
		ctx.setTransform(sx, 0, 0, sy, 0, 0);
		// Floor: plain ice in the scheme's tint. It used to carry a faint copy of the field
		// frozen at θ = 0, which no longer matches once the disk turns — nor any schema
		// but the one it was baked from.
		ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cfg.boardW, cfg.boardH); ctx.clip();
		ctx.fillStyle = floorFill[themeName]; ctx.fillRect(0, 0, cfg.boardW, cfg.boardH);
		if (theme.grid) { ctx.strokeStyle = theme.grid; ctx.lineWidth = 0.006; ctx.stroke(gridPath); }
		if (skin && skin.floor) skin.floor(ctx, view, cfg);
		drawZones(opts.mode);
		// Disk: field sprite rotated by theta. It is already cut to the circle, so this
		// needs no clip — which is both cheaper and smoother on the rim.
		ctx.save();
		ctx.translate(cfg.diskX, cfg.diskY); ctx.rotate(w.theta);
		ctx.drawImage(texDisk, -cfg.diskR, -cfg.diskR, 2 * cfg.diskR, 2 * cfg.diskR);
		if (skin && skin.disk) skin.disk(ctx, view, cfg);
		const ts = cfg.diskR / DISK_REF_R;
		ctx.fillStyle = theme.tick; ctx.fillRect(0.55 * ts, -0.012, 0.22 * ts, 0.024); // spin tick
		ctx.restore();
		ctx.lineWidth = 0.015; ctx.strokeStyle = theme.rim;
		ctx.beginPath(); ctx.arc(cfg.diskX, cfg.diskY, cfg.diskR, 0, Math.PI * 2); ctx.stroke();
		if (opts.ring) {
			const dh = holdRadius(cfg);
			if (dh < cfg.diskR) {
				ctx.setLineDash([0.05, 0.04]); ctx.lineWidth = 0.012; ctx.strokeStyle = theme.ring;
				ctx.beginPath(); ctx.arc(cfg.diskX, cfg.diskY, dh, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
			}
		}
		drawBlackHoles(opts.holeFill, opts.mode);
		// The ice surface: reflections and the frozen veil that sits over the markings.
		if (skin && skin.surface) {
			if (cfg.swapZones) {
				const sz = swapZoneFor(opts.mode);
				if (sz) { ctx.save(); ctx.clip(sz.path, 'evenodd'); skin.surface(ctx, view, cfg); ctx.restore(); }
				const sv = opts.mode === 'advance' ? swapVoidAdv : opts.mode === 'zones' ? swapVoidFan : null;
				if (sv) { ctx.save(); ctx.clip(sv.capture, 'evenodd'); skin.surface(ctx, view, cfg); ctx.restore(); }
			} else {
				ctx.save();
				const zone = opts.mode === 'advance' ? zoneAdv : zoneFan;
				if (opts.mode !== 'none') ctx.clip(zone.path, 'evenodd');
				if (opts.mode !== 'none') skin.surface(ctx, view, cfg);
				ctx.restore();
				ctx.save(); ctx.clip(holeClip); skin.surface(ctx, view, cfg); ctx.restore();
			}
		}
		// Launch zone
		ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.01; ctx.setLineDash([0.04, 0.03]);
		ctx.strokeRect(cfg.launchMinX, cfg.launchMinY, cfg.launchMaxX - cfg.launchMinX, cfg.launchMaxY - cfg.launchMinY);
		ctx.setLineDash([]);
		ctx.restore();
		ctx.lineWidth = theme.wallW; ctx.strokeStyle = theme.wall; ctx.stroke(wallPath);
		if (opts.preview && aim && aim.hasStroke) drawGhost(pred, aim);
		drawAim(w, aim);
		// Shadows go down before any puck body, so a shadow never paints over a stone.
		if (skin && skin.shadow) for (let i = 0; i < w.n; i++) skin.shadow(ctx, view, cfg, i, aim && aim.pending === i);
		for (let i = 0; i < w.n; i++) {
			const isPending = aim && aim.pending === i;
			theme.puck(w, i, isPending);
			if (skin && skin.puck) skin.puck(ctx, view, cfg, i, isPending);
		}
		drawHud(view);
	}
	// Scoreboard along the top of the board: one cell per seat — colour, balls left,
	// score, speed vote — the seat on turn lit, and its window draining while the board
	// resolves.
	function drawHud(view) {
		const seats = view.roster, n = seats.length;
		if (!n) return;
		// A spent board lights the winner, not the seat that happened to throw last.
		const lit = view.state === 'scored' ? leader(seats) : view.turn, round = view.opts.cards === 'round';
		const cw = Math.min(HUD_MAX, (cfg.boardW - 0.12) / n - HUD_GAP);
		const x0 = (cfg.boardW - (n * cw + (n - 1) * HUD_GAP)) / 2;
		ctx.save();
		ctx.font = font.hud; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
		for (let i = 0; i < n; i++) {
			const x = x0 + i * (cw + HUD_GAP), col = seatColor(i), on = i === lit;
			ctx.fillStyle = on ? 'rgba(255,255,255,0.13)' : theme.hud;
			if (round) drawRoundCell(x, cw, on, col);
			else {
				ctx.fillRect(x, HUD_Y, cw, HUD_H);
				if (on) { ctx.strokeStyle = col; ctx.lineWidth = 0.014; ctx.strokeRect(x, HUD_Y, cw, HUD_H); }
				else if (theme.hudLine) { ctx.strokeStyle = theme.hudLine; ctx.lineWidth = 0.006; ctx.strokeRect(x, HUD_Y, cw, HUD_H); }
			}
			ctx.fillStyle = col;
			ctx.beginPath(); ctx.arc(x + 0.055, HUD_Y + 0.072, 0.042, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = on ? '#ffffff' : theme.text;
			ctx.fillText(String(displayScore(cfg, n, seats[i].score)), x + 0.115, HUD_Y + 0.075);
			// The ball dots fit the cell at any count: a URL can ask for up to 8, and
			// a fixed 0.062 step would spill the last ones into the next seat's cell.
			const step = Math.min(0.062, (cw - 0.16) / Math.max(1, cfg.ballsPerPlayer - 1));
			const dot = Math.min(0.022, step * 0.38);
			for (let k = 0; k < cfg.ballsPerPlayer; k++) {
				ctx.beginPath(); ctx.arc(x + 0.135 + k * step, HUD_Y + 0.178, dot, 0, Math.PI * 2);
				if (k < seats[i].balls) { ctx.fillStyle = col; ctx.fill(); }
				else { ctx.strokeStyle = 'rgba(223,230,233,0.40)'; ctx.lineWidth = 0.009; ctx.stroke(); }
			}
		}
		if (cfg.speedVote !== 'off') drawVotes(view, x0, cw);
		if (view.state === 'resolve') { // the window that is paying right now
			const x = x0 + view.turn * (cw + HUD_GAP), y = HUD_Y + HUD_H + 0.022;
			ctx.fillStyle = 'rgba(255,255,255,0.22)';
			ctx.fillRect(x, y, cw, 0.026);
			ctx.fillStyle = seatColor(view.turn);
			if (motionTurns(cfg)) {
				// A motion-ended turn has no clock to run down: a block sweeps the bar
				// while the board slides.
				const bw = cw * 0.25, phase = 0.5 - 0.5 * Math.cos(Math.PI * view.resolveT);
				ctx.fillRect(x + (cw - bw) * phase, y, bw, 0.026);
			} else ctx.fillRect(x, y, cw * Math.max(0, 1 - view.resolveT / cfg.handoffT), 0.026);
		}
		ctx.restore();
	}
	// The rounded score card: the same cell with soft corners, its border inset by half
	// its width so the round corner is not cut by the neighbouring fill.
	const HUD_CORNER = 0.05;
	function roundCellPath(x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
		ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
		ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
		ctx.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
		ctx.closePath();
	}
	function drawRoundCell(x, cw, on, col) {
		roundCellPath(x, HUD_Y, cw, HUD_H, HUD_CORNER); ctx.fill();
		const lw = on ? 0.014 : 0.006;
		if (!on && !theme.hudLine) return;
		roundCellPath(x + lw / 2, HUD_Y + lw / 2, cw - lw, HUD_H - lw, HUD_CORNER - lw / 2);
		ctx.strokeStyle = on ? col : theme.hudLine; ctx.lineWidth = lw; ctx.stroke();
	}
	// What each seat asks for, at the right of its cell (blank = don't care) and, while
	// a vote is open, its time draining under the whole row: every seat is voting.
	function drawVotes(view, x0, cw) {
		const seats = view.roster, n = seats.length;
		ctx.font = font.tag; ctx.textAlign = 'right'; ctx.fillStyle = theme.inkSolid;
		for (let i = 0; i < n; i++) {
			if (seats[i].voteLabel) ctx.fillText(seats[i].voteLabel, x0 + i * (cw + HUD_GAP) + cw - 0.02, HUD_Y + 0.075);
		}
		if (view.state !== 'vote') return;
		const left = Math.max(0, 1 - view.voteT / cfg.voteT), y = HUD_Y + HUD_H + 0.022, span = n * cw + (n - 1) * HUD_GAP;
		ctx.fillStyle = 'rgba(255,255,255,0.22)';
		ctx.fillRect(x0, y, span, 0.026);
		ctx.fillStyle = theme.inkSolid;
		ctx.fillRect(x0, y, span * left, 0.026);
	}
	function drawPuckClassic(w, i, isPending) {
		ctx.save();
		ctx.translate(w.x[i], w.y[i]);
		ctx.globalAlpha = isPending ? 0.65 : w.st[i] === ST_SLEEP ? 0.85 : 1;
		ctx.fillStyle = puckGrad;
		ctx.beginPath(); ctx.arc(0, 0, w.r[i], 0, Math.PI * 2); ctx.fill();
		// Face sectors turn with the puck's material rotation (w.th).
		ctx.save();
		ctx.rotate(w.th[i]); ctx.scale(w.r[i], w.r[i]);
		ctx.fillStyle = SECTOR_SHADE; ctx.fill(sectorPath);
		ctx.restore();
		// The ring is inset by half its width: stroking on the fill edge leaves half the
		// line over the board, which reads as a fuzzy halo instead of a rim.
		ctx.lineWidth = RIM_W; ctx.strokeStyle = seatColor(w.own[i]);
		ctx.beginPath(); ctx.arc(0, 0, w.r[i] - RIM_W / 2, 0, Math.PI * 2); ctx.stroke();
		ctx.globalAlpha *= 0.8;
		ctx.fillStyle = '#2d3436'; ctx.font = font.num;
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText(NUM[i], 0, 0.004);
		ctx.restore();
	}
	// The kerot-s puck: a cream body on a drop shadow, a rim band whose two shaded
	// quarters are glued to the puck (so its turning shows), and a centre gauge — the
	// share of the best possible rate this puck earns right now, tagged above it while
	// it earns. The reference's dark outline becomes the owner's seat ring.
	function drawPuckKerot(w, i, isPending) {
		const r = w.r[i];
		ctx.save();
		ctx.translate(w.x[i], w.y[i]);
		ctx.fillStyle = 'rgba(0,0,0,0.35)';
		ctx.beginPath(); ctx.arc(0.008, 0.011, r, 0, TAU); ctx.fill();
		ctx.fillStyle = isPending ? '#ffd9a0' : '#f3ecdd';
		ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
		ctx.save();
		ctx.rotate(w.th[i] + w.uid[i] * GOLDEN); ctx.scale(r, r);
		ctx.fillStyle = isPending ? 'rgba(150,95,25,0.45)' : 'rgba(120,88,52,0.45)';
		ctx.fill(bandPath);
		ctx.restore();
		ctx.lineWidth = 0.005; ctx.strokeStyle = 'rgba(90,70,45,0.45)';
		ctx.beginPath(); ctx.arc(0, 0, 0.74 * r, 0, TAU); ctx.stroke();
		const share = puckRate(w, i) / (RED_MAX * Math.PI * r * r);
		if (share > 0.005) {
			const bw = 0.18 * r, bh = 0.5 * r * share;
			ctx.fillStyle = 'rgba(186,50,34,0.95)';
			ctx.fillRect(-bw / 2, -bh, bw, bh);
		}
		ctx.strokeStyle = 'rgba(70,60,45,0.5)'; ctx.lineWidth = 0.005;
		ctx.beginPath(); ctx.moveTo(-0.45 * r, 0); ctx.lineTo(0.45 * r, 0); ctx.stroke();
		ctx.lineWidth = KR_RIM; ctx.strokeStyle = seatColor(w.own[i]);
		ctx.beginPath(); ctx.arc(0, 0, r - KR_RIM / 2, 0, TAU); ctx.stroke();
		if (share > 0.005) { // outlined: the tag sits over any paint, pale included
			const tag = PCT[Math.round(100 * share)];
			ctx.font = font.tag; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
			ctx.lineJoin = 'round'; ctx.lineWidth = 0.016; ctx.strokeStyle = 'rgba(7,11,16,0.85)';
			ctx.strokeText(tag, 0, -r - 0.012);
			ctx.fillStyle = 'rgba(255,190,170,0.95)';
			ctx.fillText(tag, 0, -r - 0.012);
		}
		ctx.restore();
	}
	// In plain aim, the tip tracks the pointer between the zero-power ring and full power.
	function drawAim(w, aim) {
		if (!aim || aim.pending < 0) return;
		const sx = w.x[aim.pending], sy = w.y[aim.pending];
		const grab = aimGrab(cfg);
		ctx.save(); ctx.setLineDash([]);
		ctx.strokeStyle = theme.inkSolid; ctx.fillStyle = theme.inkSolid;
		ctx.globalAlpha = 0.3; ctx.lineWidth = 0.01;
		ctx.beginPath(); ctx.arc(sx, sy, grab, 0, Math.PI * 2); ctx.stroke();
		ctx.globalAlpha = 1;
		const sp = Math.hypot(aim.vx, aim.vy);
		if (!aim.hasStroke || sp < 1e-6) { ctx.restore(); return; }
		const len = grab + (sp - cfg.vMin) / (cfg.vMax - cfg.vMin) * cfg.dragFull;
		const ux = aim.vx / sp, uy = aim.vy / sp;
		ctx.lineWidth = 0.018;
		ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * (len - 0.13), sy + uy * (len - 0.13)); ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(sx + ux * len, sy + uy * len);
		ctx.lineTo(sx + ux * (len - 0.16) - uy * 0.05, sy + uy * (len - 0.16) + ux * 0.05);
		ctx.lineTo(sx + ux * (len - 0.16) + uy * 0.05, sy + uy * (len - 0.16) - ux * 0.05);
		ctx.closePath(); ctx.fill();
		ctx.font = font.label; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText(sp.toFixed(2) + ' m/s, stops ~' + stopDistance(cfg, sp).toFixed(1) + ' m', sx + ux * (len + 0.17), sy + uy * (len + 0.17));
		ctx.restore();
	}
	return { setup, resize, attach, drawWorld, toWorld, themes: THEMES };
}
const Render = createRenderer();
if (typeof module !== 'undefined') module.exports = { Render, createRenderer };
