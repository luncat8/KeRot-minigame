// Speed votes. With a speed rule on (CFG.speedVote), the seats set the disk speed
// during a game. Every seat holds one vote: don't care (it abstains), keep the current
// speed, or a value — a change (+/−) or an exact speed, by CFG.voteMode. The vote
// closes between two turns (js/game.js), and the average of the votes cast is the new
// speed. Bots vote for the speed their riders and the coming throws are worth most at
// (chooseVote). Node-safe.
if (typeof module !== 'undefined') Object.assign(globalThis,
	require('./cfg.js'), require('./physics.js'), require('./score.js'), require('./players.js'), require('./bots.js'));

function clampVote(cfg, v) {
	return cfg.voteMode === 'exact' ? clamp(v, 0, cfg.omegaMax) : clamp(v, -cfg.voteDeltaMax, cfg.voteDeltaMax);
}
// "+.10" / "−.25" (a change), "1.20" (an exact speed), "=" (keep), "" (don't care).
function voteLabel(cfg, kind, value) {
	if (kind === VOTE_NONE) return '';
	if (kind === VOTE_KEEP) return '=';
	if (cfg.voteMode === 'exact') return value.toFixed(2);
	const t = Math.abs(value).toFixed(2);
	return (value < 0 ? '−' : '+') + (t[0] === '0' ? t.slice(1) : t);
}
// The label is made here, once per change: the HUD draws it every frame.
function setVote(cfg, seat, kind, value) {
	seat.vote = kind;
	seat.voteValue = kind === VOTE_SET ? clampVote(cfg, value) : 0;
	seat.voteLabel = voteLabel(cfg, kind, seat.voteValue);
}
function clearVotes(cfg, roster) { for (let i = 0; i < roster.length; i++) setVote(cfg, roster[i], VOTE_NONE, 0); }
// The average of the votes cast — "keep" counts as a change of 0, or as the current
// speed — and with no vote cast the speed stays.
function tallySpeed(cfg, roster, omega) {
	const exact = cfg.voteMode === 'exact';
	let sum = 0, n = 0;
	for (let i = 0; i < roster.length; i++) {
		const s = roster[i];
		if (s.vote === VOTE_NONE) continue;
		n++;
		if (s.vote === VOTE_SET) sum += s.voteValue;
		else if (exact) sum += omega;
	}
	if (n === 0) return omega;
	return clamp(exact ? sum / n : omega + sum / n, 0, cfg.omegaMax);
}
// Is the speed voted on before seat `next` throws, `prev` having thrown last? 'turn':
// always. 'round': when the order wraps, so the first seat still playing is up again
// (a lone seat starts a new round every turn).
function tallyDue(cfg, prev, next) {
	return cfg.speedVote === 'turn' || (cfg.speedVote === 'round' && next <= prev);
}

// --- What a throw can park on ---------------------------------------------------
// The room a speed leaves a throw: the disk's red rate averaged over every spot a
// whole puck can sit on, counting the spots outside the hold radius as nothing. A
// faster disk holds less, so its throws have less to land on. The profile is that
// average accumulated outwards, ring by ring of puckRate over all angles — baked once
// per disk schema.
const HOLD_BIN = 0.01, HOLD_RAYS = 72; // m, directions
const _hold = {};
function holdProfile(cfg) {
	if (_hold[cfg.diskSchema]) return _hold[cfg.diskSchema];
	const w = createWorld(cfg), i = spawnPuck(w, cfg.diskX, cfg.diskY, 0), span = cfg.diskR - cfg.puckR;
	const out = new Float64Array(Math.floor(span / HOLD_BIN) + 1);
	let sum = 0;
	for (let k = 0; k < out.length; k++) {
		let ring = 0;
		for (let j = 0; j < HOLD_RAYS; j++) {
			const ph = 2 * Math.PI * j / HOLD_RAYS;
			w.x[i] = cfg.diskX + k * HOLD_BIN * Math.cos(ph); w.y[i] = cfg.diskY + k * HOLD_BIN * Math.sin(ph);
			ring += puckRate(w, i) / HOLD_RAYS;
		}
		sum += ring * (k === 0 ? Math.PI * HOLD_BIN * HOLD_BIN / 4 : 2 * Math.PI * k * HOLD_BIN * HOLD_BIN);
		out[k] = sum / (Math.PI * span * span);
	}
	return (_hold[cfg.diskSchema] = out);
}
function holdableRate(cfg, omega) {
	const prof = holdProfile(cfg);
	const dh = omega > 0 ? muSEff(cfg) * cfg.g / (omega * omega) : Infinity;
	return prof[Math.min(prof.length - 1, Math.floor(dh / HOLD_BIN))];
}

// --- Bot votes --------------------------------------------------------------------
// A bot weighs every speed it could ask for — the current one ± voteDeltaMax, or the
// whole range for an exact vote — by the two things a speed decides:
// - the riders: one survives the change if friction holds it through the ramp,
//   tangential acceleration included (js/physics.js). Each pays its red rate, for the
//   bot (own, × opportunity) or against it (an enemy's, × denial);
// - the throws before the next vote: a slower disk holds more of itself, so a throw
//   has more red to land on (holdableRate). Own throws want that; enemy throws are
//   denied it.
// A flat landscape is "don't care". Otherwise the bot picks the best speed — of equal
// ones the nearest, as a change also shakes everything it did not aim at — and takes
// the plateau of speeds about as good around it: if that includes the current speed
// it votes "keep", else it asks for the plateau's middle, which an average with the
// other votes is least likely to push off it.
const VOTE_STEP_DELTA = 0.01, VOTE_STEP_EXACT = 0.02; // rad/s between the speeds weighed
const VOTE_PARK = 0.5; // about every other throw parks: a capture is a prospect, a rider a fact
const VOTE_FLAT = 0.02; // × the mean parked rate: a smaller spread is no reason to vote
const VOTE_MOVE = 0.01; // × the mean parked rate per rad/s of change: the tie-break
const _vote = { kind: VOTE_NONE, value: 0 };
const _riderD = new Float64Array(MAX_PUCKS), _riderPay = new Float64Array(MAX_PUCKS);
let _worth = new Float64Array(256);

// The riders on the disk: how far out each rides, and what it pays seat s.
function gatherRiders(w, cfg, s, p) {
	let n = 0;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] !== ST_LOCKED) continue;
		const pay = puckRate(w, i) * (w.own[i] === s ? p.opportunity : -p.denial);
		if (pay === 0) continue;
		_riderD[n] = Math.hypot(w.x[i] - cfg.diskX, w.y[i] - cfg.diskY);
		_riderPay[n++] = pay;
	}
	return n;
}
// The throws before the next vote: 'turn' — only the next seat's; otherwise one by
// every seat still holding a ball. Room is the same for every thrower, so an enemy's
// throw counts against the mean enemy, not in full: a speed that gives every seat
// the same room moves no margin by itself, and what is left is the profile's lean —
// a keeper wants a disk that holds, a black hole one that holds nothing. Riders, like
// chooseStroke's knock-offs, are particular pucks and count in full.
function throwWeight(cfg, s, roster, next, p) {
	const share = p.denial / Math.max(1, roster.length - 1);
	let sum = 0;
	for (let j = 0; j < roster.length; j++) {
		if (cfg.speedVote === 'turn' ? j !== next : roster[j].balls <= 0) continue;
		sum += j === s ? p.opportunity : -share;
	}
	return sum;
}
// Speed ω as a red rate for the bot: the riders kept on the ramp from ω0, plus what
// the coming throws can park on.
function speedWorth(cfg, om0, om, riders, throwW) {
	const top = Math.max(om0, om), alpha = (om - om0) / cfg.spinRampT;
	const reach = muSEff(cfg) * cfg.g / Math.hypot(top * top, alpha);
	let v = throwW * VOTE_PARK * holdableRate(cfg, om);
	for (let k = 0; k < riders; k++) if (_riderD[k] <= reach) v += _riderPay[k];
	return v;
}
// Seat s's vote, `next` being the seat that throws after the vote. Returns a scratch
// record { kind, value }, valid until the next call.
function chooseVote(name, w, cfg, s, roster, next, rng) {
	const p = BOT_PROFILES[name] || BOT_PROFILES.balanced, om0 = cfg.omega, exact = cfg.voteMode === 'exact';
	const riders = gatherRiders(w, cfg, s, p), throwW = throwWeight(cfg, s, roster, next, p);
	// Candidates ω0 + j·step, so the current speed is always one of them (j = 0).
	const step = exact ? VOTE_STEP_EXACT : VOTE_STEP_DELTA;
	const lo = exact ? 0 : Math.max(0, om0 - cfg.voteDeltaMax), hi = exact ? cfg.omegaMax : Math.min(cfg.omegaMax, om0 + cfg.voteDeltaMax);
	const jLo = Math.ceil((lo - om0) / step - 1e-9), n = Math.floor((hi - om0) / step + 1e-9) - jLo + 1;
	if (_worth.length < n) _worth = new Float64Array(n);
	let vMin = Infinity, vMax = -Infinity;
	for (let k = 0; k < n; k++) {
		const v = speedWorth(cfg, om0, om0 + (jLo + k) * step, riders, throwW);
		_worth[k] = v; vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
	}
	_vote.kind = VOTE_NONE; _vote.value = 0;
	const r0 = Math.PI * cfg.puckR * cfg.puckR * diskMeanRed(cfg), flat = VOTE_FLAT * r0; // r0: the mean parked rate
	if (vMax - vMin <= flat) return _vote;
	// The pick carries the noise coin, scaled like chooseStroke's; the plateau does not.
	let kBest = 0, best = -Infinity;
	for (let k = 0; k < n; k++) {
		let v = _worth[k] - VOTE_MOVE * r0 * Math.abs(jLo + k) * step;
		if (p.noise > 0) v += (rng() - 0.5) * p.noise * r0;
		if (v > best) { best = v; kBest = k; }
	}
	let kL = kBest, kR = kBest;
	while (kL > 0 && _worth[kL - 1] >= _worth[kBest] - flat) kL--;
	while (kR < n - 1 && _worth[kR + 1] >= _worth[kBest] - flat) kR++;
	if (-jLo >= kL && -jLo <= kR) { _vote.kind = VOTE_KEEP; return _vote; }
	const j = jLo + ((kL + kR) >> 1);
	_vote.kind = VOTE_SET;
	_vote.value = exact ? om0 + j * step : j * step;
	return _vote;
}

if (typeof module !== 'undefined') module.exports = { clampVote, voteLabel, setVote, clearVotes, tallySpeed, tallyDue, holdProfile, holdableRate, speedWorth, chooseVote };
