// View layout: 'fit' (the default) gives the visible viewport to the board — a narrow
// rail of the transport buttons runs down the right edge (a bar under the board in
// portrait), and the settings slide over it as a drawer; 'side' keeps the panel in the
// row beside the board. The CSS owns both shapes (index.html keys them off
// body[data-fit]); this module owns the switch, the rail's settings button, the
// drawer's open/close and the refit the board needs when its box changes shape.
const View = (() => {
	// The keys are the `view` URL values (js/presets.js VIEWS); the labels are the panel.
	const MODES = { fit: { label: 'fit — board fills the screen' }, side: { label: 'side panel' } };
	let mode = 'fit', btn = null, panel = null, onResize = null, open = false;
	function isFit() { return mode === 'fit'; }
	function setOpen(v) {
		open = !!v && isFit();
		if (panel) { panel.classList.toggle('open', open); panel.scrollTop = 0; }
		if (btn) { btn.classList.toggle('on', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
		if (onResize) onResize(); // the drawer owns the rail's width: the board box moved
	}
	function toggle() { setOpen(!open); }
	function set(m) {
		if (!MODES[m] || m === mode) return mode !== m;
		mode = m;
		document.body.dataset.fit = m === 'fit' ? '1' : '0';
		setOpen(false);
		return true;
	}
	function bind(refit) {
		onResize = refit;
		btn = document.getElementById('btnSettings');
		panel = document.getElementById('panel');
		btn.addEventListener('click', toggle);
		// Moving off the settings closes them (a pointer left of the panel, or a tap out
		// on the board, does the same). Touch has no hover: there ☰ is the way in and out.
		window.addEventListener('pointermove', e => {
			if (!isFit() || !open || e.pointerType === 'touch') return;
			if (e.clientX < window.innerWidth - (panel.offsetWidth || 0) - 4) setOpen(false);
		});
		window.addEventListener('pointerdown', e => {
			if (open && !panel.contains(e.target)) setOpen(false);
		});
		window.addEventListener('keydown', e => { if (e.key === 'Escape' && open) setOpen(false); });
		set(mode);
	}
	function query() { return isFit() ? '' : 'view=side'; }
	return { modes: MODES, set, bind, isFit, toggle, query, get open() { return open; } };
})();
