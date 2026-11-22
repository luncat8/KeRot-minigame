// One page frame, two ways: the shipped loop gives the game one tick and one batch of
// up to 96 fixed steps a frame and lets a bot think for 0.7 s before it throws; the
// autoplay loop (js/auto.js) spends a wall-clock budget on several such slices, a
// batch of up to 480 steps each, with the think delay dropped. Same table, same seeds,
// same physics — this reads how much game each way plays per frame and how long a game
// takes to finish, which is the speed the Auto ▶ button actually buys.
// Run: node experiments/autoplay.js [games] [seed0]
Object.assign(globalThis,
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/predict.js'),
	require('../js/bots.js'),
	require('../js/vote.js'),
	require('../js/game.js'),
	require('../js/warp.js'));

const GAMES = parseInt(process.argv[2], 10) || 6;
const SEED0 = parseInt(process.argv[3], 10) || 20261122;
const TABLE = ['keeper', 'hunter', 'balanced', 'retriever'];
const DT = 1 / 60; // the page's nominal frame
const CAP_SHIPPED = 96, CAP_AUTO = 480, SLICES_AUTO = 8, BUDGET_MS = 20;
// The frame loop of js/main.js, in both settings. `acc` carries over between frames
// exactly as the page's does; a search (`planning`) holds the board, not the clock.
function play(g, turbo, maxFrames) {
	const think = g.cfg.botDelay;
	g.cfg.botDelay = turbo ? 0 : 0.7;
	const cap = turbo ? CAP_AUTO : CAP_SHIPPED;
	let frames = 0, simS = 0, acc = 0;
	const t0 = performance.now();
	while (g.state !== 'scored' && frames++ < maxFrames) {
		let slices = turbo ? SLICES_AUTO : 1;
		const stop = turbo ? performance.now() + BUDGET_MS : 0;
		do {
			g.tick(DT);
			g.beforeSteps();
			if (!g.planning) { // a search holds the board (and its own slice), as the page does
				acc += DT;
				let steps = 0;
				while (acc >= g.cfg.h && steps < cap) { stepWorld(g.world, g.cfg.h); acc -= g.cfg.h; steps++; }
				if (steps === cap) acc = 0;
				if (steps) { g.afterSteps(steps * g.cfg.h); simS += steps * g.cfg.h; }
			}
			slices--;
		} while (slices && performance.now() < stop && g.state !== 'scored');
	}
	g.cfg.botDelay = think;
	return { frames: frames, simS: simS, wall: performance.now() - t0 };
}
function stats(xs) {
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	return { mean: mean, min: Math.min(...xs), max: Math.max(...xs) };
}

const cfg = Object.assign({}, CFG, { ballsPerPlayer: 4, speedVote: 'round', warp: false, botSpeed: 'auto' });
const g = createGame({ world: createWorld(cfg), roster: createRoster(TABLE, cfg.ballsPerPlayer), cfg: cfg });
const out = {};
for (const turbo of [false, true]) {
	const frames = [], walls = [], sims = [];
	for (let game = 0; game < GAMES; game++) {
		g.reset();
		g.setRngState(SEED0 + game * 7919); // identical boards for both variants
		const r = play(g, turbo, 60000);
		if (g.state !== 'scored') { console.log('FAIL a game never reached SCORED'); process.exit(1); }
		frames.push(r.frames); walls.push(r.wall); sims.push(r.simS);
	}
	out[turbo ? 'auto' : 'shipped'] = { frames: stats(frames), wall: stats(walls), sim: stats(sims) };
}
const pad = (s, n) => String(s).padStart(n);
console.log('variant   frames/game   page s @60 Hz   cpu ms/game   sim s/game');
for (const name of ['shipped', 'auto']) {
	const v = out[name];
	console.log(name.padEnd(9) + pad(v.frames.mean.toFixed(0), 12) + pad((v.frames.mean / 60).toFixed(1), 15) +
		pad(v.wall.mean.toFixed(0), 14) + pad(v.sim.mean.toFixed(1), 13));
}
// A browser paces the shipped loop at its frame rate, so frames are its play time;
// this node loop is not paced, hence cpu ms/game. Autoplay buys frames — the think
// delay is gone and a frame carries up to eight of them — at about the same compute.
const framesRatio = out.shipped.frames.mean / out.auto.frames.mean;
console.log('autoplay finishes the same ' + GAMES + ' seeded games ' + framesRatio.toFixed(1) +
	'× sooner on a page (' + out.shipped.frames.mean.toFixed(0) + ' → ' + out.auto.frames.mean.toFixed(0) +
	' frames), compute per game ' + (out.auto.wall.mean / 1000).toFixed(1) + ' s vs ' +
	(out.shipped.wall.mean / 1000).toFixed(1) + ' s, board at ' +
	(1000 * out.auto.sim.mean / out.auto.wall.mean).toFixed(1) + ' s sim / cpu s');
if (!(framesRatio > 1.5)) { console.log('FAIL autoplay buys less than 1.5× the frames — check the slice budget'); process.exit(1); }
console.log('OK (autoplay frame loop vs shipped: ' + framesRatio.toFixed(1) + '× the play speed)');
