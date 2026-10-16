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

// --- How a bot plays its speed vote -------------------------------------------------
// chooseVote weighs a speed by what the board pays for it; a strategy tilts that
// weighing, so a table of bots can be set to *play* the disk instead of only tolerating
// it. `own` and `enemy` scale what a rider is worth to the voter — kept or shed;
// `room` scales how much the throws before the next vote matter at all; `next` prices
// the one throw that follows the vote by who makes it (room for my own, none for the
// seat I am trying to beat), which is the tempo play: slow before a push, fast to
// answer one. `move` is how much a change must be worth before the bot asks for one,
// and `none` is a seat that never touches the speed at all.
const SPEED_STRATS = {
	auto: { label: 'read its own board', own: 1, enemy: 1, room: 1, next: 0, move: 1 },
	park: { label: 'park — keep the disk slow', own: 1.7, enemy: 0.5, room: 1.5, next: 0.4, move: 1.2 },
	shake: { label: 'shake — shed their riders', own: 0.8, enemy: 2, room: 0.7, next: 0.8, move: 0.8 },
	tempo: { label: 'tempo — swing with the order', own: 0.4, enemy: 0.4, room: 0.8, next: 1.8, move: 0.4 },
	still: { label: 'never touch the speed', none: true },
};
function speedStrat(cfg, name) {
	const key = (typeof name === 'string' ? name : cfg.botSpeed) || 'auto';
	return SPEED_STRATS[key] || SPEED_STRATS.auto;
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

// The old ramp may still be running while the vote window is open. Price a new
// request from the speed it will actually have when the vote closes, not its old
// setpoint or the speed at which the bot happened to cast its vote.
function voteStartSpeed(w, cfg) {
	if (w.rampDur <= 0) return w.omegaCur;
	const t = Math.min(w.rampDur, w.rampT + cfg.voteT);
	return w.rampFrom + (w.rampTo - w.rampFrom) * (t / w.rampDur);
}
function voteExistingReach(w, cfg) {
	if (w.rampDur <= 0) return Infinity;
	const top = Math.max(spinNow(w), voteStartSpeed(w, cfg));
	const alpha = (w.rampTo - w.rampFrom) / w.rampDur;
	return muSEff(cfg) * cfg.g / Math.hypot(top * top, alpha);
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
// A speed-up is not a free attack: a red-scoring rider belongs in that same balance,
// and is charged at its score rate if the candidate ramp sheds it. In 'turn' mode the
// next throw is a targeted contest; 'round' mode compares one own throw with the mean
// enemy throw, so the bot does not treat every opponent as a separate room to deny.
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
let _speeds = new Float64Array(256), _worth = new Float64Array(256), _currentK = 0;

// The riders on the disk: how far out each rides, and what it pays seat s — an own
// rider by its rate and the strategy's care for it, an enemy's by what taking it away
// is worth. A rider outside the reach of the *older* ramp is already gone before this
// vote closes, so it is not priced either way.
function gatherRiders(w, cfg, s, p, st) {
	const existingReach = voteExistingReach(w, cfg);
	let n = 0;
	for (let i = 0; i < w.n; i++) {
		if (w.st[i] !== ST_LOCKED) continue;
		const dx = w.x[i] - cfg.diskX, dy = w.y[i] - cfg.diskY, d = Math.hypot(dx, dy);
		if (d > existingReach) continue;
		const pay = puckRate(w, i) * (w.own[i] === s ? p.opportunity * (st ? st.own : 1) : -p.denial * (st ? st.enemy : 1));
		if (pay === 0) continue;
		_riderD[n] = d;
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
function throwWeight(cfg, s, roster, next, p, st) {
	const share = p.denial / Math.max(1, roster.length - 1);
	let sum = 0;
	for (let j = 0; j < roster.length; j++) {
		if (cfg.speedVote === 'turn' ? j !== next : roster[j].balls <= 0) continue;
		sum += j === s ? p.opportunity : -share;
	}
	if (st && st.next !== 0 && next >= 0) sum += (next === s ? 1 : -1) * st.next * (p.opportunity + p.denial) * 0.5;
	return st ? sum * st.room : sum;
}
// Speed ω as a red rate for the bot: the riders kept on the ramp from `omFrom`,
// plus the room the coming throws can park on. Existing pucks are judged against the
// actual ramp start; candidate exact votes include both endpoints and the current
// setting, even when the interval does not divide evenly into VOTE_STEP_EXACT.
function speedWorth(cfg, om0, om, riders, throwW, omFrom) {
	const from = omFrom === undefined ? om0 : omFrom;
	const top = Math.max(from, om), alpha = (om - from) / cfg.spinRampT;
	const reach = muSEff(cfg) * cfg.g / Math.hypot(top * top, alpha);
	let v = throwW * VOTE_PARK * holdableRate(cfg, om);
	for (let k = 0; k < riders; k++) if (_riderD[k] <= reach) v += _riderPay[k];
	return v;
}
function fillVoteSpeeds(cfg, om0, exact, out) {
	if (!exact) {
		const step = VOTE_STEP_DELTA, lo = Math.max(0, om0 - cfg.voteDeltaMax), hi = Math.min(cfg.omegaMax, om0 + cfg.voteDeltaMax);
		const jLo = Math.ceil((lo - om0) / step - 1e-9), n = Math.floor((hi - om0) / step + 1e-9) - jLo + 1;
		if (_speeds.length < n) _speeds = new Float64Array(n);
		_currentK = -jLo;
		for (let k = 0; k < n; k++) { _speeds[k] = om0 + (jLo + k) * step; if (out) out[k] = _speeds[k]; }
		return n;
	}
	const intervals = Math.max(1, Math.ceil(cfg.omegaMax / VOTE_STEP_EXACT));
	const step = cfg.omegaMax / intervals;
	let n = intervals + 1, hasCurrent = false;
	for (let k = 0; k <= intervals; k++) {
		const speed = k === intervals ? cfg.omegaMax : k * step;
		if (Math.abs(speed - om0) < 1e-9) hasCurrent = true;
	}
	if (!hasCurrent) n++;
	if (_speeds.length < n) _speeds = new Float64Array(n);
	let at = 0;
	_currentK = -1;
	for (let k = 0; k <= intervals; k++) {
		let speed = k === intervals ? cfg.omegaMax : k * step;
		if (Math.abs(speed - om0) < 1e-9) { speed = om0; _currentK = at; }
		else if (speed > om0 && _currentK < 0) { _speeds[at] = om0; _currentK = at++; }
		_speeds[at++] = speed;
	}
	if (_currentK < 0) { _currentK = at; _speeds[at++] = om0; }
	if (out) for (let k = 0; k < at; k++) out[k] = _speeds[k];
	return at;
}
// Seat s's vote, `next` being the seat that throws after the vote, `strat` overriding
// CFG.botSpeed for a caller that wants to compare one (see js/vote.js SPEED_STRATS).
// Returns a scratch record { kind, value }, valid until the next call.
function chooseVote(name, w, cfg, s, roster, next, rng, strat) {
	const st = typeof strat === 'string' ? speedStrat(cfg, strat) : speedStrat(cfg);
	_vote.kind = VOTE_NONE; _vote.value = 0;
	if (st.none) return _vote;
	const p = BOT_PROFILES[name] || BOT_PROFILES.balanced, om0 = cfg.omega, exact = cfg.voteMode === 'exact';
	const riders = gatherRiders(w, cfg, s, p, st), throwW = throwWeight(cfg, s, roster, next, p, st);
	const omFrom = voteStartSpeed(w, cfg), n = fillVoteSpeeds(cfg, om0, exact);
	if (_worth.length < n) _worth = new Float64Array(n);
	let vMin = Infinity, vMax = -Infinity;
	for (let k = 0; k < n; k++) {
		const v = speedWorth(cfg, om0, _speeds[k], riders, throwW, omFrom);
		_worth[k] = v; vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
	}
	const r0 = Math.PI * cfg.puckR * cfg.puckR * diskMeanRed(cfg), flat = VOTE_FLAT * r0; // r0: the mean parked rate
	if (vMax - vMin <= flat) return _vote;
	// The pick carries the noise coin, scaled like chooseStroke's; the plateau does not.
	let kBest = 0, best = -Infinity;
	for (let k = 0; k < n; k++) {
		let v = _worth[k] - VOTE_MOVE * st.move * r0 * Math.abs(_speeds[k] - om0);
		if (p.noise > 0) v += (rng() - 0.5) * p.noise * r0;
		if (v > best) { best = v; kBest = k; }
	}
	let kL = kBest, kR = kBest;
	while (kL > 0 && _worth[kL - 1] >= _worth[kBest] - flat) kL--;
	while (kR < n - 1 && _worth[kR + 1] >= _worth[kBest] - flat) kR++;
	if (_currentK >= kL && _currentK <= kR) { _vote.kind = VOTE_KEEP; return _vote; }
	const target = exact ? 0.5 * (_speeds[kL] + _speeds[kR]) : _speeds[(kL + kR) >> 1];
	_vote.kind = VOTE_SET;
	_vote.value = exact ? target : target - om0;
	return _vote;
}

if (typeof module !== 'undefined') module.exports = { clampVote, voteLabel, setVote, clearVotes, tallySpeed, tallyDue, holdProfile, holdableRate, voteStartSpeed, gatherRiders, speedWorth, fillVoteSpeeds, chooseVote, speedStrat, SPEED_STRATS };
