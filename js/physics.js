// Fixed-step physics: area-weighted two-surface friction, co-rotation lock,
// puck spin (material rotation) and exact time-of-impact circle/wall collisions.
// Node-safe, no allocation in stepWorld (typed arrays + module scratch only).
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
		th: new Float64Array(MAX_PUCKS), om: new Float64Array(MAX_PUCKS),
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
	w.th[i] = 0; w.om[i] = 0;
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
// Contact patch of puck i on the disk: area fraction, distance to the disk centre
// and the centroid of the overlap (world coords). The centroid is why this exists:
// the disk's surface velocity is linear in position (v_surf = ω ẑ × r), so its mean
// over the patch equals its value at the centroid — sampling there is what makes a
// puck straddling the rim get dragged by the surface it actually touches instead of
// the one under its centre.
const _ov = { a: 0, cx: 0, cy: 0, d: 0 };
const _MIN_AREA = 1e-3; // below this a surface's patch counts as not touching
// Area of the part of a circle of radius R beyond a chord at distance `a` from its
// centre, and the distance from that centre to the centroid of that part.
function segArea(R, a) { return R * R * Math.acos(a / R) - a * Math.sqrt(Math.max(0, R * R - a * a)); }
function segCentroid(R, a, area) {
	const m = Math.max(0, R * R - a * a);
	// (2/3)(R²-a²)^{3/2}/A: the centroid sits `h` from the centre toward the part.
	return area > 1e-15 ? (2 / 3) * m * Math.sqrt(m) / area : 0;
}
function diskOverlap(w, i, out) {
	const cfg = w.cfg, r = w.r[i], R = cfg.diskR;
	const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
	const d = Math.sqrt(dx * dx + dy * dy);
	out.a = 0; out.cx = w.x[i]; out.cy = w.y[i]; out.d = d;
	if (d >= R + r) return 0;
	if (d <= Math.abs(R - r)) { out.a = d + r <= R ? 1 : 0; return out.a; }
	// Lens = the puck's cap + the disk's cap, split by the common chord.
	const ux = dx / d, uy = dy / d; // disk centre -> puck centre
	const a1 = (d * d + r * r - R * R) / (2 * d); // chord offset from the puck centre (toward the disk)
	const A1 = segArea(r, a1), A2 = segArea(R, d - a1), A = A1 + A2;
	if (A <= 1e-12) return 0;
	out.a = A / (Math.PI * r * r);
	const h1 = segCentroid(r, a1, A1), h2 = segCentroid(R, d - a1, A2);
	out.cx = (A1 * (w.x[i] - h1 * ux) + A2 * (cfg.diskX + h2 * ux)) / A;
	out.cy = (A1 * (w.y[i] - h1 * uy) + A2 * (cfg.diskY + h2 * uy)) / A;
	return out.a;
}
// Disk surface velocity at an arbitrary world point.
function surfVelAt(w, x, y, out) {
	out[0] = -w.omegaCur * (y - w.cfg.diskY);
	out[1] = w.omegaCur * (x - w.cfg.diskX);
	return out;
}
const _sv = [0, 0];
// One surface's Coulomb drag: the puck's *material* velocity at (px, py) — centre
// velocity plus spin about the centre — is pulled toward the surface velocity
// (sx, sy) by at most muKg*f*h, f being that surface's share of the contact area.
function dragPatch(w, i, px, py, sx, sy, f, muKg, h) {
	const om = w.om[i];
	const rvx = w.vx[i] - om * (py - w.y[i]) - sx;
	const rvy = w.vy[i] + om * (px - w.x[i]) - sy;
	const rv = Math.sqrt(rvx * rvx + rvy * rvy);
	if (rv <= w.cfg.epsV) return;
	const k = Math.min(rv, muKg * f * h) / rv;
	w.vx[i] -= rvx * k; w.vy[i] -= rvy * k;
}
function applyFriction(w, h) {
	const cfg = w.cfg, muKg = cfg.muK * cfg.g, spinK = cfg.spinDrag * muKg;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] === ST_SLEEP) continue;
		const a = diskOverlap(w, i, _ov);
		if (w.st[i] === ST_LOCKED) {
			// Ride ends when the puck slides past the rim or beyond the hold radius.
			if (a >= 0.98 && w.omegaCur * w.omegaCur * _ov.d <= cfg.muS * cfg.g) {
				if (w.omegaCur === 0) { w.st[i] = ST_SLEEP; w.vx[i] = 0; w.vy[i] = 0; w.om[i] = 0; continue; }
				w.om[i] = w.omegaCur; // riding = co-rotating in both senses
				surfVelAt(w, w.x[i], w.y[i], _sv); w.vx[i] = _sv[0]; w.vy[i] = _sv[1];
				continue;
			}
			w.st[i] = ST_SLIDE; // freed: it keeps its spin, now on its own
		}
		// Disk friction: relative velocity is taken at the patch centroid, so a
		// partially covered puck is dragged along the surface it really touches.
		if (a > 0) {
			surfVelAt(w, _ov.cx, _ov.cy, _sv);
			dragPatch(w, i, _ov.cx, _ov.cy, _sv[0], _sv[1], a, muKg, h);
		}
		// Floor friction: the exposed patch is the puck minus the overlap, its
		// centroid at centre − a/(1−a)·(patch centroid − centre).
		if (1 - a > _MIN_AREA) {
			const e = a / (1 - a);
			dragPatch(w, i, w.x[i] - e * (_ov.cx - w.x[i]), w.y[i] - e * (_ov.cy - w.y[i]), 0, 0, 1 - a, muKg, h);
		}
		// Spin. A round patch sees the spin mismatch as a pure rotation field about
		// the centre, so this friction is saturated (Coulomb): the disk patch drags
		// the spin toward ω_disk, the floor patch brakes it toward 0, at
		// ω̇ = spinDrag·μk·g/r per unit covered area. Capping by the remaining gap
		// makes the spin land exactly on the target, like the linear model does.
		const rate = spinK / w.r[i];
		let om = w.om[i];
		if (a > 0) om += clamp(w.omegaCur - om, -rate * a * h, rate * a * h);
		if (1 - a > _MIN_AREA) om += clamp(-om, -rate * (1 - a) * h, rate * (1 - a) * h);
		w.om[i] = om;
		// Lock: fully covered, no slide at the centre, held by μs. Locking snaps the
		// velocity onto the surface, so it snaps the spin onto ω_disk as well — the
		// spin ramp only decides how a puck behaves *before* it is captured, and a
		// spin gate here would just delay the capture past the drift that locking is
		// supposed to stop (measured: the whole lock band collapses).
		surfVelAt(w, w.x[i], w.y[i], _sv);
		const rvx = w.vx[i] - _sv[0], rvy = w.vy[i] - _sv[1];
		const rv = Math.sqrt(rvx * rvx + rvy * rvy);
		if (a >= 0.999 && rv <= cfg.epsLock && w.omegaCur * w.omegaCur * _ov.d <= cfg.muS * cfg.g) {
			w.st[i] = ST_LOCKED; w.vx[i] = _sv[0]; w.vy[i] = _sv[1]; w.om[i] = w.omegaCur;
			continue;
		}
		// eps-snap: friction alone would jitter around zero forever. Two ways to be at
		// rest: riding the surface (relative velocity ~ 0), or jammed on the rim where
		// the floor patch out-drags the disk patch (a <= 1-a, both drags use μk) — the
		// second one otherwise stays SLIDE forever with the surface sliding underneath.
		if (Math.sqrt(w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i]) <= cfg.epsSleep && Math.abs(om) <= cfg.epsSpin
			&& (a <= _MIN_AREA || a <= 1 - a || rv <= cfg.epsSleep)) {
			w.vx[i] = 0; w.vy[i] = 0; w.om[i] = 0; w.st[i] = ST_SLEEP;
		}
	}
}
function advance(w, dt) {
	if (dt <= 0) return;
	const cfg = w.cfg;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] === ST_SLEEP) continue;
		w.th[i] += w.om[i] * dt;
		if (w.st[i] === ST_LOCKED) {
			// Exact rotation about the disk centre: a tangent step would
			// grow the radius by ~(v*h)^2/2d every step and slowly eject it.
			const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
			const ang = w.omegaCur * dt, c = Math.cos(ang), s = Math.sin(ang);
			w.x[i] = cfg.diskX + c * dx - s * dy;
			w.y[i] = cfg.diskY + s * dx + c * dy;
			surfVelAt(w, w.x[i], w.y[i], _sv); w.vx[i] = _sv[0]; w.vy[i] = _sv[1];
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
		const low = _evAxis === 0 ? w.vx[i] < 0 : w.vy[i] < 0; // which board was hit
		const sd = low ? 1 : -1, r = w.r[i];
		// Tangential speed at the contact point (spin included): the wall rubs with
		// the same restitution as before, and the impulse's moment arm spins the
		// puck — Δω = −sd·2·Δv_t/r because r·m/I = 2/r for a disc.
		const vt = (_evAxis === 0 ? w.vy[i] : -w.vx[i]) - sd * w.om[i] * r;
		const dvt = -(1 - cfg.wallTanKeep) * vt;
		if (_evAxis === 0) {
			w.x[i] = low ? r : cfg.boardW - r;
			w.vx[i] = -cfg.eWall * w.vx[i]; w.vy[i] += dvt;
		} else {
			w.y[i] = low ? r : cfg.boardH - r;
			w.vy[i] = -cfg.eWall * w.vy[i]; w.vx[i] -= dvt;
		}
		w.om[i] -= sd * 2 * dvt / r;
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
	let jn = 0;
	if (rvn < 0) {
		jn = -(1 + cfg.ePuck) * rvn / ws; // central: discs take no torque from it
		w.vx[i] -= jn * wi * nx; w.vy[i] -= jn * wi * ny;
		w.vx[j] += jn * wj * nx; w.vy[j] += jn * wj * ny;
	}
	// Edge rub: tangential relative speed at the contact, killed up to the friction
	// cone of the normal impulse. Both spins move the same way — ω_i = −ω_j is
	// exactly the rolling condition for two touching discs.
	const tx = -ny, ty = nx;
	const vt = (w.vx[j] - w.vx[i]) * tx + (w.vy[j] - w.vy[i]) * ty - w.om[i] * w.r[i] - w.om[j] * w.r[j];
	const k = 3 * (wi + wj); // 1/m_i + 1/m_j + r_i²/I_i + r_j²/I_j; r²/I = 2/m for a disc
	const jt = clamp(-vt / k, -cfg.muEdge * jn, cfg.muEdge * jn);
	if (jt !== 0) {
		w.vx[i] -= jt * tx * wi; w.vy[i] -= jt * ty * wi;
		w.vx[j] += jt * tx * wj; w.vy[j] += jt * ty * wj;
		w.om[i] -= 2 * jt / (w.m[i] * w.r[i]); // Δω = −j_t·r/I = −2·j_t/(m·r)
		w.om[j] -= 2 * jt / (w.m[j] * w.r[j]);
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
	if (w.settled) for (let i = 0; i < w.n; i++) { w.st[i] = ST_SLEEP; w.vx[i] = 0; w.vy[i] = 0; w.om[i] = 0; }
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

if (typeof module !== 'undefined') module.exports = { createWorld, resetWorld, spawnPuck, throwPuck, stepWorld, isSettled, beginSettle, fieldValueOf, totalScore, diskOverlap, surfVelAt };
