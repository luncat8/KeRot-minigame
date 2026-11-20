// Optional presentation smoke: the lazy loader, baked canvas hooks and procedural
// audio, all against stub DOM/canvas/WebAudio. No browser or npm dependency.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
Object.assign(globalThis, require('../js/cfg.js'), require('../js/physics.js'), require('../js/presets.js'));
// The scattered-paint bake reuses the shipped field painter; the smoke's stub canvas
// supports exactly what bakeFieldCanvas needs.
const fieldLib = require('../js/field.js');
globalThis.bakeFieldCanvas = fieldLib.bakeFieldCanvas;
const schema0 = CFG.diskSchema;
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

const ops = [], canvases = [], injected = [], winListeners = {}, docListeners = {};
let attached = 'unset', attachCalls = 0;
function makeCtx() {
	const stack = [];
	return {
		globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
		lineCap: '', lineJoin: '', font: '', textAlign: '', textBaseline: '',
		imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
		save() { stack.push(this.globalAlpha, this.globalCompositeOperation); },
		restore() { this.globalCompositeOperation = stack.pop(); this.globalAlpha = stack.pop(); },
		translate() { }, rotate() { }, scale() { }, setTransform() { },
		beginPath() { }, closePath() { }, moveTo() { }, lineTo() { }, arc() { }, rect() { },
		fillRect() { ops.push('fillRect'); }, strokeRect() { ops.push('strokeRect'); },
		fill() { ops.push('fill'); }, stroke() { ops.push('stroke'); }, clip() { }, setLineDash() { },
		drawImage() { ops.push(this.globalCompositeOperation === 'multiply' ? 'shade' : this.globalCompositeOperation === 'lighter' ? 'glow' : 'drawImage'); },
		fillText() { }, strokeText() { },
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
		this.pan = new AudioParamStub(ac, 'pan');
	}
	connect(dest) { return dest; }
	start(t) { this.ac.starts++; this.startedAt = t; }
	stop(t) { this.ac.stops++; this.stoppedAt = t; }
}
const audioContexts = [];
class AudioContextStub {
	constructor() {
		this.currentTime = 0; this.sampleRate = 48000; this.state = 'suspended'; this.destination = {};
		this.nodes = []; this.starts = 0; this.stops = 0; this.oscillators = 0; this.bufferSources = 0; this.buffers = 0; this.panners = 0;
		audioContexts.push(this);
	}
	node(kind) { const n = new AudioNodeStub(this, kind); this.nodes.push(n); return n; }
	createGain() { return this.node('gain'); }
	createOscillator() { this.oscillators++; return this.node('oscillator'); }
	createBufferSource() { this.bufferSources++; return this.node('bufferSource'); }
	createBiquadFilter() { return this.node('filter'); }
	createStereoPanner() { this.panners++; return this.node('panner'); }
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
const decoQ = parseQuery('?decor=hex&face=bottom&vol=0.8');
check(decoQ.decor === 'hex' && decoQ.face === 'bottom' && Math.abs(decoQ.vol - 0.8) < 1e-9,
	'the decor, listener and volume URL keys parse');
check(parseQuery('?vol=9').vol === 2 && !parseQuery('?vol=abc'),
	'the volume key clamps to the slider range and drops a non-number');

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
check(GlassFX.audio.pan && GlassFX.audio.pan.kind === 'panner',
	'the ice hiss reaches the ears through a stereo panner');
FX.set({ visual: false, sound: true, vol: 0.5 });
check(Math.abs(GlassFX.audio.master.gain.value - 0.32 * 0.5) < 1e-9,
	'the volume setting scales the master gain', String(GlassFX.audio.master.gain.value));
FX.set({ visual: false, sound: true, vol: 1.3 });
check(Math.abs(GlassFX.audio.master.gain.value - 0.32 * 1.3) < 1e-9,
	'the shipped volume is 1.3x the original level', String(GlassFX.audio.master.gain.value));

// Skins draw only cached sprites: no gradient or buffer allocation in the hook path.
const w = createWorld(CFG);
const a = spawnPuck(w, 1.00, 1.00, 0), b = spawnPuck(w, 1.18, 1.00, 1);
throwPuck(w, a, -1, 0); throwPuck(w, b, 1, 0);
w.t = 0.1;
const view = { w: w, opts: { theme: 'classic' } };
for (const theme of ['classic', 'kerot']) {
	view.opts.theme = theme;
	const ctx = makeCtx(); ops.length = 0;
	GlassFX.skin.floor(ctx, view, CFG);
	const before = ops.filter(o => o === 'drawImage').length;
	GlassFX.skin.disk(ctx, view, CFG);
	// Scattered paint under the glaze, then the polished surface over both.
	check(ops.filter(o => o === 'drawImage').length >= before + 3,
		theme + ': the disk stacks scattered paint, glaze and polish', String(ops.length));
	ops.length = 0;
	GlassFX.skin.surface(ctx, view, CFG);
	const layers = ops.join(',');
	check(layers === 'drawImage,shade,glow,shade,glow',
		theme + ': the veil, each lamp seat multiplied, each tube added', layers);
	const surfaceOps = ops.length;
	for (let i = 0; i < w.n; i++) {
		GlassFX.skin.shadow(ctx, view, CFG, i, false);
		GlassFX.skin.puck(ctx, view, CFG, i, i === a);
	}
	check(ops.filter(o => o === 'drawImage').length >= 2 * w.n,
		theme + ': cached shadow and puck sprites are drawn', String(ops.length - surfaceOps));
}
// A mirrored lamp is a tube, not a slab: a couple of centimetres wide and many times
// longer, so it can read as a fixture while it stays faint enough to sit under the paint.
const lamps = GlassFX.lamps;
check(lamps.length === 5 && lamps.every(l => l.w <= 0.020 && l.len >= 10 * l.w),
	'every mirrored lamp is a narrow tube', lamps.map(l => l.w.toFixed(3)).join(','));
// The scattered paint is a bake per schema, never per frame.
const fieldBakes = canvases.length;
GlassFX.skin.disk(makeCtx(), view, CFG);
check(canvases.length === fieldBakes, 'the scattered paint is baked once, not per frame');
const otherSchema = CFG.diskSchema === 'rim6' ? 'classic' : 'rim6';
CFG.diskSchema = otherSchema;
GlassFX.skin.disk(makeCtx(), view, CFG);
check(canvases.length > fieldBakes, 'a disk schema change rebakes the scattered paint');
CFG.diskSchema = schema0;

// The disk decor is a baked choice, not a per-frame one: a switch rebakes exactly the
// disk sprite (the hex finish plus its soft 192² cell layer), re-applying is a no-op.
ops.length = 0;
const decorBase = canvases.length;
FX.set({ visual: true, sound: false, decor: 'hex' });
check(GlassFX.decor === 'hex' && canvases.length === decorBase + 2,
	'hex decor rebakes the disk sprite and its soft cell layer', String(canvases.length - decorBase));
const hexStrokes = ops.filter(o => o === 'stroke').length;
check(ops.filter(o => o === 'drawImage').length === 1, 'the hex cells reach the disk as one upscaled soft layer');
FX.set({ visual: true, sound: false, decor: 'hex' });
check(canvases.length === decorBase + 2, 're-applying the same decor does not rebake');
ops.length = 0;
FX.set({ visual: true, sound: false, decor: 'radial' });
check(GlassFX.decor === 'radial' && canvases.length === decorBase + 3, 'switching back rebakes the disk sprite alone');
check(ops.filter(o => o === 'drawImage').length === 0, 'the radial brush needs no sub-layer');
// The hex etching wears about a third of the cell edges away: the kept strokes must
// land near two thirds of the same lattice stroked without wear (deterministic seed).
const hexEdges = hexStrokes - 5; // minus the concentric rings and the rim arc of the disk bake
let fullEdges = 0;
{
	const cR = 192 / 2 - 1, cell = cR / 5.2, dx = 1.5 * cell, dy = Math.sqrt(3) * cell;
	for (let col = -4; col <= 4; col++) for (let row = -4; row <= 4; row++) {
		const ex = col * dx, ey = row * dy + (col & 1 ? dy / 2 : 0);
		if (ex * ex + ey * ey > (cR + cell) * (cR + cell)) continue;
		fullEdges += 6;
	}
}
check(hexEdges > fullEdges * 0.5 && hexEdges < fullEdges * 0.85,
	'the hex cells keep most edges and wear some away', hexEdges + ' of ' + fullEdges);

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
// Every seat colour has its own note: the same wall tap rings at that seat's pitch, and
// two colours meeting ring between them.
function oscillatorFreqs(ac, from) {
	const out = [];
	for (let k = from; k < ac.nodes.length; k++) if (ac.nodes[k].kind === 'oscillator') out.push(ac.nodes[k].frequency.value);
	return out;
}
function panValues(ac, from) {
	const out = [];
	for (let k = from; k < ac.nodes.length; k++) if (ac.nodes[k].kind === 'panner') out.push(ac.nodes[k].pan.value);
	return out;
}
let lastTapPans = [];
const vw = createWorld(CFG);
const vp = spawnPuck(vw, CFG.puckR + 0.004, 1.10, 0);
function wallTap(owner, t, vx, x, y) {
	vw.own[vp] = owner; vw.x[vp] = x === undefined ? CFG.puckR + 0.004 : x; vw.y[vp] = y === undefined ? 1.10 : y;
	vw.st[vp] = ST_SLIDE; vw.vx[vp] = vx; vw.vy[vp] = 0; vw.t = t;
	const from = ac.nodes.length;
	FX.frame(1 / 60, vw, 'aim', false);
	lastTapPans = panValues(ac, from);
	return oscillatorFreqs(ac, from);
}
FX.set({ visual: false, sound: true, face: 'up' });
wallTap(0, 0.2, 2.0); // tracker reset frame
const tapRed = wallTap(0, 0.4, -2.0);
check(lastTapPans.length === 2 && lastTapPans.every(p => p < -0.9),
	'facing up, a tap on the left rail rings in the left ear', lastTapPans.join(','));
wallTap(0, 0.6, 2.0);
const tapViolet = wallTap(3, 0.8, -2.0);
check(tapRed.length === 3 && tapViolet.length === 3, 'a wall tap rings with three partials');
const ratio = tapViolet[0] / tapRed[0];
check(Math.abs(ratio - 1.335) < 0.01, 'each seat colour has its own pitch on a rail tap', ratio.toFixed(3));
// The other two facings: with the head turned to the launch, the top rail is on the
// left; from the bottom edge below the disk, the top rail is dead ahead.
wallTap(0, 1.0, 2.0, CFG.boardW - CFG.puckR - 0.004);
check(lastTapPans.length === 2 && lastTapPans.every(p => p > 0.9),
	'facing up, a tap on the right rail rings in the right ear', lastTapPans.join(','));
FX.set({ visual: false, sound: true, face: 'launch' });
wallTap(0, 1.2, -2.0, CFG.diskX, CFG.puckR + 0.004);
check(lastTapPans.length === 2 && lastTapPans.every(p => p < -0.9),
	'facing the launch, a tap on the top rail rings in the left ear', lastTapPans.join(','));
FX.set({ visual: false, sound: true, face: 'bottom' });
wallTap(0, 1.4, 2.0, CFG.diskX, CFG.puckR + 0.004);
check(lastTapPans.length === 2 && lastTapPans.every(p => Math.abs(p) < 0.05),
	'from the bottom edge, a tap on the top rail is dead ahead', lastTapPans.join(','));
FX.set({ visual: false, sound: true, face: 'launch' });
const pw = createWorld(CFG);
const p0 = spawnPuck(pw, 1.00, 1.10, 0), p1 = spawnPuck(pw, 1.21, 1.10, 0);
function pairClash(t, v0, v1) {
	pw.st[p0] = ST_SLIDE; pw.st[p1] = ST_SLIDE;
	pw.vx[p0] = v0; pw.vy[p0] = 0; pw.vx[p1] = v1; pw.vy[p1] = 0; pw.t = t;
	const from = ac.nodes.length;
	FX.frame(1 / 60, pw, 'aim', false);
	return oscillatorFreqs(ac, from);
}
pairClash(0.2, 1.0, -1.0); // tracker reset frame
const sameColour = pairClash(0.4, -1.0, 1.0);
pw.own[p1] = 7;
pairClash(0.6, 1.0, -1.0);
const mixedColour = pairClash(0.8, -1.0, 1.0);
check(sameColour.length === 3 && mixedColour.length === 3, 'a two-stone contact rings with three partials');
const pairRatio = mixedColour[0] / sameColour[0];
check(Math.abs(pairRatio - Math.sqrt(1.9)) < 0.03,
	'a contact between two colours rings between the two voices', pairRatio.toFixed(3));
console.log(fail ? 'FAIL' : 'OK (lazy glass loader, baked canvas skins, under-ice paint, lamp reflections, per-colour voices, disk decors, stereo listener, volume)');
process.exit(fail);
