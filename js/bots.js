// Throw-selection bots. Node-safe, used headless (experiments/compete.js) and by
// the in-browser auto-player. All randomness goes through a seeded xorshift32 so
// competitions are reproducible. Results come back via the shared botOut object.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), require('./physics.js'), require('./predict.js'));

const HUNTER_SAMPLES = 16;

function makeRng(seed) {
	let s = (seed >>> 0) || 0x9e3779b9;
	return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
const botOut = { vx: 0, vy: 0 };

// random: flings at the disk with a wide angle/speed spread — baseline.
function botRandom(w, cfg, i, pred, rng) {
	const ang = Math.atan2(cfg.diskY - w.y[i], cfg.diskX - w.x[i]) + (rng() - 0.5) * 2.4;
	const sp = cfg.vMin + rng() * (cfg.vMax - cfg.vMin);
	botOut.vx = Math.cos(ang) * sp; botOut.vy = Math.sin(ang) * sp;
	return botOut;
}
// keeper: physics heuristic with no simulation — brake to a stop on the hot core.
function botKeeper(w, cfg, i, pred, rng) {
	const src = FIELD_SOURCES[1]; // the +0.85 red lobe, rotating with the disk
	const c = Math.cos(w.theta), s = Math.sin(w.theta);
	const tx = cfg.diskX + c * src.x - s * src.y + (rng() - 0.5) * 0.06;
	const ty = cfg.diskY + s * src.x + c * src.y + (rng() - 0.5) * 0.06;
	const dx = tx - w.x[i], dy = ty - w.y[i];
	const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
	// v^2 = 2*muK*g*stopDist -> arrive at the target with ~no speed
	const sp = Math.max(cfg.vMin, Math.min(cfg.vMax, Math.sqrt(2 * cfg.muK * cfg.g * d) * 1.05));
	botOut.vx = dx / d * sp; botOut.vy = dy / d * sp;
	return botOut;
}
// hunter: sample candidate strokes, simulate each to rest, keep the best dScore.
function botHunter(w, cfg, i, pred, rng) {
	const base = Math.atan2(cfg.diskY - w.y[i], cfg.diskX - w.x[i]);
	let best = -Infinity;
	for (let k = 0; k < HUNTER_SAMPLES; k++) {
		const ang = base + (rng() - 0.5) * 1.3;
		const sp = cfg.vMin + ((k + rng()) / HUNTER_SAMPLES) * (cfg.vMax - cfg.vMin);
		const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
		predictStroke(pred, w, i, vx, vy, cfg.maxResolve);
		const ev = pred.dScore + (pred.locked ? 0.05 : 0);
		if (ev > best) { best = ev; botOut.vx = vx; botOut.vy = vy; }
	}
	return botOut;
}
function chooseStroke(name, w, cfg, i, pred, rng) {
	if (name === 'random') return botRandom(w, cfg, i, pred, rng);
	if (name === 'keeper') return botKeeper(w, cfg, i, pred, rng);
	return botHunter(w, cfg, i, pred, rng);
}

if (typeof module !== 'undefined') module.exports = { makeRng, chooseStroke, botOut, HUNTER_SAMPLES };
