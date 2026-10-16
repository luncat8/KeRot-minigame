// Game flow: seats take turns, one push each — AIM -> RESOLVE -> ([VOTE ->] next seat |
// SETTLE -> SCORED). The board is shared and every seat is paid for the red area it
// holds for as long as it holds it (js/score.js), so the game is "keep your pucks on
// the red while the others try to shove them off".
// Input events are queued with their timestamp; throws are applied between fixed
// steps, never inside one, so frame cadence cannot shift a throw.
// A seat is either a human (pointer/keyboard) or a bot (js/bots.js) that aims on
// its own; tick() drives bot throws and the ghost-trajectory preview.
// With a speed rule on (js/vote.js), a VOTE of voteT seconds sits between two turns
// when the rule calls one: the bots cast theirs as it opens, and when it closes the
// tally sets the disk speed for the next throw.
// The whole flow is a factory over {world, roster, cfg}, because a second instance
// costs nothing and answers a question the page cannot ask: js/warp.js copies the live
// game, plays a candidate stroke out to the end of the turn and further, and hands the
// real board only the stroke that survived. Everything here reads `cfg`, never the
// global CFG, so a copy can run its own settings.
if (typeof module !== 'undefined') { Object.assign(globalThis, require('./cfg.js'), require('./physics.js'), require('./score.js'), require('./players.js'), require('./rules.js'), require('./predict.js'), require('./bots.js'), require('./vote.js')); module.exports = { createGame }; }

function angDelta(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function createGame(env) {
	const PRED_COOLDOWN = 0.08; // s between ghost re-sims during a drag
	const cfg = env.cfg || CFG;
	const w = env.world || createWorld(cfg);
	// A simulated copy: no input, no ghost, no planning of its own — and every seat
	// plays itself with the light search (js/bots.js), so a human opponent does not stall
	// the clock and a rollout's answers are the same kind of move as the game's.
	const sim = env.sim === true;
	const pred = createPredictor(cfg);
	// Default table: one human against the three profiles that differ the most — a
	// scorer, an attacker and a recoverer — so the first game shows the whole spread.
	const roster = env.roster || createRoster(['human', 'balanced', 'blackhole', 'retriever'], cfg.ballsPerPlayer);
	let state = 'aim', turn = 0, pending = -1, resolveT = 0, voteT = 0, paused = false;
	// The configured speed a game's votes have moved away from (NaN while they have
	// not): the next game starts from it again.
	let omegaBase = NaN;
	// The last tally, for the panel: the votes it counted and what came of them.
	const tally = { count: 0, from: 0, to: 0, labels: [] };
	let botT = 0, predT = 0, ghostDirty = false, seed = 1, rng = makeRng(seed);
	// len/raw/anchor* implement precision mode (shift): the speed and angle mappings are
	// rebased every time shift flips, so the stroke never jumps when it is pressed or
	// released. Plain drag is absolute; a shift segment counts only a preciseGain (speed)
	// or preciseAimGain (aim) share of further drag.
	const aim = { pending: -1, hasStroke: false, vx: 0, vy: 0, dragging: false, len: 0, raw: 0, anchorLen: 0, anchorSp: cfg.vMin, anchorRaw: NaN, anchorAng: 0, precise: false };
	const queue = []; // {type:'throw', timeStamp}
	// The time-warp planner (js/warp.js) and the shortlist its search works through.
	let planner = null, planning = false, rank = null, warpNote = '';

	function isBot(seat) { return seat.type !== 'human'; }
	// Who throws on their own: a bot in the real game, every seat in a copy.
	function playsItself() { return sim || isBot(roster[turn]); }
	// A returned puck goes back to the stock of the seat that threw it.
	function giveBack(owner) { roster[owner].balls++; }
	function botPrep() {
		const s = sim ? chooseStroke(roster[turn].type, w, cfg, pending, pred, rng, roster, null, true)
			: chooseStroke(roster[turn].type, w, cfg, pending, pred, rng, roster, rank);
		aim.vx = s.vx; aim.vy = s.vy; aim.hasStroke = true;
		botT = 0; invalidateGhost();
	}
	// A line to show during the think, without a search: the co-rotating tangent if
	// the puck can see the hold circle, otherwise the disk centre. The stroke that
	// is actually thrown is chosen at the throw (botPrep), when the disk has finished
	// turning — searching twice would hitch the page for the whole delay.
	function showBotAim() {
		const x = w.x[pending], y = w.y[pending];
		const dh = holdRadius(cfg), rf = Math.min(0.82 * dh, cfg.diskR - cfg.puckR - 0.01);
		const feed = cfg.omega !== 0 && rf > cfg.puckR ? feedTangent(cfg, x, y, rf) : null;
		const ang = feed ? feed.ang : Math.atan2(cfg.diskY - y, cfg.diskX - x);
		const sp = feed ? Math.min(cfg.vMax, feed.v0 * 0.9) : Math.min(cfg.vMax, 1.6);
		aim.vx = Math.cos(ang) * sp; aim.vy = Math.sin(ang) * sp; aim.hasStroke = true;
		botT = 0; invalidateGhost();
	}
	// Take a ball from the seat on turn and put its puck on the launch spot. No seat
	// has a ball left -> the board spins down; a seat that has a ball but no room for
	// it is retired and the turn moves on.
	function armTurn() {
		const next = nextSeat(roster, turn);
		if (next < 0) { state = 'settle'; beginSettle(w); return; }
		turn = next;
		roster[turn].balls--;
		pending = spawnPuck(w, cfg.launchX, cfg.launchY, turn);
		if (pending < 0) { roster[turn].balls = 0; armTurn(); return; }
		aim.pending = pending; aim.hasStroke = false; aim.vx = 0; aim.vy = 0;
		rebase(0, cfg.vMin, false);
		state = 'aim'; planning = false;
		if (!sim && isBot(roster[turn])) showBotAim();
	}
	// Take the un-thrown puck off the board and give its ball back.
	function disarm() {
		if (pending < 0) return;
		roster[w.own[pending]].balls++;
		removePuckAt(w, pending);
		pending = -1; aim.pending = -1; aim.hasStroke = false;
	}
	function reset() {
		if (!isNaN(omegaBase)) { cfg.omega = omegaBase; omegaBase = NaN; }
		resetWorld(w);
		for (let i = 0; i < roster.length; i++) { roster[i].balls = cfg.ballsPerPlayer; roster[i].score = 0; }
		clearVotes(cfg, roster); tally.count = 0; tally.labels.length = 0;
		state = 'aim'; resolveT = 0; voteT = 0; botT = 0; turn = 0; pending = -1;
		planning = false; warpNote = '';
		rng = makeRng(++seed); // fresh seed per board: bot games differ, competitions stay reproducible
		armTurn();
	}
	function rebase(len, sp, precise) { aim.anchorLen = len; aim.anchorSp = sp; aim.precise = precise; aim.anchorRaw = NaN; }
	function rawSpeed(len) { return clamp(cfg.vMin + len / cfg.dragFull * (cfg.vMax - cfg.vMin), cfg.vMin, cfg.vMax); }
	// Drag 0..dragFull maps onto the stroke speed range cfg.vMin..cfg.vMax and the drag
	// direction onto the aim; with shift held only a preciseGain (speed) / preciseAimGain
	// (aim) share of further drag counts — precision mode, finer on speed than on aim.
	// The angle anchor starts at the drag's own direction, so scaling the first event
	// cannot turn an absolute angle into nonsense.
	function setStroke(dx, dy, precise) {
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) { aim.hasStroke = false; return; }
		const raw = Math.atan2(dy, dx);
		if (precise !== aim.precise) {
			rebase(len, aim.hasStroke ? Math.hypot(aim.vx, aim.vy) : rawSpeed(len), precise);
			aim.anchorRaw = raw;
			aim.anchorAng = aim.hasStroke ? Math.atan2(aim.vy, aim.vx) : raw;
		} else if (isNaN(aim.anchorRaw)) {
			aim.anchorRaw = raw;
			aim.anchorAng = raw;
		}
		const gain = precise ? cfg.preciseGain : 1;
		const aimGain = precise ? cfg.preciseAimGain : 1;
		const slope = (cfg.vMax - cfg.vMin) / cfg.dragFull * gain;
		const sp = clamp(aim.anchorSp + (len - aim.anchorLen) * slope, cfg.vMin, cfg.vMax);
		const ang = aim.anchorAng + angDelta(raw, aim.anchorRaw) * aimGain;
		aim.len = len;
		aim.raw = raw;
		setAimVel(Math.cos(ang) * sp, Math.sin(ang) * sp);
	}
	function setAimVel(vx, vy) {
		aim.vx = vx; aim.vy = vy; aim.hasStroke = true;
		invalidateGhost();
	}
	function invalidateGhost() { ghostDirty = true; predT = 0; } // re-sim on the next tick
	// The mass slider retunes every puck on the board, not only the next throw: a
	// setting that reached future pucks alone would look broken while you watch.
	function setPuckMass(m) {
		cancelPlan();
		cfg.puckM = m;
		for (let i = 0; i < w.n; i++) w.m[i] = m;
	}
	// A new paint is a new score map: a bot on turn re-aims, its stroke was chosen for
	// the old one. (Slider drags do not: a re-aim per input event would stall the drag.)
	function setDiskSchema(name) {
		cancelPlan();
		cfg.diskSchema = name;
		if (state === 'aim' && pending >= 0 && isBot(roster[turn])) showBotAim();
	}
	// The turn timer has run out (or the board has settled): the next seat arms at
	// once, or after a speed vote when the rule calls one before its turn. The game's
	// first turn has no turn timer before it, so no vote either.
	function handOff() {
		recyclePucks(w, cfg.recycleMode, giveBack);
		const prev = turn;
		turn = (turn + 1) % roster.length;
		if (w.thrown >= cfg.maxThrows) { state = 'settle'; beginSettle(w); return; }
		const next = nextSeat(roster, turn);
		if (next < 0 || !tallyDue(cfg, prev, next)) { armTurn(); return; }
		turn = next; state = 'vote'; voteT = 0;
		for (let i = 0; i < roster.length; i++) {
			if (!isBot(roster[i])) continue;
			const v = chooseVote(roster[i].type, w, cfg, i, roster, next, rng);
			setVote(cfg, roster[i], v.kind, v.value);
		}
	}
	// The vote closes: the average of the votes cast is the new speed, which the motor
	// runs to over spinRampT, and every vote goes back to "don't care".
	function closeVote() {
		const from = cfg.omega, to = tallySpeed(cfg, roster, from);
		tally.count = 0; tally.from = from; tally.to = to; tally.labels.length = roster.length;
		for (let i = 0; i < roster.length; i++) {
			tally.labels[i] = roster[i].voteLabel;
			if (roster[i].vote !== VOTE_NONE) tally.count++;
		}
		clearVotes(cfg, roster);
		if (to !== from) {
			if (isNaN(omegaBase)) omegaBase = from;
			cfg.omega = to;
			beginSpinRamp(w, to, cfg.spinRampT);
		}
		armTurn();
	}
	// A direct speed change (the panel slider, auto-ω, a preset or a URL), whatever the
	// rule: the disk jumps there, and games start from it from now on.
	function setOmega(v) {
		cancelPlan();
		const wasStill = w.omegaCur === 0;
		cfg.omega = v; omegaBase = NaN;
		stopSpinRamp(w);
		if (!w.settling) {
			w.omegaCur = v; w.alpha = 0;
			if (wasStill && v !== 0) wakeOnDisk(w);
		}
	}
	function setVoteOf(i, kind, value) { if (!roster[i]) return; cancelPlan(); setVote(cfg, roster[i], kind, value); }
	// A rule change applies from the next handoff on; switching the rule off closes a
	// running vote uncounted. A vote's value means something else in the other mode,
	// so changing either drops the votes held.
	function setSpeedRule(rule, mode) {
		cancelPlan();
		cfg.speedVote = rule; cfg.voteMode = mode;
		clearVotes(cfg, roster);
		if (state === 'vote' && rule === 'off') armTurn();
	}
	function commitThrow() {
		if (state !== 'aim' || pending < 0 || !aim.hasStroke) return;
		throwPuck(w, pending, aim.vx, aim.vy);
		aim.hasStroke = false; aim.pending = -1; pending = -1;
		state = 'resolve'; resolveT = 0;
	}
	// Called by main once per frame before stepping.
	function beforeSteps() {
		while (queue.length) { const ev = queue.shift(); if (ev.type === 'throw') commitThrow(); }
	}
	// Called by main after each batch of fixed steps (dtSim simulated seconds).
	function afterSteps(dtSim) {
		// The window that pays: it opens when a seat pushes and closes at handoffT
		// (or when the board settles), and it pays every seat at once for the red it
		// is holding. The spin-down at the end is still live board, so it pays too.
		if (state === 'resolve' || state === 'settle') scoreTick(w, roster, dtSim);
		if (state === 'resolve') {
			resolveT += dtSim;
			// A turn ends when the board settles, and at handoffT regardless: a puck
			// the disk keeps nudging can slide for ten seconds, and the next seat must
			// not wait for it. Whatever is still moving stays on the board and keeps
			// being simulated while the next seat aims.
			if (isSettled(w) || resolveT >= cfg.handoffT) handOff();
		} else if (state === 'vote') {
			voteT += dtSim;
			if (voteT >= cfg.voteT) closeVote();
		} else if (state === 'settle' && w.settled) {
			recyclePucks(w, cfg.recycleMode, giveBack);
			state = 'scored';
		}
	}
	// --- Time-warp: the turn a bot is about to throw, played out in a copy ----------
	// The copy is a game made by this same factory (js/warp.js owns it), so "undo the
	// turn" is not a special case: the throw goes into the copy, and the copy is what
	// gets reloaded from the snapshot when the result is not good enough. The real
	// board only ever receives the stroke the search settled on, and it is held still
	// meanwhile (js/main.js skips the frame's steps while `planning`) so the plan
	// applies to exactly the state it was computed on.
	function saveFlow(rec) {
		rec.state = state; rec.turn = turn; rec.pending = pending;
		rec.resolveT = resolveT; rec.voteT = voteT; rec.botT = botT;
		rec.omega = cfg.omega; rec.omegaBase = omegaBase; rec.rng = rng.getState();
		return rec;
	}
	// Loads a saved flow into *this* game; `cfg.omega` is part of it, since a copy runs
	// its own cfg. The live game is never loaded — it is only ever saved.
	function loadFlow(rec) {
		state = rec.state; turn = rec.turn; pending = rec.pending;
		resolveT = rec.resolveT; voteT = rec.voteT; botT = rec.botT;
		cfg.omega = rec.omega; omegaBase = rec.omegaBase;
		rng.setState(rec.rng);
		aim.pending = pending; aim.hasStroke = false; aim.dragging = false;
		ghostDirty = false; predT = 0; planning = false;
	}
	function wantWarp() {
		if (sim || !cfg.warp || typeof createWarp !== 'function') return false;
		if (!planner) planner = createWarp();
		return true;
	}
	// The greedy search runs first (it is the bot's normal pick and the ranking the
	// look-ahead works through), then the planner tries the lines it offered, one
	// rollout per frame or so, until a line is good enough or the tries run out.
	function startPlan() {
		if (!wantWarp()) { botPrep(); commitThrow(); return; }
		if (!rank) rank = makeStrokeRank();
		botPrep();
		if (planner.begin(api, turn, rank)) planning = true;
		else commitThrow(); // nothing to look ahead between: play the greedy line
	}
	// Any setting the plan was computed against invalidates it: the search starts over
	// on the next think, on the board as it is then.
	function cancelPlan() { planning = false; }
	function stepPlan() {
		if (!planner.step(cfg.warpFrameMs)) return;
		warpNote = planner.status;
		planning = false;
		setAimVel(planner.vx, planner.vy);
		commitThrow();
	}
	// Per-frame housekeeping: ghost re-sim (throttled) and bot throws.
	function tick(dt) {
		if (!sim && ghostDirty && predT <= 0 && state === 'aim' && aim.hasStroke && pending >= 0) {
			predictStroke(pred, w, pending, aim.vx, aim.vy, cfg.maxResolve);
			ghostDirty = false; predT = PRED_COOLDOWN;
		}
		predT -= dt;
		// A copy needs no stroke in hand to start its turn: it is aimed and thrown in
		// the same tick, which is what lets a rollout run its later seats at all.
		if (paused || state !== 'aim' || pending < 0 || !playsItself() || (!sim && !aim.hasStroke)) return;
		if (planning) { stepPlan(); return; }
		botT += dt;
		if (!sim && botT < cfg.botDelay) return;
		botT = 0;
		// The bot aims when armed (so its intent shows during the think time) and
		// chooses again at the instant it throws: during the delay the disk has
		// turned ~0.5 rad and the board has kept moving, so the armed stroke is
		// stale for anything that rotates — the page must not play the bots worse
		// than the experiments do (those throw at the angle they chose on). A copy
		// plays its turns back to back, so it does not wait at all.
		if (sim) { botPrep(); commitThrow(); return; }
		startPlan();
	}
	function bindInput(canvas) {
		canvas.style.touchAction = 'none';
		let sx = 0, sy = 0;
		canvas.addEventListener('pointerdown', e => {
			if (state !== 'aim' || isBot(roster[turn])) return;
			canvas.setPointerCapture(e.pointerId);
			const p = Render.toWorld(e.clientX, e.clientY);
			sx = w.x[pending]; sy = w.y[pending]; aim.dragging = true;
			rebase(0, cfg.vMin, e.shiftKey); setStroke(p.x - sx, p.y - sy, e.shiftKey);
		});
		canvas.addEventListener('pointermove', e => {
			if (!aim.dragging || state !== 'aim') return;
			const p = Render.toWorld(e.clientX, e.clientY);
			setStroke(p.x - sx, p.y - sy, e.shiftKey);
		});
		canvas.addEventListener('pointerup', () => { aim.dragging = false; });
		window.addEventListener('keydown', e => {
			if (e.code === 'Space') {
				e.preventDefault();
				if (!isBot(roster[turn])) queue.push({ type: 'throw', timeStamp: e.timeStamp });
			}
			else if (e.key === 'Escape') { aim.hasStroke = false; rebase(0, cfg.vMin, false); }
			else if (e.key === 'r' || e.key === 'R') reset();
			else if (state === 'aim' && !isBot(roster[turn]) && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(e); }
		});
	}
	function nudge(e) {
		if (!aim.hasStroke) {
			setStroke(-cfg.dragFull * 0.5, 0, e.shiftKey);
			rebase(aim.len, Math.hypot(aim.vx, aim.vy), e.shiftKey);
			aim.anchorRaw = aim.raw; aim.anchorAng = Math.atan2(aim.vy, aim.vx);
		}
		let ang = Math.atan2(aim.vy, aim.vx), sp = Math.hypot(aim.vx, aim.vy);
		// Shift = fine, on the same two gains the drag uses: a coarser step for the aim
		// (1° plain, the aim gain with shift) and the speed gain for the speed keys.
		const gain = e.shiftKey ? cfg.preciseGain : 1;
		const aimGain = e.shiftKey ? cfg.preciseAimGain : 1;
		const da = aimGain * Math.PI / 180;
		const dk = 1 + gain * 0.02, ds = gain * 0.01;
		if (e.key === 'ArrowLeft') ang -= da;
		if (e.key === 'ArrowRight') ang += da;
		if (e.key === 'ArrowUp') sp = Math.min(cfg.vMax, sp * dk + ds);
		if (e.key === 'ArrowDown') sp = Math.max(cfg.vMin, sp / dk - ds);
		rebase(aim.len, sp, e.shiftKey); // arrows and drag share the same anchor
		aim.anchorRaw = aim.raw; aim.anchorAng = ang;
		setAimVel(Math.cos(ang) * sp, Math.sin(ang) * sp);
	}
	// Swap the whole roster at once (a table preset or URL `seats` list) — unlike the
	// live seat-by-seat edits, a table swap restarts the board and deals fresh balls.
	function setSeatTypes(types) {
		cancelPlan();
		roster.length = 0;
		for (let i = 0; i < Math.min(types.length, cfg.maxPlayers); i++) roster.push(makeSeat(types[i], cfg.ballsPerPlayer));
		reset();
	}
	// Roster edits, live: no reset, so trying a different number of seats is a click.
	function setSeatType(i, type) {
		cancelPlan();
		const seat = roster[i];
		if (!seat || seat.type === type) return;
		seat.type = type;
		if (state !== 'aim' || i !== turn || pending < 0) return;
		if (isBot(seat)) showBotAim(); else aim.hasStroke = false;
	}
	function addPlayer(type) {
		if (roster.length >= cfg.maxPlayers) return false;
		cancelPlan();
		roster.push(makeSeat(type, cfg.ballsPerPlayer));
		// On a spent board there is nothing left to score, so the new seat starts a
		// fresh game — that is the point of adding one.
		if (state === 'settle' || state === 'scored') reset();
		return true;
	}
	function removePlayer(i) {
		if (roster.length <= 1 || i < 0 || i >= roster.length) return false;
		cancelPlan();
		disarm(); // the puck on the launch spot goes back to its owner first
		dropOwned(w, i); // his pucks leave the board with him
		reindexOwners(w, i);
		roster.splice(i, 1);
		if (i < turn) turn--; // keep the seat on turn where it is
		turn = turn % roster.length;
		if (state === 'aim') armTurn();
		return true;
	}
	const api = {
		world: w, aim, pred, roster, cfg, reset, bindInput, beforeSteps, afterSteps, tick,
		setStroke, setAimVel, commitThrow, setSeatType, setSeatTypes, addPlayer, removePlayer,
		invalidateGhost, setPuckMass, setDiskSchema, giveBack, setOmega, setSpeedRule, setVote: setVoteOf,
		// The bot brain, through the one entry point that owns a running plan: turning
		// the look-ahead off drops a search that is under way instead of honouring it.
		setWarp(on) { cfg.warp = !!on; cancelPlan(); },
		queueThrow: ts => queue.push({ type: 'throw', timeStamp: ts }),
		get state() { return state; },
		// The game is over (disk spinning down, or scored): the board is spent until
		// the next reset, so a settings change has to restart it to be seen at all.
		get roundEnded() { return state === 'settle' || state === 'scored'; },
		get resolveT() { return resolveT; }, // s into the resolve; the turn hands off at handoffT
		get voteT() { return voteT; }, // s into a speed vote; it closes at cfg.voteT
		get omegaStart() { return isNaN(omegaBase) ? cfg.omega : omegaBase; }, // the configured speed
		get omegaNow() { return spinNow(w); }, // the motor's live speed, including a vote ramp
		tally,
		get pending() { return pending; },
		get turn() { return turn; },
		get seatTypes() { return roster.map(s => s.type); },
		get winner() { return state === 'scored' ? leader(roster) : -1; },
		get paused() { return paused; },
		togglePause: () => { paused = !paused; return paused; },
		// The warp hooks: what js/warp.js drives a copy through, and what the panel
		// reads. `planning` freezes the real board for the length of the look-ahead.
		saveFlow, loadFlow,
		get rngState() { return rng.getState(); },
		setRngState(v) { rng.setState(v); },
		get planning() { return planning; },
		get warpStatus() { return warpNote || (planning && planner ? planner.status : ''); },
	};
	return api;
}
const Game = createGame({});
