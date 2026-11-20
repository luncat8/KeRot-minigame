// Lazy switch for the optional glass presentation. The shipped page loads only this
// small controller: js/fx-glass.js (baked textures, shadows, WebAudio synthesis) is
// fetched on the first request for glass or sound, and the Snowfall bundle needs none
// of it. A WebAudio context is made on a user gesture, never at boot.
const FX = (() => {
	const SRC = 'js/fx-glass.js';
	// decor/face/vol are presentation options: the disk's finish, the listener's
	// placement and facing, and the volume in units of the add-on's base level.
	const state = { visual: false, sound: false, decor: 'radial', face: 'launch', vol: 1.3 };
	let tried = false, ready = false, failed = false, ac = null;
	function needed() { return state.visual || state.sound; }
	function addon() { return typeof GlassFX !== 'undefined' ? GlassFX : null; }
	function load() {
		if (tried || !needed() || typeof document === 'undefined') return;
		tried = true;
		const script = document.createElement('script');
		script.src = SRC;
		script.async = true;
		script.onload = () => { ready = !!addon(); if (!ready) failed = true; apply(); };
		script.onerror = () => { failed = true; };
		(document.head || document.body).appendChild(script);
	}
	function apply() {
		const a = addon();
		if (!a) return;
		if (ac && a.attachAudio) a.attachAudio(ac);
		if (a.set) a.set(state);
		if (typeof Render !== 'undefined' && Render.attach) Render.attach(state.visual ? a.skin : null);
	}
	function unlock() {
		if (!state.sound || typeof window === 'undefined') return;
		const Ctor = window.AudioContext || window.webkitAudioContext;
		if (!Ctor) return;
		if (!ac) ac = new Ctor();
		if (ac.state === 'suspended' && ac.resume) {
			try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { }
		}
		const a = addon();
		if (a && a.attachAudio) a.attachAudio(ac);
	}
	function set(next) {
		if (!next) return;
		const wasSound = state.sound;
		state.visual = !!next.visual;
		state.sound = !!next.sound;
		if (typeof next.decor === 'string') state.decor = next.decor;
		if (typeof next.face === 'string') state.face = next.face;
		if (typeof next.vol === 'number' && isFinite(next.vol)) state.vol = Math.min(2, Math.max(0, next.vol));
		if (needed()) load();
		if (state.sound && !wasSound) unlock();
		apply();
	}
	function frame(dt, w, stateName, paused) {
		const a = addon();
		if (ready && a && a.frame) a.frame(dt, w, stateName, paused);
	}
	if (typeof window !== 'undefined' && window.addEventListener) {
		for (const type of ['pointerdown', 'keydown', 'click']) window.addEventListener(type, unlock, true);
	}
	if (typeof document !== 'undefined' && document.addEventListener) {
		document.addEventListener('visibilitychange', () => {
			const a = addon();
			if (a && a.mute) a.mute(document.visibilityState === 'hidden');
		});
	}
	return {
		set, frame, unlock,
		get visual() { return state.visual; },
		get sound() { return state.sound; },
		get loaded() { return ready; },
		get failed() { return failed; },
	};
})();
globalThis.FX = FX;
if (typeof module !== 'undefined') module.exports = FX;
