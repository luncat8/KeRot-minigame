// Game rules shared by the browser loop and the headless competition: pool
// accounting and puck recycling. Node-safe: no DOM access.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));

// A puck that still touches the disk is in play there — never recycle it, even if
// its centre sits in a return zone (the fan contains the disk's right cap).
function onDisk(cfg, x, y) {
	const dx = x - cfg.diskX, dy = y - cfg.diskY;
	return Math.sqrt(dx * dx + dy * dy) <= cfg.diskR + cfg.puckR;
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
// out of its own box. Either way the disk itself is never a return zone.
function inReturnZone(cfg, mode, x, y) {
	if (mode === 'none' || onDisk(cfg, x, y)) return false;
	if (mode === 'zones') return inTri(RETURN_ZONES, x, y);
	if (mode === 'advance') {
		const v = ADVANCE_ZONES;
		return inTri(v, x, y) || (x >= v.lx && x <= v.lx + v.lw);
	}
	return false;
}
// Remove resting pucks a return rule claims (swap-remove). Call at resolve end
// and at settle end. Returns how many went back to the pool.
function recyclePucks(w, mode) {
	let count = 0;
	for (let i = w.n - 1; i >= 0; i--) {
		if (w.st[i] !== ST_SLEEP || !inReturnZone(w.cfg, mode, w.x[i], w.y[i])) continue;
		w.n--;
		if (i !== w.n) {
			w.x[i] = w.x[w.n]; w.y[i] = w.y[w.n];
			w.vx[i] = w.vx[w.n]; w.vy[i] = w.vy[w.n];
			w.r[i] = w.r[w.n]; w.m[i] = w.m[w.n];
			w.th[i] = w.th[w.n]; w.om[i] = w.om[w.n]; w.st[i] = w.st[w.n];
		}
		count++;
	}
	return count;
}
function poolOf(w, cfg) { return Math.max(0, cfg.poolSize - w.n); }
function roundOver(w, cfg) { return poolOf(w, cfg) <= 0 || w.thrown >= cfg.maxThrows; }

if (typeof module !== 'undefined') module.exports = { onDisk, inReturnZone, recyclePucks, poolOf, roundOver };
