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
	function collapse(v) {
		panel.hidden = v;
		document.getElementById('menuTab').hidden = !v;
		setOpen(!v);
	}
	function bindSwipes() {
		const canvas = document.getElementById('c'), help = document.getElementById('help');
		let id = null, from, x, y;
		window.addEventListener('pointerdown', e => {
			if (e.button !== 0 || e.isPrimary === false) return;
			if (e.target === canvas && !Game.canAim()) from = 'board';
			else if (panel.contains(e.target) && !e.target.closest('input,select,textarea')) from = 'menu';
			else if (help.contains(e.target)) from = 'help';
			else return;
			id = e.pointerId; x = e.clientX; y = e.clientY;
		});
		window.addEventListener('pointercancel', e => { if (e.pointerId === id) id = null; });
		window.addEventListener('pointerup', e => {
			if (id === null || e.pointerId !== id) return;
			id = null;
			const dx = e.clientX - x;
			if (Math.abs(dx) < 48 || Math.abs(dx) < 1.5 * Math.abs(e.clientY - y)) return;
			if (from === 'menu' && dx > 0) collapse(true);
			if (from === 'help' && dx < 0) Help.dismiss();
			if (from !== 'board' || Game.canAim()) return;
			if (dx > 0) Help.pin();
			else collapse(false);
		});
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
		document.getElementById('btnCollapse').addEventListener('click', () => collapse(true));
		document.getElementById('menuTab').addEventListener('click', () => collapse(false));
		bindSwipes();
		window.addEventListener('pointerdown', e => {
			if (open && !panel.contains(e.target)) setOpen(false);
		});
		window.addEventListener('keydown', e => { if (e.key === 'Escape' && open) setOpen(false); });
		set(mode);
	}
	function query() { return isFit() ? '' : 'view=side'; }
	return { modes: MODES, set, bind, isFit, toggle, query, get open() { return open; } };
})();
