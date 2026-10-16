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
const Game = (() => {
	const PRED_COOLDOWN = 0.08; // s between ghost re-sims during a drag
	const w = createWorld(CFG);
	const pred = createPredictor(CFG);
	// Default table: one human against the three profiles that differ the most — a
	// scorer, an attacker and a recoverer — so the first game shows the whole spread.
	const roster = createRoster(['human', 'balanced', 'blackhole', 'retriever'], CFG.ballsPerPlayer);
	let state = 'aim', turn = 0, pending = -1, resolveT = 0, voteT = 0, paused = false;
	// The configured speed a game's votes have moved away from (NaN while they have
	// not): the next game starts from it again.
	let omegaBase = NaN;
	// The last tally, for the panel: the votes it counted and what came of them.
	const tally = { count: 0, from: 0, to: 0, labels: [] };
	let botT = 0, predT = 0, ghostDirty = false, seed = 1, rng = makeRng(seed);
	// len/anchor* implement precision mode (shift): the speed mapping is rebased every
	// time shift flips, so the stroke never jumps when it is pressed or released.
	const aim = { pending: -1, hasStroke: false, vx: 0, vy: 0, dragging: false, len: 0, anchorLen: 0, anchorSp: CFG.vMin, precise: false };
	const queue = []; // {type:'throw', timeStamp}

	function isBot(seat) { return seat.type !== 'human'; }
	// A puck a return rule claims goes back to the stock of the seat that threw it.
	function giveBack(owner) { roster[owner].balls++; }
	function botPrep() {
		const s = chooseStroke(roster[turn].type, w, CFG, pending, pred, rng, roster);
		aim.vx = s.vx; aim.vy = s.vy; aim.hasStroke = true;
		botT = 0; invalidateGhost();
	}
	// A line to show during the think, without a search: the co-rotating tangent if
	// the puck can see the hold circle, otherwise the disk centre. The stroke that
	// is actually thrown is chosen at the throw (botPrep), when the disk has finished
	// turning — searching twice would hitch the page for the whole delay.
	function showBotAim() {
		const x = w.x[pending], y = w.y[pending];
		const dh = holdRadius(CFG), rf = Math.min(0.82 * dh, CFG.diskR - CFG.puckR - 0.01);
		const feed = CFG.omega !== 0 && rf > CFG.puckR ? feedTangent(CFG, x, y, rf) : null;
		const ang = feed ? feed.ang : Math.atan2(CFG.diskY - y, CFG.diskX - x);
		const sp = feed ? Math.min(CFG.vMax, feed.v0 * 0.9) : Math.min(CFG.vMax, 1.6);
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
		pending = spawnPuck(w, CFG.launchX, CFG.launchY, turn);
		if (pending < 0) { roster[turn].balls = 0; armTurn(); return; }
		aim.pending = pending; aim.hasStroke = false; aim.vx = 0; aim.vy = 0;
		rebase(0, CFG.vMin, false);
		state = 'aim';
		if (isBot(roster[turn])) showBotAim();
	}
	// Take the un-thrown puck off the board and give its ball back.
	function disarm() {
		if (pending < 0) return;
		roster[w.own[pending]].balls++;
		removePuckAt(w, pending);
		pending = -1; aim.pending = -1; aim.hasStroke = false;
	}
	function reset() {
		if (!isNaN(omegaBase)) { CFG.omega = omegaBase; omegaBase = NaN; }
		resetWorld(w);
		for (let i = 0; i < roster.length; i++) { roster[i].balls = CFG.ballsPerPlayer; roster[i].score = 0; }
		clearVotes(CFG, roster); tally.count = 0; tally.labels.length = 0;
		state = 'aim'; resolveT = 0; voteT = 0; botT = 0; turn = 0; pending = -1;
		rng = makeRng(++seed); // fresh seed per board: bot games differ, competitions stay reproducible
		armTurn();
	}
	function rebase(len, sp, precise) { aim.anchorLen = len; aim.anchorSp = sp; aim.precise = precise; }
	function rawSpeed(len) { return clamp(CFG.vMin + len / CFG.dragFull * (CFG.vMax - CFG.vMin), CFG.vMin, CFG.vMax); }
	// Drag 0..dragFull maps onto the stroke speed range CFG.vMin..CFG.vMax; with shift
	// held only a preciseGain share of further drag counts (precision mode).
	function setStroke(dx, dy, precise) {
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) { aim.hasStroke = false; return; }
		if (precise !== aim.precise) rebase(len, aim.hasStroke ? Math.hypot(aim.vx, aim.vy) : rawSpeed(len), precise);
		const slope = (CFG.vMax - CFG.vMin) / CFG.dragFull * (precise ? CFG.preciseGain : 1);
		const sp = clamp(aim.anchorSp + (len - aim.anchorLen) * slope, CFG.vMin, CFG.vMax);
		aim.len = len;
		setAimVel(dx / len * sp, dy / len * sp);
	}
	function setAimVel(vx, vy) {
		aim.vx = vx; aim.vy = vy; aim.hasStroke = true;
		invalidateGhost();
	}
	function invalidateGhost() { ghostDirty = true; predT = 0; } // re-sim on the next tick
	// The mass slider retunes every puck on the board, not only the next throw: a
	// setting that reached future pucks alone would look broken while you watch.
	function setPuckMass(m) {
		CFG.puckM = m;
		for (let i = 0; i < w.n; i++) w.m[i] = m;
	}
	// A new paint is a new score map: a bot on turn re-aims, its stroke was chosen for
	// the old one. (Slider drags do not: a re-aim per input event would stall the drag.)
	function setDiskSchema(name) {
		CFG.diskSchema = name;
		if (state === 'aim' && pending >= 0 && isBot(roster[turn])) showBotAim();
	}
	// The turn timer has run out (or the board has settled): the next seat arms at
	// once, or after a speed vote when the rule calls one before its turn. The game's
	// first turn has no turn timer before it, so no vote either.
	function handOff() {
		recyclePucks(w, CFG.recycleMode, giveBack);
		const prev = turn;
		turn = (turn + 1) % roster.length;
		if (w.thrown >= CFG.maxThrows) { state = 'settle'; beginSettle(w); return; }
		const next = nextSeat(roster, turn);
		if (next < 0 || !tallyDue(CFG, prev, next)) { armTurn(); return; }
		turn = next; state = 'vote'; voteT = 0;
		for (let i = 0; i < roster.length; i++) {
			if (!isBot(roster[i])) continue;
			const v = chooseVote(roster[i].type, w, CFG, i, roster, next, rng);
			setVote(CFG, roster[i], v.kind, v.value);
		}
	}
	// The vote closes: the average of the votes cast is the new speed, which the motor
	// runs to over spinRampT, and every vote goes back to "don't care".
	function closeVote() {
		const from = CFG.omega, to = tallySpeed(CFG, roster, from);
		tally.count = 0; tally.from = from; tally.to = to; tally.labels.length = roster.length;
		for (let i = 0; i < roster.length; i++) {
			tally.labels[i] = roster[i].voteLabel;
			if (roster[i].vote !== VOTE_NONE) tally.count++;
		}
		clearVotes(CFG, roster);
		if (to !== from) {
			if (isNaN(omegaBase)) omegaBase = from;
			CFG.omega = to;
			beginSpinRamp(w, to, CFG.spinRampT);
		}
		armTurn();
	}
	// A direct speed change (the panel slider, auto-ω, a preset or a URL), whatever the
	// rule: the disk jumps there, and games start from it from now on.
	function setOmega(v) {
		const wasStill = w.omegaCur === 0;
		CFG.omega = v; omegaBase = NaN;
		stopSpinRamp(w);
		if (!w.settling) {
			w.omegaCur = v; w.alpha = 0;
			if (wasStill && v !== 0) wakeOnDisk(w);
		}
	}
	function setVoteOf(i, kind, value) { if (roster[i]) setVote(CFG, roster[i], kind, value); }
	// A rule change applies from the next handoff on; switching the rule off closes a
	// running vote uncounted. A vote's value means something else in the other mode,
	// so changing either drops the votes held.
	function setSpeedRule(rule, mode) {
		CFG.speedVote = rule; CFG.voteMode = mode;
		clearVotes(CFG, roster);
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
			if (isSettled(w) || resolveT >= CFG.handoffT) handOff();
		} else if (state === 'vote') {
			voteT += dtSim;
			if (voteT >= CFG.voteT) closeVote();
		} else if (state === 'settle' && w.settled) {
			recyclePucks(w, CFG.recycleMode, giveBack);
			state = 'scored';
		}
	}
	// Per-frame housekeeping: ghost re-sim (throttled) and bot throws.
	function tick(dt) {
		if (ghostDirty && predT <= 0 && state === 'aim' && aim.hasStroke && pending >= 0) {
			predictStroke(pred, w, pending, aim.vx, aim.vy, CFG.maxResolve);
			ghostDirty = false; predT = PRED_COOLDOWN;
		}
		predT -= dt;
		if (paused || state !== 'aim' || pending < 0 || !aim.hasStroke || !isBot(roster[turn])) return;
		botT += dt;
		// The bot aims when armed (so its intent shows during the think time) and
		// chooses again at the instant it throws: during the delay the disk has
		// turned ~0.5 rad and the board has kept moving, so the armed stroke is
		// stale for anything that rotates — the page must not play the bots worse
		// than the experiments do (those throw at the angle they chose on).
		if (botT >= CFG.botDelay) { botT = 0; botPrep(); commitThrow(); }
	}
	function bindInput(canvas) {
		canvas.style.touchAction = 'none';
		let sx = 0, sy = 0;
		canvas.addEventListener('pointerdown', e => {
			if (state !== 'aim' || isBot(roster[turn])) return;
			canvas.setPointerCapture(e.pointerId);
			const p = Render.toWorld(e.clientX, e.clientY);
			sx = w.x[pending]; sy = w.y[pending]; aim.dragging = true;
			rebase(0, CFG.vMin, e.shiftKey); setStroke(p.x - sx, p.y - sy, e.shiftKey);
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
			else if (e.key === 'Escape') { aim.hasStroke = false; rebase(0, CFG.vMin, false); }
			else if (e.key === 'r' || e.key === 'R') reset();
			else if (state === 'aim' && !isBot(roster[turn]) && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(e); }
		});
	}
	function nudge(e) {
		if (!aim.hasStroke) { setStroke(-CFG.dragFull * 0.5, 0, e.shiftKey); rebase(aim.len, Math.hypot(aim.vx, aim.vy), e.shiftKey); }
		let ang = Math.atan2(aim.vy, aim.vx), sp = Math.hypot(aim.vx, aim.vy);
		const da = (e.shiftKey ? 0.2 : 1) * Math.PI / 180; // shift = fine on both axes
		const dk = e.shiftKey ? 1.005 : 1.020, ds = e.shiftKey ? 0.002 : 0.010;
		if (e.key === 'ArrowLeft') ang -= da;
		if (e.key === 'ArrowRight') ang += da;
		if (e.key === 'ArrowUp') sp = Math.min(CFG.vMax, sp * dk + ds);
		if (e.key === 'ArrowDown') sp = Math.max(CFG.vMin, sp / dk - ds);
		rebase(aim.len, sp, e.shiftKey); // arrows and drag share the same anchor
		setAimVel(Math.cos(ang) * sp, Math.sin(ang) * sp);
	}
	// Swap the whole roster at once (a table preset or URL `seats` list) — unlike the
	// live seat-by-seat edits, a table swap restarts the board and deals fresh balls.
	function setSeatTypes(types) {
		roster.length = 0;
		for (let i = 0; i < Math.min(types.length, CFG.maxPlayers); i++) roster.push(makeSeat(types[i], CFG.ballsPerPlayer));
		reset();
	}
	// Roster edits, live: no reset, so trying a different number of seats is a click.
	function setSeatType(i, type) {
		const seat = roster[i];
		if (!seat || seat.type === type) return;
		seat.type = type;
		if (state !== 'aim' || i !== turn || pending < 0) return;
		if (isBot(seat)) showBotAim(); else aim.hasStroke = false;
	}
	function addPlayer(type) {
		if (roster.length >= CFG.maxPlayers) return false;
		roster.push(makeSeat(type, CFG.ballsPerPlayer));
		// On a spent board there is nothing left to score, so the new seat starts a
		// fresh game — that is the point of adding one.
		if (state === 'settle' || state === 'scored') reset();
		return true;
	}
	function removePlayer(i) {
		if (roster.length <= 1 || i < 0 || i >= roster.length) return false;
		disarm(); // the puck on the launch spot goes back to its owner first
		dropOwned(w, i); // his pucks leave the board with him
		reindexOwners(w, i);
		roster.splice(i, 1);
		if (i < turn) turn--; // keep the seat on turn where it is
		turn = turn % roster.length;
		if (state === 'aim') armTurn();
		return true;
	}
	return {
		world: w, aim, pred, roster, reset, bindInput, beforeSteps, afterSteps, tick,
		setStroke, setAimVel, commitThrow, setSeatType, setSeatTypes, addPlayer, removePlayer,
		invalidateGhost, setPuckMass, setDiskSchema, giveBack, setOmega, setSpeedRule, setVote: setVoteOf,
		queueThrow: ts => queue.push({ type: 'throw', timeStamp: ts }),
		get state() { return state; },
		// The game is over (disk spinning down, or scored): the board is spent until
		// the next reset, so a settings change has to restart it to be seen at all.
		get roundEnded() { return state === 'settle' || state === 'scored'; },
		get resolveT() { return resolveT; }, // s into the resolve; the turn hands off at handoffT
		get voteT() { return voteT; }, // s into a speed vote; it closes at CFG.voteT
		get omegaStart() { return isNaN(omegaBase) ? CFG.omega : omegaBase; }, // the configured speed
		get omegaNow() { return spinNow(w); }, // the motor's live speed, including a vote ramp
		tally,
		get pending() { return pending; },
		get turn() { return turn; },
		get seatTypes() { return roster.map(s => s.type); },
		get winner() { return state === 'scored' ? leader(roster) : -1; },
		get paused() { return paused; },
		togglePause: () => { paused = !paused; return paused; },
	};
})();
