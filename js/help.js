// Hover previews the rules; the help tab or a spectator swipe pins them open.
// The board editor suspends the whole drawer (and its edge hover) while it is open.
const Help = (() => {
	const EDGE = 28; // px from the left edge that opens the drawer
	let box = null, tab = null, open = false, pinned = false, suspended = false;
	let boxW = 0;
	function show(v) {
		if (open === v) return;
		open = v;
		if (v) boxW = box.offsetWidth || 0; // measured once per opening, not per move
		box.classList.toggle('open', v);
		tab.setAttribute('aria-expanded', v ? 'true' : 'false');
	}
	function dismiss() { pinned = false; show(false); }
	// Edit mode owns the screen: while suspended the drawer stays shut and neither the
	// edge hover, the tab, a tap out nor Escape touches it. Resume restores the state.
	function suspend() { if (suspended) return; suspended = true; show(false); }
	function resume() { if (!suspended) return; suspended = false; if (pinned) show(true); }
	function inside(target) { return target === tab || target === box || box.contains(target); }
	// Hover: near the edge opens it, anywhere right of the drawer closes it again.
	function onMove(e) {
		if (suspended || e.buttons || e.pointerType === 'touch') return;
		if (e.clientX <= EDGE) show(true);
		else if (!pinned && e.clientX > boxW + 8) show(false);
	}
	function bind() {
		box = document.getElementById('help');
		tab = document.getElementById('helpTab');
		document.getElementById('helpClose').addEventListener('click', dismiss);
		tab.addEventListener('click', () => { if (suspended) return; pinned = !pinned; show(pinned); });
		window.addEventListener('pointermove', onMove);
		// A tap out on the board closes a pinned drawer, so it never blocks a stroke.
		window.addEventListener('pointerdown', e => { if (!suspended && pinned && !inside(e.target)) dismiss(); });
		window.addEventListener('keydown', e => { if (e.key === 'Escape' && pinned && !suspended) dismiss(); });
	}
	return { bind, dismiss, suspend, resume, pin() { pinned = true; show(true); } };
})();
