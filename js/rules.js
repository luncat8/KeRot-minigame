// Game rules shared by the browser loop and the headless competition: pool
// accounting and puck recycling. Node-safe: no DOM access.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./physics.js'));

// A puck that still touches the disk is in play there — never recycle it.
function onDisk(cfg, x, y) {
	const dx = x - cfg.diskX, dy = y - cfg.diskY;
	return Math.sqrt(dx * dx + dy * dy) <= cfg.diskR + cfg.puckR;
}
// The keep-clear disk drawn as a hole in every return zone: diskR + puckR around the
// disk centre. Inside a wedge that starts at the disk centre it is exactly the circle's
// sector between the wedge's two sides, which is what the renderer cuts out, so the
// drawn zone and the rule are the same region.
function inGuard(cfg, x, y) {
	const dx = x - cfg.diskX, dy = y - cfg.diskY, Rg = cfg.diskR + cfg.puckR;
	return dx * dx + dy * dy < Rg * Rg;
}
// Inside a wound triangle: all three edge cross products point the same way (the
// vertex tables are wound so that "inside" is ≥ 0).
function inTri(z, x, y) {
	const e1 = (z.bx - z.ax) * (y - z.ay) - (z.by - z.ay) * (x - z.ax);
	const e2 = (z.cx - z.bx) * (y - z.by) - (z.cy - z.by) * (x - z.bx);
	const e3 = (z.ax - z.cx) * (y - z.cy) - (z.ay - z.cy) * (x - z.cx);
	return e1 >= 0 && e2 >= 0 && e3 >= 0;
}
// The field zone shapes ('rounded', 'arcs', '3-rounded', '6-hemi') are the region
// zoneField > 0 of a clearance field — the distance to what the zone keeps clear of.
// The renderer traces this same function, so the drawn outline and the rule agree to
// its tracing grid, and its inset lines are level sets of it: copies of the outline.
// The soft pair blends that distance with a smooth minimum so every corner comes out
// rounded; the cut pair takes a plain minimum, so the outline is the circles and
// straight sides themselves, cut sharp where they meet.
// The fillet scale must exceed twice the narrowest hole ↔ guard gap (8 cm on the shipped
// board): then the 'rounded' outline bridges that gap instead of threading through it.
const ZONE_SOFT_K = 0.3;
// The cut pair keeps a visible strip of ice between the disk/hole rim and the zone
// outline, so a puck can sit in the gap without being recycled.
const ZONE_CUT_GAP = 0.06;
function smin(a, b, k) {
	const h = Math.max(k - Math.abs(a - b), 0) / k;
	return Math.min(a, b) - h * h * k / 4;
}
function isSoftZone(cfg) { return cfg.zoneStyle === 'rounded' || cfg.zoneStyle === 'arcs'; }
function isCutZone(cfg) { return cfg.zoneStyle === '3-rounded' || cfg.zoneStyle === '6-hemi'; }
function isFieldZone(cfg) { return isSoftZone(cfg) || isCutZone(cfg); }
// Signed distance to the line through a and b, positive on the side of the point p.
function sideGap(ax, ay, bx, by, px, py, x, y) {
	const ex = bx - ax, ey = by - ay, d = (ex * (y - ay) - ey * (x - ax)) / Math.sqrt(ex * ex + ey * ey);
	return ex * (py - ay) - ey * (px - ax) < 0 ? -d : d;
}
// 'arcs': one curve from wall to wall around the disk — the guard blended into the
// vertical through the disk centre — so the holes lie inside the zone. They need no
// exemption: a puck that touches a void is swallowed in the step it gets there
// (absorbBlackHoles), long before a handoff could recycle it.
// 'rounded' on the wedge side: clear of the guard and of each hole's reach, and on the
// wall side of the line hole → disk centre. That line is buried where the hole and the
// guard blend, so it only closes the zone and never shows. On the fan side there are
// no holes: the fan's own sides, with the corners at the guard rounded.
// '3-rounded': the wedge cut by three bigger circles — the disk and each hole
// grown by puckR + gap — so the outline is their arcs, with a strip of ice
// between rim and outline. The wedge sides run hole → disk centre, not corner →
// disk centre: each side segment lies inside the union of the disk and hole
// circles (they overlap along it), so no straight edge ever reaches the outline
// and the zone is outlined by the three circles alone. The hole cuts are
// circles around the hole centres whatever the void's own shape, so a triangle
// void still gets a circular cut (the circle covers its reach). On the fan side
// the holes are far away, so the fan's own sides stay. '6-hemi': the half-board
// through the disk centre cut by one bigger circle around the disk, so the
// outline is a circular arc and the holes lie inside, as in 'arcs' but cut sharp.
function zoneField(cfg, mode, x, y) {
	const left = mode === 'advance';
	const gx = x - cfg.diskX, gy = y - cfg.diskY;
	let d = Math.sqrt(gx * gx + gy * gy) - cfg.diskR - cfg.puckR;
	if (isCutZone(cfg)) {
		d -= cfg.zoneCutGap ?? ZONE_CUT_GAP;
		if (cfg.zoneStyle === '6-hemi') d = Math.min(d, left ? cfg.diskX - x : x - cfg.diskX);
		else if (left) {
			for (let k = 0; k < cfg.holes.length; k++) {
				const hole = cfg.holes[k], hx = x - hole.x, hy = y - hole.y;
				d = Math.min(d, Math.sqrt(hx * hx + hy * hy) - hole.r - cfg.puckR - (cfg.zoneCutGap ?? ZONE_CUT_GAP));
				d = Math.min(d, sideGap(hole.x, hole.y, cfg.diskX, cfg.diskY, 0, cfg.diskY, x, y));
			}
		} else {
			const z = cfg.returnZone;
			d = Math.min(d, sideGap(z.ax, z.ay, z.bx, z.by, z.cx, z.cy, x, y));
			d = Math.min(d, sideGap(z.ax, z.ay, z.cx, z.cy, z.bx, z.by, x, y));
			for (let k = 0; k < cfg.holes.length; k++) {
				const hole = cfg.holes[k], hx = x - hole.x, hy = y - hole.y;
				d = Math.min(d, Math.sqrt(hx * hx + hy * hy) - hole.r - cfg.puckR - (cfg.zoneCutGap ?? ZONE_CUT_GAP));
			}
		}
	} else if (cfg.zoneStyle === 'arcs') d = smin(d, left ? cfg.diskX - x : x - cfg.diskX, ZONE_SOFT_K);
	else if (left) {
		for (let k = 0; k < cfg.holes.length; k++) {
			const hole = cfg.holes[k];
			d = smin(d, holeGap(cfg, hole, x, y) - cfg.puckR, ZONE_SOFT_K);
			d = smin(d, sideGap(hole.x, hole.y, cfg.diskX, cfg.diskY, 0, cfg.diskY, x, y), ZONE_SOFT_K);
		}
	} else {
		const z = cfg.returnZone;
		d = smin(d, sideGap(z.ax, z.ay, z.bx, z.by, z.cx, z.cy, x, y), ZONE_SOFT_K);
		d = smin(d, sideGap(z.ax, z.ay, z.cx, z.cy, z.bx, z.by, x, y), ZONE_SOFT_K);
	}
	if (!left) return d;
	const v = cfg.advanceZone; // the launch lane joins whatever the shape
	return Math.max(d, Math.min(x - v.lx, v.lx + v.lw - x));
}
// 'zones' is the eject fan: inside the triangle apex→far corners. 'advance' is the
// wedge behind the disk plus the launch lane: a puck has to get past the disk and
// out of its own box. Both tables put a vertex on the disk centre and their sides run
// straight out of it, so 'inside the wedge but within the keep-clear radius' is simply
// the guard — no second test needed, and no extra exemption the picture does not show.
function inReturnZone(cfg, mode, x, y) {
	if (mode === 'none') return false;
	if (isFieldZone(cfg)) return zoneField(cfg, mode, x, y) > 0;
	if (mode === 'zones') return inTri(cfg.returnZone, x, y) && !inGuard(cfg, x, y);
	if (mode === 'advance') {
		const v = cfg.advanceZone;
		if (inTri(v, x, y) && !inGuard(cfg, x, y)) return true;
		return x >= v.lx && x <= v.lx + v.lw; // launch lane; the guard cannot reach it
	}
	return false;
}
// Move the last puck into slot i and shrink the board by one — the swap-remove every
// removal is built on. Indices above i shift, so callers walk downwards.
function moveLast(w, i) { swapRemovePuck(w, i); }
// Remove every puck test(w, i) claims. onTake (optional) is told the seat that owned
// it — that is how a returned puck goes back into its owner's stock.
function takePucks(w, test, onTake) {
	let count = 0;
	for (let i = w.n - 1; i >= 0; i--) {
		if (!test(w, i)) continue;
		if (onTake) onTake(w.own[i]);
		moveLast(w, i);
		count++;
	}
	return count;
}
let _mode = 'none';
function puckWouldRecycle(w, i, mode) {
	return w.st[i] === ST_SLEEP && inReturnZone(w.cfg, mode, w.x[i], w.y[i]);
}
function isRecyclable(w, i) { return puckWouldRecycle(w, i, _mode); }
// A return rule only claims a puck that has come to rest inside its zone, and the disk
// itself is exempt (inGuard), so nothing that still touches it is ever taken.
function recyclePucks(w, mode, onBack) {
	_mode = mode;
	return mode === 'none' ? 0 : takePucks(w, isRecyclable, onBack);
}
let _dropOwner = -1;
function isOwnedBy(w, i) { return w.own[i] === _dropOwner; }
// A seat that leaves takes his pucks with him: they stop scoring, and they stop
// cluttering the board for the seats that are still playing.
function dropOwned(w, owner) {
	_dropOwner = owner;
	return takePucks(w, isOwnedBy, null);
}
// Roster splice changes every surviving owner after the removed seat by one.
function reindexOwners(w, removed) {
	for (let i = 0; i < w.n; i++) if (w.own[i] > removed) w.own[i]--;
	const losses = w.ownerLosses;
	for (let i = removed; i < losses.length - 1; i++) losses[i] = losses[i + 1];
	losses[losses.length - 1] = 0;
}
// Remove one puck by index — the puck waiting on the launch spot, for instance.
function removePuckAt(w, at) { moveLast(w, at); }

if (typeof module !== 'undefined') module.exports = { onDisk, inGuard, isSoftZone, isCutZone, isFieldZone, ZONE_CUT_GAP, zoneField, inReturnZone, puckWouldRecycle, moveLast, takePucks, recyclePucks, dropOwned, reindexOwners, removePuckAt };
