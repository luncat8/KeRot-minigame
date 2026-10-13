// Numeric field report + a PNG preview (tiny zlib-based encoder, no deps).
const fs = require('fs'), zlib = require('zlib');
const { CFG } = require('../js/cfg.js');
const { fieldLocal, fieldWorld, fieldColor } = require('../js/field.js');
const N = 200;
let above = 0, sat = 0, inDisk = 0, vMin = 1, vMax = -1;
for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
	const ux = -CFG.diskR + 2 * CFG.diskR * gx / (N - 1), uy = -CFG.diskR + 2 * CFG.diskR * gy / (N - 1);
	if (ux * ux + uy * uy > CFG.diskR * CFG.diskR) continue;
	inDisk++;
	const v = fieldLocal(CFG, ux, uy);
	if (v > 0.5) above++;
	if (v >= 0.999) sat++;
	vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
}
// V=0 crossing along local +x
let cross = -1;
for (let d = 0; d <= CFG.diskR; d += 0.001) if (fieldLocal(CFG, d, 0) <= 0) { cross = d; break; }
console.log('disk area V>0.5: ' + (100 * above / inDisk).toFixed(1) + '%  saturated(+1): ' + (100 * sat / inDisk).toFixed(1) + '%');
console.log('V range on disk: [' + vMin.toFixed(2) + ', ' + vMax.toFixed(2) + ']  V(rim,+x)=' + fieldLocal(CFG, CFG.diskR, 0).toFixed(2) + '  far floor=' + fieldWorld(CFG, 3.5, 2.1, 0).toFixed(2));
console.log('V=0 crossing on +x at ' + cross.toFixed(3) + ' m (d_hold=' + (0.9 * CFG.diskR).toFixed(3) + ' m)');
// PNG of the whole board at theta=0
const W = 360, H = 220, rgb = [0, 0, 0], raw = Buffer.alloc((W * 3 + 1) * H);
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
	fieldColor(fieldWorld(CFG, px / 100, py / 100, 0), rgb);
	const o = py * (W * 3 + 1) + 1 + px * 3;
	raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
}
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([len, body, crc]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(__dirname + '/logs', { recursive: true });
fs.writeFileSync(__dirname + '/logs/field.png', png);
console.log('wrote experiments/logs/field.png');
