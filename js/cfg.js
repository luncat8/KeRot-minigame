// Tuning table and board geometry. Node-safe: no DOM access.
const CFG = {
	g: 9.81,
	boardW: 3.60, boardH: 2.20,
	diskX: 1.10, diskY: 1.10, diskR: 0.80,
	puckR: 0.10, puckM: 4.0,
	launchX: 3.25, launchY: 1.10, launchMinX: 3.05, launchMaxX: 3.45, launchMinY: 0.95, launchMaxY: 1.25,
	muK: 0.030, muS: 0.045,
	muEdge: 0.10, // puck-puck contact friction (edge rub -> spin exchange)
	omega: 0.7831, // sqrt(muS*g/(0.9*diskR)), re-solved by autoOmega()
	omegaMax: 4.000,
	vMin: 0.00, vMax: 3.00, // stroke speed range; drag maps 0..dragFull onto vMin..vMax
	eWall: 0.35, wallTanKeep: 0.85,
	ePuck: 0.65,
	h: 1 / 480,
	epsLock: 0.010, epsSleep: 0.004, epsSpin: 0.050, epsV: 1e-4,
	spinDrag: 4 / 3, // spinning friction: ω̇ = spinDrag*muK*g/r per unit covered area
	slop: 1e-6,
	maxSubsteps: 8,
	maxResolve: 8, // s; ghost re-sim horizon
	handoffT: 4, // s; hand the turn over even if the board has not settled
	ballsPerPlayer: 4, // every seat throws this many pucks; the game is seats x balls throws
	maxPlayers: 8, // roster cap: seats x balls pucks can be on the board at once
	maxThrows: 96, // hard game cap: a board that keeps handing pucks back still ends
	scoreDisplayMax: 999, // scores are shown as 0..scoreDisplayMax per game
	recycleMode: 'zones', // 'none' | 'zones' | 'advance' (radio group)
	botDelay: 0.7, // seconds a bot "thinks" (aim shown) before throwing
	settleTime: 3,
	dragFull: 0.90,
	preciseGain: 0.25, // shift-held drag gain (precision mode)
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
// Field sources in disk-local meters (see field.js). BIAS cools the whole plane.
const FIELD_SOURCES = [
	{ x: 0.00, y: 0.00, w: 1.25, sigma: 0.256 },
	{ x: 0.36, y: 0.00, w: 0.85, sigma: 0.240 },
	{ x: -0.36, y: 0.36, w: -0.85, sigma: 0.240 },
	{ x: -0.36, y: -0.36, w: -0.85, sigma: 0.240 },
];
const FIELD_BIAS = -0.30;
// Semicircular capture zones along the left map edge, above and below the disk.
// A puck is absorbed when its centre enters BLACK_HOLES[k].r + puckR.
const BLACK_HOLES = [
	{ x: 0.48, y: 0, r: 0.18 },
	{ x: 0.48, y: CFG.boardH, r: 0.18 },
];
const MAX_PUCKS = 40;
const ST_SLIDE = 0, ST_LOCKED = 1, ST_SLEEP = 2;

function holdRadius(cfg) { return cfg.omega > 0 ? cfg.muS * cfg.g / (cfg.omega * cfg.omega) : Infinity; }
function autoOmega(cfg) { return Math.sqrt(cfg.muS * cfg.g / (0.9 * cfg.diskR)); }

if (typeof module !== 'undefined') module.exports = { CFG, RETURN_ZONES, ADVANCE_ZONES, FIELD_SOURCES, FIELD_BIAS, BLACK_HOLES, MAX_PUCKS, ST_SLIDE, ST_LOCKED, ST_SLEEP, holdRadius, autoOmega, clamp };
