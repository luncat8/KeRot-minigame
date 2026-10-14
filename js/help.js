// Help drawer: the rules live in a panel parked off the left edge. It slides in when
// a pointer comes near that edge (hover has no equivalent on touch, so a swipe in from
// the edge — or the ? tab — pins it open), and closes when the pointer leaves, when the
// board is touched, or on Escape. Hover is transient; pinned stays until dismissed.
const Help = (() => {
	const EDGE = 28; // px from the left edge that opens the drawer
	const SWIPE = 48; // px of travel that counts as a swipe in/out
	const SWIPE_MS = 700;
	let box = null, tab = null, open = false, pinned = false;
	let sx = 0, sy = 0, st = 0, tracking = false, boxW = 0;
	function show(v) {
		if (open === v) return;
		open = v;
		if (v) boxW = box.offsetWidth || 0; // measured once per opening, not per move
		box.classList.toggle('open', v);
		tab.setAttribute('aria-expanded', v ? 'true' : 'false');
	}
	function dismiss() { pinned = false; show(false); }
	function inside(target) { return target === tab || target === box || box.contains(target); }
	// Hover: near the edge opens it, anywhere right of the drawer closes it again.
	function onMove(e) {
		if (e.pointerType === 'touch') return;
		if (e.clientX <= EDGE) show(true);
		else if (!pinned && e.clientX > boxW + 8) show(false);
	}
	// Touch: a swipe in from the edge opens it pinned, a swipe left on it closes it.
	function touchStart(e) {
		const t = e.touches[0];
		tracking = true; sx = t.clientX; sy = t.clientY; st = e.timeStamp;
	}
	function touchMove(e) {
		if (!tracking) return;
		const t = e.touches[0], dx = t.clientX - sx;
		if (Math.abs(t.clientY - sy) > SWIPE || e.timeStamp - st > SWIPE_MS) { tracking = false; return; }
		if (dx > SWIPE && !open) { pinned = true; show(true); tracking = false; }
		else if (dx < -SWIPE && open) dismiss();
	}
	function bind() {
		box = document.getElementById('help');
		tab = document.getElementById('helpTab');
		document.getElementById('helpClose').addEventListener('click', dismiss);
		tab.addEventListener('click', () => { pinned = !pinned; show(pinned); });
		window.addEventListener('pointermove', onMove);
		// A tap out on the board closes a pinned drawer, so it never blocks a stroke.
		window.addEventListener('pointerdown', e => { if (pinned && !inside(e.target)) dismiss(); });
		window.addEventListener('touchstart', touchStart, { passive: true });
		window.addEventListener('touchmove', touchMove, { passive: true });
		window.addEventListener('touchend', () => { tracking = false; }, { passive: true });
		window.addEventListener('keydown', e => { if (e.key === 'Escape' && pinned) dismiss(); });
	}
	return { bind };
})();
