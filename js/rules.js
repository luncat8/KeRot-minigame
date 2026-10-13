// Game rules shared by the browser loop and the headless competition: pool
// accounting and puck recycling. Node-safe: no DOM access.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));

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
// 'zones' is the eject fan: inside the triangle apex→far corners. 'advance' is the
// wedge behind the disk plus the launch lane: a puck has to get past the disk and
// out of its own box. Both tables put a vertex on the disk centre and their sides run
// straight out of it, so 'inside the wedge but within the keep-clear radius' is simply
// the guard — no second test needed, and no extra exemption the picture does not show.
function inReturnZone(cfg, mode, x, y) {
	if (mode === 'none') return false;
	if (mode === 'zones') return inTri(RETURN_ZONES, x, y) && !inGuard(cfg, x, y);
	if (mode === 'advance') {
		const v = ADVANCE_ZONES;
		if (inTri(v, x, y) && !inGuard(cfg, x, y)) return true;
		return x >= v.lx && x <= v.lx + v.lw; // launch lane; the guard cannot reach it
	}
	return false;
}
// Move the last puck into slot i and shrink the board by one — the swap-remove every
// removal is built on. Indices above i shift, so callers walk downwards.
function moveLast(w, i) {
	w.n--;
	if (i === w.n) return;
	w.x[i] = w.x[w.n]; w.y[i] = w.y[w.n];
	w.vx[i] = w.vx[w.n]; w.vy[i] = w.vy[w.n];
	w.r[i] = w.r[w.n]; w.m[i] = w.m[w.n];
	w.th[i] = w.th[w.n]; w.om[i] = w.om[w.n]; w.st[i] = w.st[w.n];
	w.own[i] = w.own[w.n];
}
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
function isRecyclable(w, i) { return w.st[i] === ST_SLEEP && inReturnZone(w.cfg, _mode, w.x[i], w.y[i]); }
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
// Remove one puck by index — the puck waiting on the launch spot, for instance.
function removePuckAt(w, at) { moveLast(w, at); }

if (typeof module !== 'undefined') module.exports = { onDisk, inGuard, inReturnZone, moveLast, takePucks, recyclePucks, dropOwned, removePuckAt };
