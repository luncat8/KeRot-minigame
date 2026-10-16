'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
childProcess.execFileSync(process.execPath, [path.join(ROOT, 'tools/build-minigame.js'), '--check'], { stdio: 'inherit' });

let now = 0, nextRaf = 1;
const frames = new Map(), windowListeners = {}, documentListeners = {};
function noop() {}
function makeContext() {
	return {
		globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
		save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, setTransform: noop,
		beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop,
		strokeRect: noop, fillRect: noop, stroke: noop, fill: noop, clip: noop, setLineDash: noop,
		drawImage: noop, fillText: noop, strokeText: noop, putImageData: noop,
		createRadialGradient() { return { addColorStop: noop }; },
		createLinearGradient() { return { addColorStop: noop }; },
		createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }
	};
}
class TestPath2D {
	moveTo() {}
	lineTo() {}
	arc() {}
	rect() {}
	closePath() {}
	addPath() {}
}
function makeCanvas() {
	const canvas = {
		width: 0, height: 0, style: {}, _events: {}, _ctx: null,
		parentElement: { clientWidth: 720, clientHeight: 440 },
		getContext() { return this._ctx || (this._ctx = makeContext()); },
		getBoundingClientRect() { return { left: 0, top: 0 }; },
		addEventListener(type, fn) { (this._events[type] = this._events[type] || []).push(fn); },
		removeEventListener(type, fn) {
			const list = this._events[type] || [];
			this._events[type] = list.filter(item => item !== fn);
		},
		dispatch(type, event) { for (const fn of this._events[type] || []) fn(event); },
		setPointerCapture: noop, focus: noop
	};
	return canvas;
}
function makeElement() {
	return {
		textContent: '', innerHTML: '', disabled: false, dataset: {}, attrs: {}, _events: {},
		addEventListener(type, fn) { (this._events[type] = this._events[type] || []).push(fn); },
		removeEventListener(type, fn) {
			const list = this._events[type] || [];
			this._events[type] = list.filter(item => item !== fn);
		},
		dispatch(type, event) { for (const fn of this._events[type] || []) fn(event); },
		setAttribute(name, value) { this.attrs[name] = String(value); },
		click() { for (const fn of this._events.click || []) fn({ target: this }); }
	};
}
function makeMount() {
	let ready = false;
	const nodes = {
		'.kerot-game': makeElement(),
		'.kerot-board': makeCanvas(),
		'.kerot-status': makeElement(),
		'.kerot-scoreline': makeElement(),
		'.kerot-instructions': makeElement(),
		'.kerot-outcome': makeElement(),
		'.kerot-result-note': makeElement(),
		'.kerot-throw': makeElement(),
		'.kerot-clear': makeElement(),
		'.kerot-pause': makeElement(),
		'.kerot-title': makeElement()
	};
	const mount = {
		offsetHeight: 576, _events: {}, nodes,
		addEventListener(type, fn) { (this._events[type] = this._events[type] || []).push(fn); },
		removeEventListener(type, fn) {
			const list = this._events[type] || [];
			this._events[type] = list.filter(item => item !== fn);
		},
		querySelector(selector) { return ready ? nodes[selector] || null : null; }
	};
	Object.defineProperty(mount, 'innerHTML', {
		get() { return this._html || ''; },
		set(value) { this._html = String(value); ready = true; }
	});
	return mount;
}

const fakeDocument = {
	visibilityState: 'visible',
	createElement(tag) { return tag === 'canvas' ? makeCanvas() : makeElement(); },
	addEventListener(type, fn) { (documentListeners[type] = documentListeners[type] || []).push(fn); },
	removeEventListener(type, fn) { documentListeners[type] = (documentListeners[type] || []).filter(item => item !== fn); }
};
const fakeWindow = {
	devicePixelRatio: 1,
	performance: { now: () => now },
	requestAnimationFrame(fn) { const id = nextRaf++; frames.set(id, fn); return id; },
	cancelAnimationFrame(id) { frames.delete(id); },
	addEventListener(type, fn) { (windowListeners[type] = windowListeners[type] || []).push(fn); },
	removeEventListener(type, fn) { windowListeners[type] = (windowListeners[type] || []).filter(item => item !== fn); }
};
globalThis.window = fakeWindow;
globalThis.document = fakeDocument;
globalThis.Path2D = TestPath2D;
let registered = null;
fakeWindow.SnowfallGames = { add(spec) { registered = spec; return true; } };

const bundlePath = path.join(ROOT, 'games/kerot.js');
const spec = require(bundlePath);
assert.strictEqual(spec, registered, 'the script registers its exported game descriptor');
assert.strictEqual(spec.id, 'kerot');
assert.strictEqual(spec.fallback, 0);
assert(spec.cssText.includes('.kerot-slot') && spec.cssText.includes('min-height'), 'the bundle carries its mount-reserving CSS');
assert(!Object.prototype.hasOwnProperty.call(globalThis, 'CFG'), 'the bundled sources stay out of the story page global scope');

/* Two live sessions get isolated renderer surfaces and independent cleanups. */
const firstMount = makeMount(), secondMount = makeMount();
const answers = [];
let firstCleanup = null;
const first = { el: firstMount, key: 'kerot.match-1', opts: { balls: 1, bot: 'random', botDelay: 0, handoffT: 1.5, settleTime: 0.25, schema: 'rim6', theme: 'classic', title: '<safe text>' },
	answer(value) { answers.push(value); spec.result(first, value, 'live'); firstCleanup(); } };
firstCleanup = spec.run(first);
const second = { el: secondMount, key: 'kerot.match-2', opts: { balls: 1 }, answer() {} };
const secondCleanup = spec.run(second);
assert.notStrictEqual(firstMount.nodes['.kerot-board']._ctx, secondMount.nodes['.kerot-board']._ctx,
	'each session owns a distinct canvas context');
assert.strictEqual(firstMount.nodes['.kerot-title'].textContent, '<safe text>', 'story text is assigned as text, not HTML');
assert.strictEqual(frames.size, 2, 'both sessions schedule their own frame');
secondCleanup();
assert.strictEqual(frames.size, 1, 'tearing one session down leaves the other running');

const canvas = firstMount.nodes['.kerot-board'];
const pointer = { pointerId: 1, clientX: 500, clientY: 220, shiftKey: false, cancelable: true, preventDefault: noop };
canvas.dispatch('pointerdown', pointer);
canvas.dispatch('pointermove', pointer);
canvas.dispatch('pointerup', pointer);
assert.strictEqual(firstMount.nodes['.kerot-throw'].disabled, false, 'aiming enables the throw button');
firstMount.nodes['.kerot-game'].dispatch('keydown', {
	target: firstMount.nodes['.kerot-pause'], code: 'Space', key: ' ', preventDefault: noop
});
const idleFrame = frames.entries().next().value;
frames.delete(idleFrame[0]);
now += 1000 / 60;
idleFrame[1](now);
assert.strictEqual(firstMount.nodes['.kerot-throw'].disabled, false,
	'Space on a control button does not trigger an unintended throw');
firstMount.nodes['.kerot-throw'].click();

let frameCount = 0;
while (frames.size && !answers.length && frameCount < 6000) {
	const entry = frames.entries().next().value;
	frames.delete(entry[0]);
	now += 1000 / 60;
	entry[1](now);
	frameCount++;
}
assert.strictEqual(answers.length, 1, 'a short match resolves once');
assert([-1, 0, 1].includes(answers[0]), 'the engine receives one scalar win/draw/loss outcome');
assert.strictEqual(firstMount.nodes['.kerot-game'].dataset.outcome,
	answers[0] > 0 ? 'win' : answers[0] < 0 ? 'loss' : 'draw', 'the live result is painted');
assert.strictEqual(frames.size, 0, 'the resolved game leaves no frame callback behind');
assert.strictEqual(Object.values(canvas._events).reduce((n, events) => n + events.length, 0), 0,
	'the completed session removes its pointer handlers');
firstCleanup();

const skipped = makeMount();
spec.result({ el: skipped }, 0, 'default');
assert.strictEqual(skipped.nodes['.kerot-outcome'].textContent, 'Skipped', 'the neutral fallback does not pretend a match was played');
assert(/skipped/.test(skipped.nodes['.kerot-result-note'].textContent), 'skip mode is explained to the reader');
const saved = makeMount();
spec.result({ el: saved }, -1, 'saved');
assert.strictEqual(saved.nodes['.kerot-outcome'].textContent, 'Opponent wins', 'saved outcomes can replay without mounting physics');
assert(/saved story state/.test(saved.nodes['.kerot-result-note'].textContent), 'saved mode is explained to the reader');

/* A missing runner is a quiet no-op at the bundle boundary. */
delete require.cache[require.resolve(bundlePath)];
const restoreError = console.error;
console.error = noop;
delete fakeWindow.SnowfallGames;
const absent = require(bundlePath);
console.error = restoreError;
assert.strictEqual(absent, null, 'the bundle safely declines to register without SnowfallGames');
console.log('minigame-smoke: bundle, two-session isolation, live match, cleanup, saved and skip results passed (' + frameCount + ' frames)');
