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
assert(spec.cssText.includes('--kerot-vh') && spec.cssText.includes('@media (max-height: 560px)'),
	'the bundle scales the board box for horizontal smartphone viewports');
assert(!Object.prototype.hasOwnProperty.call(globalThis, 'CFG'), 'the bundled sources stay out of the story page global scope');

/* Two live sessions get isolated renderer surfaces and independent cleanups. */
const vvListeners = {};
fakeWindow.innerHeight = 390;
fakeWindow.visualViewport = {
	height: 312, scale: 1,
	addEventListener(type, fn) { (vvListeners[type] = vvListeners[type] || []).push(fn); },
	removeEventListener(type, fn) { vvListeners[type] = (vvListeners[type] || []).filter(item => item !== fn); }
};
const firstMount = makeMount(), secondMount = makeMount();
firstMount.nodes['.kerot-game'].style = { props: {}, setProperty(k, v) { this.props[k] = String(v); } };
const answers = [];
let firstCleanup = null;
const first = { el: firstMount, key: 'kerot.match-1', opts: { balls: 1, bot: 'random', botDelay: 0, handoffT: 1.5, settleTime: 0.25, schema: 'rim6', theme: 'classic', title: '<safe text>' },
	answer(value) { answers.push(value); spec.result(first, value, 'live'); firstCleanup(); } };
firstCleanup = spec.run(first);
assert.strictEqual(firstMount.nodes['.kerot-game'].style.props['--kerot-vh'], '312px',
	'live session publishes visible mobile viewport height to CSS');
fakeWindow.visualViewport.height = 296;
for (const fn of vvListeners.resize || []) fn();
assert.strictEqual(firstMount.nodes['.kerot-game'].style.props['--kerot-vh'], '296px',
	'visualViewport resize updates --kerot-vh');
const second = { el: secondMount, key: 'kerot.match-2', opts: { balls: 1 }, answer() {} };
const secondCleanup = spec.run(second);
assert.notStrictEqual(firstMount.nodes['.kerot-board']._ctx, secondMount.nodes['.kerot-board']._ctx,
	'each session owns a distinct canvas context');
assert.strictEqual(firstMount.nodes['.kerot-title'].textContent, '<safe text>', 'story text is assigned as text, not HTML');
assert.strictEqual(frames.size, 2, 'both sessions schedule their own frame');
secondCleanup();
assert.strictEqual(frames.size, 1, 'tearing one session down leaves the other running');

const canvas = firstMount.nodes['.kerot-board'];
// The adapter aims the way the page does: a pointer clear of the puck's grab ring
// starts the stroke (the mount's canvas maps 1:1 onto world units here), and a press
// on the puck with no stroke in hand is the throw gesture, which throws nothing yet.
// The mount's renderer maps its box by hand: the board point under a client pixel is
// the renderer's own mapping, so ask the canvas's session context for it. The session
// armed the puck at CFG.launch*, and the first session runs the classic theme on a box
// the stub canvas reports as 720x440 at the launch spot's share of it.
// The stub canvas reports a 720 x 440 box; the renderer fits the 3.6 x 2.2 m board
// into it (a 0.5 dpr stub keeps client px = world * fitScale) and centres it, so a
// board point maps to its own fraction of the box. The mount's armed puck is at
// CFG.launchX/launchY, 3.25 / 1.10 m.
const onBoard = (wx, wy) => ({
	pointerId: 1, clientX: wx * 200, clientY: wy * 200,
	shiftKey: false, cancelable: true, pointerType: 'mouse', timeStamp: 0, preventDefault: noop,
});
const launchX = 3.25, launchY = 1.1;
canvas.dispatch('pointerdown', onBoard(launchX, launchY));
assert.strictEqual(firstMount.nodes['.kerot-throw'].disabled, true, 'a tap on the puck throws nothing while nothing is aimed');
canvas.dispatch('pointerup', onBoard(launchX, launchY));
canvas.dispatch('pointerdown', onBoard(launchX - 0.32 - 0.45, launchY));
canvas.dispatch('pointermove', onBoard(launchX - 0.32 - 0.45, launchY - 0.2));
canvas.dispatch('pointerup', onBoard(launchX - 1.0, launchY - 0.2));
assert.strictEqual(firstMount.nodes['.kerot-throw'].disabled, false, 'aiming enables the throw button');
// Space on a control button is that button's business, not a throw; the stroke is
// still in hand, so the throw button stays enabled.
firstMount.nodes['.kerot-game'].dispatch('keydown', {
	target: firstMount.nodes['.kerot-pause'], code: 'Space', key: ' ', preventDefault: noop
});
assert.strictEqual(firstMount.nodes['.kerot-throw'].disabled, false,
	'Space on a control button does not trigger an unintended throw');
// A click on the puck throws the stroke in hand; the throw is queued and the
// mini-game's own frame commits it, so the turn is no longer the human's after one.
canvas.dispatch('pointerdown', onBoard(launchX, launchY));
const idleFrame = frames.entries().next().value;
frames.delete(idleFrame[0]);
now += 1000 / 60;
idleFrame[1](now);
assert.strictEqual(firstMount.nodes['.kerot-throw'].disabled, true, 'a click on the puck throws the stroke');
firstMount.nodes['.kerot-throw'].click(); // a press while the bot is on turn is a no-op

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
assert.strictEqual((vvListeners.resize || []).length, 0,
	'the completed session removes its visualViewport listener');
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
