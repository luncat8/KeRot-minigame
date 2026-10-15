// Fixed-step physics: area-weighted two-surface friction, co-rotation lock,
// puck spin (material rotation) and exact time-of-impact circle/wall collisions.
// Node-safe, no allocation in stepWorld (typed arrays + module scratch only).
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));
let _evTau = 0, _evKind = 0, _evI = 0, _evJ = 0, _evAxis = 0, _evFound = false;
function consider(i, j, axis, tau, rem) {
	if (tau < 0 || tau > rem || (_evFound && tau >= _evTau)) return;
	_evTau = tau; _evI = i; _evJ = j; _evAxis = axis; _evKind = j < 0 ? 1 : 2; _evFound = true;
}
// Swept-circle entry: the puck radius expands the hole, so even a fast grazing path is caught.
function considerHole(i, hole, tau, rem) {
	if (tau < 0 || tau > rem || (_evFound && tau >= _evTau)) return;
	_evTau = tau; _evI = i; _evJ = hole; _evAxis = -1; _evKind = 3; _evFound = true;
}
function holeEntryTime(w, i, hole, rem) {
	const dx = w.x[i] - hole.x, dy = w.y[i] - hole.y;
	const r = hole.r + w.r[i], c = dx * dx + dy * dy - r * r;
	if (c <= 0) return 0;
	const vx = w.vx[i], vy = w.vy[i], vv = vx * vx + vy * vy;
	if (vv <= 0) return -1;
	const dot = dx * vx + dy * vy;
	if (dot >= 0) return -1;
	const disc = dot * dot - vv * c;
	if (disc < 0) return -1;
	const tau = (-dot - Math.sqrt(disc)) / vv;
	return tau <= rem ? tau : -1;
}

function createWorld(cfg) {
	return {
		cfg: cfg, t: 0, theta: 0, omegaCur: cfg.omega,
		n: 0, thrown: 0, nextUid: 1,
		settling: false, settleT: 0, settled: false,
		x: new Float64Array(MAX_PUCKS), y: new Float64Array(MAX_PUCKS),
		vx: new Float64Array(MAX_PUCKS), vy: new Float64Array(MAX_PUCKS),
		r: new Float64Array(MAX_PUCKS), m: new Float64Array(MAX_PUCKS),
		th: new Float64Array(MAX_PUCKS), om: new Float64Array(MAX_PUCKS),
		st: new Uint8Array(MAX_PUCKS),
		own: new Uint8Array(MAX_PUCKS), // the seat the puck belongs to (js/players.js)
		uid: new Uint32Array(MAX_PUCKS), // stable across swap-removal, for prediction tracking
		ownerLosses: new Uint16Array(cfg.maxPlayers || CFG.maxPlayers),
	};
}
function resetWorld(w) {
	w.t = 0; w.theta = 0; w.omegaCur = w.cfg.omega; w.n = 0; w.thrown = 0; w.nextUid = 1;
	w.ownerLosses.fill(0);
	w.settling = false; w.settleT = 0; w.settled = false;
}
// owner is the seat index (js/players.js); the physics experiments leave it at 0.
function spawnPuck(w, x, y, owner) {
	if (w.n >= MAX_PUCKS) return -1;
	const i = w.n++;
	w.x[i] = x; w.y[i] = y; w.vx[i] = 0; w.vy[i] = 0;
	w.r[i] = w.cfg.puckR; w.m[i] = w.cfg.puckM; w.st[i] = ST_SLEEP;
	w.th[i] = 0; w.om[i] = 0; w.own[i] = owner || 0; w.uid[i] = w.nextUid++;
	separateOverlaps(w, i);
	return i;
}
function swapRemovePuck(w, i) {
	w.n--;
	if (i === w.n) return;
	w.x[i] = w.x[w.n]; w.y[i] = w.y[w.n];
	w.vx[i] = w.vx[w.n]; w.vy[i] = w.vy[w.n];
	w.r[i] = w.r[w.n]; w.m[i] = w.m[w.n];
	w.th[i] = w.th[w.n]; w.om[i] = w.om[w.n];
	w.st[i] = w.st[w.n]; w.own[i] = w.own[w.n]; w.uid[i] = w.uid[w.n];
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
// Contact patch of puck i on the disk: area fraction, distance to the disk centre,
// the centroid of the overlap (world coords) and the two torque budgets (qd on the
// disk, qf on the floor). The centroid is why this exists: the disk's surface
// velocity is linear in position (v_surf = ω ẑ × r), so its mean over the patch
// equals its value at the centroid — sampling there is what makes a puck straddling
// the rim get dragged by the surface it actually touches instead of the one under
// its centre.
const _ov = { a: 0, cx: 0, cy: 0, d: 0, qd: 0, qf: 0, px: 0, py: 0 };
// Area of the part of a circle of radius R beyond a chord at distance `a` from its
// centre, and the distance from that centre to the centroid of that part.
function segArea(R, a) { return R * R * Math.acos(a / R) - a * Math.sqrt(Math.max(0, R * R - a * a)); }
function segCentroid(R, a, area) {
	const m = Math.max(0, R * R - a * a);
	// (2/3)(R²-a²)^{3/2}/A: the centroid sits `h` from the centre toward the part.
	return area > 1e-15 ? (2 / 3) * m * Math.sqrt(m) / area : 0;
}
// ∫|ρ|dA over the part of a disc of radius r beyond a chord at signed distance `a`
// from its centre — the region {ρ ≤ r, ρ·ê ≥ a}, so a = −r is the whole disc (the
// chord misses it) and a = +r is empty. Exact polar integral: the region covers the
// half-angle acos(a/r), plus (a < 0, the chord past the centre) or minus (a > 0) the
// wedge {|cos ψ| > |a|/r} whose inner/outer radius is a/cos ψ — ∫sec³ is elementary.
// For the full disc this is (2/3)r³, i.e. ω̇ = (4/3)μk·g/r = CFG.spinDrag·μk·g/r, the
// rate the ring pattern is built to reproduce exactly.
function segMoment(r, a) {
	const s = clamp(a / r, -1, 1);
	const u = Math.abs(s), t = Math.sqrt(Math.max(0, 1 - u * u)); // tan(psi), psi = acos(u)
	// |a|³·∫₀^ψsec³ / r³, with the u³ factor first so u→0 cannot overflow the log.
	const k = 0.5 * (u * t + u * u * u * Math.log((1 + t) / Math.max(u, 1e-300)));
	return (2 / 3) * r * r * r * (Math.acos(s) + (a > 0 ? -k : k));
}
function diskOverlap(w, i, out) {
	const cfg = w.cfg, r = w.r[i], R = cfg.diskR;
	const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY;
	const d = Math.sqrt(dx * dx + dy * dy);
	out.a = 0; out.cx = w.x[i]; out.cy = w.y[i]; out.d = d; out.qd = 0; out.qf = 1;
	out.px = w.x[i]; out.py = w.y[i];
	if (d >= R + r) return 0;
	if (d <= Math.abs(R - r)) { out.a = d + r <= R ? 1 : 0; out.qd = out.a; out.qf = 1 - out.a; return out.a; }
	// Lens = the puck's cap + the disk's cap, split by the common chord.
	const ux = dx / d, uy = dy / d; // disk centre -> puck centre
	const a1 = (d * d + r * r - R * R) / (2 * d); // chord offset from the puck centre (toward the disk)
	const A1 = segArea(r, a1), A2 = segArea(R, d - a1), A = A1 + A2;
	if (A <= 1e-12) return 0;
	out.a = A / (Math.PI * r * r);
	const h1 = segCentroid(r, a1, A1), h2 = segCentroid(R, d - a1, A2);
	out.cx = (A1 * (w.x[i] - h1 * ux) + A2 * (cfg.diskX + h2 * ux)) / A;
	out.cy = (A1 * (w.y[i] - h1 * uy) + A2 * (cfg.diskY + h2 * uy)) / A;
	// Each side's share of the puck's first moment ∫|ρ|dA, in units of the full disc's
	// (2/3)πr³ = 1; the two partition the puck exactly. Only the sleep gate uses it
	// (holdable): the friction itself is integrated cell by cell and needs no split.
	out.qd = clamp(drillShare(w, i, A2, a1), 0, 1);
	out.qf = 1 - out.qd;
	return out.a;
}
// The disk-covered cap's share of the puck's first moment ∫|ρ|dA — the most torque its
// friction can exert about the puck centre. Used by the sleep gate as the floor patch's
// moment capacity; the sliding law does not need it.
function drillShare(w, i, A2, a1) {
	const r = w.r[i];
	// The puck's cap is exact (segMoment); the disk's cap is a sliver (R = 8r) whose
	// mean radius is (r + 2|a1|)/3 — its end points sit on the puck's rim, its middle
	// on the chord. Measured against grid quadrature: 0.6 % worst case.
	const m1 = segMoment(r, a1) + A2 * (r + 2 * Math.abs(a1)) / 3;
	return m1 / ((2 / 3) * Math.PI * r * r * r);
}
// Disk surface velocity at an arbitrary world point.
function surfVelAt(w, x, y, out) {
	out[0] = -w.omegaCur * (y - w.cfg.diskY);
	out[1] = w.omegaCur * (x - w.cfg.diskX);
	return out;
}
const _sv = [0, 0];
// Friction samples over the puck: 4 rings × 16 rays, equal weights (one area cell each).
// The ring radii are chosen so the pattern reproduces both moments the model is
// calibrated on exactly — Σw = πr² (so a translating puck feels exactly μk·m·g) and
// Σw|ρ| = ∫|ρ|dA = (2/3)r³ (so a pure spin drains at exactly spinDrag·μk·g/r).
// A patch has to be *integrated*: the disk's surface velocity varies across it, so the
// friction of a swirling patch partially cancels, and a single sample at the centroid
// cannot see that cancellation at all. That is what pumped a puck straddling the rim:
// with the centroid's full-magnitude drag plus a separate saturated couple, the two
// cross-coupled and drove the puck along the rim, spinning up to |ω| ≈ 9 ω_disk until
// the resolve cap fired. Integrating the patch is dissipative by construction — every
// cell's friction opposes its own slip — and matches an independent fine-grid
// quadrature of the same law.
const FR_RINGS = 4, FR_RAYS = 16, FR_N = FR_RINGS * FR_RAYS;
// × puckR: equal-area ring representatives (√((k+½)/n), which is what a fine
// quadrature gives), rescaled so they sum to 8/3 = 4 × (2/3) and Σw|ρ| = (2/3)r³
// holds to rounding. A spin on still ice then decays at exactly spinDrag·μk·g/r.
const FR_RAD = (() => {
	const a = [];
	let s = 0;
	for (let k = 0; k < FR_RINGS; k++) { const v = Math.sqrt((k + 0.5) / FR_RINGS); a.push(v); s += v; }
	const k = (2 / 3) * FR_RINGS / s;
	for (let i = 0; i < FR_RINGS; i++) a[i] *= k;
	return a;
})();
const FR_COS = new Float64Array(FR_RAYS), FR_SIN = new Float64Array(FR_RAYS);
for (let j = 0; j < FR_RAYS; j++) {
	const ph = (j + 0.5) * 2 * Math.PI / FR_RAYS;
	FR_COS[j] = Math.cos(ph); FR_SIN[j] = Math.sin(ph);
}
// Can the floor patch's static friction hold the disk patch's kinetic drive? Force
// against μs·(1−a), and the moment of that force about the puck's centre against the
// floor patch's own moment capacity μs·(1−a)·λ — the same normalisation the sliding law
// uses. Used only to decide that a stopped puck may sleep: a sliver of overlap is held
// (and ends the round), while a puck the disk can still torque away is not. Only the
// ratio μk/μs enters, so the puck's load factor cancels out of it.
function holdable(cfg, a, ov) {
	if (a >= 1) return false;
	const drive = cfg.muK * a, cap = cfg.muS * (1 - a);
	const rd = Math.hypot(ov.cx - ov.px, ov.cy - ov.py), lf = (2 / 3) * ov.qf * cfg.puckR;
	const f = drive / cap, t = lf > 0 ? drive * rd / (cap * lf) : Infinity;
	return f * f + t * t <= 1;
}
function applyFriction(w, h) {
	const cfg = w.cfg, muKg = cfg.muK * cfg.g, muSg = cfg.muS * cfg.g, R = cfg.diskR, dcx = cfg.diskX, dcy = cfg.diskY;
	const boardLoad = loadFactor(cfg, cfg.puckM); // the slider mass: a cbrt per step, not per puck
	for (let i = 0; i < w.n; i++) {
		// A sleeping puck is at rest: it is skipped entirely, and only a contact that
		// can move it brings it back (a puck hit wakes it explicitly). Nothing on the
		// disk can: the drive a jammed straddler feels is saturated at μk·g·a, so
		// spinning the disk up changes the *direction* of the slip under it, not the
		// force the floor's static friction has to hold (see holdable).
		if (w.st[i] === ST_SLEEP) continue;
		// Ice grips a heavier puck less (loadFactor): its own mass sets both coefficients.
		const load = w.m[i] === cfg.puckM ? boardLoad : loadFactor(cfg, w.m[i]), holdG = muSg * load;
		const a = diskOverlap(w, i, _ov);
		if (w.st[i] === ST_LOCKED) {
			// Ride ends when the puck slides past the rim or beyond the hold radius.
			if (a >= 0.98 && w.omegaCur * w.omegaCur * _ov.d <= holdG) {
				if (w.omegaCur === 0) { w.st[i] = ST_SLEEP; w.vx[i] = 0; w.vy[i] = 0; w.om[i] = 0; continue; }
				w.om[i] = w.omegaCur; // riding = co-rotating in both senses
				surfVelAt(w, w.x[i], w.y[i], _sv); w.vx[i] = _sv[0]; w.vy[i] = _sv[1];
				continue;
			}
			w.st[i] = ST_SLIDE; // freed: it keeps its spin, now on its own
		}
		// Coulomb friction over the whole puck at once: a cell under the disk rubs against
		// the disk's surface, the rest against the still floor, and the ones the disk
		// covers are what give a partially-intersected puck its rotation.
		const r = w.r[i], x = w.x[i], y = w.y[i], vx0 = w.vx[i], vy0 = w.vy[i], om0 = w.om[i];
		const cell = muKg * load * h / FR_N; // per unit mass, per sample
		let fx = 0, fy = 0, tq = 0;
		for (let k = 0; k < FR_RINGS; k++) {
			const rad = FR_RAD[k] * r;
			for (let j = 0; j < FR_RAYS; j++) {
				const rx = rad * FR_COS[j], ry = rad * FR_SIN[j];
				let sx = 0, sy = 0;
				const ex = x + rx - dcx, ey = y + ry - dcy;
				if (ex * ex + ey * ey <= R * R) { sx = -w.omegaCur * ey; sy = w.omegaCur * ex; }
				const ux = vx0 - om0 * ry - sx, uy = vy0 + om0 * rx - sy;
				const rr = Math.sqrt(ux * ux + uy * uy);
				if (rr <= 1e-9) continue;
				const gx = -cell * ux / rr, gy = -cell * uy / rr;
				fx += gx; fy += gy; tq += rx * gy - ry * gx;
			}
		}
		w.vx[i] = vx0 + fx; w.vy[i] = vy0 + fy;
		w.om[i] = om0 + tq * (2 / (r * r)); // Δω = τ/I, I = ½mr²
		const om = w.om[i];
		// Lock: fully covered, no slide at the centre, held by μs. Locking snaps the
		// velocity onto the surface, so it snaps the spin onto ω_disk as well — the
		// spin ramp only decides how a puck behaves *before* it is captured, and a
		// spin gate here would just delay the capture past the drift that locking is
		// supposed to stop (measured: the whole lock band collapses).
		surfVelAt(w, x, y, _sv);
		const rvx = w.vx[i] - _sv[0], rvy = w.vy[i] - _sv[1];
		const rv = Math.sqrt(rvx * rvx + rvy * rvy);
		if (a >= 0.999 && rv <= cfg.epsLock && w.omegaCur * w.omegaCur * _ov.d <= holdG) {
			w.st[i] = ST_LOCKED; w.vx[i] = _sv[0]; w.vy[i] = _sv[1]; w.om[i] = w.omegaCur;
			continue;
		}
		// eps-snap: friction alone would jitter around zero forever. A puck that has
		// stopped is at rest in the world, so on bare ice that is the whole test. Over
		// the disk it is at rest only while the floor's static friction can still hold
		// the disk's drive (see holdable); a puck the disk is dragging must not freeze,
		// or a partial overlap would end the round with the disk still pulling it.
		if (Math.sqrt(w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i]) <= cfg.epsSleep && Math.abs(om) <= cfg.epsSpin
			&& (a <= 0 || holdable(cfg, a, _ov))) {
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
		for (let k = 0; k < BLACK_HOLES.length; k++) {
			const tau = holeEntryTime(w, i, BLACK_HOLES[k], rem);
			if (tau >= 0) considerHole(i, k, tau, rem);
		}
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
	if (_evKind === 3) {
		const owner = w.own[i];
		if (owner < w.ownerLosses.length) w.ownerLosses[owner]++;
		swapRemovePuck(w, i);
		return;
	}
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
	absorbBlackHoles(w);
}
function isSettled(w) {
	for (let i = 0; i < w.n; i++) if (w.st[i] === ST_SLIDE) return false;
	return true;
}
function absorbBlackHoles(w) {
	for (let i = w.n - 1; i >= 0; i--) {
		let captured = false;
		for (let k = 0; k < BLACK_HOLES.length; k++) {
			const hole = BLACK_HOLES[k], dx = w.x[i] - hole.x, dy = w.y[i] - hole.y;
			const r = hole.r + w.r[i];
			if (dx * dx + dy * dy <= r * r) { captured = true; break; }
		}
		if (!captured) continue;
		const owner = w.own[i];
		if (owner < w.ownerLosses.length) w.ownerLosses[owner]++;
		swapRemovePuck(w, i);
	}
}
function beginSettle(w) { if (!w.settling) { w.settling = true; w.settleT = 0; } }
if (typeof module !== 'undefined') module.exports = { createWorld, resetWorld, spawnPuck, throwPuck, stepWorld, isSettled, beginSettle, diskOverlap, surfVelAt, holdable, swapRemovePuck, absorbBlackHoles, FR_RINGS, FR_RAYS, FR_N, FR_RAD, FR_COS, FR_SIN };
