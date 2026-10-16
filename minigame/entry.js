'use strict';

const cfgModule = require('../js/cfg.js');
const playerModule = require('../js/players.js');
const botModule = require('../js/bots.js');
const physicsModule = require('../js/physics.js');
const scoreModule = require('../js/score.js');
const gameModule = require('../js/game.js');
const renderModule = require('../js/render.js');
const cssText = require('./style.js');
const registry = globalThis.SnowfallGames;
const BASE_CFG = cfgModule.CFG;
const BOT_PROFILES = botModule.BOT_PROFILES;
const { createRoster } = playerModule;
const { stepWorld } = physicsModule;
const { displayScore } = scoreModule;
const { createGame } = gameModule;
const { createRenderer } = renderModule;
const BOT_NAMES = {
	random: 'random', keeper: 'keeper', hunter: 'hunter',
	retriever: 'retriever', blackhole: 'black hole', balanced: 'balanced'
};
const MIN_BALLS = 1, MAX_BALLS = 4;
const MIN_HANDOFF = 1.5, MAX_HANDOFF = 4;
const MIN_SETTLE = 0.25, MAX_SETTLE = 3;

function bounded(value, fallback, min, max) {
	const n = Number(value);
	return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function settingsFor(opts) {
	const o = opts || {};
	const cfg = Object.assign({}, BASE_CFG);
	const balls = Math.round(bounded(o.balls, 2, MIN_BALLS, MAX_BALLS));
	const bot = Object.prototype.hasOwnProperty.call(BOT_PROFILES, o.bot) ? o.bot : 'balanced';
	cfg.maxPlayers = 2;
	cfg.ballsPerPlayer = balls;
	cfg.maxThrows = balls * 2;
	cfg.recycleMode = 'none';
	cfg.speedVote = 'off';
	cfg.warp = false;
	cfg.botDelay = bounded(o.botDelay, 0.35, 0, 2);
	cfg.handoffT = bounded(o.handoffT, 3, MIN_HANDOFF, MAX_HANDOFF);
	cfg.settleTime = bounded(o.settleTime, 1.2, MIN_SETTLE, MAX_SETTLE);
	if (o.omega !== undefined && o.omega !== null) cfg.omega = bounded(o.omega, cfg.omega, 0, cfg.omegaMax);
	if (o.mass !== undefined && o.mass !== null) cfg.puckM = bounded(o.mass, cfg.puckM, cfg.massMin, cfg.massMax);
	if (['classic', 'circles', 'rim6'].includes(o.schema)) cfg.diskSchema = o.schema;
	return { cfg: cfg, bot: bot, theme: o.theme === 'classic' ? 'classic' : 'kerot' };
}

function idleMarkup() {
	return '<div class="kerot-game kerot-result-only">'
		+ '<header class="kerot-head"><strong class="kerot-title">KE / ROT</strong>'
		+ '<span class="kerot-status">Match result</span></header>'
		+ '<div class="kerot-result-body"><p class="kerot-outcome" aria-live="polite"></p>'
		+ '<p class="kerot-result-note"></p><p class="kerot-scoreline"></p></div></div>';
}

function outcomeName(value) {
	if (value > 0) return 'You win';
	if (value < 0) return 'Opponent wins';
	return 'Draw';
}

function result(g, value, mode) {
	let outcome = g.el.querySelector('.kerot-outcome');
	if (!outcome) {
		g.el.innerHTML = idleMarkup();
		outcome = g.el.querySelector('.kerot-outcome');
	}
	const status = g.el.querySelector('.kerot-status');
	const note = g.el.querySelector('.kerot-result-note');
	const scoreline = g.el.querySelector('.kerot-scoreline');
	outcome.textContent = mode === 'default' ? 'Skipped' : outcomeName(value);
	outcome.dataset.result = value > 0 ? 'win' : value < 0 ? 'loss' : 'draw';
	if (status) status.textContent = mode === 'live' ? 'Final score' : 'Story result';
	if (mode === 'default') {
		if (note) note.textContent = 'The match was skipped; the story fallback is neutral.';
		if (scoreline) scoreline.textContent = 'No match was played.';
		return;
	}
	if (mode === 'saved') {
		if (note) note.textContent = 'This result was replayed from your saved story state.';
		if (scoreline && !scoreline.textContent) scoreline.textContent = 'The earlier match score is not stored by the story engine.';
		return;
	}
	if (note) note.textContent = 'Match complete · result saved by Snowfall.';
}

function run(g) {
	const o = g.opts || {};
	const setup = settingsFor(o);
	const cfg = setup.cfg;
	const roster = createRoster(['human', setup.bot], cfg.ballsPerPlayer);
	const game = createGame({ cfg: cfg, roster: roster, lightBots: true, ghost: false });
	const renderer = createRenderer();
	g.el.innerHTML = '<div class="kerot-game">'
		+ '<header class="kerot-head"><strong class="kerot-title"></strong>'
		+ '<span class="kerot-status" role="status" aria-live="polite"></span></header>'
		+ '<div class="kerot-board-wrap"><canvas class="kerot-board" tabindex="0" role="img"'
		+ ' aria-label="KeRot rotating-disk curling board. Drag to aim, then throw."></canvas></div>'
		+ '<div class="kerot-controls">'
		+ '<p class="kerot-scoreline" aria-live="polite"></p>'
		+ '<p class="kerot-instructions"></p>'
		+ '<div class="kerot-buttons"><button class="kerot-throw" type="button" disabled>Throw stone · Space</button>'
		+ '<button class="kerot-clear" type="button" disabled>Clear aim</button>'
		+ '<button class="kerot-pause" type="button" aria-pressed="false">Pause</button></div>'
		+ '</div><p class="kerot-outcome" aria-live="polite"></p>'
		+ '<p class="kerot-result-note"></p></div>';

	const root = g.el.querySelector('.kerot-game');
	const canvas = g.el.querySelector('.kerot-board');
	const status = g.el.querySelector('.kerot-status');
	const scoreline = g.el.querySelector('.kerot-scoreline');
	const instructions = g.el.querySelector('.kerot-instructions');
	const outcome = g.el.querySelector('.kerot-outcome');
	const note = g.el.querySelector('.kerot-result-note');
	const throwButton = g.el.querySelector('.kerot-throw');
	const clearButton = g.el.querySelector('.kerot-clear');
	const pauseButton = g.el.querySelector('.kerot-pause');
	const title = g.el.querySelector('.kerot-title');
	const theme = renderer.themes[setup.theme] ? setup.theme : 'kerot';
	const viewOpts = { ring: true, preview: false, mode: 'none', theme: theme };
	const view = {
		w: game.world, aim: game.aim, opts: viewOpts, pred: game.pred, roster: game.roster,
		turn: game.turn, resolveT: game.resolveT, voteT: game.voteT, state: game.state
	};
	let active = true, intersecting = true, pageVisible = document.visibilityState !== 'hidden';
	let rafId = 0, last = 0, acc = 0, uiT = 0, dragX = 0, dragY = 0, finished = false;
	let observer = null, resizeObserver = null;

	function canAim() { return game.state === 'aim' && game.turn === 0 && game.pending >= 0; }
	function refreshView() {
		view.turn = game.turn; view.resolveT = game.resolveT; view.voteT = game.voteT; view.state = game.state;
	}
	function draw() { refreshView(); renderer.drawWorld(view); }
	function resize() { renderer.resize(); draw(); }
	function stopLoop() {
		if (!rafId) return;
		window.cancelAnimationFrame(rafId);
		rafId = 0;
	}
	function schedule() {
		if (!active || !intersecting || !pageVisible || game.paused || rafId) return;
		rafId = window.requestAnimationFrame(frame);
	}
	function statusText() {
		if (game.state === 'aim') return game.turn === 0 ? 'Your throw · drag to aim' : 'Opponent lining up a throw…';
		if (game.state === 'resolve') return 'Stone in motion · turn ' + (game.turn + 1) + ' of 2';
		if (game.state === 'settle') return 'Final stones settling…';
		return 'Match complete';
	}
	function updateControls() {
		const humanTurn = canAim();
		throwButton.disabled = !humanTurn || !game.aim.hasStroke || game.paused;
		clearButton.disabled = !humanTurn || !game.aim.hasStroke || game.paused;
		pauseButton.disabled = game.state === 'scored';
		pauseButton.textContent = game.paused ? 'Resume' : 'Pause';
		pauseButton.setAttribute('aria-pressed', game.paused ? 'true' : 'false');
		status.textContent = game.paused ? 'Paused' : statusText();
		scoreline.textContent = 'YOU ' + displayScore(cfg, 2, roster[0].score)
			+ '  ·  ' + BOT_NAMES[setup.bot].toUpperCase() + ' ' + displayScore(cfg, 2, roster[1].score);
	}
	function queueThrow() {
		if (!canAim() || !game.aim.hasStroke || game.paused) return;
		game.queueThrow(window.performance ? window.performance.now() : Date.now());
	}
	function nudge(key, precise) {
		if (!canAim()) return;
		if (!game.aim.hasStroke) game.setStroke(-cfg.dragFull * 0.5, 0, false);
		let speed = Math.hypot(game.aim.vx, game.aim.vy);
		let angle = Math.atan2(game.aim.vy, game.aim.vx);
		const aimGain = precise ? cfg.preciseAimGain : 1;
		const speedGain = precise ? cfg.preciseGain : 1;
		if (key === 'ArrowLeft') angle -= aimGain * Math.PI / 180;
		if (key === 'ArrowRight') angle += aimGain * Math.PI / 180;
		if (key === 'ArrowUp') speed = Math.min(cfg.vMax, speed * (1 + speedGain * 0.02) + speedGain * 0.01);
		if (key === 'ArrowDown') speed = Math.max(cfg.vMin, speed / (1 + speedGain * 0.02) - speedGain * 0.01);
		game.setAimVel(Math.cos(angle) * speed, Math.sin(angle) * speed);
		updateControls();
		draw();
	}
	function onKeyDown(ev) {
		if (ev.target !== canvas || !canAim() || game.paused) return;
		if (ev.code === 'Space' || ev.key === 'Enter') { ev.preventDefault(); queueThrow(); return; }
		if (ev.key === 'Escape') {
			game.aim.hasStroke = false;
			game.invalidateGhost();
			updateControls(); draw();
			return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
		ev.preventDefault();
		nudge(ev.key, ev.shiftKey);
	}
	function pointerDown(ev) {
		if (!canAim() || game.paused) return;
		if (ev.cancelable) ev.preventDefault();
		if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
		const p = renderer.toWorld(ev.clientX, ev.clientY);
		dragX = game.world.x[game.pending]; dragY = game.world.y[game.pending];
		game.aim.dragging = true;
		game.setStroke(p.x - dragX, p.y - dragY, !!ev.shiftKey);
		canvas.focus({ preventScroll: true });
		updateControls(); draw();
	}
	function pointerMove(ev) {
		if (!game.aim.dragging || !canAim() || game.paused) return;
		const p = renderer.toWorld(ev.clientX, ev.clientY);
		game.setStroke(p.x - dragX, p.y - dragY, !!ev.shiftKey);
		updateControls(); draw();
	}
	function pointerUp() { game.aim.dragging = false; }
	function clearAim() {
		if (!canAim()) return;
		game.aim.hasStroke = false;
		game.invalidateGhost();
		updateControls(); draw();
	}
	function togglePause() {
		game.togglePause();
		last = 0; acc = 0;
		updateControls(); draw();
		if (game.paused) stopLoop(); else schedule();
	}
	function frame(now) {
		rafId = 0;
		if (!active || !intersecting || !pageVisible || game.paused) return;
		let dt = last ? (now - last) / 1000 : 1 / 60;
		last = now;
		if (dt > 0.25) dt = 0.25;
		game.tick(dt);
		game.beforeSteps();
		acc += dt;
		let steps = 0;
		while (acc >= cfg.h && steps < 96) { stepWorld(game.world, cfg.h); acc -= cfg.h; steps++; }
		if (steps === 96) acc = 0;
		if (steps) game.afterSteps(steps * cfg.h);
		if (uiT <= 0) {
			uiT = 0.2;
			updateControls();
		}
		uiT -= dt;
		draw();
		if (game.state === 'scored' && !finished) finish();
		schedule();
	}
	function finish() {
		finished = true;
		const delta = roster[0].score - roster[1].score;
		const outcomeValue = Math.abs(delta) < 1e-8 ? 0 : delta > 0 ? 1 : -1;
		scoreline.textContent = 'FINAL  YOU ' + displayScore(cfg, 2, roster[0].score)
			+ '  ·  ' + BOT_NAMES[setup.bot].toUpperCase() + ' ' + displayScore(cfg, 2, roster[1].score);
		status.textContent = 'Match complete';
		g.el.querySelector('.kerot-game').dataset.outcome = outcomeValue > 0 ? 'win' : outcomeValue < 0 ? 'loss' : 'draw';
		g.answer(outcomeValue);
	}
	function onVisibility() {
		pageVisible = document.visibilityState !== 'hidden';
		last = 0; acc = 0;
		if (pageVisible) schedule(); else stopLoop();
	}
	function onIntersection(entries) {
		for (let i = 0; i < entries.length; i++) {
			if (entries[i].target !== g.el) continue;
			intersecting = entries[i].isIntersecting;
			last = 0; acc = 0;
			if (intersecting) schedule(); else stopLoop();
		}
	}

	title.textContent = typeof o.title === 'string' ? o.title : 'KE / ROT · rotating-disk curling';
	instructions.textContent = typeof o.instructions === 'string' ? o.instructions
		: 'Drag from the stone toward the disk to aim. Release, then throw · arrows adjust · Shift = fine control.';
	status.textContent = 'Your throw · drag to aim';
	scoreline.textContent = 'YOU 0  ·  ' + BOT_NAMES[setup.bot].toUpperCase() + ' 0';
	outcome.textContent = '';
	note.textContent = '';
	game.reset();
	if (Number.isFinite(Number(o.seed))) game.setRngState(Number(o.seed) >>> 0);
	renderer.setup(canvas, cfg);
	draw();

	canvas.addEventListener('pointerdown', pointerDown);
	canvas.addEventListener('pointermove', pointerMove);
	canvas.addEventListener('pointerup', pointerUp);
	canvas.addEventListener('pointercancel', pointerUp);
	canvas.addEventListener('lostpointercapture', pointerUp);
	g.el.addEventListener('keydown', onKeyDown);
	throwButton.addEventListener('click', queueThrow);
	clearButton.addEventListener('click', clearAim);
	pauseButton.addEventListener('click', togglePause);
	window.addEventListener('resize', resize);
	document.addEventListener('visibilitychange', onVisibility);
	if (window.ResizeObserver) {
		resizeObserver = new window.ResizeObserver(resize);
		resizeObserver.observe(canvas.parentElement);
	}
	if (window.IntersectionObserver) {
		observer = new window.IntersectionObserver(onIntersection);
		observer.observe(g.el);
	}
	schedule();

	return function() {
		if (!active) return;
		active = false;
		stopLoop();
		if (observer) observer.disconnect();
		if (resizeObserver) resizeObserver.disconnect();
		canvas.removeEventListener('pointerdown', pointerDown);
		canvas.removeEventListener('pointermove', pointerMove);
		canvas.removeEventListener('pointerup', pointerUp);
		canvas.removeEventListener('pointercancel', pointerUp);
		canvas.removeEventListener('lostpointercapture', pointerUp);
		g.el.removeEventListener('keydown', onKeyDown);
		throwButton.removeEventListener('click', queueThrow);
		clearButton.removeEventListener('click', clearAim);
		pauseButton.removeEventListener('click', togglePause);
		window.removeEventListener('resize', resize);
		document.removeEventListener('visibilitychange', onVisibility);
	};
}

const spec = {
	id: 'kerot',
	title: 'KeRot',
	fallback: 0,
	cssText: cssText,
	run: run,
	result: result
};

if (registry && typeof registry.add === 'function') registry.add(spec);
if (typeof module !== 'undefined' && module.exports) module.exports = spec;
