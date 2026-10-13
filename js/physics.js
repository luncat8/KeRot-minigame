// Fixed-step physics: area-weighted two-surface friction, co-rotation lock,
// and exact time-of-impact circle/wall collisions. Node-safe, no allocation
// in stepWorld (typed arrays + module scratch scalars only).
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./field.js'));
let _evTau = 0, _evKind = 0, _evI = 0, _evJ = 0, _evAxis = 0, _evFound = false;
function consider(i, j, axis, tau, rem) {
	if (tau < 0 || tau > rem || (_evFound && tau >= _evTau)) return;
	_evTau = tau; _evI = i; _evJ = j; _evAxis = axis; _evKind = j < 0 ? 1 : 2; _evFound = true;
}

function createWorld(cfg) {
	return {
		cfg: cfg, t: 0, theta: 0, omegaCur: cfg.omega,
		n: 0, thrown: 0,
		settling: false, settleT: 0, settled: false,
		x: new Float64Array(MAX_PUCKS), y: new Float64Array(MAX_PUCKS),
		vx: new Float64Array(MAX_PUCKS), vy: new Float64Array(MAX_PUCKS),
		r: new Float64Array(MAX_PUCKS), m: new Float64Array(MAX_PUCKS),
		st: new Uint8Array(MAX_PUCKS),
	};
}
function resetWorld(w) {
	w.t = 0; w.theta = 0; w.omegaCur = w.cfg.omega; w.n = 0; w.thrown = 0;
	w.settling = false; w.settleT = 0; w.settled = false;
}
function spawnPuck(w, x, y) {
	if (w.n >= MAX_PUCKS) return -1;
	const i = w.n++;
	w.x[i] = x; w.y[i] = y; w.vx[i] = 0; w.vy[i] = 0;
	w.r[i] = w.cfg.puckR; w.m[i] = w.cfg.puckM; w.st[i] = ST_SLEEP;
	separateOverlaps(w, i);
	return i;
}
// Positional-only separation (spawn / fallback): never injects velocity.
function separateOverlaps(w, only) {
	for (let i = 0; i < w.n; i++) {
		for (let j = i + 1; j < w.n; j++) {
			if (only >= 0 && i !== only && j !== only) continue;
			const dx = w.x[j] - w.x[i], dy = w.y[j] - w.y[i];
			const sig = w.r[i] + w.r[j], d2 = dx * dx + dy * dy;
			if (d2 >= sig * sig) continue;
			const d = Math.sqrt(d2) || 1e-9;
			const nx = d2 > 0 ? dx / d : 1, ny = d2 > 0 ? dy / d : 0;
			const push = (sig - d + w.cfg.slop), wi = 1 / w.m[i], wj = 1 / w.m[j], ws = wi + wj;
			w.x[i] -= nx * push * (wi / ws); w.y[i] -= ny * push * (wi / ws);
			w.x[j] += nx * push * (wj / ws); w.y[j] += ny * push * (wj / ws);
		}
	}
	clampInside(w);
}
function throwPuck(w, i, vx, vy) {
	w.vx[i] = vx; w.vy[i] = vy; w.st[i] = ST_SLIDE; w.thrown++;
}
// Exact circle-circle intersection area fraction of puck i inside the disk.
function diskAreaFrac(w, i) {
	const cfg = w.cfg;
	const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
	const d = Math.sqrt(dx * dx + dy * dy), r = w.r[i], R = cfg.diskR;
	if (d >= R + r) return 0;
	if (d <= Math.abs(R - r)) return d + r <= R ? 1 : 0;
	const c1 = Math.max(-1, Math.min(1, (d * d + r * r - R * R) / (2 * d * r)));
	const c2 = Math.max(-1, Math.min(1, (d * d + R * R - r * r) / (2 * d * R)));
	const heron = Math.sqrt(Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)));
	return (r * r * Math.acos(c1) + R * R * Math.acos(c2) - 0.5 * heron) / (Math.PI * r * r);
}
function surfVel(w, i, out) {
	const dx = w.x[i] - w.cfg.diskX, dy = w.y[i] - w.cfg.diskY;
	out[0] = -w.omegaCur * dy; out[1] = w.omegaCur * dx;
	return out;
}
const _sv = [0, 0];

function applyFriction(w, h) {
	const cfg = w.cfg, muKg = cfg.muK * cfg.g;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] === ST_SLEEP) continue;
		const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
		const d = Math.sqrt(dx * dx + dy * dy);
		surfVel(w, i, _sv);
		if (w.st[i] === ST_LOCKED) {
			const a = diskAreaFrac(w, i);
			if (a < 0.98 || w.omegaCur * w.omegaCur * d > cfg.muS * cfg.g) w.st[i] = ST_SLIDE;
			else if (w.omegaCur === 0) { w.st[i] = ST_SLEEP; w.vx[i] = 0; w.vy[i] = 0; continue; }
			else { w.vx[i] = _sv[0]; w.vy[i] = _sv[1]; continue; }
		}
		const a = diskAreaFrac(w, i);
		// Disk friction opposes velocity relative to the moving surface.
		let rvx = w.vx[i] - _sv[0], rvy = w.vy[i] - _sv[1];
		const rv = Math.sqrt(rvx * rvx + rvy * rvy);
		if (a > 0 && rv > cfg.epsV) {
			const dec = Math.min(rv, muKg * a * h);
			w.vx[i] -= rvx / rv * dec; w.vy[i] -= rvy / rv * dec;
		}
		// Floor friction opposes lab velocity, weighted by exposed area.
		const sp = Math.sqrt(w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i]);
		if (a < 1 && sp > cfg.epsV) {
			const dec = Math.min(sp, muKg * (1 - a) * h);
			w.vx[i] -= w.vx[i] / sp * dec; w.vy[i] -= w.vy[i] / sp * dec;
		}
		rvx = w.vx[i] - _sv[0]; rvy = w.vy[i] - _sv[1];
		const rv2 = Math.sqrt(rvx * rvx + rvy * rvy);
		if (a >= 0.999 && rv2 <= cfg.epsLock && w.omegaCur * w.omegaCur * d <= cfg.muS * cfg.g && w.omegaCur !== 0) {
			w.st[i] = ST_LOCKED; w.vx[i] = _sv[0]; w.vy[i] = _sv[1];
		} else if (Math.sqrt(w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i]) <= cfg.epsSleep && (a <= 1e-3 || rv2 <= cfg.epsSleep)) {
			// ^ relative velocity only matters where the puck actually touches the disk
			// eps-snap: kinetic friction alone would jitter around zero forever.
			w.vx[i] = 0; w.vy[i] = 0; w.st[i] = ST_SLEEP;
		}
	}
}
function advance(w, dt) {
	if (dt <= 0) return;
	const cfg = w.cfg;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] === ST_SLEEP) continue;
		if (w.st[i] === ST_LOCKED) {
			// Exact rotation about the disk centre: a tangent step would
			// grow the radius by ~(v*h)^2/2d every step and slowly eject it.
			const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
			const ang = w.omegaCur * dt, c = Math.cos(ang), s = Math.sin(ang);
			w.x[i] = cfg.diskX + c * dx - s * dy;
			w.y[i] = cfg.diskY + s * dx + c * dy;
			surfVel(w, i, _sv); w.vx[i] = _sv[0]; w.vy[i] = _sv[1];
		} else { w.x[i] += w.vx[i] * dt; w.y[i] += w.vy[i] * dt; }
	}
	w.theta += w.omegaCur * dt;
	w.t += dt;
}
// Earliest event in (0, rem]; sets _ev* scratch. Returns false if none.
function findEvent(w, rem) {
	const cfg = w.cfg;
	_evKind = 0; _evTau = rem; _evFound = false;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] !== ST_SLIDE) continue;
		const r = w.r[i];
		if (w.vx[i] < 0) consider(i, -1, 0, (r - w.x[i]) / w.vx[i], rem);
		if (w.vx[i] > 0) consider(i, -1, 0, (cfg.boardW - r - w.x[i]) / w.vx[i], rem);
		if (w.vy[i] < 0) consider(i, -1, 1, (r - w.y[i]) / w.vy[i], rem);
		if (w.vy[i] > 0) consider(i, -1, 1, (cfg.boardH - r - w.y[i]) / w.vy[i], rem);
	}
	for (let i = 0; i < w.n; i++) {
		for (let j = i + 1; j < w.n; j++) {
			if (w.st[i] === ST_SLEEP && w.st[j] === ST_SLEEP) continue;
			const dx = w.x[j] - w.x[i], dy = w.y[j] - w.y[i];
			const vx = w.vx[j] - w.vx[i], vy = w.vy[j] - w.vy[i];
			const dv = dx * vx + dy * vy;
			if (dv >= 0) continue;
			const sig = w.r[i] + w.r[j];
			const vv = vx * vx + vy * vy, cc = dx * dx + dy * dy - sig * sig;
			if (cc <= 0) { consider(i, j, -1, 0, rem); continue; } // already overlapping
			const disc = dv * dv - vv * cc;
			if (disc < 0) continue;
			consider(i, j, -1, (-dv - Math.sqrt(disc)) / vv, rem);
		}
	}
	return _evFound;
}
function resolveEvent(w) {
	const cfg = w.cfg, i = _evI;
	if (_evKind === 1) {
		if (_evAxis === 0) {
			w.x[i] = w.vx[i] < 0 ? w.r[i] : cfg.boardW - w.r[i];
			w.vx[i] = -cfg.eWall * w.vx[i]; w.vy[i] *= cfg.wallTanKeep;
		} else {
			w.y[i] = w.vy[i] < 0 ? w.r[i] : cfg.boardH - w.r[i];
			w.vy[i] = -cfg.eWall * w.vy[i]; w.vx[i] *= cfg.wallTanKeep;
		}
		return;
	}
	const j = _evJ;
	let dx = w.x[j] - w.x[i], dy = w.y[j] - w.y[i];
	const sig = w.r[i] + w.r[j], d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
	const nx = d > 1e-9 && dx * dx + dy * dy > 0 ? dx / d : 1, ny = d > 1e-9 && dx * dx + dy * dy > 0 ? dy / d : 0;
	const wi = 1 / w.m[i], wj = 1 / w.m[j], ws = wi + wj;
	if (d < sig) { // positional separation by inverse mass
		const push = sig - d + cfg.slop;
		w.x[i] -= nx * push * (wi / ws); w.y[i] -= ny * push * (wi / ws);
		w.x[j] += nx * push * (wj / ws); w.y[j] += ny * push * (wj / ws);
	}
	const rvn = (w.vx[j] - w.vx[i]) * nx + (w.vy[j] - w.vy[i]) * ny;
	if (rvn < 0) {
		const imp = -(1 + cfg.ePuck) * rvn / ws;
		w.vx[i] -= imp * wi * nx; w.vy[i] -= imp * wi * ny;
		w.vx[j] += imp * wj * nx; w.vy[j] += imp * wj * ny;
	}
	if (w.st[i] !== ST_SLIDE) w.st[i] = ST_SLIDE; // a hit wakes sleepers / unlocks
	if (w.st[j] !== ST_SLIDE) w.st[j] = ST_SLIDE;
	clampInside(w); // pair separation must never shove a puck through a wall
}
function clampInside(w) {
	const cfg = w.cfg;
	for (let i = 0; i < w.n; i++) {
		w.x[i] = Math.max(w.r[i], Math.min(cfg.boardW - w.r[i], w.x[i]));
		w.y[i] = Math.max(w.r[i], Math.min(cfg.boardH - w.r[i], w.y[i]));
	}
}
function stepWorld(w, h) {
	const cfg = w.cfg;
	if (w.settling) {
		const t0 = w.settleT;
		w.settleT = Math.min(cfg.settleTime, w.settleT + h);
		// Trapezoidal average keeps theta exact while omega ramps to 0.
		w.omegaCur = cfg.omega * 0.5 * (Math.max(0, 1 - t0 / cfg.settleTime) + Math.max(0, 1 - w.settleT / cfg.settleTime));
		if (w.settleT >= cfg.settleTime) { w.omegaCur = 0; w.settled = true; }
	} else w.omegaCur = cfg.omega;
	applyFriction(w, h);
	let rem = h;
	for (let k = 0; k < cfg.maxSubsteps; k++) {
		if (!findEvent(w, rem)) { advance(w, rem); rem = 0; break; }
		advance(w, _evTau); rem -= _evTau;
		resolveEvent(w);
		if (rem <= 0) break;
	}
	if (rem > 0) { advance(w, rem); clampInside(w); } // substep budget exhausted: guard only
	if (w.settled) for (let i = 0; i < w.n; i++) { w.st[i] = ST_SLEEP; w.vx[i] = 0; w.vy[i] = 0; }
}
function isSettled(w) {
	for (let i = 0; i < w.n; i++) if (w.st[i] === ST_SLIDE) return false;
	return true;
}
function beginSettle(w) { if (!w.settling) { w.settling = true; w.settleT = 0; } }
function fieldValueOf(w, i) { return fieldWorld(w.cfg, w.x[i], w.y[i], w.theta); }
function totalScore(w) {
	let s = 0;
	for (let i = 0; i < w.n; i++) s += fieldValueOf(w, i);
	return s;
}

if (typeof module !== 'undefined') module.exports = { createWorld, resetWorld, spawnPuck, throwPuck, stepWorld, isSettled, beginSettle, fieldValueOf, totalScore, diskAreaFrac };
