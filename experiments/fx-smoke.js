// Optional presentation smoke: the lazy loader, baked canvas hooks and procedural
// audio, all against stub DOM/canvas/WebAudio. No browser or npm dependency.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
Object.assign(globalThis, require('../js/cfg.js'), require('../js/physics.js'), require('../js/presets.js'));
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

const ops = [], canvases = [], injected = [], winListeners = {}, docListeners = {};
let attached = 'unset', attachCalls = 0;
function makeCtx() {
	return {
		globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
		lineCap: '', lineJoin: '', font: '', textAlign: '', textBaseline: '',
		imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
		save() { }, restore() { }, translate() { }, rotate() { }, scale() { }, setTransform() { },
		beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, rect() { },
		fillRect() { ops.push('fillRect'); }, strokeRect() { ops.push('strokeRect'); },
		fill() { ops.push('fill'); }, stroke() { ops.push('stroke'); }, clip() { }, setLineDash() { },
		drawImage() { ops.push('drawImage'); }, fillText() { }, strokeText() { },
		putImageData() { },
		createRadialGradient() { return { addColorStop() { } }; },
		createLinearGradient() { return { addColorStop() { } }; },
		createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
	};
}
function makeCanvas() {
	const cv = { width: 0, height: 0, style: {}, _ctx: null, parentElement: { dataset: {}, clientWidth: 900, clientHeight: 550 } };
	cv.getContext = () => cv._ctx || (cv._ctx = makeCtx());
	cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: cv.width, height: cv.height });
	canvases.push(cv);
	return cv;
}
class AudioParamStub {
	constructor(ac, name) { this.ac = ac; this.name = name; this.value = 0; this.calls = []; }
	setValueAtTime(v, t) { this.value = v; this.calls.push(['set', v, t]); return this; }
	exponentialRampToValueAtTime(v, t) { this.value = v; this.calls.push(['ramp', v, t]); return this; }
	setTargetAtTime(v, t, c) { this.value = v; this.calls.push(['target', v, t, c]); return this; }
}
class AudioNodeStub {
	constructor(ac, kind) {
		this.ac = ac; this.kind = kind; this.gain = new AudioParamStub(ac, 'gain');
		this.frequency = new AudioParamStub(ac, 'frequency'); this.Q = new AudioParamStub(ac, 'Q');
	}
	connect(dest) { return dest; }
	start(t) { this.ac.starts++; this.startedAt = t; }
	stop(t) { this.ac.stops++; this.stoppedAt = t; }
}
const audioContexts = [];
class AudioContextStub {
	constructor() {
		this.currentTime = 0; this.sampleRate = 48000; this.state = 'suspended'; this.destination = {};
		this.nodes = []; this.starts = 0; this.stops = 0; this.oscillators = 0; this.bufferSources = 0; this.buffers = 0;
		audioContexts.push(this);
	}
	node(kind) { const n = new AudioNodeStub(this, kind); this.nodes.push(n); return n; }
	createGain() { return this.node('gain'); }
	createOscillator() { this.oscillators++; return this.node('oscillator'); }
	createBufferSource() { this.bufferSources++; return this.node('bufferSource'); }
	createBiquadFilter() { return this.node('filter'); }
	createBuffer(ch, len) { this.buffers++; return { getChannelData: () => new Float32Array(len) }; }
	resume() { this.state = 'running'; return Promise.resolve(); }
}
globalThis.ST_SLIDE = ST_SLIDE;
globalThis.seatColor = () => '#ffffff';
globalThis.Render = {
	attach(skin) { attached = skin; attachCalls++; if (skin && skin.setup) skin.setup(CFG, 200, 200, 2); },
};
globalThis.window = {
	AudioContext: AudioContextStub,
	addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
};
globalThis.document = {
	visibilityState: 'visible', head: {}, body: { dataset: {} },
	createElement(tag) {
		if (tag === 'canvas') return makeCanvas();
		return { tag: tag, src: '', async: false, onload: null, onerror: null };
	},
	addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
};
document.head.appendChild = node => {
	if (node.tag !== 'script') return;
	injected.push(node);
	const src = fs.readFileSync(path.join(ROOT, node.src), 'utf8')
		.replace(/\bconst GlassFX =/, 'globalThis.GlassFX =');
	eval('"use strict";' + src);
	if (node.onload) node.onload();
};
function fire(store, type, ev) { for (const fn of store[type] || []) fn(ev || {}); }

const fxSrc = fs.readFileSync(path.join(ROOT, 'js/fx.js'), 'utf8').replace(/\bconst FX =/, 'globalThis.FX =');
eval('"use strict";' + fxSrc);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const bundle = fs.readFileSync(path.join(ROOT, 'games/kerot.js'), 'utf8');
check(/<script src="js\/fx\.js"><\/script>/.test(html) && !/<script[^>]+js\/fx-glass\.js/.test(html),
	'the page loads only the lazy controller, not the add-on');
check(!/GlassFX|fx-glass\.js/.test(bundle), 'the committed story bundle carries no glass add-on');
check(parseQuery('?fx=glass&sfx=1').fx === 'glass' && parseQuery('?fx=glass&sfx=1').sfx === true,
	'the glass URL keys parse into a setup');

FX.set({ visual: false, sound: false });
check(injected.length === 0 && !FX.loaded, 'plain and silent fetch no optional script');
FX.set({ visual: true, sound: true });
check(injected.length === 1 && injected[0].src === 'js/fx-glass.js' && injected[0].async,
	'first glass/sound request injects exactly one local classic script');
check(FX.loaded && !FX.failed && attached === GlassFX.skin, 'the loaded add-on attaches its renderer skin');
check(audioContexts.length === 1 && audioContexts[0].state === 'running' && GlassFX.audio,
	'sound unlocks one running WebAudio context on enable');
const ac = GlassFX.audio.ac;
check(ac.buffers === 1 && ac.bufferSources >= 1, 'the ice hiss uses one baked noise buffer');
check(GlassFX.audio.master.gain.value > 0, 'enabling sound opens the master gain');
const baked = canvases.length;
check(baked >= 5, 'floor, disk, grain, gloss and shadow sprites are baked once', String(baked));
FX.set({ visual: true, sound: false });
check(attached === GlassFX.skin && canvases.length === baked, 'visual-only mode keeps the skin and does not rebake');
check(GlassFX.audio.master.gain.value === 0, 'switching sound off closes the master gain');
FX.set({ visual: false, sound: true });
check(attached === null && GlassFX.sound && GlassFX.audio.master.gain.value > 0,
	'sound-only mode detaches the skin but keeps audio on');
check(injected.length === 1, 'switching modes never injects the add-on twice');

// Skins draw only cached sprites: no gradient or buffer allocation in the hook path.
const w = createWorld(CFG);
const a = spawnPuck(w, 1.00, 1.00, 0), b = spawnPuck(w, 1.18, 1.00, 1);
throwPuck(w, a, -1, 0); throwPuck(w, b, 1, 0);
w.t = 0.1;
const view = { w: w, opts: { theme: 'classic' } };
for (const theme of ['classic', 'kerot']) {
	view.opts.theme = theme;
	const ctx = makeCtx(); ops.length = 0;
	GlassFX.skin.floor(ctx, view, CFG); GlassFX.skin.disk(ctx, view, CFG);
	for (let i = 0; i < w.n; i++) {
		GlassFX.skin.shadow(ctx, view, CFG, i, false);
		GlassFX.skin.puck(ctx, view, CFG, i, i === a);
	}
	check(ops.filter(o => o === 'drawImage').length >= 3 + 3 * w.n,
		theme + ': cached floor, disk, shadow and puck sprites are drawn', String(ops.length));
}

// World-state audio: reset frame, puck clink, black hole, throw and final chime.
FX.set({ visual: true, sound: true });
w.t = 0.1;
FX.frame(1 / 60, w, 'aim', false); // first frame resyncs the tracker after enable
w.t = 0.12;
FX.frame(1 / 60, w, 'aim', false);
check(GlassFX.audio.slide.gain.value > 0, 'sliding pucks open the ice hiss');
let osc = ac.oscillators, srcs = ac.bufferSources;
w.t = 0.2; w.vx[a] = 1; w.vx[b] = -1;
FX.frame(1 / 60, w, 'aim', false);
check(ac.oscillators >= osc + 3 && ac.bufferSources > srcs, 'a puck contact plays glass partials and an ice transient');
osc = ac.oscillators;
w.t = 0.4; w.ownerLosses[0]++; w.n = 1;
FX.frame(1 / 60, w, 'aim', false);
check(ac.oscillators > osc, 'a black-hole capture plays the low void sound');
osc = ac.oscillators;
w.t = 0.6; w.thrown++;
FX.frame(1 / 60, w, 'aim', false);
check(ac.oscillators >= osc + 3, 'a throw plays its release sound');
osc = ac.oscillators;
w.t = 0.8;
FX.frame(1 / 60, w, 'scored', false);
check(ac.oscillators >= osc + 3, 'the scored transition plays a soft glass chime');
FX.set({ visual: true, sound: false });
osc = ac.oscillators;
w.t = 1.0; w.x[a] = CFG.puckR; w.vx[a] = -1;
FX.frame(1 / 60, w, 'scored', false);
check(ac.oscillators === osc, 'silence creates no audio nodes even on a wall contact');
check(GlassFX.audio.master.gain.value === 0, 'silence keeps the master gain closed');

// Page visibility is a second mute path, so a hidden tab cannot leave a hiss running.
FX.set({ visual: true, sound: true });
document.visibilityState = 'hidden'; fire(docListeners, 'visibilitychange');
check(GlassFX.audio.master.gain.value === 0, 'a hidden page mutes the add-on');
document.visibilityState = 'visible'; fire(docListeners, 'visibilitychange');
check(GlassFX.audio.master.gain.value > 0, 'returning to the page unmutes the add-on');
fire(winListeners, 'pointerdown');
check(audioContexts.length === 1 && !FX.failed, 'a user gesture reuses the one audio context');
console.log(fail ? 'FAIL' : 'OK (lazy glass loader, baked canvas skins, procedural ice/glass audio)');
process.exit(fail);
