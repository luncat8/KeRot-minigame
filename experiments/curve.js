// The pay curve (js/field.js fieldColor) and the red/blue part split (js/score.js
// puckSplit, seatSplit, diskPaintStats). Four questions:
//   1. is the curve monotone in the field value at every allowed setting, and do its
//      anchors stay put — pale 245 at v = 0, ceiling 255 at v = +1 (RED_MAX is the
//      display reference), blue endpoint = payBlue?
//   2. does the default curve reproduce the shipped palette bit for bit?
//   3. does the masked-grid split agree with a direct classification of the paint —
//      a puck's red-part pay and blue-part pay, on the disk and over the rim — and
//      does it add up (red + blue = the rate puckRate pays)?
//   4. do the disk's part shares (diskPaintStats) match a fine quadrature of the map?
Object.assign(globalThis,
	require('../js/cfg.js'),
	require('../js/field.js'),
	require('../js/physics.js'),
	require('../js/score.js'),
	require('../js/players.js'),
	require('../js/rules.js'),
	require('../js/bots.js'));
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }

const rgb = [0, 0, 0];
const R = CFG.diskR, r = CFG.puckR, PUCK_A = Math.PI * r * r;

// 1. Monotone and anchored, over the whole knob grid (the NUM_RANGES ends included).
{
	let worstFall = 0, worstAnchors = '';
	for (const payBlue of [0, 55, 120, 200, 245]) {
		for (const payBend of [0.25, 0.6, 1, 1.8, 4]) {
			CFG.payBlue = payBlue; CFG.payBend = payBend;
			let prev = -Infinity;
			for (let k = 0; k <= 2000; k++) {
				const red = fieldColor(-1 + k / 1000, rgb)[0];
				if (red < prev - 1e-9) worstFall = Math.max(worstFall, prev - red);
				prev = red;
			}
			fieldColor(-1, rgb); const blue = rgb[0];
			fieldColor(0, rgb); const pale = rgb[0];
			fieldColor(1, rgb); const top = rgb[0];
			if (Math.abs(blue - payBlue) > 0.5 || Math.abs(pale - 245) > 0.5 || Math.abs(top - RED_MAX) > 0.5)
				worstAnchors = 'blue ' + payBlue + ' bend ' + payBend + ' → ' + blue.toFixed(1) + '/' + pale.toFixed(1) + '/' + top.toFixed(1);
		}
	}
	CFG.payBlue = 55; CFG.payBend = 1;
	check(worstFall === 0, 'the pay curve never falls as the field value rises, at every setting', worstFall.toFixed(3));
	check(worstAnchors === '', 'the anchors stay pale 245, ceiling 255, blue = payBlue', worstAnchors);
	console.log('curve: monotone across payBlue 0–245 × bend 0.25–4; pale 245 and the 255 ceiling never move');
}

// 2. The default setting is the shipped palette.
{
	const shipped = [
		// v, R, G, B — the palette as it shipped before the curve was adjustable
		[-1, 55, 90, 240], [-0.5, 150, 167.5, 245], [0, 245, 245, 250], [0.5, 250, 162.5, 155], [1, 255, 80, 60],
	];
	let worst = 0;
	for (const [v, R0, G0, B0] of shipped) {
		fieldColor(v, rgb);
		worst = Math.max(worst, Math.abs(rgb[0] - R0), Math.abs(rgb[1] - G0), Math.abs(rgb[2] - B0));
	}
	check(worst < 1e-9, 'payBlue 55, bend 1 reproduce the shipped palette exactly', worst.toExponential(1));
	console.log('default curve: matches the shipped palette at the anchors and midpoints (worst |diff| ' + worst.toExponential(1) + ')');
}

// A fine midpoint quadrature of one puck's pay, split by the paint's colour: the
// reference the masked-grid split has to meet (same shape as experiments/scoring.js;
// the same red/pale/blue cut field-preview.js reports area shares at).
function refSplit(cfg, theta, px, py, n) {
	const step = 2 * r / n, cell = step * step;
	let sum = 0, red = 0, blue = 0;
	for (let j = 0; j < n; j++) {
		const y = py - r + (j + 0.5) * step;
		for (let i = 0; i < n; i++) {
			const x = px - r + (i + 0.5) * step;
			const dx = x - cfg.diskX, dy = y - cfg.diskY;
			if (dx * dx + dy * dy > R * R) continue;
			const qx = x - px, qy = y - py;
			if (qx * qx + qy * qy > r * r) continue;
			const v = fieldWorld(cfg, x, y, theta), pay = fieldColor(v, rgb)[0];
			sum += pay;
			if (v >= 0.5) red += pay;
			if (v <= -0.5) blue += pay;
		}
	}
	return { rate: cell * sum, red: cell * red, blue: cell * blue };
}

// 3. The split against the reference, over all schemas and both curve regimes, on the
// disk and over the rim. The grid is coarse (128 nodes, 1.25 cm) and the pattern is
// the score's own, so a few percent is the floor — the gate is 6 % of the rate.
const schema0 = CFG.diskSchema;
const rng = makeRng(20261122);
{
	let worst = 0, worstAt = '', worstAdd = 0;
	for (const schema of Object.keys(DISK_SCHEMAS)) {
		CFG.diskSchema = schema;
		for (const [payBlue, payBend] of [[55, 1], [0, 0.6], [245, 4]]) {
			CFG.payBlue = payBlue; CFG.payBend = payBend;
			const w = createWorld(CFG);
			for (let k = 0; k < 30; k++) {
				const ang = rng() * Math.PI * 2, rad = R * (0.15 + 0.95 * rng());
				const px = CFG.diskX + Math.cos(ang) * rad, py = CFG.diskY + Math.sin(ang) * rad;
				w.n = 0; w.theta = rng() * Math.PI * 2;
				const i = spawnPuck(w, px, py, 0);
				const got = puckSplit(w, i, { rate: 0, red: 0, pale: 0, blue: 0, area: 0 });
				const ref = refSplit(CFG, w.theta, px, py, 200);
				if (ref.rate < 1e-6) continue;
				const err = Math.max(Math.abs(got.red - ref.red), Math.abs(got.blue - ref.blue), Math.abs(got.rate - ref.rate)) / ref.rate;
				if (err > worst) { worst = err; worstAt = schema + ' blue ' + payBlue + ' bend ' + payBend + ' at ' + (px - CFG.diskX).toFixed(2) + ',' + (py - CFG.diskY).toFixed(2); }
				worstAdd = Math.max(worstAdd, Math.abs(got.red + got.pale + got.blue - got.rate) / (got.rate || 1),
					Math.max(0, -got.blue, -got.pale, -got.red));
			}
		}
	}
	CFG.diskSchema = schema0; CFG.payBlue = 55; CFG.payBend = 1;
	// 10 %, not the 1 % of the total integral (experiments/scoring.js): the part masks
	// step at the colour edge, and the bake's 1.25 cm nodes quantise a puck that sits on
	// one — the paid total is smooth over the same edge, the split is not. The grid is
	// the paid truth; this gate only catches a wrong classification.
	check(worst < 0.10, 'the red/pale/blue split matches the paint classification (worst ' + (100 * worst).toFixed(2) + ' %)', worstAt);
	check(worstAdd < 1e-9, 'the split adds up: red + pale + blue = the paid rate, no negative part', worstAdd.toExponential(1));
	console.log('split vs fine quadrature over 3 schemas × 3 curve settings × 30 pucks: worst ' + (100 * worst).toFixed(2) + ' % of the rate (the colour-edge cell size is the floor)');
}

// The lens path (puck over the rim), where the split integrates each grid on its own.
{
	CFG.diskSchema = schema0;
	const w = createWorld(CFG), out = { rate: 0, red: 0, pale: 0, blue: 0, area: 0 };
	let worst = 0, worstAt = '';
	for (let k = 0; k < 60; k++) {
		const ang = rng() * Math.PI * 2, rad = R - r + rng() * 1.9 * r;
		const px = CFG.diskX + Math.cos(ang) * rad, py = CFG.diskY + Math.sin(ang) * rad;
		w.n = 0; w.theta = rng() * Math.PI * 2;
		const i = spawnPuck(w, px, py, 0);
		const got = puckSplit(w, i, out), ref = refSplit(CFG, w.theta, px, py, 200);
		if (ref.rate < 1e-6) continue;
		const err = Math.max(Math.abs(got.red - ref.red), Math.abs(got.blue - ref.blue)) / PUCK_A / RED_MAX;
		if (err > worst) { worst = err; worstAt = (px - CFG.diskX).toFixed(2) + ',' + (py - CFG.diskY).toFixed(2); }
	}
	// 1 %, twice the total's rim gate (experiments/scoring.js): the mask edge again.
	check(worst < 0.01, 'the split over the rim is within 1 % of a puck of full red', worstAt);
	console.log('split over the rim, 60 pucks: worst ' + (100 * worst).toFixed(2) + ' % of a full-red puck');

}

// 4. The disk's part shares vs a fine quadrature of the map (per schema).
{
	console.log('disk parts (grid bake vs 300² quadrature):');
	const N = 300;
	for (const schema of Object.keys(DISK_SCHEMAS)) {
		CFG.diskSchema = schema;
		const got = diskPaintStats(CFG);
		let inside = 0, nRed = 0, nBlue = 0, sum = 0, sumRed = 0, sumBlue = 0;
		for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
			const x = -R + 2 * R * (gx + 0.5) / N, y = -R + 2 * R * (gy + 0.5) / N;
			if (x * x + y * y > R * R) continue;
			inside++;
			const v = fieldLocal(CFG, x, y), pay = fieldColor(v, rgb)[0];
			sum += pay;
			if (v >= 0.5) { nRed++; sumRed += pay; }
			if (v <= -0.5) { nBlue++; sumBlue += pay; }
		}
		const err = Math.max(
			Math.abs(got.redArea - nRed / inside), Math.abs(got.blueArea - nBlue / inside),
			Math.abs(got.redPay - sumRed / sum), Math.abs(got.bluePay - sumBlue / sum));
		check(err < 0.03, schema + ': the part shares match the fine quadrature', (100 * err).toFixed(2) + ' %');
		console.log('  ' + schema.padEnd(8) + ' red ' + (100 * got.redArea).toFixed(0) + ' % of area → ' + (100 * got.redPay).toFixed(0) + ' % of pay · pale ' +
			(100 * got.paleArea).toFixed(0) + ' % → ' + (100 * got.palePay).toFixed(0) + ' % · blue ' +
			(100 * got.blueArea).toFixed(0) + ' % → ' + (100 * got.bluePay).toFixed(0) + ' %  (worst share err ' + (100 * err).toFixed(2) + ' %)');
	}
	CFG.diskSchema = schema0;
}

// Cost: the split re-walks the pattern per puck — readout rate (5 Hz), a few seats.
{
	CFG.diskSchema = schema0;
	const w = createWorld(CFG);
	const nPucks = 32;
	for (let k = 0; k < nPucks; k++) {
		const ang = k * 2.399963, rad = R * 0.8 * Math.sqrt((k % nPucks) / nPucks);
		spawnPuck(w, CFG.diskX + Math.cos(ang) * rad, CFG.diskY + Math.sin(ang) * rad, 0);
	}
	const out = { rate: 0, red: 0, pale: 0, blue: 0, area: 0 };
	for (let k = 0; k < w.n; k++) puckSplit(w, k, out); // warm up (puckSplit sets its own geo)
	const reps = 20000;
	const t0 = process.hrtime.bigint();
	for (let k = 0; k < reps; k++) for (let i = 0; i < w.n; i++) puckSplit(w, i, out);
	const perPuck = Number(process.hrtime.bigint() - t0) / reps / w.n;
	console.log('cost: ' + perPuck.toFixed(0) + ' ns per puck split — a 4-seat readout at 5 Hz is ' +
		(perPuck * 4 * 5 / 1e6).toFixed(3) + ' ms/s of panel time');
	check(perPuck < 5e4, 'a split readout stays cheap', perPuck.toFixed(0) + ' ns');
}

console.log(fail ? 'FAIL' : 'OK (pay curve monotone and anchored, split matches the paint, parts match the map)');
process.exit(fail);
