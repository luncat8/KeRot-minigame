// Side-panel wiring. DOM text is written only when a value actually changes;
// update() is throttled to ~5 Hz by main. opts is a shared object mutated in
// place — never allocated in the frame loop.
const UI = (() => {
	const $ = id => document.getElementById(id);
	const els = {};
	const opts = { ring: true, preview: true, mode: 'zones', theme: 'classic' };
	const rows = []; // one per seat: {root, sel, balls, score, rm}
	let lastText = {};
	function setText(id, txt) { if (lastText[id] !== txt) { lastText[id] = txt; els[id].textContent = txt; } }
	function setNode(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
	function bind(onReset) {
		for (const id of ['omega', 'muK', 'muS', 'mass', 'omegaVal', 'muKVal', 'muSVal', 'massVal', 'hold', 'stop', 'simTime', 'puckCount', 'liveScore', 'state', 'breakdown', 'btnThrow', 'btnClear', 'btnAuto', 'btnReset', 'btnPause', 'chkRing', 'chkPreview', 'roster', 'btnAdd', 'diskSchema', 'legendBar', 'legendText', 'theme', 'preset', 'ballsLegend'])
			els[id] = $(id);
		// Every physics input invalidates the ghost: it is only valid for the settings
		// it was simulated with, so a slider move must re-sim it on the next frame.
		// On a spent board (the disk has spun down after the game) the new setting
		// would otherwise never be seen — the disk is stopped and only a reset starts
		// it again — so restart the board as well.
		const onPhys = () => { if (Game.roundEnded) onReset(); Game.invalidateGhost(); markCustom(); };
		els.omega.max = String(CFG.omegaMax);
		els.omega.addEventListener('input', () => { CFG.omega = parseFloat(els.omega.value); sync(); onPhys(); });
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
		els.btnAuto.addEventListener('click', () => { CFG.omega = autoOmega(CFG); els.omega.value = String(CFG.omega); sync(); onPhys(); });
		els.btnThrow.addEventListener('click', () => Game.queueThrow(performance.now()));
		els.btnClear.addEventListener('click', () => { Game.aim.hasStroke = false; });
		els.btnReset.addEventListener('click', onReset);
		els.btnPause.addEventListener('click', () => { els.btnPause.textContent = Game.togglePause() ? 'Resume' : 'Pause'; });
		els.btnAdd.addEventListener('click', () => { Game.addPlayer(nextType()); syncRoster(); markCustom(); });
		for (const r of recycleRadios()) {
			r.addEventListener('change', () => { if (r.checked) { CFG.recycleMode = r.value; opts.mode = r.value; markCustom(); } });
		}
		pullControls();
		syncRoster();
		sync();
	}
	function recycleRadios() { return document.querySelectorAll('input[name=recycle]'); }
	// Any manual control change leaves the bundle the preset select last applied.
	function markCustom() { if (els.preset) els.preset.value = ''; }
	// The controls mirror CFG (after boot parameters and presets), never the stale
	// HTML defaults: every writable control is written here.
	function pullControls() {
		els.omega.value = String(CFG.omega);
		els.muK.value = String(CFG.muK);
		els.muS.value = String(CFG.muS);
		els.muS.min = String(CFG.muK);
		els.mass.value = String(Math.log10(CFG.puckM));
		els.diskSchema.value = CFG.diskSchema;
		els.theme.value = opts.theme;
		for (const r of recycleRadios()) r.checked = r.value === CFG.recycleMode;
		opts.mode = CFG.recycleMode;
	}
	// A setup object (a preset by name, or the URL parameters) applied in one go:
	// CFG first, then the table it asks for, then the looks. Any board-changing key
	// starts a fresh board — a preset is a way to start over on purpose — and a
	// named bundle is echoed into the address bar as its shareable link.
	function applySetup(setup) {
		if (!setup) return;
		applyCfg(setup);
		if (setup.theme && Render.themes[setup.theme]) { opts.theme = setup.theme; document.body.dataset.theme = opts.theme; }
		if (setup.ring !== undefined) els.chkRing.checked = setup.ring;
		if (setup.ghost !== undefined) els.chkPreview.checked = setup.ghost;
		if (setup.seats && setup.seats.length) Game.setSeatTypes(setup.seats); // resets itself
		else if (setup.omega !== undefined || setup.muK !== undefined || setup.muS !== undefined || setup.puckM !== undefined ||
			setup.autoOmega || setup.balls !== undefined || setup.schema || setup.recycle) Game.reset();
		pullControls();
		syncRoster();
		sync();
		if (!setup.preset) return;
		els.preset.value = setup.preset;
		try { history.replaceState(null, '', '?' + presetQuery(setup.preset)); }
		catch (e) { // the address bar may refuse (sandbox, some file:// setups) — the game is already set
		}
	}
	function applyPreset(name) {
		if (!PRESETS[name]) return;
		applySetup(Object.assign({}, PRESETS[name], { preset: name }));
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
	// The μ sliders are the coefficients of a massRef puck; at any other mass the
	// coefficients the board actually runs on follow the arrow.
	function muText(mu, eff) { return Math.abs(eff - mu) < 0.0005 ? mu.toFixed(3) : mu.toFixed(3) + ' → ' + eff.toFixed(3); }
	function sync() {
		setText('omegaVal', CFG.omega.toFixed(3) + ' rad/s');
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
		if (Game.state === 'settle') return 'disk spinning down…';
		return 'game over — ' + seatName(Game.winner) + ' wins · Reset board for a new game';
	}
	function update(w) {
		const roster = Game.roster, n = roster.length;
		syncRoster();
		sync();
		setText('simTime', 't = ' + w.t.toFixed(1) + ' s');
		let lost = 0;
		for (let i = 0; i < w.ownerLosses.length; i++) lost += w.ownerLosses[i];
		setText('puckCount', 'board ' + w.n + ' · throws ' + w.thrown + ' · black holes ' + lost + ' · ' + n + ' seat' + (n > 1 ? 's' : '') + ' × ' + CFG.ballsPerPlayer);
		const seat = roster[Game.turn];
		setText('liveScore', 'on turn: ' + seatName(Game.turn) + ' earns ' + scoreRate(w, Game.turn).toFixed(1) + '/s');
		setText('state', stateText(seat));
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
