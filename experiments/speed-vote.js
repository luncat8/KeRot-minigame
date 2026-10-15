// Speed votes and the motor that applies them. Gated here:
//  1. the tally: the average of the votes cast, "keep" as a change of 0 or as the
//     current speed, "don't care" abstaining, nobody voting = no change, clamped;
//  2. when a vote is due: every turn, or when the order wraps (a new round);
//  3. the motor ramp: theta stays the exact integral, the ramp ends on the setpoint,
//     and a rider pays for the tangential acceleration — a fast change sheds a puck a
//     slow one keeps, and the end-of-game spin-down sheds the outermost riders;
//  4. a still disk that starts turning wakes the pucks it carries (they used to stay
//     asleep, frozen, while the paint turned under them);
//  5. bot votes: the room a speed leaves the next throw, and the riders it keeps —
//     the vote does on the board what the bot predicted;
//  6. the vote phase through the real state machine: it opens at the handoff, takes
//     no throw, closes after voteT, ramps the disk to the tally, clears the votes; a
//     reset restores the configured speed; a direct speed change drops the ramp.
// Run: node experiments/speed-vote.js
Object.assign(globalThis, require('../js/physics.js'), require('../js/score.js'), require('../js/players.js'),
	require('../js/rules.js'), require('../js/predict.js'), require('../js/bots.js'), require('../js/vote.js'));
const fs = require('fs');
eval(fs.readFileSync(require('path').join(__dirname, '../js/game.js'), 'utf8')
	.replace(/^if \(typeof module !== 'undefined'\).*$/m, '')
	.replace(/\bconst (Game) =/, 'globalThis.$1 ='));
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); fail = 1; } }
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-12);
const OM0 = CFG.omega, RULE0 = CFG.speedVote, MODE0 = CFG.voteMode, holdG = muSEff(CFG) * CFG.g;

// 1. The tally.
{
	const c = Object.assign({}, CFG, { voteMode: 'delta' }), r = createRoster(['human', 'human', 'human', 'human'], 4);
	setVote(c, r[0], VOTE_SET, 0.2); setVote(c, r[1], VOTE_SET, -0.1); setVote(c, r[2], VOTE_KEEP, 0); // r[3]: don't care
	check(near(tallySpeed(c, r, 0.8), 0.8 + 0.1 / 3), 'delta: the mean change of the votes cast, keep = 0', tallySpeed(c, r, 0.8));
	check(r.map(s => s.voteLabel).join(' ') === '+.20 −.10 = ', 'labels: change, keep, blank for don\'t care', r.map(s => s.voteLabel).join(' '));
	setVote(c, r[0], VOTE_SET, 3);
	check(r[0].voteValue === c.voteDeltaMax, 'a change is clamped to ±voteDeltaMax', r[0].voteValue);
	clearVotes(c, r);
	check(tallySpeed(c, r, 0.8) === 0.8 && r.every(s => s.vote === VOTE_NONE && s.voteLabel === ''), 'nobody voting leaves the speed alone');
	setVote(c, r[0], VOTE_SET, -0.5);
	check(tallySpeed(c, r, 0.2) === 0, 'the tally never goes below a still disk');
	c.voteMode = 'exact'; clearVotes(c, r);
	setVote(c, r[0], VOTE_SET, 1.2); setVote(c, r[1], VOTE_KEEP, 0);
	check(near(tallySpeed(c, r, 0.8), 1.0), 'exact: the mean target, keep = the current speed', tallySpeed(c, r, 0.8));
	check(r[0].voteLabel === '1.20', 'an exact vote is labelled with its speed', r[0].voteLabel);
	setVote(c, r[2], VOTE_SET, 9);
	check(r[2].voteValue === c.omegaMax, 'an exact vote is clamped to omegaMax');
}
// 2. When a vote is due.
{
	const c = Object.assign({}, CFG);
	c.speedVote = 'off'; check(!tallyDue(c, 3, 0), 'off: never');
	c.speedVote = 'turn'; check(tallyDue(c, 0, 1) && tallyDue(c, 3, 0), 'turn: before every turn');
	c.speedVote = 'round';
	check(!tallyDue(c, 0, 1) && !tallyDue(c, 2, 3) && tallyDue(c, 3, 0), 'round: only when the order wraps');
	check(tallyDue(c, 1, 0) && !tallyDue(c, 0, 1), 'round: seats out of balls are skipped, the wrap still counts');
	check(tallyDue(c, 0, 0), 'round: a lone seat starts a new round every turn');
}
// 3. The motor ramp.
{
	const c = Object.assign({}, CFG), w = createWorld(c), om1 = OM0 + 0.5;
	for (let s = 0; s < 48; s++) stepWorld(w, c.h);
	const th0 = w.theta;
	c.omega = om1; beginSpinRamp(w, om1, 1);
	for (let s = 0; s < 240; s++) stepWorld(w, c.h);
	check(near(spinNow(w), (OM0 + om1) / 2, 1e-12) && near(w.alpha, 0.5, 1e-12), 'halfway up the ramp: the mean speed, α = Δω/T', spinNow(w));
	for (let s = 0; s < 480; s++) stepWorld(w, c.h);
	const want = (OM0 + om1) / 2 * 1 + om1 * 0.5;
	console.log('ramp ' + OM0.toFixed(4) + ' -> ' + om1.toFixed(4) + ' over 1 s, then 0.5 s steady: theta ' + (w.theta - th0).toFixed(12) +
		' vs ' + want.toFixed(12));
	check(near(w.theta - th0, want, 1e-9), 'theta is the exact integral of the ramp', (w.theta - th0 - want).toExponential(2));
	check(w.rampDur === 0 && w.omegaCur === om1 && w.alpha === 0, 'the ramp ends on the setpoint and the disk holds it');
	// A rider at 0.55 m is inside the hold radius at both speeds; only the ramp's
	// tangential acceleration can shed it.
	const shed = dur => {
		const cc = Object.assign({}, CFG), ww = createWorld(cc), i = spawnPuck(ww, cc.diskX + 0.55, cc.diskY, 0);
		ww.st[i] = ST_LOCKED;
		stepWorld(ww, cc.h);
		cc.omega = 0.85; beginSpinRamp(ww, 0.85, dur);
		for (let s = 0; s < 960; s++) stepWorld(ww, cc.h);
		return ww.st[i] !== ST_LOCKED;
	};
	check(0.55 * 0.85 * 0.85 <= holdG, 'the 0.55 m rider is inside the hold radius at 0.85 rad/s');
	const fast = shed(0.05), slow = shed(1);
	console.log('rider at 0.55 m, ω ' + OM0.toFixed(4) + ' -> 0.85: over 0.05 s ' + (fast ? 'shed' : 'kept') + ', over 1 s ' + (slow ? 'shed' : 'kept'));
	check(fast && !slow, 'a fast change sheds the rider, a slow one keeps it');
	// The end-of-game spin-down is a ramp of the same kind: α = ω/settleTime.
	const settle = d => {
		const cc = Object.assign({}, CFG), ww = createWorld(cc), i = spawnPuck(ww, cc.diskX + d, cc.diskY, 0);
		ww.st[i] = ST_LOCKED;
		for (let s = 0; s < 480; s++) stepWorld(ww, cc.h);
		const rode = ww.st[i] === ST_LOCKED;
		beginSettle(ww);
		let k = 0;
		while (!ww.settled && ww.st[i] === ST_LOCKED) { stepWorld(ww, cc.h); k++; }
		return { rode: rode, held: ww.settled, t: k * cc.h };
	};
	const inner = settle(0.60), outer = settle(0.70);
	const dSettle = holdG / Math.hypot(OM0 * OM0, OM0 / CFG.settleTime);
	console.log('spin-down from ' + OM0.toFixed(4) + ' rad/s: hold radius ' + (holdG / (OM0 * OM0)).toFixed(4) + ' m steady, ' +
		dSettle.toFixed(4) + ' m as it starts; rider at 0.60 m ' + (inner.held ? 'rides to the stop' : 'shed at ' + inner.t.toFixed(3) + ' s') +
		', at 0.70 m ' + (outer.held ? 'rides to the stop' : 'shed at ' + outer.t.toFixed(3) + ' s'));
	check(inner.rode && outer.rode, 'both riders ride a steady disk');
	check(inner.held && !outer.held && outer.t < 0.01, 'the spin-down sheds the 0.70 m rider at once and keeps the 0.60 m one');
}
// 4. A still disk that starts turning wakes what it carries.
{
	const c = Object.assign({}, CFG, { omega: 0 }), w = createWorld(c);
	const i = spawnPuck(w, c.diskX + 0.40, c.diskY, 0); // asleep on the still disk
	const j = spawnPuck(w, c.diskX - c.diskR - 0.09, c.diskY, 0); // a sliver over the rim
	for (let s = 0; s < 240; s++) stepWorld(w, c.h);
	check(w.st[i] === ST_SLEEP && w.st[j] === ST_SLEEP, 'both pucks sleep on the still disk');
	const xj = w.x[j], yj = w.y[j];
	c.omega = 0.5;
	for (let s = 0; s < 960; s++) stepWorld(w, c.h);
	const ang = Math.atan2(w.y[i] - c.diskY, w.x[i] - c.diskX);
	console.log('still disk spun up to 0.5 rad/s: the puck it carries is ' + ['sliding', 'riding', 'asleep'][w.st[i]] + ', carried ' +
		ang.toFixed(3) + ' rad in 2 s; the rim sliver moved ' + Math.hypot(w.x[j] - xj, w.y[j] - yj).toExponential(1) + ' m');
	// It starts from rest, so it lags while friction brings it up to the surface speed.
	check(w.st[i] === ST_LOCKED && ang > 0.7, 'the puck on the disk wakes and rides', ang);
	check(w.st[j] === ST_SLEEP && w.x[j] === xj && w.y[j] === yj, 'a sliver the floor holds stays asleep');
}
// 5. A bot's vote does on the board what the bot predicted. Seat 0 rides at 0.40 m,
//    seat 1 near the hold radius at 0.69 m, and seat 2 throws next.
{
	const c = Object.assign({}, CFG, { speedVote: 'turn', voteMode: 'delta' });
	const board = () => {
		const w = createWorld(c);
		const a = spawnPuck(w, c.diskX + 0.40, c.diskY, 0), b = spawnPuck(w, c.diskX - 0.69, c.diskY, 1);
		w.st[a] = ST_LOCKED; w.st[b] = ST_LOCKED;
		stepWorld(w, c.h);
		return w;
	};
	const roster = createRoster(['hunter', 'keeper', 'balanced'], 3), rng = makeRng(7), empty = createWorld(c);
	// An empty board: only the room the next throw has to park on is at stake. At the
	// default speed the disk holds all of itself already, so a slower one adds none.
	c.omega = 0.3;
	check(chooseVote('hunter', empty, c, 0, roster, 2, rng).kind === VOTE_NONE, 'nothing changes within reach: don\'t care');
	c.omega = OM0;
	check(chooseVote('keeper', empty, c, 0, roster, 0, rng).kind === VOTE_KEEP, 'its own throw next, at full room: keep');
	const deny = chooseVote('hunter', empty, c, 0, roster, 2, rng);
	check(deny.kind === VOTE_SET && deny.value > 0, 'an enemy throw next: the hunter asks for less room (faster)', deny.value);
	const w = board();
	const hv = chooseVote('hunter', w, c, 0, roster, 2, rng), hunterVote = { kind: hv.kind, value: hv.value };
	const kv = chooseVote('keeper', w, c, 1, roster, 2, rng);
	console.log('bot votes: hunter (rider at 0.40 m, enemy at 0.69 m) ' + voteLabel(c, hunterVote.kind, hunterVote.value) +
		', keeper (rider at 0.69 m) ' + (voteLabel(c, kv.kind, kv.value) || 'don\'t care'));
	check(hunterVote.kind === VOTE_SET && hunterVote.value !== 0, 'the hunter asks for a change', hunterVote.kind);
	check(kv.kind === VOTE_KEEP, 'the keeper, whose rider rides near the limit, votes keep', kv.kind);
	const after = board();
	c.omega = OM0 + hunterVote.value; beginSpinRamp(after, c.omega, c.spinRampT);
	for (let s = 0; s < 720; s++) stepWorld(after, c.h);
	let ownRides = false, enemyRides = false;
	for (let i = 0; i < after.n; i++) {
		if (after.st[i] !== ST_LOCKED) continue;
		if (after.own[i] === 0) ownRides = true; else enemyRides = true;
	}
	check(ownRides && !enemyRides, 'the hunter\'s vote alone sheds the enemy rider and keeps its own');
	c.omega = OM0;
}
// 6. The vote phase through the real state machine: two humans, rule 'turn'.
function run(cond, limit) {
	let k = 0;
	while (!cond() && k++ < (limit || 20000)) { Game.tick(1 / 60); Game.beforeSteps(); for (let s = 0; s < 8; s++) stepWorld(Game.world, CFG.h); Game.afterSteps(8 * CFG.h); }
	return k;
}
{
	CFG.speedVote = 'turn'; CFG.voteMode = 'delta';
	Game.setSeatTypes(['human', 'human']);
	const w = Game.world;
	check(Game.state === 'aim' && Game.turn === 0, 'the game\'s first turn arms without a vote');
	Game.setAimVel(-0.6, 0); Game.commitThrow();
	run(() => Game.state !== 'resolve');
	check(Game.state === 'vote' && Game.turn === 1 && Game.pending < 0, 'the turn timer hands over to a vote, the next seat lit, no puck armed', Game.state);
	Game.setAimVel(-0.6, 0); Game.queueThrow(0); Game.beforeSteps();
	check(Game.state === 'vote', 'no throw during a vote');
	Game.setVote(0, VOTE_SET, 0.3); Game.setVote(1, VOTE_KEEP, 0);
	const t0 = w.t;
	run(() => Game.state !== 'vote');
	console.log('vote phase: ' + (w.t - t0).toFixed(3) + ' s; ' + OM0.toFixed(4) + ' -> ' + CFG.omega.toFixed(4) + ' rad/s by ' + Game.tally.count + ' votes');
	check(Game.state === 'aim' && Game.turn === 1 && Game.pending >= 0, 'when the vote closes the next seat is armed');
	check(near(w.t - t0, CFG.voteT, 8 * CFG.h + 1e-9), 'the vote lasts voteT', w.t - t0);
	check(near(CFG.omega, OM0 + 0.15, 1e-12) && Game.tally.count === 2, 'the tally is the average of the two votes', CFG.omega);
	check(w.rampDur > 0 && spinNow(w) < CFG.omega, 'the disk ramps to the tally, it does not jump');
	check(Game.roster.every(s => s.vote === VOTE_NONE), 'every vote is back to don\'t care');
	check(Game.omegaStart === OM0, 'the configured speed is remembered');
	run(() => w.rampDur === 0);
	check(w.omegaCur === CFG.omega, 'the ramp ends on the tally');
	Game.reset();
	check(CFG.omega === OM0 && Game.omegaStart === OM0, 'a new game starts from the configured speed');
	// A direct speed change during a ramp: the disk jumps, and it is the new start.
	Game.setAimVel(-0.6, 0); Game.commitThrow();
	run(() => Game.state === 'vote');
	Game.setVote(0, VOTE_SET, -0.4);
	run(() => Game.state !== 'vote');
	check(w.rampDur > 0, 'a ramp is running');
	Game.setOmega(1.0);
	run(() => false, 1);
	check(w.rampDur === 0 && w.omegaCur === 1.0 && Game.omegaStart === 1.0, 'a direct change drops the ramp and becomes the start speed');
	Game.reset();
	check(CFG.omega === 1.0, 'and the next game starts from it');
	Game.setOmega(OM0);
	// The rule switched off while a vote is open: it closes uncounted.
	Game.setAimVel(-0.6, 0); Game.commitThrow();
	run(() => Game.state === 'vote');
	Game.setVote(0, VOTE_SET, 0.5);
	Game.setSpeedRule('off', 'delta');
	check(Game.state === 'aim' && CFG.omega === OM0 && Game.roster[0].vote === VOTE_NONE, 'switching the rule off closes the vote uncounted');
	// Exact votes.
	Game.setSpeedRule('turn', 'exact');
	Game.reset();
	Game.setAimVel(-0.6, 0); Game.commitThrow();
	run(() => Game.state === 'vote');
	Game.setVote(0, VOTE_SET, 1.2); Game.setVote(1, VOTE_SET, 0.6);
	run(() => Game.state !== 'vote');
	check(near(CFG.omega, 0.9, 1e-12), 'exact: the average of the speeds asked for', CFG.omega);
	Game.reset();
}
// Rule 'round', three humans, two balls each: a vote only before the second round.
{
	CFG.speedVote = 'round'; CFG.voteMode = 'delta'; CFG.ballsPerPlayer = 2; CFG.recycleMode = 'none'; // nothing comes back
	Game.setSeatTypes(['human', 'human', 'human']);
	let votes = 0, throws = 0, frames = 0, wasVote = false;
	while (Game.state !== 'scored' && frames++ < 20000) {
		if (Game.state === 'aim') { Game.setAimVel(-0.5, 0.05 * throws); Game.commitThrow(); throws++; }
		run(() => false, 1);
		if (Game.state === 'vote' && !wasVote) votes++;
		wasVote = Game.state === 'vote';
	}
	console.log('round rule, 3 seats x 2 balls: ' + throws + ' throws, ' + votes + ' vote(s)');
	check(Game.state === 'scored' && throws === 6 && votes === 1, 'one vote, before the second round', throws + ' throws, ' + votes + ' votes');
	CFG.ballsPerPlayer = 4; CFG.recycleMode = 'zones'; CFG.speedVote = RULE0; CFG.voteMode = MODE0;
	Game.setSeatTypes(['human', 'balanced', 'blackhole', 'retriever']);
}
console.log(fail ? 'FAIL' : 'OK (tally, schedule, motor ramp, wake on spin-up, bot votes, vote phase)');
process.exit(fail);
