// Tuning table and board geometry. Node-safe: no DOM access.
const CFG = {
	g: 9.81,
	boardW: 3.60, boardH: 2.20,
	diskX: 1.10, diskY: 1.10, diskR: 0.80,
	puckR: 0.10,
	// puckM is the mass slider; it applies to every puck on the board. The μ sliders are
	// the coefficients of a massRef puck, and ice grips a heavier one less (loadFactor).
	puckM: 4.0, massRef: 4.0, massMin: 0.5, massMax: 20,
	launchX: 3.25, launchY: 1.10, launchMinX: 3.05, launchMaxX: 3.45, launchMinY: 0.95, launchMaxY: 1.25,
	muK: 0.030, muS: 0.045,
	muEdge: 0.10, // puck-puck contact friction (edge rub -> spin exchange)
	omega: 0.7831, // sqrt(muS*g/(0.9*diskR)), re-solved by autoOmega()
	omegaMax: 4.000,
	vMin: 0.00, vMax: 3.00, // stroke speed range; drag maps 0..dragFull onto vMin..vMax
	// The slowest stroke that still moves the puck. An aim can hold vMin (the grab
	// ring's zero, and a bot's coarse grid bottoms out there too), but a throw that
	// cannot cross the ice is no throw: it sleeps on the launch spot in a step, the
	// turn hands over at once, and the return rule reclaims the puck from the launch
	// lane without it ever moving — the seat appeared to skip its move. Aims below
	// this throw at it; the bots never pick below it (js/bots.js consider).
	vThrowMin: 0.30,
	eWall: 0.35, wallTanKeep: 0.85,
	ePuck: 0.65,
	h: 1 / 480,
	epsLock: 0.010, epsSleep: 0.004, epsSpin: 0.050, epsV: 1e-4,
	spinDrag: 4 / 3, // spinning friction: ω̇ = spinDrag*muK*g/r per unit covered area
	slop: 1e-6,
	maxSubsteps: 8,
	maxResolve: 8, // s; the furthest a prediction plays a turn out (bot follow-up, motion-mode horizon)
	handoffT: 4, // s; hand the turn over even if the board has not settled
	// How a thrown turn ends (radio group, turnLimit below): 'window' — at handoffT or
	// when the board settles, whichever is first; 'motion' — only when the board settles.
	// Settled means no puck slides: a locked rider moves with the disk, not over it.
	turnEnd: 'window',
	ballsPerPlayer: 4, // every seat throws this many pucks; the game is seats x balls throws
	maxPlayers: 8, // roster cap: seats x balls pucks can be on the board at once
	maxThrows: 96, // hard game cap: a board that keeps handing pucks back still ends
	scoreDisplayMax: 999, // scores are shown as 0..scoreDisplayMax per game
	recycleMode: 'advance', // 'none' | 'zones' | 'advance' (radio group)
	// The shapes of the return zone and the black holes (radio groups). They are rules,
	// not skins: the drawn outline is the region the rule tests (js/rules.js, js/physics.js).
	// zoneStyle: 'hatch' | 'wavy' — the straight wedge; 'rounded' — an outline that
	// hugs the disk and the holes, no straight edge; 'arcs' — one curve around the disk,
	// the holes inside the zone; '3-rounded' — the wedge cut by bigger circles around
	// the disk and the holes, outlined by those three circles alone; '6-hemi' — one
	// circular outline around the disk, the holes inside. holeStyle: 'classic' | 'rim'
	// | 'well' — the round void, drawn three ways; 'triangle' — a triangular void.
	zoneStyle: 'hatch', holeStyle: 'classic', swapZones: false,
	zoneCutGap: 0.06, zoneReach: 1, customGeometry: false, scoreScale: 1, // scoreScale: score-map size relative to diskR (1 = 100%)
	diskSchema: 'classic', // disk paint = score map, a key of DISK_SCHEMAS (js/field.js)
	// Speed rule (radio groups, js/vote.js): who sets ω during a game. 'off' — the panel
	// slider alone; 'turn' — the seats vote before every turn; 'round' — before every
	// round. A vote is a change of up to ±voteDeltaMax ('delta') or an exact speed
	// ('exact'). It closes voteT after the turn timer, and the disk then runs to the
	// average of the votes cast over spinRampT.
	speedVote: 'round', voteMode: 'delta',
	voteT: 1, voteDeltaMax: 0.50, spinRampT: 1,
	// How a bot plays its speed vote, on top of its profile (the table is in js/vote.js):
	// 'auto' is the plain board economics, the named ones push it one way.
	botSpeed: 'auto',
	// Time-warp (js/warp.js): a bot plays its turn out in a copy of the game before the
	// real board commits to it, takes it back when the result is not good enough and
	// tries the next candidate. warpTries caps the tries, warpTurns is how much of the
	// game one try plays out (0 = to the end of it), warpGoal is the lead over the
	// position it started from — in ball annuities — that ends the search early, and
	// warpFrameMs budgets each slice; an atomic reply search may exceed that budget.
	warp: false, warpTries: 6, warpTurns: 3, warpGoal: 0.5, warpFrameMs: 8,
	botDelay: 0.7, // seconds a bot "thinks" (aim shown) before throwing
	// The end of a game is a brake, not a stop: the motor runs the disk from its speed to
	// 0 over this long (beginSettle), so the board you just built comes to rest in front
	// of you instead of freezing. 4 s at the default ω is a gentle final turn.
	settleTime: 4,
	dragFull: 0.90,
	aimGrabMargin: 0.22, // radius beyond the puck where power starts building
	preciseGain: 0.03125, // shift-held speed gain: 1/32 of plain
	preciseAimGain: 0.125, // shift-held aim gain: 1/8 of plain
	endMode: 'settle',
};
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
// Return zone (recycleMode 'zones'): the eject fan — the triangle from the disk
// centre to the two far board corners, minus the disk itself. Everything the disk
// flings back to the thrower's side is a spent throw and returns to the pool;
// pucks that stay on the cold side (or jam near the rim) keep their score.
const RETURN_ZONES = {
	ax: CFG.diskX, ay: CFG.diskY, // apex = disk centre
	bx: CFG.boardW, by: 0, // far corners
	cx: CFG.boardW, cy: CFG.boardH,
};
// The other rule (recycleMode 'advance'): the wedge the disk stands in front of —
// apex at the disk centre, base on the left wall — plus the launch lane, the full-
// height strip the puck is thrown from. Both are ground a puck has to leave: behind
// the disk it never got into play, in the lane it never left home. The wedge is the
// mirror of the fan, and the disk itself is exempt in either rule (see onDisk).
const ADVANCE_ZONES = {
	ax: 0, ay: CFG.boardH, // wound so every edge test of an inside point is ≥ 0
	bx: 0, by: 0,
	cx: CFG.diskX, cy: CFG.diskY,
	lx: CFG.launchMinX, lw: CFG.boardW - CFG.launchMinX, // launch lane, floor to ceiling
};
// Semicircular capture zones along the left map edge, above and below the disk.
// A puck is absorbed when its centre enters BLACK_HOLES[k].r + puckR.
const BLACK_HOLES = [
	{ x: 0.48, y: 0, r: 0.18 },
	{ x: 0.48, y: CFG.boardH, r: 0.18 },
];
Object.assign(CFG, { returnZone: RETURN_ZONES, advanceZone: ADVANCE_ZONES, holes: BLACK_HOLES });
const MAX_PUCKS = 40;
const ST_SLIDE = 0, ST_LOCKED = 1, ST_SLEEP = 2;

// Ice friction falls with load. With a Hertzian real contact area A ∝ N^(2/3) and a
// constant interfacial shear strength τ, μ = τA/N ∝ N^(−1/3), for static and kinetic
// friction alike. This is the only way mass reaches a lone puck: under load-independent
// Coulomb friction the deceleration μ·m·g/m and the hold limit ω²d ≤ μs·g cancel it.
function loadFactor(cfg, m) { return Math.cbrt(cfg.massRef / m); }
// The slider mass applies to every puck, so these describe the whole board.
function muKEff(cfg) { return cfg.muK * loadFactor(cfg, cfg.puckM); }
function muSEff(cfg) { return cfg.muS * loadFactor(cfg, cfg.puckM); }
function holdRadius(cfg) { return cfg.omega > 0 ? muSEff(cfg) * cfg.g / (cfg.omega * cfg.omega) : Infinity; }
function autoOmega(cfg) { return Math.sqrt(muSEff(cfg) * cfg.g / (0.9 * cfg.diskR)); }
// The radius a pointer has to clear around the armed puck before it aims the stroke:
// the puck plus its margin.
function aimGrab(cfg) { return cfg.puckR + cfg.aimGrabMargin; }
function stopDistance(cfg, v) { return v * v / (2 * muKEff(cfg) * cfg.g); } // on bare ice

// --- Turn end: the one rule the game, the predictors, the bots and warp copies share ---
// Motion-ended turns need friction: without it nothing ever settles.
function motionTurns(cfg) { return cfg.turnEnd === 'motion' && cfg.muK > 0; }
// The slowest the fastest thing on the board can come to rest on bare ice: a full stroke,
// or a puck flung at the rim speed of the disk.
function slideTime(cfg) {
	return Math.max(cfg.vMax, Math.abs(cfg.omega) * (cfg.diskR + cfg.puckR)) / (muKEff(cfg) * cfg.g);
}
// The emergency watchdog of a motion-ended turn. A free slide stops within slideTime, and
// walls only take energy out; a rim straddler that the motor drags adds seconds that do
// not shrink with friction, hence the fixed base. Measured play stays under half of it at
// every friction (experiments/motion-turns.js), and it is the same wherever a turn is run.
const TURN_WATCHDOG_BASE = 8, TURN_WATCHDOG_SLIDES = 3; // s, × slideTime
// The longest a thrown turn can last: handoffT, or the watchdog in motion mode. The turn
// hands over at isSettled(w) || resolveT >= turnLimit(cfg).
function turnLimit(cfg) {
	return motionTurns(cfg) ? TURN_WATCHDOG_BASE + TURN_WATCHDOG_SLIDES * slideTime(cfg) : cfg.handoffT;
}
// The nominal length of a turn: the score display's reference and the bots' measure of
// what later turns pay. The fixed window is handoffT. A motion-ended turn lasts as long as
// its board slides — most throws lock or stop within seconds, a few run long — and its
// measured mean grows with the log of slideTime (fit in experiments/motion-turns.js).
const MOTION_SPAN_S = 2.06, MOTION_SPAN_K = 1.54;
function turnSpan(cfg) { return motionTurns(cfg) ? MOTION_SPAN_S + MOTION_SPAN_K * Math.log(slideTime(cfg)) : cfg.handoffT; }
// What the turns still to come pay a puck parked now: ~0.9 of a span each (many close on
// settle) plus ~2 s of the end-of-game spin-down.
function futurePay(cfg, turns) { return 2 + 0.9 * turnSpan(cfg) * turns; }

// Explicit board geometry is shared by presets and the optional editor.
const GEOMETRY_KEYS = ['boardW', 'boardH', 'diskX', 'diskY', 'diskR', 'puckR',
	'launchX', 'launchY', 'launchMinX', 'launchMaxX', 'launchMinY', 'launchMaxY', 'zoneCutGap', 'zoneReach'];
function boardGeometry(cfg) {
	const out = {};
	for (const key of GEOMETRY_KEYS) out[key] = cfg[key];
	out.holes = cfg.holes.map(h => ({ x: h.x, y: h.y, r: h.r }));
	return out;
}
function validBoardGeometry(b) {
	if (!b || !GEOMETRY_KEYS.every(k => typeof b[k] === 'number' && Number.isFinite(b[k]))) return false;
	const { boardW: W, boardH: H, diskX: x, diskY: y, diskR: R, puckR: r } = b;
	if (W < 2 || W > 20 || H < 1 || H > 20 || r < 0.02 || r > 0.25 || R < 2 * r || R < 0.15) return false;
	if (x < R || x > W - R || y < R || y > H - R) return false;
	if (b.zoneCutGap < 0 || b.zoneCutGap > 0.5 || b.zoneReach < 0.1 || b.zoneReach > 1) return false;
	if (b.launchMinX < x + R + 2 * r || b.launchMaxX > W - r || b.launchMaxX - b.launchMinX < 2 * r - 1e-9) return false;
	if (b.launchMinY < r || b.launchMaxY > H - r || b.launchMaxY - b.launchMinY < 2 * r - 1e-9) return false;
	if (b.launchX < b.launchMinX || b.launchX > b.launchMaxX || b.launchY < b.launchMinY || b.launchY > b.launchMaxY) return false;
	if (!Array.isArray(b.holes) || b.holes.length !== 2) return false;
	const triangleScale = Math.sqrt(Math.PI / 2 * Math.max(y / x, x / y));
	const reach = h => h.r * Math.max(1, triangleScale);
	for (const h of b.holes) {
		if (!h || !['x', 'y', 'r'].every(k => typeof h[k] === 'number' && Number.isFinite(h[k]))) return false;
		if (h.r < 0.02 || h.r > 0.6 || h.x < 0 || h.x > W || h.y < 0 || h.y > H) return false;
		if (Math.hypot(h.x - x, h.y - y) < R + reach(h) + r) return false;
		const dx = Math.max(b.launchMinX - h.x, 0, h.x - b.launchMaxX), dy = Math.max(b.launchMinY - h.y, 0, h.y - b.launchMaxY);
		if (Math.hypot(dx, dy) < reach(h) + r) return false;
	}
	return Math.hypot(b.holes[0].x - b.holes[1].x, b.holes[0].y - b.holes[1].y) >= reach(b.holes[0]) + reach(b.holes[1]) + 2 * r;
}
function rebuildZones(cfg) {
	const x = cfg.diskX, y = cfg.diskY, W = cfg.boardW, H = cfg.boardH, t = cfg.zoneReach;
	cfg.returnZone = { ax: x, ay: y, bx: x + (W - x) * t, by: y * (1 - t), cx: x + (W - x) * t, cy: y + (H - y) * t };
	cfg.advanceZone = { ax: x * (1 - t), ay: y + (H - y) * t, bx: x * (1 - t), by: y * (1 - t), cx: x, cy: y,
		lx: cfg.launchMinX, lw: W - cfg.launchMinX };
}
function applyBoardGeometry(cfg, geometry) {
	if (!validBoardGeometry(geometry)) return false;
	for (const key of GEOMETRY_KEYS) cfg[key] = geometry[key];
	cfg.holes = geometry.holes.map(h => ({ x: h.x, y: h.y, r: h.r }));
	cfg.customGeometry = true;
	rebuildZones(cfg);
	return true;
}
const DEFAULT_BOARD_GEOMETRY = boardGeometry(CFG);
function resetBoardGeometry(cfg) {
	applyBoardGeometry(cfg, DEFAULT_BOARD_GEOMETRY);
	cfg.customGeometry = false;
}
if (typeof module !== 'undefined') module.exports = { GEOMETRY_KEYS, boardGeometry, validBoardGeometry, applyBoardGeometry, rebuildZones, resetBoardGeometry, CFG, aimGrab, RETURN_ZONES, ADVANCE_ZONES, BLACK_HOLES, MAX_PUCKS, ST_SLIDE, ST_LOCKED, ST_SLEEP, loadFactor, muKEff, muSEff, holdRadius, autoOmega, stopDistance, motionTurns, slideTime, turnLimit, turnSpan, futurePay, clamp };
