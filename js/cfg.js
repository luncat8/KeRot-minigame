// Tuning table and board geometry. Node-safe: no DOM access.
const CFG = {
	g: 9.81,
	boardW: 3.60, boardH: 2.20,
	diskX: 1.10, diskY: 1.10, diskR: 0.80,
	puckR: 0.10, puckM: 4.0,
	launchX: 3.25, launchY: 1.10, launchMinX: 3.05, launchMaxX: 3.45, launchMinY: 0.95, launchMaxY: 1.25,
	muK: 0.030, muS: 0.045,
	omega: 0.7831, // sqrt(muS*g/(0.9*diskR)), re-solved by autoOmega()
	vMax: 1.40,
	eWall: 0.35, wallTanKeep: 0.85,
	ePuck: 0.65,
	h: 1 / 480,
	epsLock: 0.010, epsSleep: 0.004, epsV: 1e-4,
	slop: 1e-6,
	maxSubsteps: 8,
	maxResolve: 8,
	pucksPerGame: 8,
	settleTime: 3,
	dragFull: 0.90,
	endMode: 'settle',
};
// Field sources in disk-local meters (see field.js). BIAS cools the whole plane.
const FIELD_SOURCES = [
	{ x: 0.00, y: 0.00, w: 1.25, sigma: 0.256 },
	{ x: 0.36, y: 0.00, w: 0.85, sigma: 0.240 },
	{ x: -0.36, y: 0.36, w: -0.85, sigma: 0.240 },
	{ x: -0.36, y: -0.36, w: -0.85, sigma: 0.240 },
];
const FIELD_BIAS = -0.30;
const MAX_PUCKS = 32;
const ST_SLIDE = 0, ST_LOCKED = 1, ST_SLEEP = 2;

function holdRadius(cfg) { return cfg.omega > 0 ? cfg.muS * cfg.g / (cfg.omega * cfg.omega) : Infinity; }
function autoOmega(cfg) { return Math.sqrt(cfg.muS * cfg.g / (0.9 * cfg.diskR)); }

if (typeof module !== 'undefined') module.exports = { CFG, FIELD_SOURCES, FIELD_BIAS, MAX_PUCKS, ST_SLIDE, ST_LOCKED, ST_SLEEP, holdRadius, autoOmega };
