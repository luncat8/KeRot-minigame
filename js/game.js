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
	const baseW = cfg.boardW, baseH = cfg.boardH;
	const w = env.world || createWorld(cfg);
	// A simulated copy: no input, no ghost, no planning of its own — and every seat
	// plays itself with the light search (js/bots.js), so a human opponent does not stall
	// the clock and a rollout's answers are the same kind of move as the game's.
	const sim = env.sim === true;
	const lightBots = env.lightBots === true; // embedded surfaces can trade some aim search for less main-thread work
	const ghost = env.ghost !== false; // a VN slot may omit the preview to keep its frame budget light
	const pred = createPredictor(cfg);
	// Default table: one human against the three profiles that differ the most — a
	// scorer, an attacker and a recoverer — so the first game shows the whole spread.
	const roster = env.roster || createRoster(['human', 'balanced', 'blackhole', 'retriever'], cfg.ballsPerPlayer);
	let state = 'aim', turn = 0, pending = -1, resolveT = 0, voteT = 0, paused = false;
	// The armed puck's uid. `pending` is a board index, and a removal (a hole, a black
	// hole) swap-moves the last puck into the freed slot, so the armed puck — the last
	// one spawned — can change index while its seat still aims (syncPending).
	let pendingUid = 0;
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
	let aimTurn = 0;
	const queue = []; // {type:'throw', timeStamp}
	// The time-warp planner (js/warp.js) and the shortlist its search works through.
	let planner = null, planning = false, rank = null, warpNote = '';

	function isBot(seat) { return seat.type !== 'human'; }
	// Who throws on their own: a bot in the real game, every seat in a copy.
	function playsItself() { return sim || isBot(roster[turn]); }
	// A returned puck goes back to the stock of the seat that threw it.
	function giveBack(owner) { roster[owner].balls++; }
	function botPrep() {
		const s = chooseStroke(roster[turn].type, w, cfg, pending, pred, rng, roster, sim ? null : rank, sim || lightBots);
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
		aimTurn++;
		aim.dragging = false;
		const next = nextSeat(roster, turn);
		if (next < 0) { state = 'settle'; beginSettle(w); return; }
		turn = next;
		roster[turn].balls--;
		pending = spawnPuck(w, cfg.launchX, cfg.launchY, turn);
		if (pending < 0) { roster[turn].balls = 0; armTurn(); return; }
		pendingUid = w.uid[pending];
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
	// A puck removed by the simulation while a seat aims is swap-removed, which pulls the
	// board's last puck — the armed one — into the freed slot. The index is not an
	// identity: without this the aim, the ghost and the throw all address a slot the
	// armed puck no longer occupies, so the preview came up empty and the throw went
	// into a stale entry the step loop never visits (the ball simply never moved).
	// Re-find it by uid, and re-sim the ghost: the puck that was in the way is gone.
	function syncPending() {
		if (pending < 0) return;
		if (pending < w.n && w.uid[pending] === pendingUid) return;
		pending = findPuckUid(w, pendingUid);
		aim.pending = pending;
		invalidateGhost();
		if (pending >= 0) return;
		roster[turn].balls++; // no board slot holds it: hand the ball back and re-arm
		armTurn();
	}
	function reset() {
		queue.length = 0;
		paused = false; // a fresh board is live, whatever the last one was doing
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
	function setStroke(dx, dy, precise, angle) {
		const len = Math.hypot(dx, dy);
		const raw = angle === undefined ? Math.atan2(dy, dx) : angle; // a caller may hold the angle
		if (len < 1e-6) { aim.hasStroke = false; return; }
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
		syncPending();
		if (state !== 'aim' || pending < 0 || !aim.hasStroke) return;
		throwPuck(w, pending, aim.vx, aim.vy);
		aim.hasStroke = false; aim.pending = -1; pending = -1;
		state = 'resolve'; resolveT = 0;
	}
	// Called by main once per frame before stepping.
	function beforeSteps() {
		syncPending();
		while (queue.length) { const ev = queue.shift(); if (ev.type === 'throw') commitThrow(); }
	}
	// Called by main after each batch of fixed steps (dtSim simulated seconds).
	function afterSteps(dtSim) {
		syncPending(); // a hole swallowed a puck during these steps, and the armed one moved with it
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
			// The board is spent: clear what the return rule claims, but hand nothing back.
			// A ball returned inside a turn window is what keeps a round alive (handOff);
			// after the last throw there is no turn left to spend it, so a stock that grew
			// here read as a game that should have continued and did not.
			recyclePucks(w, cfg.recycleMode, null);
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
		rec.state = state; rec.turn = turn; rec.pending = pending; rec.pendingUid = pendingUid;
		rec.resolveT = resolveT; rec.voteT = voteT; rec.botT = botT;
		rec.omega = cfg.omega; rec.omegaBase = omegaBase; rec.rng = rng.getState();
		return rec;
	}
	// Loads a saved flow into *this* game; `cfg.omega` is part of it, since a copy runs
	// its own cfg. The live game is never loaded — it is only ever saved.
	function loadFlow(rec) {
		state = rec.state; turn = rec.turn; pending = rec.pending; pendingUid = rec.pendingUid;
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
		syncPending();
		if (!sim && ghost && ghostDirty && predT <= 0 && state === 'aim' && aim.hasStroke && pending >= 0) {
			// The ghost is drawn during a drag, on the frame that also steps the board, so
			// it is simulated to the window the throw is paid by (handoffT) and not to the
			// spin-down horizon: a puck still sliding 4 s after the push has already had
			// its turn handed over, and simulating that tail is most of a crowded board's
			// ghost cost. The bots still price the full maxResolve horizon.
			predictStroke(pred, w, pending, aim.vx, aim.vy, cfg.handoffT);
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
	const canAim = () => state === 'aim' && pending >= 0 && !isBot(roster[turn]) && !paused;
	// Expand the ice, not the pieces. Keep the disk left, the launch lane right,
	// and the playing line halfway down the available pane.
	function fitBoard(aspect = baseW / baseH) {
		const width = Math.max(baseW, baseH * aspect), height = Math.max(baseH, baseW / aspect);
		if (Math.abs(width - cfg.boardW) + Math.abs(height - cfg.boardH) < 1e-6) return false;
		const dy = height / 2 - cfg.diskY, dx = width - cfg.boardW;
		for (let i = 0; i < w.n; i++) {
			const r = w.r[i], lane = clamp((w.x[i] - cfg.diskX - cfg.diskR - r) / (cfg.launchMinX - cfg.diskX - cfg.diskR - r), 0, 1);
			w.x[i] = clamp(w.x[i] + dx * lane, r, width - r);
			w.y[i] = clamp(w.y[i] + dy, r, height - r);
		}
		cfg.boardW = width; cfg.boardH = height;
		cfg.diskY = cfg.launchY = height / 2;
		cfg.launchX += dx; cfg.launchMinX += dx; cfg.launchMaxX += dx;
		cfg.launchMinY += dy; cfg.launchMaxY += dy;
		cfg.returnZone = { ax: cfg.diskX, ay: cfg.diskY, bx: width, by: 0, cx: width, cy: height };
		cfg.advanceZone = { ax: 0, ay: height, bx: 0, by: 0, cx: cfg.diskX, cy: cfg.diskY, lx: cfg.launchMinX, lw: width - cfg.launchMinX };
		cfg.holes = [BLACK_HOLES[0], { ...BLACK_HOLES[1], y: height }];
		cancelPlan(); invalidateGhost();
		return true;
	}
	function bindPointer(canvas, renderer, onChange = () => {}) {
		canvas.style.touchAction = 'none';
		let id = null, turnAtPress, startX, startY, tap, moved, relative, lastLen, lastAngle, angle, speed;
		function sample(e) {
			const p = renderer.toWorld(e.clientX, e.clientY);
			const dx = p.x - w.x[pending], dy = p.y - w.y[pending];
			const d = Math.hypot(dx, dy);
			const len = Math.max(0, d - aimGrab(cfg));
			const bearing = d > cfg.puckR ? Math.atan2(dy, dx) : lastAngle;
			if (!relative && !e.shiftKey) {
				angle = bearing;
				speed = rawSpeed(len);
			} else {
				// Once fine control is used, keep its offset for the rest of this drag.
				// Releasing Shift restores normal gains, not the absolute pointer position.
				relative = true;
				angle += angDelta(bearing, lastAngle) * (e.shiftKey ? cfg.preciseAimGain : 1);
				speed = clamp(speed + (len - lastLen) / cfg.dragFull * (cfg.vMax - cfg.vMin) * (e.shiftKey ? cfg.preciseGain : 1), cfg.vMin, cfg.vMax);
			}
			lastLen = len; lastAngle = bearing;
			setAimVel(Math.cos(angle) * speed, Math.sin(angle) * speed);
		}
		function down(e) {
			if (id !== null || !canAim() || e.button > 0 || e.isPrimary === false) return;
			if (e.cancelable) e.preventDefault();
			canvas.focus?.({ preventScroll: true });
			id = e.pointerId; turnAtPress = aimTurn;
			startX = e.clientX; startY = e.clientY; moved = false;
			const p = renderer.toWorld(startX, startY);
			const dx = p.x - w.x[pending], dy = p.y - w.y[pending];
			const d = Math.hypot(dx, dy);
			tap = d <= cfg.puckR;
			lastLen = Math.max(0, d - aimGrab(cfg));
			lastAngle = tap ? Math.atan2(aim.vy, aim.vx) : Math.atan2(dy, dx);
			relative = !!e.shiftKey && aim.hasStroke && !tap;
			angle = relative ? Math.atan2(aim.vy, aim.vx) : lastAngle;
			speed = relative ? Math.hypot(aim.vx, aim.vy) : rawSpeed(lastLen);
			if (!tap) { sample(e); aim.dragging = true; }
			canvas.setPointerCapture?.(id);
			onChange();
		}
		function update(e) {
			moved ||= Math.hypot(e.clientX - startX, e.clientY - startY) >= 6;
			if (tap && !moved) return;
			if (tap && !aim.dragging) {
				const p = renderer.toWorld(e.clientX, e.clientY);
				if (Math.hypot(p.x - w.x[pending], p.y - w.y[pending]) <= cfg.puckR) return;
				lastAngle = angle = Math.atan2(p.y - w.y[pending], p.x - w.x[pending]);
			}
			sample(e);
			aim.dragging = true;
		}
		function move(e) {
			if (e.pointerId !== id || turnAtPress !== aimTurn || !canAim()) return;
			update(e); onChange();
		}
		function finish(e) {
			if (e.pointerId !== id) return;
			if (e.type === 'pointerup' && turnAtPress === aimTurn && canAim()) {
				update(e);
				if (tap && !moved && aim.hasStroke) api.queueThrow(e.timeStamp);
			}
			id = null; aim.dragging = false;
			onChange();
		}
		const handlers = { pointerdown: down, pointermove: move, pointerup: finish, pointercancel: finish, lostpointercapture: finish };
		for (const type in handlers) canvas.addEventListener(type, handlers[type]);
		return () => {
			for (const type in handlers) canvas.removeEventListener(type, handlers[type]);
			aim.dragging = false;
		};
	}
	// A spent board is also its own "play again" button: two taps anywhere on the canvas,
	// a hand's width apart and within RESTART_TAP_MS, deal a new game. A mouse
	// double-click is exactly that pair; on touch it is a double tap. The gesture is
	// live once the last throw is done, and js/ui.js shows the result card asking for it
	// when the board has scored.
	const RESTART_TAP_MS = 600, RESTART_SLOP = 40; // ms, css px
	function bindRestart(canvas) {
		let lastT = -Infinity, lastX = 0, lastY = 0;
		canvas.addEventListener('pointerup', e => {
			if (e.button > 0 || (state !== 'settle' && state !== 'scored')) return;
			const t = e.timeStamp || performance.now();
			const near = Math.abs(e.clientX - lastX) <= RESTART_SLOP && Math.abs(e.clientY - lastY) <= RESTART_SLOP;
			if (near && t - lastT <= RESTART_TAP_MS) { lastT = -Infinity; reset(); return; }
			lastT = t; lastX = e.clientX; lastY = e.clientY;
		});
	}
	function bindInput(canvas) {
		bindPointer(canvas, Render);
		bindRestart(canvas);
		window.addEventListener('keydown', e => {
			// Space and the arrows belong to the control that has focus (a slider, a
			// select, a button); the game reads them only from the board and the page.
			const owned = e.target && e.target.closest && e.target.closest('button, input, select, textarea');
			const key = e.key || '';
			if (owned && (e.code === 'Space' || key.startsWith('Arrow'))) return;
			if (e.code === 'Space') {
				e.preventDefault();
				if (!paused && !isBot(roster[turn])) queue.push({ type: 'throw', timeStamp: e.timeStamp });
			}
			else if (key === 'Escape') { aim.hasStroke = false; rebase(0, cfg.vMin, false); }
			else if (key === 'r' || key === 'R') reset();
			else if (!paused && state === 'aim' && !isBot(roster[turn]) && key.startsWith('Arrow')) { e.preventDefault(); nudge(e); }
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
		world: w, aim, pred, roster, cfg, reset, fitBoard, canAim, bindInput, bindPointer, beforeSteps, afterSteps, tick,
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
