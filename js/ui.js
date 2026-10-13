// Side-panel wiring. DOM text is written only when a value actually changes;
// update() is throttled to ~5 Hz by main. opts is a shared object mutated in
// place — never allocated in the frame loop.
const UI = (() => {
	const $ = id => document.getElementById(id);
	const els = {};
	const opts = { ring: true, preview: true, mode: 'zones' };
	let lastText = {};
	function setText(id, txt) { if (lastText[id] !== txt) { lastText[id] = txt; els[id].textContent = txt; } }
	function bind(onReset) {
		for (const id of ['omega', 'muK', 'muS', 'omegaVal', 'muKVal', 'muSVal', 'hold', 'stop', 'simTime', 'puckCount', 'liveScore', 'state', 'breakdown', 'btnThrow', 'btnClear', 'btnAuto', 'btnReset', 'btnPause', 'chkRing', 'chkPreview', 'playerType'])
			els[id] = $(id);
		// Every physics input invalidates the ghost: it is only valid for the settings
		// it was simulated with, so a slider move must re-sim it on the next frame.
		// On a spent board (the disk has spun down after the round) the new setting
		// would otherwise never be seen — the disk is stopped and only a reset starts
		// it again — so restart the board as well.
		const onPhys = () => { if (Game.roundEnded) onReset(); Game.invalidateGhost(); };
		els.omega.max = String(CFG.omegaMax);
		els.omega.addEventListener('input', () => { CFG.omega = parseFloat(els.omega.value); sync(); onPhys(); });
		els.muK.addEventListener('input', () => {
			CFG.muK = parseFloat(els.muK.value);
			els.muS.min = String(CFG.muK);
			if (CFG.muS < CFG.muK) { CFG.muS = CFG.muK; els.muS.value = String(CFG.muS); }
			sync(); onPhys();
		});
		els.muS.addEventListener('input', () => { CFG.muS = parseFloat(els.muS.value); sync(); onPhys(); });
		els.btnAuto.addEventListener('click', () => { CFG.omega = autoOmega(CFG); els.omega.value = String(CFG.omega); sync(); onPhys(); });
		els.btnThrow.addEventListener('click', () => Game.queueThrow(performance.now()));
		els.btnClear.addEventListener('click', () => { Game.aim.hasStroke = false; });
		els.btnReset.addEventListener('click', onReset);
		els.btnPause.addEventListener('click', () => { els.btnPause.textContent = Game.togglePause() ? 'Resume' : 'Pause'; });
		els.playerType.addEventListener('change', () => Game.setPlayer(els.playerType.value));
		for (const r of document.querySelectorAll('input[name=recycle]')) {
			r.addEventListener('change', () => { if (r.checked) { CFG.recycleMode = r.value; opts.mode = r.value; } });
			if (r.checked) { CFG.recycleMode = r.value; opts.mode = r.value; }
		}
		sync();
	}
	function sync() {
		setText('omegaVal', CFG.omega.toFixed(3) + ' rad/s');
		setText('muKVal', CFG.muK.toFixed(3));
		setText('muSVal', CFG.muS.toFixed(3));
		const dh = holdRadius(CFG), pct = dh === Infinity ? '∞' : (100 * dh / CFG.diskR).toFixed(0) + '%';
		let warn = '';
		if (dh > CFG.diskR) warn = ' (nothing is ever ejected)';
		else if (dh < 0.2 * CFG.diskR) warn = ' (meat grinder)';
		setText('hold', 'd_hold/R = ' + pct + warn);
		setText('stop', 'speed range ' + CFG.vMin.toFixed(2) + '–' + CFG.vMax.toFixed(2) + ' m/s; max-throw stops in ~' +
			(CFG.vMax * CFG.vMax / (2 * CFG.muK * CFG.g)).toFixed(1) + ' m');
	}
	function update(w) {
		sync();
		setText('simTime', 't = ' + w.t.toFixed(1) + ' s');
		setText('puckCount', 'board ' + w.n + ' / ' + CFG.poolSize + ' · pool ' + poolOf(w, CFG) + ' · throws ' + w.thrown);
		let s = 0;
		for (let i = 0; i < w.n; i++) if (Game.state !== 'aim' || i !== Game.pending) s += fieldValueOf(w, i);
		setText('liveScore', (Game.state === 'scored' ? 'final score = ' : 'live score = ') + s.toFixed(2));
		setText('state', Game.state === 'aim' ? (Game.player === 'human'
			? 'aim: drag to set the stroke, Space to throw'
			: 'bot (' + Game.player + ') is aiming…')
			: Game.state === 'resolve' ? 'resolving… next turn in ' + Math.max(0, CFG.handoffT - Game.resolveT).toFixed(1) + ' s'
			: Game.state === 'settle' ? 'disk spinning down…' : 'scored — press Reset board');
		if (Game.state === 'scored') {
			let html = '';
			for (let i = 0; i < w.n; i++) html += 'puck ' + (i + 1) + ': V = ' + fieldValueOf(w, i).toFixed(2) + '<br>';
			html += '<b>total = ' + Game.finalScore.toFixed(2) + '</b>';
			if (lastText.breakdown !== html) { lastText.breakdown = html; els.breakdown.innerHTML = html; }
		} else if (lastText.breakdown !== '') { lastText.breakdown = ''; els.breakdown.innerHTML = ''; }
	}
	function optsNow() {
		opts.ring = els.chkRing.checked; opts.preview = els.chkPreview.checked;
		return opts;
	}
	return { bind, update, opts: optsNow };
})();
