// Every disk schema (js/field.js): how much of the disk is red / pale / blue, what a
// puck earns on average — over the whole disk and over the part a riding puck can
// hold — plus a PNG preview each (tiny zlib-based encoder, no deps). Gates the two
// things a new schema could break: the palette's red channel has to rise with the
// field value (score = red channel), and the bots' aim points have to be holdable red.
const fs = require('fs'), zlib = require('zlib');
const { CFG, holdRadius } = require('../js/cfg.js');
const { DISK_SCHEMAS, fieldLocal, fieldColor } = require('../js/field.js');
const R = CFG.diskR, rgb = [0, 0, 0];
let fail = 0;
function check(ok, name, extra) { if (!ok) { console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); fail = 1; } }
const pay = v => fieldColor(v, rgb)[0] / 255;

{
	let prev = -Infinity, rising = true;
	for (let k = 0; k <= 2000; k++) { const r = fieldColor(-1 + k / 1000, rgb)[0]; if (r < prev) rising = false; prev = r; }
	console.log('palette pays: blue ' + pay(-1).toFixed(3) + ' · pale ' + pay(0).toFixed(3) + ' · red ' + pay(1).toFixed(3) + ' of the maximum');
	check(rising, 'the palette\'s red channel never falls as the field value rises');
}
// Puck centres a riding puck can hold: inside the hold radius and wholly on the disk.
const hold = Math.min(holdRadius(CFG), R - CFG.puckR);
const N = 200;
function png(file) {
	const W = 220, raw = Buffer.alloc((W * 3 + 1) * W);
	for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
		const x = -R + 2 * R * (px + 0.5) / W, y = -R + 2 * R * (py + 0.5) / W, o = py * (W * 3 + 1) + 1 + px * 3;
		if (x * x + y * y > R * R) { raw[o] = 11; raw[o + 1] = 28; raw[o + 2] = 38; continue; }
		fieldColor(fieldLocal(CFG, x, y), rgb);
		raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
	}
	function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([len, body, crc]); }
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
	fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
fs.mkdirSync(__dirname + '/logs', { recursive: true });
const schema0 = CFG.diskSchema;
console.log('schema        disk: red  pale  blue   mean pay: disk  holdable (centre ≤ ' + (hold / R).toFixed(2) + ' R)');
for (const name of Object.keys(DISK_SCHEMAS)) {
	CFG.diskSchema = name;
	let n = 0, red = 0, blue = 0, sum = 0, hn = 0, hs = 0, vMin = 1, vMax = -1;
	for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
		const x = -R + 2 * R * (gx + 0.5) / N, y = -R + 2 * R * (gy + 0.5) / N, d2 = x * x + y * y;
		if (d2 > R * R) continue;
		const v = fieldLocal(CFG, x, y), p = pay(v);
		n++; sum += p;
		if (v > 0.5) red++; else if (v < -0.5) blue++;
		vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
		if (d2 <= hold * hold) { hn++; hs += p; }
	}
	console.log(name.padEnd(13) + (100 * red / n).toFixed(0).padStart(10) + '%' + (100 * (n - red - blue) / n).toFixed(0).padStart(5) + '%' +
		(100 * blue / n).toFixed(0).padStart(5) + '%' + (sum / n).toFixed(3).padStart(16) + (hs / hn).toFixed(3).padStart(10));
	check(vMin >= -1 && vMax <= 1, name + ': the field stays in [−1, 1]', vMin.toFixed(3) + '…' + vMax.toFixed(3));
	for (const a of DISK_SCHEMAS[name].aims) {
		const d = Math.hypot(a.x, a.y), v = fieldLocal(CFG, a.x, a.y);
		check(d <= hold && v > 0.5, name + ': every bot aim point is holdable and red', 'd ' + (d / R).toFixed(2) + ' R, v ' + v.toFixed(2));
	}
	png(__dirname + '/logs/field-' + name + '.png');
}
CFG.diskSchema = schema0;
console.log('wrote experiments/logs/field-<schema>.png');
console.log(fail ? 'FAIL' : 'OK (palette monotone, schemas in range, aims holdable)');
process.exit(fail);
