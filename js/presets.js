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
// puckM, schema, recycle, zones, holes, vote, voteMode, turns, theme, cards, seats, balls, autoOmega); a bundle sets only what
// it lists and leaves the rest alone, except `default`, which is complete on
// purpose — the way back from anywhere. `autoOmega` re-solves the 90 % rule after
// the bundle's μ and mass are in, so every mass preset keeps its own eject ring.
const PRESETS = {
	default: { label: 'classic default', geometry: null, maxThrows: 96, muK: 0.030, muS: 0.045, puckM: 4, autoOmega: true, schema: 'classic', recycle: 'advance',
		zones: 'hatch', holes: 'classic', swap: false, scoreScale: 1, payBlue: 55, payBend: 1, vote: 'round', voteMode: 'delta', turns: 'window', theme: 'classic', cards: 'square', fx: 'plain', sfx: false, balls: 4,
		decor: 'radial', face: 'launch', vol: 1.3,
		botspeed: 'auto', warp: false, warpTries: 6, warpTurns: 3, warpGoal: 0.5, seats: ['human', 'balanced', 'blackhole', 'retriever'] },
	slick: { label: 'slick ice · long slides', muK: 0.012, muS: 0.030, puckM: 4, autoOmega: true },
	grippy: { label: 'grippy ice · short stops', muK: 0.080, muS: 0.120, puckM: 4, autoOmega: true },
	stones: { label: 'curling stones · 20 kg', puckM: 20, autoOmega: true },
	feathers: { label: 'featherweights · 0.5 kg', puckM: 0.5, autoOmega: true },
	// A plain omega leaves the rest of the physics wherever it was, so the grinder
	// pins the reference table its 1.356 rad/s was solved for (d_hold = 0.3 R).
	grinder: { label: 'meat grinder · eject at 0.3 R', muK: 0.030, muS: 0.045, puckM: 4, omega: 1.356 },
	rimtrap: { label: 'rim traps · 6 hemispheres', schema: 'rim6' },
	// A wide board with a small disk: the disk keeps a quarter of the default radius
	// and the score pattern scales with it by default (scoreScale = 1), so the eject
	// ring and hold geometry shrink to match; the wells sit in the two far corners.
	// ω is the auto-ω of this disk, and the seat order puts the random seat on the left.
	notsobigdisk: { label: 'not-so-big disk · small disk, well holes',
		geometry: { boardW: 4.1942140790742535, boardH: 2.2, diskX: 1.1183164735294637, diskY: 1.1, diskR: 0.200000002241845,
			puckR: 0.08030261092839523, launchX: 3.8442140790742534, launchY: 1.1, launchMinX: 3.644214079074253, launchMaxX: 4.044214079074253,
			launchMinY: 0.95, launchMaxY: 1.25, zoneCutGap: 0.06, zoneReach: 1,
			holes: [{ x: 0, y: 0, r: 0.46692223924468396 }, { x: 0, y: 2.2, r: 0.46692223924468396 }] },
		omega: 1.5660459675595018, muK: 0.030, muS: 0.045, puckM: 4, zones: '3-rounded', holes: 'well',
		seats: ['random', 'balanced', 'blackhole', 'retriever'] },
	crystal: { label: 'crystal ice · glass skin + sounds', fx: 'glass', sfx: true },
	// Two tables built to show the two bot settings off: the same profiles, one set to
	// play the disk with its votes, one set to look ahead before it throws.
	speedplay: { label: 'speed play · park vs shake', vote: 'turn', botspeed: 'park' },
	foresight: { label: 'foresight · time-warp look-ahead', warp: 1, warpTries: 8, warpTurns: 3, warpGoal: 0.6 },
	// Turns that end when the board stops: the staller keeps it sliding while its pucks
	// out-earn the table, against a parker and the fixed-window timing bot.
	staller: { label: 'motion turns · staller keeps it sliding', turns: 'motion', seats: ['human', 'staller', 'keeper', 'timing'] },
	solo: { label: 'practice · human alone', seats: ['human'], vote: 'off' }, // a vote of one is the slider
	bots: { label: 'bot league · all six profiles', seats: ['keeper', 'hunter', 'balanced', 'retriever', 'blackhole', 'random'] },
	// A bundle drawn at apply time (randomSetup below), not a fixed one: the looks
	// stay where they are and only the game is shuffled.
	random: { label: 'random · shuffled game, bot table', random: true },
};
// The slider ranges of index.html; URL values are clamped to them. payBlue stops at
// pale (245): above it the blue part would out-pay the pale paint it bends toward, and
// the palette's red channel would fall as the field value rises.
const NUM_RANGES = { maxThrows: [1, 512], omega: [0, CFG.omegaMax], muK: [0.005, 0.3], muS: [0.03, 0.5], puckM: [CFG.massMin, CFG.massMax], balls: [1, 8],
	scoreScale: [0.25, 3], payBlue: [0, 245], payBend: [0.25, 4], warpTries: [1, 16], warpTurns: [0, 6], warpGoal: [0, 3], vol: [0, 2] };
const RECYCLES = ['none', 'zones', 'advance'];
const ZONE_STYLES = ['hatch', 'wavy', 'rounded', 'arcs', '3-rounded', '6-hemi'], HOLE_STYLES = ['classic', 'rim', 'well', 'triangle']; // CFG.zoneStyle, CFG.holeStyle
const CARD_STYLES = ['square', 'round']; // the score cards' corners; page state, not CFG
const SPEED_RULES = ['off', 'turn', 'round'], VOTE_MODES = ['delta', 'exact']; // CFG.speedVote, CFG.voteMode
const TURN_ENDS = ['window', 'motion']; // CFG.turnEnd
const VIEWS = ['fit', 'side']; // the layout keys of index.html; fit is the shipped one
const FX_MODES = ['plain', 'glass']; // presentation; not CFG, js/ui.js loads the add-on
const DECOR_MODES = ['radial', 'hex']; // the glass disk's etched finish
const FACE_MODES = ['launch', 'up', 'bottom']; // where the sound listener sits and faces

// The shuffle behind the `random` preset: every game rule a link can name is drawn
// fresh — ice and mass, disk paint, return rule, zone shapes, speed and turn rules,
// the bot brains and the table itself — while the looks stay put: theme, presentation,
// cards, decor and the board's geometry are not in the draw, so a shuffled game still
// looks like the one you were watching. One draw per applied game, never per frame.
function randomPick(list) { return list[(Math.random() * list.length) | 0]; }
function randomNum(lo, hi) { return lo + Math.random() * (hi - lo); }
// A table of 2..4 bots, each profile once — the shuffle is a table to watch, so no
// human seat is dealt (js/auto.js runs these games back to back).
function randomTable() {
	const pool = SEAT_TYPES.slice(1); // every seat type but the human
	for (let i = pool.length - 1; i > 0; i--) {
		const j = (Math.random() * (i + 1)) | 0, t = pool[i];
		pool[i] = pool[j]; pool[j] = t;
	}
	return pool.slice(0, 2 + ((Math.random() * 3) | 0));
}
function randomSetup() {
	const muK = Math.round(randomNum(0.01, 0.09) * 1000) / 1000;
	const muS = Math.max(muK, Math.round(randomNum(muK, 0.16) * 1000) / 1000); // the panel's μs ≥ μk rule
	return {
		muK: muK, muS: muS,
		puckM: Math.round(10 ** randomNum(Math.log10(CFG.massMin), Math.log10(CFG.massMax)) * 100) / 100,
		autoOmega: true, // the drawn mass and ice re-solve the disk's speed
		balls: randomPick([1, 2, 3, 4]), // a shuffled game is short enough to watch to the end
		schema: randomPick(Object.keys(DISK_SCHEMAS)), // the score map is the rule, not only the paint
		zones: randomPick(ZONE_STYLES), holes: randomPick(HOLE_STYLES), recycle: randomPick(RECYCLES), swap: Math.random() < 0.5,
		scoreScale: randomPick([0.75, 1, 1, 1, 1.25, 1.5]),
		// The pay curve joins the draw (it is the score map's rule, not only its look),
		// weighted toward the shipped curve so most shuffles still feel like the classic.
		payBlue: randomPick([55, 55, 120, 200, 240]), payBend: randomPick([1, 1, 0.6, 1.8]),
		vote: randomPick(SPEED_RULES), voteMode: randomPick(VOTE_MODES), turns: randomPick(TURN_ENDS),
		botspeed: randomPick(Object.keys(SPEED_STRATS)),
		warp: Math.random() < 0.25, warpTries: 2 + ((Math.random() * 5) | 0),
		warpTurns: (Math.random() * 4) | 0, warpGoal: Math.round(randomNum(0.3, 1) * 20) / 20,
		seats: randomTable(),
	};
}

// The CFG-level share of a setup: numbers, disk schema, return rule, speed rule, balls. Called
// by the boot path before the first deal and by the panel preset. Theme, seats and
// the view toggles are not CFG — the caller applies those.
function applyCfg(setup) {
	if (setup.geometry === null) resetBoardGeometry(CFG);
	else if (setup.geometry) applyBoardGeometry(CFG, setup.geometry);
	if (Number.isFinite(setup.maxThrows)) CFG.maxThrows = Math.round(clamp(setup.maxThrows, 1, 512));
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
	if (ZONE_STYLES.includes(setup.zones)) CFG.zoneStyle = setup.zones;
	if (HOLE_STYLES.includes(setup.holes)) CFG.holeStyle = setup.holes;
	if (setup.swap !== undefined) CFG.swapZones = !!setup.swap;
	if (setup.scoreScale !== undefined) CFG.scoreScale = clamp(setup.scoreScale, NUM_RANGES.scoreScale[0], NUM_RANGES.scoreScale[1]);
	if (setup.payBlue !== undefined) CFG.payBlue = clamp(setup.payBlue, NUM_RANGES.payBlue[0], NUM_RANGES.payBlue[1]);
	if (setup.payBend !== undefined) CFG.payBend = clamp(setup.payBend, NUM_RANGES.payBend[0], NUM_RANGES.payBend[1]);
	if (SPEED_RULES.includes(setup.vote)) CFG.speedVote = setup.vote;
	if (VOTE_MODES.includes(setup.voteMode)) CFG.voteMode = setup.voteMode;
	if (TURN_ENDS.includes(setup.turns)) CFG.turnEnd = setup.turns;
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
	found = numKey(q, out, 'maxthrows', 'maxThrows') || found;
	if (q.geometry) {
		try {
			const b = JSON.parse(q.geometry);
			if (validBoardGeometry(b)) { out.geometry = b; found = true; }
		} catch (e) { /* Ignore malformed geometry, not the rest of the link. */ }
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
	for (const [key, list] of [['zones', ZONE_STYLES], ['holes', HOLE_STYLES], ['cards', CARD_STYLES]]) {
		const v = q[key] && q[key].toLowerCase();
		if (list.includes(v)) { out[key] = v; found = true; }
	}
	const sw = q.swap && q.swap.toLowerCase();
	if (sw !== undefined) { out.swap = sw === '1' || sw === 'true' || sw === 'on'; found = true; }
	found = numKey(q, out, 'scorescale', 'scoreScale') || found;
	found = numKey(q, out, 'payblue', 'payBlue') || found;
	found = numKey(q, out, 'paybend', 'payBend') || found;
	const vote = q.vote && q.vote.toLowerCase(), voteMode = q.votemode && q.votemode.toLowerCase();
	if (SPEED_RULES.includes(vote)) { out.vote = vote; found = true; }
	if (VOTE_MODES.includes(voteMode)) { out.voteMode = voteMode; found = true; }
	const turns = q.turns && q.turns.toLowerCase();
	if (TURN_ENDS.includes(turns)) { out.turns = turns; found = true; }
	if (q.theme) { out.theme = q.theme.toLowerCase(); found = true; } // validated where themes live (ui.js)
	const fx = q.fx && q.fx.toLowerCase();
	if (fx === 'glass' || fx === 'crystal' || fx === 'on' || fx === '1' || fx === 'true') { out.fx = 'glass'; found = true; }
	else if (FX_MODES.includes(fx) || fx === 'off' || fx === '0' || fx === 'false') { out.fx = 'plain'; found = true; }
	const sfx = q.sfx && q.sfx.toLowerCase();
	if (['1', 'true', 'on', '0', 'false', 'off'].includes(sfx)) { out.sfx = sfx === '1' || sfx === 'true' || sfx === 'on'; found = true; }
	const decor = q.decor && q.decor.toLowerCase();
	if (DECOR_MODES.includes(decor)) { out.decor = decor; found = true; }
	const face = q.face && q.face.toLowerCase();
	if (FACE_MODES.includes(face)) { out.face = face; found = true; }
	found = numKey(q, out, 'vol', 'vol') || found;
	const view = q.view && q.view.toLowerCase();
	if (VIEWS.includes(view)) { out.view = view; found = true; }
	const botspeed = q.botspeed && q.botspeed.toLowerCase();
	if (SPEED_STRATS[botspeed]) { out.botspeed = botspeed; found = true; }
	// The look-ahead is a switch and three numbers; `warp` reads like the view toggles.
	if (['1', 'true', 'on', '0', 'false', 'off'].includes(q.warp)) { out.warp = q.warp === '1' || q.warp === 'true' || q.warp === 'on'; found = true; }
	for (const [urlName, key] of [['warptries', 'warpTries'], ['warpturns', 'warpTurns'], ['warpgoal', 'warpGoal']]) found = numKey(q, out, urlName, key) || found;
	if (q.seats) {
		const seats = q.seats.split(',').map(s => s.trim().toLowerCase()).filter(s => SEAT_TYPES.includes(s)).slice(0, CFG.maxPlayers);
		if (seats.length) { out.seats = seats; found = true; }
	}
	for (const [urlName, key] of [['ring', 'ring'], ['ghost', 'ghost'], ['holefill', 'holeFill']]) {
		const v = q[urlName];
		if (v === '1' || v === 'true' || v === '0' || v === 'false') { out[key] = v === '1' || v === 'true'; found = true; }
	}
	return found ? out : null;
}
// The canonical link of a named preset: the panel writes it into the address bar,
// and the same page state comes back when it is opened.
function presetQuery(name) { return 'preset=' + name; }

if (typeof module !== 'undefined') module.exports = { PRESETS, ZONE_STYLES, HOLE_STYLES, CARD_STYLES, SPEED_RULES, VOTE_MODES, TURN_ENDS, VIEWS, FX_MODES, DECOR_MODES, FACE_MODES, parseQuery, applyCfg, presetQuery, randomSetup };
