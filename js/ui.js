// Side-panel wiring. DOM text is written only when a value actually changes.
const UI = (() => {
	const $ = id => document.getElementById(id);
	const els = {};
	let lastText = {};
	function setText(id, txt) { if (lastText[id] !== txt) { lastText[id] = txt; els[id].textContent = txt; } }
	function bind(onReset) {
		for (const id of ['omega', 'muK', 'muS', 'omegaVal', 'muKVal', 'muSVal', 'hold', 'stop', 'simTime', 'puckCount', 'liveScore', 'state', 'breakdown', 'btnThrow', 'btnClear', 'btnAuto', 'btnReset', 'btnPause', 'chkRing', 'chkPreview'])
			els[id] = $(id);
		els.omega.addEventListener('input', () => { CFG.omega = parseFloat(els.omega.value); sync(); });
		els.muK.addEventListener('input', () => {
			CFG.muK = parseFloat(els.muK.value);
			els.muS.min = String(CFG.muK);
			if (CFG.muS < CFG.muK) { CFG.muS = CFG.muK; els.muS.value = String(CFG.muS); }
			sync();
		});
		els.muS.addEventListener('input', () => { CFG.muS = parseFloat(els.muS.value); sync(); });
		els.btnAuto.addEventListener('click', () => { CFG.omega = autoOmega(CFG); els.omega.value = String(CFG.omega); sync(); });
		els.btnThrow.addEventListener('click', () => Game.queueThrow(performance.now()));
		els.btnClear.addEventListener('click', () => { Game.aim.hasStroke = false; });
		els.btnReset.addEventListener('click', onReset);
		els.btnPause.addEventListener('click', () => { els.btnPause.textContent = Game.togglePause() ? 'Resume' : 'Pause'; });
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
		setText('stop', 'max-throw stopping distance = ' + (CFG.vMax * CFG.vMax / (2 * CFG.muK * CFG.g)).toFixed(2) + ' m');
	}
	function update(w) {
		sync();
		setText('simTime', 't = ' + w.t.toFixed(1) + ' s');
		setText('puckCount', 'puck ' + Math.min(w.thrown + (Game.state === 'aim' ? 1 : 0), CFG.pucksPerGame) + ' / ' + CFG.pucksPerGame);
		setText('liveScore', (Game.state === 'scored' ? 'final score = ' : 'live score = ') + totalScore(w).toFixed(2));
		setText('state', Game.state === 'aim' ? 'aim: drag to set the stroke, Space to throw' :
			Game.state === 'resolve' ? 'resolving…' : Game.state === 'settle' ? 'disk spinning down…' : 'scored — press Reset board');
		if (Game.state === 'scored') {
			let html = '';
			for (let i = 0; i < w.n; i++) html += 'puck ' + (i + 1) + ': V = ' + fieldValueOf(w, i).toFixed(2) + '<br>';
			html += '<b>total = ' + Game.finalScore.toFixed(2) + '</b>';
			if (lastText.breakdown !== html) { lastText.breakdown = html; els.breakdown.innerHTML = html; }
		} else if (lastText.breakdown !== '') { lastText.breakdown = ''; els.breakdown.innerHTML = ''; }
	}
	return { bind, update, opts: () => ({ ring: els.chkRing.checked, preview: els.chkPreview.checked }) };
})();
