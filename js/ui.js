// Side-panel wiring. DOM text is written only when a value actually changes;
// update() is throttled to ~5 Hz by main. opts is a shared object mutated in
// place — never allocated in the frame loop.
const UI = (() => {
	const $ = id => document.getElementById(id);
	const els = {};
	const opts = { ring: true, preview: true, mode: CFG.recycleMode, theme: 'classic' };
	// What a link with no parameters opens. Taken now, before boot parameters or a
	// preset move CFG — a shared link lists only what differs from this.
	const SHIPPED = {
		omega: CFG.omega, muK: CFG.muK, muS: CFG.muS, puckM: CFG.puckM,
		schema: CFG.diskSchema, recycle: CFG.recycleMode, vote: CFG.speedVote, voteMode: CFG.voteMode, balls: CFG.ballsPerPlayer,
		botspeed: CFG.botSpeed, warp: !!CFG.warp, warpTries: CFG.warpTries, warpTurns: CFG.warpTurns, warpGoal: CFG.warpGoal,
		theme: 'classic', seats: 'human,balanced,blackhole,retriever',
	};
	const rows = []; // one per seat: {root, sel, balls, score, rm}
	const voteRows = []; // one per human seat: {seat, root, none, keep, range, val}
	let voteKey = '', shownOmega = NaN, lastText = {};
	function setText(id, txt) { if (lastText[id] !== txt) { lastText[id] = txt; els[id].textContent = txt; } }
	function setNode(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
	function bind(onReset) {
		for (const id of ['omega', 'muK', 'muS', 'mass', 'omegaVal', 'muKVal', 'muSVal', 'massVal', 'hold', 'stop', 'simTime', 'puckCount', 'liveScore', 'state', 'breakdown', 'btnThrow', 'btnClear', 'btnAuto', 'btnReset', 'btnPause', 'chkRing', 'chkPreview', 'roster', 'btnAdd', 'diskSchema', 'legendBar', 'legendText', 'theme', 'preset', 'ballsLegend', 'voteBox', 'voteRows', 'voteStatus',
			'botSpeed', 'chkWarp', 'warpRows', 'warpTries', 'warpTurns', 'warpGoal', 'warpTriesVal', 'warpTurnsVal', 'warpGoalVal', 'warpStatus'])
			els[id] = $(id);
		// Every physics input invalidates the ghost: it is only valid for the settings
		// it was simulated with, so a slider move must re-sim it on the next frame.
		// On a spent board (the disk has spun down after the game) the new setting
		// would otherwise never be seen — the disk is stopped and only a reset starts
		// it again — so restart the board as well.
		const onPhys = () => { if (Game.roundEnded) onReset(); Game.invalidateGhost(); markCustom(); };
		els.omega.max = String(CFG.omegaMax);
		els.omega.addEventListener('input', () => { Game.setOmega(parseFloat(els.omega.value)); shownOmega = Game.omegaNow; sync(); onPhys(); });
		els.muK.addEventListener('input', () => {
			CFG.muK = parseFloat(els.muK.value);
			els.muS.min = String(CFG.muK);
			if (CFG.muS < CFG.muK) { CFG.muS = CFG.muK; els.muS.value = String(CFG.muS); }
			sync(); onPhys();
		});
		els.muS.addEventListener('input', () => { CFG.muS = parseFloat(els.muS.value); sync(); onPhys(); });
		// Mass spans 40× (a plastic disc to a curling stone), so the slider is log10 kg.
		els.mass.min = String(Math.log10(CFG.massMin)); els.mass.max = String(Math.log10(CFG.massMax));
		els.mass.addEventListener('input', () => { Game.setPuckMass(10 ** parseFloat(els.mass.value)); sync(); onPhys(); });
		fillSelect(els.botSpeed, SPEED_STRATS, CFG.botSpeed);
		els.botSpeed.addEventListener('change', () => { CFG.botSpeed = els.botSpeed.value; markCustom(); });
		// The look-ahead settings are read when a search starts, so they apply from the
		// next bot turn on; only switching it off has to reach a search under way.
		els.chkWarp.checked = CFG.warp;
		els.chkWarp.addEventListener('change', () => { Game.setWarp(els.chkWarp.checked); syncWarp(); markCustom(); });
		els.warpTries.min = '1'; els.warpTries.max = String(WARP_MAX_TRIES);
		els.warpTries.addEventListener('input', () => { CFG.warpTries = parseInt(els.warpTries.value, 10); syncWarp(); markCustom(); });
		els.warpTurns.addEventListener('input', () => { CFG.warpTurns = parseInt(els.warpTurns.value, 10); syncWarp(); markCustom(); });
		els.warpGoal.addEventListener('input', () => { CFG.warpGoal = parseFloat(els.warpGoal.value); syncWarp(); markCustom(); });
		syncWarp();
		fillSelect(els.diskSchema, DISK_SCHEMAS, CFG.diskSchema);
		els.diskSchema.addEventListener('change', () => { Game.setDiskSchema(els.diskSchema.value); markCustom(); });
		fillSelect(els.theme, Render.themes, opts.theme);
		els.theme.addEventListener('change', () => { opts.theme = els.theme.value; document.body.dataset.theme = opts.theme; markCustom(); });
		// The preset select keeps a placeholder until a bundle is picked, and goes back
		// to it (markCustom) as soon as any control moves away from the bundle.
		const ph = document.createElement('option');
		ph.value = ''; ph.textContent = 'apply a preset…'; els.preset.appendChild(ph);
		fillSelect(els.preset, PRESETS, '');
		els.preset.addEventListener('change', () => { if (els.preset.value) applyPreset(els.preset.value); });
		paintLegend();
		els.btnAuto.addEventListener('click', () => { Game.setOmega(autoOmega(CFG)); pullOmega(); sync(); onPhys(); });
		els.btnThrow.addEventListener('click', () => Game.queueThrow(performance.now()));
		els.btnClear.addEventListener('click', () => { Game.aim.hasStroke = false; });
		els.btnReset.addEventListener('click', onReset);
		els.btnPause.addEventListener('click', () => { els.btnPause.textContent = Game.togglePause() ? 'Resume' : 'Pause'; });
		els.btnAdd.addEventListener('click', () => { Game.addPlayer(nextType()); syncRoster(); markCustom(); });
		for (const r of radios('recycle')) {
			r.addEventListener('change', () => { if (r.checked) { CFG.recycleMode = r.value; opts.mode = r.value; markCustom(); } });
		}
		// The speed rule is live, like the return rule: it applies from the next handoff.
		for (const r of radios('speedVote')) r.addEventListener('change', () => { if (r.checked) setRule(r.value, CFG.voteMode); });
		for (const r of radios('voteMode')) r.addEventListener('change', () => { if (r.checked) setRule(CFG.speedVote, r.value); });
		pullControls();
		syncRoster();
		syncVotes();
		sync();
	}
	function radios(name) { return document.querySelectorAll('input[name=' + name + ']'); }
	function setRule(rule, mode) { Game.setSpeedRule(rule, mode); syncVotes(); markCustom(); }
	function pullOmega() { shownOmega = Game.omegaNow; els.omega.value = String(shownOmega); }
	function numParam(v) { return String(Math.round(v * 1e6) / 1e6); }
	function writeQuery(search) {
		try { history.replaceState(null, '', search ? '?' + search : location.pathname + location.hash); }
		catch (e) { // the address bar may refuse (sandbox, some file:// setups)
		}
	}
	// The link of the board as it stands: every key that differs from the shipped
	// table, so a refresh opens this page and not the bundle the select has left.
	function liveQuery() {
		const parts = [];
		const omega = Game.omegaStart; // what games start at: a voted speed belongs to the game, not the link
		if (Math.abs(omega - SHIPPED.omega) > 5e-4) parts.push('omega=' + numParam(omega));
		if (Math.abs(CFG.muK - SHIPPED.muK) > 5e-4) parts.push('muk=' + numParam(CFG.muK));
		if (Math.abs(CFG.muS - SHIPPED.muS) > 5e-4) parts.push('mus=' + numParam(CFG.muS));
		if (Math.abs(CFG.puckM - SHIPPED.puckM) > 1e-3) parts.push('mass=' + numParam(CFG.puckM));
		if (CFG.diskSchema !== SHIPPED.schema) parts.push('schema=' + CFG.diskSchema);
		if (CFG.recycleMode !== SHIPPED.recycle) parts.push('recycle=' + CFG.recycleMode);
		if (CFG.speedVote !== SHIPPED.vote) parts.push('vote=' + CFG.speedVote);
		if (CFG.voteMode !== SHIPPED.voteMode) parts.push('votemode=' + CFG.voteMode);
		if (CFG.botSpeed !== SHIPPED.botspeed) parts.push('botspeed=' + CFG.botSpeed);
		if (!!CFG.warp !== SHIPPED.warp) parts.push('warp=' + (CFG.warp ? 1 : 0));
		if (CFG.warpTries !== SHIPPED.warpTries) parts.push('warptries=' + CFG.warpTries);
		if (CFG.warpTurns !== SHIPPED.warpTurns) parts.push('warpturns=' + CFG.warpTurns);
		if (CFG.warpGoal !== SHIPPED.warpGoal) parts.push('warpgoal=' + numParam(CFG.warpGoal));
		if (opts.theme !== SHIPPED.theme) parts.push('theme=' + opts.theme);
		if (CFG.ballsPerPlayer !== SHIPPED.balls) parts.push('balls=' + CFG.ballsPerPlayer);
		const seats = Game.seatTypes.join(',');
		if (seats !== SHIPPED.seats) parts.push('seats=' + seats);
		if (els.chkRing && !els.chkRing.checked) parts.push('ring=0');
		if (els.chkPreview && !els.chkPreview.checked) parts.push('ghost=0');
		return parts.join('&');
	}
	// Any manual control change leaves the bundle the preset select last applied,
	// and the address bar has to leave it too — a leftover ?preset= would reload the
	// bundle and throw the tweak away.
	function markCustom() {
		if (els.preset) els.preset.value = '';
		writeQuery(liveQuery());
	}
	// The controls mirror CFG (after boot parameters and presets), never the stale
	// HTML defaults: every writable control is written here.
	function pullControls() {
		pullOmega();
		els.muK.value = String(CFG.muK);
		els.muS.value = String(CFG.muS);
		els.muS.min = String(CFG.muK);
		els.mass.value = String(Math.log10(CFG.puckM));
		els.diskSchema.value = CFG.diskSchema;
		els.theme.value = opts.theme;
		for (const r of radios('recycle')) r.checked = r.value === CFG.recycleMode;
		opts.mode = CFG.recycleMode;
		for (const r of radios('speedVote')) r.checked = r.value === CFG.speedVote;
		for (const r of radios('voteMode')) r.checked = r.value === CFG.voteMode;
		els.botSpeed.value = CFG.botSpeed in SPEED_STRATS ? CFG.botSpeed : 'auto';
		els.chkWarp.checked = !!CFG.warp;
		els.warpTries.value = String(CFG.warpTries);
		els.warpTurns.value = String(CFG.warpTurns);
		els.warpGoal.value = String(CFG.warpGoal);
		syncWarp();
	}
	// The look-ahead's own numbers: the lines it compares, the turns it plays each of
	// them out for, and the bar under which it is worth looking further (the ranked lines
	// are played whatever the goal says; the goal buys the fine tuning around their
	// winner). The rows say "balls" because that is the unit the bar is priced in — one
	// parked puck's remaining annuity, the same coin the bots' value function pays in.
	function syncWarp() {
		const tries = clamp(Math.round(CFG.warpTries) || 1, 1, WARP_MAX_TRIES);
		setText('warpTriesVal', tries + ' line' + (tries === 1 ? '' : 's'));
		setText('warpTurnsVal', CFG.warpTurns > 0 ? CFG.warpTurns + ' turn' + (CFG.warpTurns > 1 ? 's' : '') : 'to the end of the game');
		setText('warpGoalVal', CFG.warpGoal > 0 ? CFG.warpGoal.toFixed(2) + ' ball' + (CFG.warpGoal === 1 ? '' : 's') : 'nothing');
		els.warpRows.hidden = !CFG.warp;
	}
	// A setup object (a preset by name, or the URL parameters) applied in one go:
	// CFG first, then the table it asks for, then the looks. Any board-changing key
	// starts a fresh board — a preset is a way to start over on purpose — and a
	// named bundle is echoed into the address bar as its shareable link.
	function applySetup(setup) {
		if (!setup) return;
		applyCfg(setup);
		if (setup.omega !== undefined || setup.autoOmega) Game.setOmega(CFG.omega); // a set speed, not a voted one
		if (setup.theme && Render.themes[setup.theme]) { opts.theme = setup.theme; document.body.dataset.theme = opts.theme; }
		if (setup.ring !== undefined) els.chkRing.checked = setup.ring;
		if (setup.ghost !== undefined) els.chkPreview.checked = setup.ghost;
		if (setup.seats && setup.seats.length) Game.setSeatTypes(setup.seats); // resets itself
		else if (setup.omega !== undefined || setup.muK !== undefined || setup.muS !== undefined || setup.puckM !== undefined ||
			setup.autoOmega || setup.balls !== undefined || setup.schema || setup.recycle || setup.vote || setup.voteMode) Game.reset();
		pullControls();
		syncRoster();
		syncVotes();
		sync();
		if (setup.preset) els.preset.value = setup.preset;
		// Boot does not rewrite the address bar: the link the page was opened with
		// already round-trips, including keys that override a named preset. Rewriting
		// it down to ?preset=name would drop those overrides.
	}
	function applyPreset(name) {
		const src = PRESETS[name];
		if (!src) return;
		const setup = Object.assign({}, src, { preset: name });
		if (src.seats) setup.seats = src.seats.slice();
		applySetup(setup);
		let q = presetQuery(name);
		if (els.chkRing && !els.chkRing.checked) q += '&ring=0';
		if (els.chkPreview && !els.chkPreview.checked) q += '&ghost=0';
		writeQuery(q);
	}
	function fillSelect(sel, table, value) {
		for (const key in table) {
			const o = document.createElement('option');
			o.value = key; o.textContent = table[key].label;
			sel.appendChild(o);
		}
		sel.value = value;
	}
	// The paint's three anchors and what each pays, read off fieldColor itself.
	function paintLegend() {
		const rgb = [0, 0, 0], css = [], pays = [];
		for (const v of [-1, 0, 1]) {
			fieldColor(v, rgb);
			css.push('rgb(' + rgb.map(Math.round).join(',') + ')');
			pays.push(Math.round(100 * rgb[0] / RED_MAX) + ' %');
		}
		els.legendBar.style.background = 'linear-gradient(90deg, ' + css.join(', ') + ')';
		els.legendText.textContent = 'pays: blue ' + pays[0] + ' · pale ' + pays[1] + ' · red ' + pays[2];
	}
	// A new seat joins as a human, unless every seat already is one — then it joins as
	// a bot, so a solo player who removes the default bots still gets an opponent.
	function nextType() { return Game.roster.some(s => s.type !== 'human') ? 'human' : 'balanced'; }
	// The roster block is rebuilt when the number of seats changes, or when a row and
	// its seat have drifted apart (a seat removed and another added in one go); the
	// values inside it are rewritten in place by update().
	function syncRoster() {
		const roster = Game.roster;
		let same = rows.length === roster.length;
		for (let i = 0; same && i < rows.length; i++) if (rows[i].sel.value !== roster[i].type) same = false;
		if (same) return;
		for (const r of rows) r.root.remove();
		rows.length = 0;
		for (let i = 0; i < roster.length; i++) rows.push(buildRow(i, roster[i].type));
		els.btnAdd.disabled = roster.length >= CFG.maxPlayers; // the roster is capped
	}
	function buildRow(i, type) {
		const root = document.createElement('div');
		root.className = 'prow';
		const dot = document.createElement('span');
		dot.className = 'sw'; dot.style.background = seatColor(i);
		const sel = document.createElement('select');
		for (const t of SEAT_TYPES) {
			const o = document.createElement('option');
			o.value = t; o.textContent = SEAT_LABELS[t];
			sel.appendChild(o);
		}
		sel.value = type;
		sel.addEventListener('change', () => { Game.setSeatType(i, sel.value); markCustom(); });
		const balls = document.createElement('span'); balls.className = 'pballs';
		const score = document.createElement('span'); score.className = 'pscore';
		const rm = document.createElement('button');
		rm.className = 'px'; rm.textContent = '×'; rm.title = 'remove this player';
		rm.addEventListener('click', () => { Game.removePlayer(i); syncRoster(); markCustom(); });
		root.append(dot, sel, balls, score, rm);
		els.roster.appendChild(root);
		return { root: root, sel: sel, balls: balls, score: score, rm: rm };
	}
	// The vote block: a row per human seat (the bots vote on their own; every vote
	// shows on the board), rebuilt when the humans or the vote mode change and
	// refreshed in place otherwise. Hidden while the rule is off.
	function syncVotes() {
		const roster = Game.roster, on = CFG.speedVote !== 'off';
		els.voteBox.hidden = !on;
		if (!on) return;
		let key = CFG.voteMode;
		for (let i = 0; i < roster.length; i++) if (roster[i].type === 'human') key += ' ' + i;
		if (key !== voteKey) {
			voteKey = key;
			for (const r of voteRows) r.root.remove();
			voteRows.length = 0;
			for (let i = 0; i < roster.length; i++) if (roster[i].type === 'human') voteRows.push(buildVoteRow(i));
		}
		for (const r of voteRows) showVote(r, roster[r.seat]);
		setText('voteStatus', voteStatus());
	}
	// One human's vote: don't care, keep, or the slider — a change or an exact speed —
	// on a line of its own, so it keeps the panel's full width.
	function buildVoteRow(i) {
		const root = document.createElement('div'), line = document.createElement('div');
		root.className = 'vseat'; line.className = 'vrow';
		const dot = document.createElement('span');
		dot.className = 'sw'; dot.style.background = seatColor(i); dot.title = seatName(i);
		const none = voteChoice(i, VOTE_NONE, "don't care"), keep = voteChoice(i, VOTE_KEEP, 'keep');
		const val = document.createElement('span');
		val.className = 'vval';
		line.append(dot, none.label, keep.label, val);
		const exact = CFG.voteMode === 'exact', range = document.createElement('input');
		range.type = 'range'; range.step = '0.01';
		range.min = String(exact ? 0 : -CFG.voteDeltaMax); range.max = String(exact ? CFG.omegaMax : CFG.voteDeltaMax);
		range.addEventListener('input', () => Game.setVote(i, VOTE_SET, parseFloat(range.value)));
		root.append(line, range);
		els.voteRows.appendChild(root);
		return { seat: i, root: root, none: none.input, keep: keep.input, range: range, val: val };
	}
	function voteChoice(i, kind, text) {
		const label = document.createElement('label'), input = document.createElement('input'), span = document.createElement('span');
		input.type = 'radio'; input.name = 'vote' + i;
		input.addEventListener('change', () => { if (input.checked) Game.setVote(i, kind, 0); });
		span.textContent = text;
		label.append(input, span);
		return { label: label, input: input };
	}
	// The row follows the seat's vote: the tally hands it back as don't care.
	function showVote(r, seat) {
		r.none.checked = seat.vote === VOTE_NONE;
		r.keep.checked = seat.vote === VOTE_KEEP;
		if (seat.vote !== VOTE_SET) r.range.value = String(CFG.voteMode === 'exact' ? CFG.omega : 0);
		setNode(r.val, seat.vote === VOTE_SET ? seat.voteLabel : '');
	}
	function voteStatus() {
		const t = Game.tally;
		if (Game.state === 'vote') return 'the vote is open — it closes in ' + Math.max(0, CFG.voteT - Game.voteT).toFixed(1) + ' s';
		if (!t.labels.length) return 'the speed is voted ' + (CFG.speedVote === 'turn' ? 'between every two turns' : 'before every round');
		if (!t.count) return 'last vote: nobody voted, the speed stayed';
		return 'last vote: ' + t.from.toFixed(3) + ' → ' + t.to.toFixed(3) + ' rad/s, ' + t.count + ' vote' + (t.count > 1 ? 's' : '') + ' cast';
	}
	// The μ sliders are the coefficients of a massRef puck; at any other mass the
	// coefficients the board actually runs on follow the arrow.
	function muText(mu, eff) { return Math.abs(eff - mu) < 0.0005 ? mu.toFixed(3) : mu.toFixed(3) + ' → ' + eff.toFixed(3); }
	function sync() {
		const live = Game.omegaNow, set = CFG.omega, start = Game.omegaStart;
		let omegaText = live.toFixed(3) + ' rad/s';
		if (Math.abs(live - set) > 0.0005) omegaText += ' (ramping to ' + set.toFixed(3) + ')';
		if (start !== set) omegaText += ' (voted; set ' + start.toFixed(3) + ')';
		setText('omegaVal', omegaText);
		setText('muKVal', muText(CFG.muK, muKEff(CFG)));
		setText('muSVal', muText(CFG.muS, muSEff(CFG)));
		setText('massVal', CFG.puckM.toFixed(2) + ' kg · μ ×' + loadFactor(CFG, CFG.puckM).toFixed(2));
		const dh = holdRadius(CFG), pct = dh === Infinity ? '∞' : (100 * dh / CFG.diskR).toFixed(0) + '%';
		let warn = '';
		if (dh > CFG.diskR) warn = ' (nothing is ever ejected)';
		else if (dh < 0.2 * CFG.diskR) warn = ' (meat grinder)';
		setText('ballsLegend', 'players — ' + CFG.ballsPerPlayer + ' balls each, one push per turn');
		setText('hold', 'd_hold/R = ' + pct + warn);
		setText('stop', 'speed range ' + CFG.vMin.toFixed(2) + '–' + CFG.vMax.toFixed(2) + ' m/s; max-throw stops in ~' +
			stopDistance(CFG, CFG.vMax).toFixed(1) + ' m');
	}
	function ballDots(left) {
		let s = '';
		for (let k = 0; k < CFG.ballsPerPlayer; k++) s += k < left ? '●' : '○';
		return s;
	}
	function stateText(seat) {
		if (Game.state === 'aim') return seat.type === 'human'
			? 'P' + (Game.turn + 1) + ': drag to set the stroke, Space to throw'
			: 'P' + (Game.turn + 1) + ' (' + SEAT_LABELS[seat.type] + ') is aiming…';
		if (Game.state === 'resolve') return 'resolving… next seat in ' + Math.max(0, CFG.handoffT - Game.resolveT).toFixed(1) + ' s';
		if (Game.state === 'vote') return 'speed vote — P' + (Game.turn + 1) + ' throws when it closes';
		if (Game.state === 'settle') return 'disk spinning down…';
		return 'game over — ' + seatName(Game.winner) + ' wins · Reset board for a new game';
	}
	function update(w) {
		const roster = Game.roster, n = roster.length;
		syncRoster();
		syncVotes();
		if (Game.omegaNow !== shownOmega) pullOmega(); // follow the motor during a vote ramp
		sync();
		setText('simTime', 't = ' + w.t.toFixed(1) + ' s');
		let lost = 0;
		for (let i = 0; i < w.ownerLosses.length; i++) lost += w.ownerLosses[i];
		setText('puckCount', 'board ' + w.n + ' · throws ' + w.thrown + ' · black holes ' + lost + ' · ' + n + ' seat' + (n > 1 ? 's' : '') + ' × ' + CFG.ballsPerPlayer);
		const seat = roster[Game.turn];
		setText('liveScore', 'on turn: ' + seatName(Game.turn) + ' earns ' + scoreRate(w, Game.turn).toFixed(1) + '/s');
		setText('state', stateText(seat));
		setText('warpStatus', Game.warpStatus);
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i], s = roster[i];
			setNode(r.balls, ballDots(s.balls));
			setNode(r.score, String(displayScore(CFG, n, s.score)));
			r.root.classList.toggle('on', i === Game.turn);
			r.rm.disabled = rows.length <= 1; // the last seat cannot be removed
		}
		if (Game.state !== 'scored') { if (lastText.breakdown !== '') { lastText.breakdown = ''; els.breakdown.innerHTML = ''; } return; }
		let html = '';
		for (let i = 0; i < n; i++) html += '<b style="color:' + seatColor(i) + '">' + seatName(i) + '</b> ' +
			displayScore(CFG, n, roster[i].score) + ' <span class="dim">(' + roster[i].score.toFixed(0) + ' raw)</span>' +
			(i === Game.winner ? ' ← winner' : '') + '<br>';
		if (lastText.breakdown !== html) { lastText.breakdown = html; els.breakdown.innerHTML = html; }
	}
	function optsNow() {
		opts.ring = els.chkRing.checked; opts.preview = els.chkPreview.checked;
		return opts;
	}
	return { bind, update, opts: optsNow, applySetup, applyPreset };
})();
