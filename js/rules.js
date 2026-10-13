// Game rules shared by the browser loop and the headless competition: pool
// accounting and puck recycling. Node-safe: no DOM access.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));

// A puck that still touches the disk is in play there — never recycle it, even if
// its centre sits in a return zone (the channel runs under the disk's left cap).
function onDisk(cfg, x, y) {
	const dx = x - cfg.diskX, dy = y - cfg.diskY;
	return Math.sqrt(dx * dx + dy * dy) <= cfg.diskR + cfg.puckR;
}
function inReturnZone(cfg, mode, x, y) {
	if (mode === 'none' || onDisk(cfg, x, y)) return false;
	if (mode === 'behind') return x < cfg.diskX;
	if (x < RETURN_ZONES.lagoonW) return true;
	return y < RETURN_ZONES.stream || y > cfg.boardH - RETURN_ZONES.stream;
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
			w.r[i] = w.r[w.n]; w.m[i] = w.m[w.n]; w.st[i] = w.st[w.n];
		}
		count++;
	}
	return count;
}
function poolOf(w, cfg) { return Math.max(0, cfg.poolSize - w.n); }
function roundOver(w, cfg) { return poolOf(w, cfg) <= 0 || w.thrown >= cfg.maxThrows; }

if (typeof module !== 'undefined') module.exports = { onDisk, inReturnZone, recyclePucks, poolOf, roundOver };
