// Canvas renderer. Each board gets its own surfaces, textures and coordinate transform;
// the default page uses one instance and an embedded minigame creates one per session.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./field.js'), require('./physics.js'), require('./score.js'), require('./players.js'));
function createRenderer() {
	let cfg = CFG;
	let cv, ctx, scale = 100, ox = 0, oy = 0, dpr = 1;
	let texDisk = null, texSchema = '', ppmDisk = 96, puckGrad = null, wallPath = null, gridPath = null;
	let zoneFan = null, zoneAdv = null, hatchPath = null, sectorPath = null, bandPath = null;
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
	const font = { hud: '', label: '', zone: '', hole: '', num: '', tag: '' };
	const ghostInk = [];
	function setup(canvas, config) {
		cfg = config || CFG;
		cv = canvas; ctx = cv.getContext('2d');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		puckGrad = ctx.createRadialGradient(-0.03, -0.03, 0.01, 0, 0, cfg.puckR);
		puckGrad.addColorStop(0, '#f5f6fa'); puckGrad.addColorStop(0.7, '#b2bec3'); puckGrad.addColorStop(1, '#636e72');
		for (const name in THEMES) {
			const t = THEMES[name];
			if (t.floor.length === 1) { t.floorFill = t.floor[0]; continue; }
			t.floorFill = ctx.createLinearGradient(0, 0, 0, cfg.boardH);
			for (let k = 0; k < t.floor.length; k++) t.floorFill.addColorStop(k / (t.floor.length - 1), t.floor[k]);
		}
		applyTheme('classic');
		buildZonePaths();
		resize();
	}
	function applyTheme(name) {
		themeName = name; theme = THEMES[name];
		const f = theme.font;
		font.hud = 'bold 0.088px ' + f; font.label = '0.075px ' + f; font.zone = '0.09px ' + f;
		font.hole = '0.045px ' + f; font.num = 'bold ' + (cfg.puckR * 0.55) + 'px ' + f; font.tag = '0.06px ' + f;
		for (let c = 0; c < GHOST_CHUNKS; c++) ghostInk[c] = 'rgba(' + theme.ink + ',' + (0.10 + 0.07 * (GHOST_CHUNKS - c)).toFixed(3) + ')';
		theme.inkSolid = 'rgb(' + theme.ink + ')';
	}
	function buildZonePaths() {
		const z = RETURN_ZONES, v = ADVANCE_ZONES;
		// Both return rules: a fill with the on-disk guard (diskR + puckR) punched
		// out of it, so the exemption is drawn instead of implied, plus the outline
		// to stroke. The 'advance' rule adds the launch lane to its wedge.
		zoneFan = bakeZone(z, null);
		zoneAdv = bakeZone(v, [v.lx, 0, v.lw, cfg.boardH]);
		hatchPath = new Path2D();
		for (let s = -cfg.boardH; s < cfg.boardW; s += 0.14) { // 45° stripes across the board
			hatchPath.moveTo(s, 0); hatchPath.lineTo(s + cfg.boardH, cfg.boardH);
		}
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
	function bakeZone(t, rect) {
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
		return { path: path, line: line };
	}
	// The board is fitted into its box by hand instead of by CSS: it takes the largest
	// rect of the board's aspect that fits both ways, so the canvas never grows past the
	// viewport and never raises a scrollbar. Refits are cheap — an unchanged size
	// returns before re-baking the textures.
	function resize() {
		const box = cv.parentElement;
		const availW = box.clientWidth || 960;
		const availH = box.clientHeight || Math.round(availW * cfg.boardH / cfg.boardW);
		const aspect = cfg.boardW / cfg.boardH;
		let wpx = availW, hpx = availW / aspect;
		if (hpx > availH) { hpx = availH; wpx = availH * aspect; }
		wpx = Math.max(1, Math.floor(wpx)); hpx = Math.max(1, Math.floor(hpx));
		// Supersampling is the cheap antialiasing: draw at the device ratio, capped so
		// a huge window cannot ask for a backing store no frame loop could fill.
		dpr = Math.min(3, window.devicePixelRatio || 1);
		if (wpx * hpx * dpr * dpr > MAX_BACKING) dpr = Math.max(1, Math.sqrt(MAX_BACKING / (wpx * hpx)));
		const bw = Math.round(wpx * dpr), bh = Math.round(hpx * dpr);
		if (bw === cv.width && bh === cv.height) return;
		cv.style.width = wpx + 'px'; cv.style.height = hpx + 'px';
		cv.width = bw; cv.height = bh;
		scale = Math.min(cv.width / cfg.boardW, cv.height / cfg.boardH);
		ox = (cv.width - cfg.boardW * scale) / 2; oy = (cv.height - cfg.boardH * scale) / 2;
		bake();
	}
	function bake() {
		ppmDisk = Math.max(96, Math.min(512, 2 * scale / dpr));
		bakeDisk();
		wallPath = new Path2D();
		wallPath.rect(0, 0, cfg.boardW, cfg.boardH);
	}
	// The disk sprite is cut to the circle once, at bake time. Clipping the drawn image
	// to an arc every frame costs more and reads worse: a clip edge is a hard edge,
	// while a pre-cut sprite gets smoothed by the rotation and the bilinear filter.
	// Rebaked when the disk schema changes (drawWorld compares texSchema).
	function bakeDisk() {
		const ppm = ppmDisk;
		const tex = bakeFieldCanvas({ x: -cfg.diskR, y: -cfg.diskR, w: 2 * cfg.diskR, h: 2 * cfg.diskR }, ppm, cfg);
		const cut = document.createElement('canvas');
		cut.width = tex.width; cut.height = tex.height;
		const g = cut.getContext('2d');
		g.drawImage(tex, 0, 0);
		g.globalCompositeOperation = 'destination-in';
		g.fillStyle = '#ffffff';
		g.beginPath(); g.arc(tex.width / 2, tex.height / 2, cfg.diskR * ppm, 0, Math.PI * 2); g.fill();
		texDisk = cut; texSchema = cfg.diskSchema;
	}
	function toWorld(clientX, clientY) {
		const r = cv.getBoundingClientRect();
		return { x: ((clientX - r.left) * dpr - ox) / scale, y: ((clientY - r.top) * dpr - oy) / scale };
	}
	function drawZones(mode) {
		if (mode === 'none') return;
		const z = mode === 'advance' ? zoneAdv : zoneFan;
		ctx.save();
		ctx.fillStyle = Z_FILL;
		ctx.fill(z.path, 'evenodd');
		ctx.save(); ctx.clip(z.path, 'evenodd');
		ctx.strokeStyle = Z_HATCH; ctx.lineWidth = 0.012; ctx.stroke(hatchPath);
		ctx.restore();
		ctx.setLineDash([0.05, 0.04]); ctx.lineWidth = 0.012; ctx.strokeStyle = Z_LINE;
		ctx.stroke(z.line); ctx.setLineDash([]);
		if (mode === 'advance') {
			const v = ADVANCE_ZONES;
			// upright in both halves: the wedge's live part is its left edge, the only
			// stretch of it the disk guard does not cover, and the lane is the strip
			drawZoneLabel(0.10, cfg.diskY, -Math.PI / 2);
			drawZoneLabel(v.lx + v.lw / 2, cfg.diskY, -Math.PI / 2);
		} else {
			drawZoneLabel(2.55, 0.75, labelRot); // inside the fan, along its edges
			drawZoneLabel(2.55, cfg.boardH - 0.75, -labelRot);
		}
		ctx.restore();
	}
	function drawBlackHoles() {
		ctx.save();
		ctx.beginPath(); ctx.rect(0, 0, cfg.boardW, cfg.boardH); ctx.clip();
		for (let i = 0; i < BLACK_HOLES.length; i++) {
			const hole = BLACK_HOLES[i];
			ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r + cfg.puckR, 0, 2 * Math.PI);
			ctx.strokeStyle = 'rgba(186, 104, 200, 0.65)'; ctx.lineWidth = 0.012; ctx.setLineDash([0.035, 0.025]); ctx.stroke();
			ctx.setLineDash([]);
			ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r, 0, 2 * Math.PI);
			ctx.fillStyle = '#090812'; ctx.fill();
			ctx.strokeStyle = '#9b59b6'; ctx.lineWidth = 0.018; ctx.stroke();
			ctx.beginPath(); ctx.arc(hole.x, hole.y, hole.r * 0.58, 0, 2 * Math.PI);
			ctx.strokeStyle = 'rgba(214, 165, 255, 0.7)'; ctx.lineWidth = 0.012; ctx.stroke();
			ctx.fillStyle = '#e5c3ff'; ctx.font = font.hole;
			ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VOID', hole.x, hole.y + (i === 0 ? 0.10 : -0.10));
		}
		ctx.restore();
	}
	function drawZoneLabel(x, y, rot) {
		ctx.save();
		ctx.translate(x, y); ctx.rotate(rot);
		ctx.fillStyle = Z_LINE; ctx.font = font.zone;
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
		if (cfg.diskSchema !== texSchema) bakeDisk();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, cv.width, cv.height);
		ctx.setTransform(scale, 0, 0, scale, ox, oy);
		// Floor: plain ice in the scheme's tint. It used to carry a faint copy of the field
		// frozen at θ = 0, which no longer matches once the disk turns — nor any schema
		// but the one it was baked from.
		ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cfg.boardW, cfg.boardH); ctx.clip();
		ctx.fillStyle = theme.floorFill; ctx.fillRect(0, 0, cfg.boardW, cfg.boardH);
		if (theme.grid) { ctx.strokeStyle = theme.grid; ctx.lineWidth = 0.006; ctx.stroke(gridPath); }
		drawZones(opts.mode);
		// Disk: field sprite rotated by theta. It is already cut to the circle, so this
		// needs no clip — which is both cheaper and smoother on the rim.
		ctx.save();
		ctx.translate(cfg.diskX, cfg.diskY); ctx.rotate(w.theta);
		ctx.drawImage(texDisk, -cfg.diskR, -cfg.diskR, 2 * cfg.diskR, 2 * cfg.diskR);
		ctx.fillStyle = theme.tick; ctx.fillRect(0.55, -0.012, 0.22, 0.024); // spin tick
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
		drawBlackHoles();
		// Launch zone
		ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.01; ctx.setLineDash([0.04, 0.03]);
		ctx.strokeRect(cfg.launchMinX, cfg.launchMinY, cfg.launchMaxX - cfg.launchMinX, cfg.launchMaxY - cfg.launchMinY);
		ctx.setLineDash([]);
		ctx.restore();
		ctx.lineWidth = theme.wallW; ctx.strokeStyle = theme.wall; ctx.stroke(wallPath);
		if (opts.preview && aim && aim.hasStroke) drawGhost(pred, aim);
		drawAim(w, aim);
		for (let i = 0; i < w.n; i++) theme.puck(w, i, aim && aim.pending === i);
		drawHud(view);
	}
	// Scoreboard along the top of the board: one cell per seat — colour, balls left,
	// score, speed vote — the seat on turn lit, and its window draining while the board
	// resolves.
	function drawHud(view) {
		const seats = view.roster, n = seats.length;
		if (!n) return;
		const cw = Math.min(HUD_MAX, (cfg.boardW - 0.12) / n - HUD_GAP);
		const x0 = (cfg.boardW - (n * cw + (n - 1) * HUD_GAP)) / 2;
		ctx.save();
		ctx.font = font.hud; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
		for (let i = 0; i < n; i++) {
			const x = x0 + i * (cw + HUD_GAP), col = seatColor(i), on = i === view.turn;
			ctx.fillStyle = on ? 'rgba(255,255,255,0.13)' : theme.hud;
			ctx.fillRect(x, HUD_Y, cw, HUD_H);
			if (on) { ctx.strokeStyle = col; ctx.lineWidth = 0.014; ctx.strokeRect(x, HUD_Y, cw, HUD_H); }
			else if (theme.hudLine) { ctx.strokeStyle = theme.hudLine; ctx.lineWidth = 0.006; ctx.strokeRect(x, HUD_Y, cw, HUD_H); }
			ctx.fillStyle = col;
			ctx.beginPath(); ctx.arc(x + 0.055, HUD_Y + 0.072, 0.042, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = on ? '#ffffff' : theme.text;
			ctx.fillText(String(displayScore(cfg, n, seats[i].score)), x + 0.115, HUD_Y + 0.075);
			for (let k = 0; k < cfg.ballsPerPlayer; k++) {
				ctx.beginPath(); ctx.arc(x + 0.135 + k * 0.062, HUD_Y + 0.178, 0.022, 0, Math.PI * 2);
				if (k < seats[i].balls) { ctx.fillStyle = col; ctx.fill(); }
				else { ctx.strokeStyle = 'rgba(223,230,233,0.40)'; ctx.lineWidth = 0.009; ctx.stroke(); }
			}
		}
		if (cfg.speedVote !== 'off') drawVotes(view, x0, cw);
		if (view.state === 'resolve') { // the 4 s window that is paying right now
			const left = Math.max(0, 1 - view.resolveT / cfg.handoffT);
			const x = x0 + view.turn * (cw + HUD_GAP), y = HUD_Y + HUD_H + 0.022;
			ctx.fillStyle = 'rgba(255,255,255,0.22)';
			ctx.fillRect(x, y, cw, 0.026);
			ctx.fillStyle = seatColor(view.turn);
			ctx.fillRect(x, y, cw * left, 0.026);
		}
		ctx.restore();
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
	function drawAim(w, aim) {
		if (!aim || aim.pending < 0 || !aim.hasStroke) return;
		const sx = w.x[aim.pending], sy = w.y[aim.pending];
		const sp = Math.hypot(aim.vx, aim.vy);
		if (sp < 1e-6) return;
		const len = sp / cfg.vMax * cfg.dragFull;
		const ux = aim.vx / sp, uy = aim.vy / sp;
		ctx.save();
		ctx.strokeStyle = theme.inkSolid; ctx.fillStyle = theme.inkSolid; ctx.lineWidth = 0.018;
		ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * (len + 0.15), sy + uy * (len + 0.15)); ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(sx + ux * (len + 0.28), sy + uy * (len + 0.28));
		ctx.lineTo(sx + ux * (len + 0.12) - uy * 0.05, sy + uy * (len + 0.12) + ux * 0.05);
		ctx.lineTo(sx + ux * (len + 0.12) + uy * 0.05, sy + uy * (len + 0.12) - ux * 0.05);
		ctx.closePath(); ctx.fill();
		ctx.font = font.label;
		ctx.fillText(sp.toFixed(2) + ' m/s, stops ~' + stopDistance(cfg, sp).toFixed(1) + ' m', sx + ux * (len + 0.45), sy + uy * (len + 0.45));
		ctx.restore();
	}
	return { setup, resize, drawWorld, toWorld, themes: THEMES };
}
const Render = createRenderer();
if (typeof module !== 'undefined') module.exports = { Render, createRenderer };
