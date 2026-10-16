// Named settings bundles and their URL parameter form. A panel preset applies a
// named bundle and starts a fresh board with it (unlike the live sliders, a preset
// is allowed to reset the game — that is what it is for). URL parameters are the
// same set read at boot, so a configured game is a shareable link:
//   index.html?preset=stones   index.html?schema=rim6&seats=human,hunter&mass=8
// A named `preset` parameter applies first, then the individual keys override it.
// Everything malformed is clamped or dropped, so a hand-typed link always opens.
// Node-safe: no DOM, no location — the caller passes the query string in.
if (typeof module !== 'undefined') Object.assign(globalThis,
	require('./cfg.js'), require('./field.js'), require('./players.js'), require('./vote.js'));

// The bundles. Keys match the setup object parseQuery returns (omega, muK, muS,
// puckM, schema, recycle, vote, voteMode, theme, seats, balls, autoOmega); a bundle sets only what
// it lists and leaves the rest alone, except `default`, which is complete on
// purpose — the way back from anywhere. `autoOmega` re-solves the 90 % rule after
// the bundle's μ and mass are in, so every mass preset keeps its own eject ring.
const PRESETS = {
	default: { label: 'classic default', muK: 0.030, muS: 0.045, puckM: 4, autoOmega: true, schema: 'classic', recycle: 'zones',
		vote: 'round', voteMode: 'delta', theme: 'classic', balls: 4, seats: ['human', 'balanced', 'blackhole', 'retriever'] },
	slick: { label: 'slick ice · long slides', muK: 0.012, muS: 0.030, puckM: 4, autoOmega: true },
	grippy: { label: 'grippy ice · short stops', muK: 0.080, muS: 0.120, puckM: 4, autoOmega: true },
	stones: { label: 'curling stones · 20 kg', puckM: 20, autoOmega: true },
	feathers: { label: 'featherweights · 0.5 kg', puckM: 0.5, autoOmega: true },
	// A plain omega leaves the rest of the physics wherever it was, so the grinder
	// pins the reference table its 1.356 rad/s was solved for (d_hold = 0.3 R).
	grinder: { label: 'meat grinder · eject at 0.3 R', muK: 0.030, muS: 0.045, puckM: 4, omega: 1.356 },
	rimtrap: { label: 'rim traps · 6 hemispheres', schema: 'rim6' },
	// Two tables built to show the two bot settings off: the same profiles, one set to
	// play the disk with its votes, one set to look ahead before it throws.
	speedplay: { label: 'speed play · park vs shake', vote: 'turn', botspeed: 'park' },
	foresight: { label: 'foresight · time-warp look-ahead', warp: 1, warpTries: 8, warpTurns: 3, warpGoal: 0.6 },
	solo: { label: 'practice · human alone', seats: ['human'], vote: 'off' }, // a vote of one is the slider
	bots: { label: 'bot league · all six profiles', seats: ['keeper', 'hunter', 'balanced', 'retriever', 'blackhole', 'random'] },
};
// The slider ranges of index.html; URL values are clamped to them.
const NUM_RANGES = { omega: [0, CFG.omegaMax], muK: [0.005, 0.3], muS: [0.03, 0.5], puckM: [CFG.massMin, CFG.massMax], balls: [1, 8],
	warpTries: [1, 16], warpTurns: [0, 6], warpGoal: [0, 3] };
const RECYCLES = ['none', 'zones', 'advance'];
const SPEED_RULES = ['off', 'turn', 'round'], VOTE_MODES = ['delta', 'exact']; // CFG.speedVote, CFG.voteMode

// The CFG-level share of a setup: numbers, disk schema, return rule, speed rule, balls. Called
// by the boot path before the first deal and by the panel preset. Theme, seats and
// the view toggles are not CFG — the caller applies those.
function applyCfg(setup) {
	// μ and mass first — autoOmega solves from them; an explicit omega goes last,
	// so `?preset=stones&omega=2` really means omega 2.
	for (const key of ['muK', 'muS', 'puckM']) {
		if (setup[key] === undefined) continue;
		const range = NUM_RANGES[key];
		CFG[key] = clamp(setup[key], range[0], range[1]);
	}
	CFG.muS = Math.max(CFG.muS, CFG.muK); // the panel's μs ≥ μk rule
	if (setup.autoOmega) CFG.omega = autoOmega(CFG);
	if (setup.omega !== undefined) CFG.omega = clamp(setup.omega, NUM_RANGES.omega[0], NUM_RANGES.omega[1]);
	if (setup.balls !== undefined) CFG.ballsPerPlayer = Math.round(clamp(setup.balls, NUM_RANGES.balls[0], NUM_RANGES.balls[1]));
	if (setup.schema && DISK_SCHEMAS[setup.schema]) CFG.diskSchema = setup.schema;
	if (RECYCLES.includes(setup.recycle)) CFG.recycleMode = setup.recycle;
	if (SPEED_RULES.includes(setup.vote)) CFG.speedVote = setup.vote;
	if (VOTE_MODES.includes(setup.voteMode)) CFG.voteMode = setup.voteMode;
	if (SPEED_STRATS[setup.botspeed]) CFG.botSpeed = setup.botspeed;
	if (setup.warp !== undefined) CFG.warp = !!setup.warp;
	if (setup.warpTries !== undefined) CFG.warpTries = Math.round(setup.warpTries);
	if (setup.warpTurns !== undefined) CFG.warpTurns = Math.round(setup.warpTurns);
	if (setup.warpGoal !== undefined) CFG.warpGoal = setup.warpGoal;
}

// Keys are folded to lower case once (a hand-typed ?muK=0.09 and ?muk=0.09 are the
// same), everything below reads the folded map.
function numKey(q, out, urlName, key) {
	if (q[urlName] === undefined) return false;
	const v = parseFloat(q[urlName]);
	if (!isFinite(v)) return false;
	const range = NUM_RANGES[key];
	out[key] = clamp(v, range[0], range[1]);
	return true;
}
// query string -> setup object; null when it holds nothing usable, so boot without
// parameters changes nothing at all. `preset` is expanded in place, individual keys
// override it; out.preset keeps the name for the select and the URL echo.
function parseQuery(search) {
	if (!search || search.length < 2) return null;
	const q = {};
	for (const entry of new URLSearchParams(search.charAt(0) === '?' ? search : '?' + search)) q[entry[0].toLowerCase()] = entry[1];
	const out = {};
	let found = false;
	const presetName = q.preset && q.preset.toLowerCase();
	const preset = PRESETS[presetName];
	if (preset) {
		Object.assign(out, preset);
		if (preset.seats) out.seats = preset.seats.slice(); // the bundle's array is not the caller's to mutate
		out.preset = presetName;
		found = true;
	}
	found = numKey(q, out, 'omega', 'omega') || found;
	found = numKey(q, out, 'muk', 'muK') || found;
	found = numKey(q, out, 'mus', 'muS') || found;
	found = numKey(q, out, 'mass', 'puckM') || found;
	found = numKey(q, out, 'balls', 'balls') || found;
	const schema = q.schema && q.schema.toLowerCase();
	if (DISK_SCHEMAS[schema]) { out.schema = schema; found = true; }
	const recycle = q.recycle && q.recycle.toLowerCase();
	if (RECYCLES.includes(recycle)) { out.recycle = recycle; found = true; }
	const vote = q.vote && q.vote.toLowerCase(), voteMode = q.votemode && q.votemode.toLowerCase();
	if (SPEED_RULES.includes(vote)) { out.vote = vote; found = true; }
	if (VOTE_MODES.includes(voteMode)) { out.voteMode = voteMode; found = true; }
	if (q.theme) { out.theme = q.theme.toLowerCase(); found = true; } // validated where themes live (ui.js)
	const botspeed = q.botspeed && q.botspeed.toLowerCase();
	if (SPEED_STRATS[botspeed]) { out.botspeed = botspeed; found = true; }
	// The look-ahead is a switch and three numbers; `warp` reads like the view toggles.
	if (['1', 'true', 'on', '0', 'false', 'off'].includes(q.warp)) { out.warp = q.warp === '1' || q.warp === 'true' || q.warp === 'on'; found = true; }
	for (const [urlName, key] of [['warptries', 'warpTries'], ['warpturns', 'warpTurns'], ['warpgoal', 'warpGoal']]) found = numKey(q, out, urlName, key) || found;
	if (q.seats) {
		const seats = q.seats.split(',').map(s => s.trim().toLowerCase()).filter(s => SEAT_TYPES.includes(s)).slice(0, CFG.maxPlayers);
		if (seats.length) { out.seats = seats; found = true; }
	}
	for (const key of ['ring', 'ghost']) {
		const v = q[key];
		if (v === '1' || v === 'true' || v === '0' || v === 'false') { out[key] = v === '1' || v === 'true'; found = true; }
	}
	return found ? out : null;
}
// The canonical link of a named preset: the panel writes it into the address bar,
// and the same page state comes back when it is opened.
function presetQuery(name) { return 'preset=' + name; }

if (typeof module !== 'undefined') module.exports = { PRESETS, SPEED_RULES, VOTE_MODES, parseQuery, applyCfg, presetQuery };
