// Optional glass-ice presentation, loaded by js/fx.js only when the page asks for it.
// Everything here is additive: the score map, seat rings, numbers, gauges and physics
// stay in the shipped renderer; the skin bakes its sprites once and only draws them.
// Audio is procedural WebAudio (no files): an ice hiss follows total sliding speed,
// glass partials answer puck contacts, and low noise answers walls, holes and throws.
const GlassFX = (() => {
	const TAU = 2 * Math.PI, GOLDEN = 2.399963;
	const TABLE = 128, MASK = TABLE - 1, VOL = 0.32; // VOL is the volume slider's 100 % mark; shipped default is 1.3×
	const SLIDE = typeof ST_SLIDE !== 'undefined' ? ST_SLIDE : 0;
	const REDUCED = typeof window !== 'undefined' && window.matchMedia
		? !!window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
	let visual = false, soundOn = false, pageHidden = false, audio = null, needsReset = true;
	let floorTex = null, diskTex = null, grainTex = null, glossTex = null, shadowTex = null, bakedCfg = null;
	let bakedW = 0, bakedH = 0, softRadius = 0, softScale = 1;
	let glazeTex = null, veilTex = null, softTex = null, softSchema = '';
	// Page-controlled options (pushed by FX.set): the disk's etched finish, the
	// listener's placement and facing, and the volume in units of VOL.
	let lampsOn = false;
	let decorMode = 'radial', faceMode = 'launch', volLevel = 1.3, bakedDecor = '';
	const lampTex = [null, null], lampShade = [null, null];
	const seenUid = new Uint32Array(TABLE), alive = new Uint8Array(TABLE);
	const pvx = new Float64Array(TABLE), pvy = new Float64Array(TABLE);
	const ppx = new Float64Array(TABLE), ppy = new Float64Array(TABLE); // last known spot, for the pan of a puck that just left
	const pst = new Uint8Array(TABLE), lastHit = new Float64Array(TABLE);
	let lastUid = 0, lastT = 0, lastThrown = 0, lastLoss = 0, lastState = '';
	let lastAnyHit = -1e9, lastVoid = -1e9, lastThrow = -1e9, lastRecycle = -1e9, lastEnd = -1e9;

	function limit(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
	function rng(seed) {
		let s = seed >>> 0;
		return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
	}
	function makeCanvas(w, h) {
		const cv = document.createElement('canvas');
		cv.width = w; cv.height = h;
		return cv;
	}
	function cutCircle(g, size, r) {
		const c = size / 2;
		g.globalCompositeOperation = 'destination-in';
		g.fillStyle = '#ffffff';
		g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
		g.globalCompositeOperation = 'source-over';
	}
	function bakeFloorTex() {
		const W = 864, H = 528, cv = makeCanvas(W, H), g = cv.getContext('2d');
		const img = g.createImageData(W, H), data = img.data, r = rng(0x5eed1ce);
		for (let p = 0, n = W * H; p < n; p++) {
			const o = p * 4, light = r(), a = r();
			if (light > 0.5) { data[o] = 225; data[o + 1] = 240; data[o + 2] = 255; }
			else { data[o] = 8; data[o + 1] = 20; data[o + 2] = 36; }
			data[o + 3] = a > 0.975 ? 34 : a > 0.72 ? 13 : 5;
		}
		g.putImageData(img, 0, 0);
		g.lineCap = 'round';
		for (let k = 0; k < 8; k++) { // broad, soft frost swaths under the fine grain
			const x = r() * W, y = r() * H, len = 120 + r() * 260, ang = -0.85 + r() * 0.5;
			g.strokeStyle = 'rgba(220,240,255,0.028)'; g.lineWidth = 10 + r() * 24;
			g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
		}
		for (let k = 0; k < 100; k++) {
			const x = r() * W, y = r() * H, len = 8 + r() * 86, ang = -0.85 + r() * 0.55;
			g.strokeStyle = r() > 0.25 ? 'rgba(225,245,255,0.14)' : 'rgba(3,12,26,0.16)';
			g.lineWidth = r() > 0.9 ? 1.5 : 0.65;
			g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
		}
		for (let k = 0; k < 14; k++) { // a few longer, kinked frozen fissures
			let x = r() * W, y = r() * H;
			g.strokeStyle = 'rgba(210,238,255,0.10)'; g.lineWidth = 1.2;
			g.beginPath(); g.moveTo(x, y);
			for (let j = 0; j < 3; j++) { x += 12 + r() * 38; y += (r() - 0.5) * 18; g.lineTo(x, y); }
			g.stroke();
		}
		const light = g.createRadialGradient(W * 0.22, H * 0.08, 0, W * 0.38, H * 0.32, W * 0.9);
		light.addColorStop(0, 'rgba(255,255,255,0.14)'); light.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = light; g.fillRect(0, 0, W, H);
		const vignette = g.createRadialGradient(W * 0.5, H * 0.45, W * 0.18, W * 0.5, H * 0.5, W * 0.76);
		vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.38)');
		g.fillStyle = vignette; g.fillRect(0, 0, W, H);
		return cv;
	}
	function bakeShadowTex() {
		const S = 192, cv = makeCanvas(S, S), g = cv.getContext('2d'), c = S / 2;
		const grad = g.createRadialGradient(c, c, S * 0.04, c, c, c);
		grad.addColorStop(0, 'rgba(0,0,0,0.78)');
		grad.addColorStop(0.42, 'rgba(0,0,0,0.38)');
		grad.addColorStop(1, 'rgba(0,0,0,0)');
		g.fillStyle = grad; g.fillRect(0, 0, S, S);
		return cv;
	}
	// The paint is not on the surface: it is frozen under a few centimetres of ice, so a
	// marking reaches the eye scattered — low contrast, shifted blue, with frost and
	// trapped air sitting above it. This sprite is that thickness, laid over the paint.
	function bakeGlazeTex() {
		const S = 512, c = S / 2, R = S * 0.5 - 1, cv = makeCanvas(S, S), g = cv.getContext('2d');
		const r = rng(0x3ce1a7);
		g.save(); g.beginPath(); g.arc(c, c, R, 0, TAU); g.clip();
		// Milk thickens toward the rim, where the ice is colder and less skated.
		const milk = g.createRadialGradient(c, c, R * 0.05, c, c, R);
		milk.addColorStop(0, 'rgba(232,246,255,0.018)');
		milk.addColorStop(0.60, 'rgba(214,236,255,0.045)');
		milk.addColorStop(1, 'rgba(186,216,248,0.15)');
		g.fillStyle = milk; g.fillRect(0, 0, S, S);
		for (let k = 0; k < 30; k++) { // frost patches, brighter than the haze around them
			const a = r() * TAU, d = R * Math.sqrt(r()) * 0.94;
			const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, rad = R * (0.05 + 0.17 * r());
			const fr = g.createRadialGradient(x, y, 0, x, y, rad);
			fr.addColorStop(0, 'rgba(255,255,255,' + (0.03 + 0.05 * r()).toFixed(3) + ')');
			fr.addColorStop(1, 'rgba(255,255,255,0)');
			g.fillStyle = fr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
		}
		for (let k = 0; k < 150; k++) { // air trapped between the paint and the surface
			const a = r() * TAU, d = R * Math.sqrt(r());
			const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, rad = 0.9 + 3.2 * r();
			g.strokeStyle = 'rgba(24,52,84,' + (0.09 + 0.13 * r()).toFixed(3) + ')';
			g.lineWidth = 1; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.stroke();
			g.fillStyle = 'rgba(248,255,255,' + (0.10 + 0.16 * r()).toFixed(3) + ')';
			g.beginPath(); g.arc(x - rad * 0.28, y - rad * 0.28, rad * 0.46, 0, TAU); g.fill();
		}
		g.restore();
		cutCircle(g, S, R);
		return cv;
	}
	// Board-wide veil over the zone hatch, the launch box and the disk alike: all of it
	// is paint under ice, so none of it may stay vector-sharp while the ice is frosted.
	// Frost scatters light away from the eye as much as into it: the broad clouds are a
	// cold depth tint that *deepens* the board, and only the pit marks and the sparse
	// frost blooms add light — the veil lowers the floor instead of lifting it.
	function bakeVeilTex() {
		const W = 432, H = 264, cv = makeCanvas(W, H), g = cv.getContext('2d');
		const r = rng(0x7a17e5);
		for (let k = 0; k < 34; k++) {
			const x = r() * W, y = r() * H, rad = 30 + r() * 130;
			const cloud = g.createRadialGradient(x, y, 0, x, y, rad);
			cloud.addColorStop(0, 'rgba(8,22,40,' + (0.06 + 0.10 * r()).toFixed(3) + ')');
			cloud.addColorStop(1, 'rgba(8,22,40,0)');
			g.fillStyle = cloud; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
		}
		for (let k = 0; k < 11; k++) { // the few frost blooms that do catch the light
			const x = r() * W, y = r() * H, rad = 40 + r() * 90;
			const bloom = g.createRadialGradient(x, y, 0, x, y, rad);
			bloom.addColorStop(0, 'rgba(226,244,255,' + (0.03 + 0.04 * r()).toFixed(3) + ')');
			bloom.addColorStop(1, 'rgba(226,244,255,0)');
			g.fillStyle = bloom; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
		}
		for (let k = 0; k < 900; k++) { // frozen-in pit marks, a texel or two each
			const x = r() * W, y = r() * H, s = r() > 0.9 ? 2 : 1;
			g.fillStyle = r() > 0.4 ? 'rgba(240,250,255,' + (0.04 + 0.08 * r()).toFixed(3) + ')'
				: 'rgba(8,22,40,' + (0.05 + 0.08 * r()).toFixed(3) + ')';
			g.fillRect(x, y, s, s);
		}
		return cv;
	}
	// Ceiling lamps mirrored in the ice. A reflection belongs to the surface, not to the
	// disk, so these are baked in board space once and never turn with it. Positions are
	// board metres; two groups shimmer on separate slow phases so the ice is not a decal.
	// A lamp is a narrow tube, not a slab of glow: a dark seat where the housing blocks
	// the sky, a thin segmented bar with a hot filament, and the polish's scratches cut
	// straight through it. The seat multiplies, the tube adds — so a reflection deepens
	// the ice around the light instead of fogging the whole board.
	const LAMPS = [
		{ group: 0, x: 0.62, y: 0.58, len: 0.50, w: 0.019, a: 0.90 },
		{ group: 0, x: 2.14, y: 0.50, len: 0.36, w: 0.015, a: 0.64 },
		{ group: 1, x: 1.40, y: 1.90, len: 0.44, w: 0.017, a: 0.56 },
		{ group: 1, x: 2.84, y: 1.94, len: 0.32, w: 0.014, a: 0.48 },
		{ group: 1, x: 0.24, y: 1.26, len: 0.28, w: 0.012, a: 0.40 },
	];
	// 200 px/m across the board, so the bar's ribs survive the upscale at 1:1; the whole
	// sprite is baked once, so the resolution is free at draw time.
	const LAMP_PPM = 200;
	const LAMP_INK = '255,242,214', LAMP_CORE = '255,252,236', LAMP_FRINGE = '150,198,238';
	// Both ends of every stroke fade out, so no part of the fixture has a drawn-in cap.
	function lampSpan(g, len, ink) {
		const grad = g.createLinearGradient(-len / 2, 0, len / 2, 0);
		grad.addColorStop(0, 'rgba(' + ink + ',0)');
		grad.addColorStop(0.07, 'rgba(' + ink + ',0.55)');
		grad.addColorStop(0.26, 'rgba(' + ink + ',1)');
		grad.addColorStop(0.74, 'rgba(' + ink + ',1)');
		grad.addColorStop(0.93, 'rgba(' + ink + ',0.55)');
		grad.addColorStop(1, 'rgba(' + ink + ',0)');
		return grad;
	}
	// The shade: what the ice does *not* mirror. Baked with black ink; drawn multiply.
	function drawLampShade(g, len, w) {
		g.save(); g.scale(1, 0.46);
		const seat = g.createRadialGradient(0, 0, len * 0.05, 0, 0, len * 0.72);
		seat.addColorStop(0, 'rgba(0,0,0,0.34)');
		seat.addColorStop(0.45, 'rgba(0,0,0,0.15)');
		seat.addColorStop(1, 'rgba(0,0,0,0)');
		g.fillStyle = seat; g.beginPath(); g.arc(0, 0, len * 0.72, 0, TAU); g.fill();
		g.restore();
		// Two soft shelves either side of the tube: the fixture is a body with a diffuser,
		// and that body is the dark line the eye reads the bright line against.
		const ink = lampSpan(g, len, '0,0,0');
		g.strokeStyle = ink; g.lineCap = 'round'; g.globalAlpha = 0.14;
		g.lineWidth = w * 2.0;
		for (let k = -1; k <= 1; k += 2) {
			g.beginPath(); g.moveTo(-len * 0.44, k * w * 1.5); g.lineTo(len * 0.44, k * w * 1.5); g.stroke();
		}
		g.globalAlpha = 1;
	}
	// The light: a pool, a short smear down the line of sight, then the tube itself.
	function drawLamp(g, len, w, a, seed) {
		const r = rng(seed);
		g.save(); g.scale(1, 0.30);
		const pool = g.createRadialGradient(0, 0, 0, 0, 0, len * 0.34);
		pool.addColorStop(0, 'rgba(' + LAMP_INK + ',' + (a * 0.04).toFixed(3) + ')');
		pool.addColorStop(0.55, 'rgba(' + LAMP_INK + ',' + (a * 0.015).toFixed(3) + ')');
		pool.addColorStop(1, 'rgba(' + LAMP_INK + ',0)');
		g.fillStyle = pool; g.beginPath(); g.arc(0, 0, len * 0.34, 0, TAU); g.fill();
		g.restore();
		// Frost blurs the mirror along the line of sight — a little. A tall smear is fog;
		// a short one is what makes the bar read as sitting *under* the surface.
		g.save(); g.scale(1, 2.8);
		const smear = g.createRadialGradient(0, 0, 0, 0, 0, len * 0.16);
		smear.addColorStop(0, 'rgba(' + LAMP_INK + ',' + (a * 0.09).toFixed(3) + ')');
		smear.addColorStop(0.55, 'rgba(' + LAMP_INK + ',' + (a * 0.03).toFixed(3) + ')');
		smear.addColorStop(1, 'rgba(' + LAMP_INK + ',0)');
		g.fillStyle = smear; g.beginPath(); g.arc(0, 0, len * 0.16, 0, TAU); g.fill();
		g.restore();
		const ink = lampSpan(g, len, LAMP_INK), core = lampSpan(g, len, LAMP_CORE);
		const fringe = lampSpan(g, len, LAMP_FRINGE);
		g.lineCap = 'round';
		// The far face of the ice mirrors the tube a second time, dimmer and lower: two
		// bars a few millimetres apart are the difference between a smear and a mirror.
		g.strokeStyle = ink; g.globalAlpha = a * 0.16; g.lineWidth = w * 0.9;
		g.beginPath(); g.moveTo(-len * 0.40, w * 2.6); g.lineTo(len * 0.40, w * 2.6); g.stroke();
		// Bloom, body, filament: thin strokes keep the tube a line, not a slab.
		g.strokeStyle = ink;
		g.globalAlpha = a * 0.10; g.lineWidth = w * 3.4;
		g.beginPath(); g.moveTo(-len * 0.45, 0); g.lineTo(len * 0.45, 0); g.stroke();
		g.globalAlpha = a * 0.44; g.lineWidth = w * 1.5;
		g.beginPath(); g.moveTo(-len * 0.48, 0); g.lineTo(len * 0.48, 0); g.stroke();
		g.strokeStyle = core; g.globalAlpha = a * 0.95; g.lineWidth = Math.max(1.2, w * 0.46);
		g.beginPath(); g.moveTo(-len * 0.50, 0); g.lineTo(len * 0.50, 0); g.stroke();
		// The diffuser's lips: two fainter lines hugging the filament, so the tube reads as
		// a body with edges instead of one painted stroke.
		g.strokeStyle = ink; g.globalAlpha = a * 0.22; g.lineWidth = Math.max(0.9, w * 0.22);
		for (let k = -1; k <= 1; k += 2) {
			g.beginPath(); g.moveTo(-len * 0.46, k * w * 0.85); g.lineTo(len * 0.46, k * w * 0.85); g.stroke();
		}
		// A cool fringe below the warm filament: the ice scatters blue, and that one pixel
		// of colour separation is what stops the bar reading as a white sticker.
		g.strokeStyle = fringe; g.globalAlpha = a * 0.26; g.lineWidth = Math.max(1, w * 0.55);
		g.beginPath(); g.moveTo(-len * 0.42, w * 0.95); g.lineTo(len * 0.42, w * 0.95); g.stroke();
		// Cut glints along the tube: the surface is not flat, so the reflection returns in
		// little pieces where it catches a facet.
		g.fillStyle = 'rgb(' + LAMP_CORE + ')';
		for (let k = 0; k < 7; k++) {
			const gx = (r() - 0.5) * len * 0.88, gy = (r() - 0.5) * w * 0.9;
			const gr = Math.max(0.5, w * (0.16 + 0.22 * r()));
			g.globalAlpha = a * (0.35 + 0.45 * r());
			g.beginPath(); g.arc(gx, gy, gr, 0, TAU); g.fill();
		}
		g.globalAlpha = 1;
		// The polish scratches the mirror: ribs across the diffuser, then free striae down
		// the smear. Punched out of the sprite, so the light is broken, not painted over.
		g.globalCompositeOperation = 'destination-out';
		const ribs = 2 + ((r() * 3) | 0);
		for (let k = 1; k < ribs; k++) {
			const rx = -len / 2 + len * (k + 0.35 * (r() - 0.5)) / ribs;
			g.globalAlpha = 0.18 + 0.24 * r(); g.lineWidth = w * (0.25 + 0.35 * r());
			g.beginPath(); g.moveTo(rx, -w * 1.4); g.lineTo(rx, w * 1.4); g.stroke();
		}
		for (let k = 0; k < 6; k++) {
			const sx = (r() - 0.5) * len * 0.86, sy = (r() - 0.5) * len * 0.16;
			const half = len * (0.10 + 0.10 * r()), drift = (r() - 0.5) * w * 3;
			g.globalAlpha = 0.10 + 0.14 * r(); g.lineWidth = 0.9 + 1.6 * r();
			g.beginPath(); g.moveTo(sx, sy - half); g.lineTo(sx + drift, sy + half); g.stroke();
		}
		g.globalCompositeOperation = 'source-over';
		g.globalAlpha = 1;
	}
	function bakeLampTex(group, cfg, light) {
		const W = Math.round(cfg.boardW * LAMP_PPM), H = Math.round(cfg.boardH * LAMP_PPM);
		const cv = makeCanvas(W, H), g = cv.getContext('2d');
		const kx = W / cfg.boardW, ky = H / cfg.boardH;
		for (let i = 0; i < LAMPS.length; i++) {
			const l = LAMPS[i];
			if (l.group !== group) continue;
			g.save(); g.translate(l.x * kx, l.y * ky);
			if (light) drawLamp(g, l.len * kx, l.w * kx, l.a, 0x1a3 + 97 * i);
			else drawLampShade(g, l.len * kx, l.w * kx);
			g.restore();
		}
		return cv;
	}
	// Scattered copy of the schema: laid over the sharp paint it softens every marking
	// edge without moving it, because it is the same field, only older. 60 px per metre
	// is a couple of centimetres of scatter — depth, not a soft-focus filter — and the
	// two bilinear steps to 192 then to the disk turn its texels into a smooth ramp.
	function bakeSoftField(cfg) {
		if (typeof bakeFieldCanvas !== 'function') return null;
		const box = { x: -cfg.diskR, y: -cfg.diskR, w: 2 * cfg.diskR, h: 2 * cfg.diskR };
		const small = bakeFieldCanvas(box, 60, cfg), S = 192;
		const cv = makeCanvas(S, S), g = cv.getContext('2d');
		g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
		g.drawImage(small, 0, 0, S, S);
		cutCircle(g, S, S * 0.5 - 1);
		softSchema = cfg.diskSchema; softRadius = cfg.diskR; softScale = cfg.scoreScale || 1;
		return cv;
	}
	// Hex decor: a honeycomb etched into the polish. Baked at 192 and drawn upscaled
	// into the 512 disk sprite, so no edge stays vector-sharp — the same softness
	// trick as the scattered paint. Each cell decides its six edges on its own and
	// wears about a third of them away, so a shared edge lands bright (kept from both
	// sides), faint (one side) or missing entirely — a worn etching, not a grid.
	function bakeHexTex() {
		const S = 192, c = S / 2, R = S * 0.5 - 1, cv = makeCanvas(S, S), g = cv.getContext('2d');
		const r = rng(0xce11de);
		const cell = R / 5.2, dx = 1.5 * cell, dy = Math.sqrt(3) * cell;
		g.lineCap = 'round';
		for (let col = -4; col <= 4; col++) {
			for (let row = -4; row <= 4; row++) {
				const x = c + col * dx, y = c + row * dy + (col & 1 ? dy / 2 : 0);
				const ex = x - c, ey = y - c;
				if (ex * ex + ey * ey > (R + cell) * (R + cell)) continue; // wholly outside the disk
				for (let e = 0; e < 6; e++) {
					if (r() < 0.32) continue; // this cell's side of the edge has worn away
					const a0 = e * Math.PI / 3, a1 = a0 + Math.PI / 3;
					g.strokeStyle = r() > 0.2 ? 'rgba(235,250,255,' + (0.040 + 0.05 * r()).toFixed(3) + ')' : 'rgba(8,24,48,0.06)';
					g.lineWidth = 0.9 + 0.7 * r();
					g.beginPath();
					g.moveTo(x + cell * Math.cos(a0), y + cell * Math.sin(a0));
					g.lineTo(x + cell * Math.cos(a1), y + cell * Math.sin(a1));
					g.stroke();
				}
			}
		}
		return cv;
	}
	// Transparent overlay for the rotating disk. Low alpha keeps the field's red
	// channel — the score map — legible; nothing here feeds scoring or bot aims.
	// The etched finish is the page's decor choice, baked once per switch.
	function bakeDiskTex() {
		const S = 512, c = S / 2, R = S * 0.5 - 2, cv = makeCanvas(S, S), g = cv.getContext('2d');
		const r = rng(0xc0ffee);
		g.save(); g.beginPath(); g.arc(c, c, R, 0, TAU); g.clip();
		const sheen = g.createLinearGradient(0, 0, S, S);
		sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
		sheen.addColorStop(0.38, 'rgba(255,255,255,0.02)');
		sheen.addColorStop(0.72, 'rgba(120,180,255,0.035)');
		sheen.addColorStop(1, 'rgba(0,8,24,0.10)');
		g.fillStyle = sheen; g.fillRect(0, 0, S, S);
		const glow = g.createRadialGradient(S * 0.27, S * 0.20, 0, S * 0.27, S * 0.20, S * 0.72);
		glow.addColorStop(0, 'rgba(255,255,255,0.11)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = glow; g.fillRect(0, 0, S, S);
		const streak = g.createLinearGradient(0, S * 0.26, S, S * 0.74);
		streak.addColorStop(0, 'rgba(255,255,255,0)');
		streak.addColorStop(0.44, 'rgba(255,255,255,0.05)');
		streak.addColorStop(0.56, 'rgba(255,255,255,0.05)');
		streak.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = streak; g.fillRect(0, 0, S, S);
		if (decorMode === 'hex') {
			g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
			g.drawImage(bakeHexTex(), 0, 0, S, S);
		} else {
			// Skating scratches at free radii: a random angle, start and length each,
			// so most touch neither the centre nor the rim — worn ice, not a starburst.
			// Shorter lines than the old full-span brush, so more of them, a touch
			// stronger and with a per-scratch jitter, keep the plate read as brushed.
			g.lineWidth = 0.8;
			for (let k = 0; k < 300; k++) {
				const a = r() * TAU, r0 = R * (0.04 + 0.66 * r());
				const r1 = Math.min(R * 0.985, r0 + R * (0.05 + 0.38 * r()));
				g.strokeStyle = k % 3 ? 'rgba(235,250,255,' + (0.045 + 0.025 * r()).toFixed(3) + ')' : 'rgba(8,24,48,0.06)';
				g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
				g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
			}
		}
		g.strokeStyle = 'rgba(235,250,255,0.085)'; g.lineWidth = 1.2;
		for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(c, c, R * (0.20 + 0.18 * k), 0, TAU); g.stroke(); }
		for (let k = 0; k < 850; k++) {
			g.fillStyle = r() > 0.72 ? 'rgba(255,255,255,0.08)' : 'rgba(8,22,42,0.045)';
			const s = r() > 0.96 ? 2 : 1;
			g.fillRect(r() * S, r() * S, s, s);
		}
		const bevel = g.createRadialGradient(c, c, R * 0.80, c, c, R);
		bevel.addColorStop(0, 'rgba(255,255,255,0)');
		bevel.addColorStop(0.86, 'rgba(255,255,255,0)');
		bevel.addColorStop(0.965, 'rgba(235,250,255,0.24)');
		bevel.addColorStop(1, 'rgba(0,8,22,0.30)');
		g.fillStyle = bevel; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
		g.strokeStyle = 'rgba(235,250,255,0.12)'; g.lineWidth = 2.5;
		g.beginPath(); g.arc(c, c, R * 0.93, 0, TAU); g.stroke();
		g.restore();
		cutCircle(g, S, R);
		bakedDecor = decorMode;
		return cv;
	}
	function bakeGrainTex() {
		const S = 128, c = S / 2, R = S * 0.5 - 3, cv = makeCanvas(S, S), g = cv.getContext('2d');
		const r = rng(0x91a2b3);
		g.save(); g.beginPath(); g.arc(c, c, R, 0, TAU); g.clip();
		const shade = g.createRadialGradient(c * 0.72, c * 0.64, 1, c, c, R);
		shade.addColorStop(0, 'rgba(255,255,255,0.22)');
		shade.addColorStop(0.55, 'rgba(255,255,255,0.03)');
		shade.addColorStop(1, 'rgba(0,8,22,0.20)');
		g.fillStyle = shade; g.fillRect(0, 0, S, S);
		g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
		for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(c, c, R * (0.28 + 0.20 * k), 0, TAU); g.stroke(); }
		g.lineWidth = 0.7;
		for (let k = 0; k < 48; k++) {
			const a = k * TAU / 48, r0 = R * 0.36, r1 = R * (0.72 + 0.24 * r());
			g.strokeStyle = k % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(10,25,45,0.06)';
			g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
			g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
		}
		for (let k = 0; k < 220; k++) {
			g.fillStyle = r() > 0.65 ? 'rgba(255,255,255,0.10)' : 'rgba(8,20,36,0.07)';
			g.fillRect(r() * S, r() * S, 1, 1);
		}
		g.restore();
		cutCircle(g, S, R);
		return cv;
	}
	function bakeGlossTex() {
		const S = 128, c = S / 2, R = S * 0.5 - 3, cv = makeCanvas(S, S), g = cv.getContext('2d');
		g.save(); g.beginPath(); g.arc(c, c, R, 0, TAU); g.clip();
		const hi = g.createRadialGradient(c * 0.62, c * 0.52, 0, c * 0.62, c * 0.52, R * 0.86);
		hi.addColorStop(0, 'rgba(255,255,255,0.65)');
		hi.addColorStop(0.24, 'rgba(255,255,255,0.24)');
		hi.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = hi; g.fillRect(0, 0, S, S);
		g.strokeStyle = 'rgba(255,255,255,0.70)'; g.lineWidth = 3;
		g.beginPath(); g.arc(c, c, R * 0.89, Math.PI * 1.06, Math.PI * 1.62); g.stroke();
		g.strokeStyle = 'rgba(120,180,220,0.20)'; g.lineWidth = 1.5;
		g.beginPath(); g.arc(c, c, R * 0.97, Math.PI * 0.12, Math.PI * 0.76); g.stroke();
		g.restore();
		cutCircle(g, S, R);
		return cv;
	}
	// Fixed-size sprites: a window resize stretches one drawImage instead of rebaking
	// the field, which was the expensive mistake the disk texture already avoids.
	function setup(cfg) {
		if (floorTex && bakedCfg === cfg && bakedW === cfg.boardW && bakedH === cfg.boardH) return;
		bakedCfg = cfg; bakedW = cfg.boardW; bakedH = cfg.boardH;
		floorTex = bakeFloorTex(); diskTex = bakeDiskTex(); grainTex = bakeGrainTex();
		glossTex = bakeGlossTex(); shadowTex = bakeShadowTex();
		glazeTex = bakeGlazeTex(); veilTex = bakeVeilTex();
		for (let k = 0; k < 2; k++) {
			lampTex[k] = bakeLampTex(k, cfg, true); lampShade[k] = bakeLampTex(k, cfg, false);
		}
		softTex = null; softSchema = '';
	}
	function floor(ctx, view, cfg) {
		if (!floorTex) return;
		const dark = view.opts.theme === 'kerot', R = cfg.diskR * 1.22;
		ctx.save();
		ctx.globalAlpha = dark ? 0.72 : 0.92;
		ctx.drawImage(floorTex, 0, 0, cfg.boardW, cfg.boardH);
		ctx.globalAlpha = dark ? 0.62 : 0.50;
		ctx.drawImage(shadowTex, cfg.diskX - R + 0.035, cfg.diskY - R + 0.05, 2 * R, 2 * R);
		ctx.restore();
	}
	function disk(ctx, view, cfg) {
		if (!diskTex) return;
		const dark = view.opts.theme === 'kerot';
		ctx.save();
		// Depth first: the scattered copy of the paint, then the ice above it, then the
		// brushed polish of the surface. Below three sprites nothing is drawn, so the
		// softened paint never washes a shadow or a stone.
		if (softSchema !== cfg.diskSchema || softRadius !== cfg.diskR || softScale !== (cfg.scoreScale || 1)) softTex = bakeSoftField(cfg);
		if (softTex) {
			ctx.globalAlpha = dark ? 0.82 : 0.76;
			ctx.drawImage(softTex, -cfg.diskR, -cfg.diskR, 2 * cfg.diskR, 2 * cfg.diskR);
			ctx.globalAlpha = 1;
		}
		ctx.globalAlpha = dark ? 0.42 : 0.46;
		ctx.drawImage(glazeTex, -cfg.diskR, -cfg.diskR, 2 * cfg.diskR, 2 * cfg.diskR);
		ctx.globalAlpha = dark ? 0.72 : 0.90;
		ctx.drawImage(diskTex, -cfg.diskR, -cfg.diskR, 2 * cfg.diskR, 2 * cfg.diskR);
		ctx.globalAlpha = dark ? 0.48 : 0.62;
		ctx.lineWidth = 0.018; ctx.strokeStyle = 'rgba(235,250,255,0.55)';
		ctx.beginPath(); ctx.arc(0, 0, cfg.diskR - 0.009, Math.PI * 1.06, Math.PI * 1.70); ctx.stroke();
		ctx.strokeStyle = 'rgba(0,8,22,0.42)';
		ctx.beginPath(); ctx.arc(0, 0, cfg.diskR - 0.009, Math.PI * 0.06, Math.PI * 0.70); ctx.stroke();
		ctx.restore();
	}
	// The ice surface, drawn once per frame over every marking and under every stone:
	// the frozen veil, then the ceiling lamps mirrored in the ice. The veil deepens what
	// it covers instead of whitening it — paint under ice loses light, not gains it — and
	// each lamp lands in two passes: a multiply of its dark seat, then an additive tube.
	function surface(ctx, view, cfg) {
		if (!veilTex) return;
		const dark = view.opts.theme === 'kerot', t = view.w ? view.w.t : 0;
		ctx.save();
		ctx.globalAlpha = dark ? 0.65 : 0.72;
		ctx.drawImage(veilTex, 0, 0, cfg.boardW, cfg.boardH);
		ctx.globalAlpha = dark ? 0.28 : 0.34;
		ctx.drawImage(floorTex, 0, 0, cfg.boardW, cfg.boardH);
		for (let k = 0; lampsOn && k < 2; k++) {
			// The housing is matte: it does not breathe with the tube.
			ctx.globalCompositeOperation = 'multiply';
			ctx.globalAlpha = dark ? 0.26 : 0.30;
			ctx.drawImage(lampShade[k], 0, 0, cfg.boardW, cfg.boardH);
			// Reflections are light added to the ice, not paint on it: additive blending
			// keeps the tube warm instead of turning it grey over the teal of the zones.
			// Slow, out-of-step breathing: a dead-steady reflection reads as a sticker.
			// With reduced motion the tube simply stays at its mid brightness.
			ctx.globalCompositeOperation = 'lighter';
			ctx.globalAlpha = (dark ? 0.32 : 0.36) * (REDUCED ? 0.95 : 0.90 + 0.10 * Math.sin(t * (0.37 + 0.11 * k) + 2.1 * k));
			ctx.drawImage(lampTex[k], 0, 0, cfg.boardW, cfg.boardH);
		}
		ctx.restore();
	}
	function shadow(ctx, view, cfg, i, isPending) {
		const w = view.w, r = w.r[i], soft = 2.7 * r, contact = 2.05 * r;
		ctx.save();
		ctx.globalAlpha = isPending ? 0.32 : 0.55;
		ctx.drawImage(shadowTex, w.x[i] - soft / 2 + 0.022, w.y[i] - soft / 2 + 0.030, soft, soft);
		ctx.globalAlpha = isPending ? 0.20 : 0.38;
		ctx.drawImage(shadowTex, w.x[i] - contact / 2 + 0.010, w.y[i] - contact / 2 + 0.015, contact, contact);
		ctx.restore();
	}
	function puck(ctx, view, cfg, i, isPending) {
		const w = view.w, r = w.r[i], phase = w.th[i] + (w.uid[i] & 31) * GOLDEN;
		const col = typeof seatColor === 'function' ? seatColor(w.own[i]) : '#ffffff';
		ctx.save(); ctx.translate(w.x[i], w.y[i]);
		ctx.save(); ctx.rotate(phase); ctx.globalAlpha = isPending ? 0.60 : 0.85;
		ctx.drawImage(grainTex, -r, -r, 2 * r, 2 * r); ctx.restore();
		ctx.globalAlpha = isPending ? 0.62 : 0.90;
		ctx.drawImage(glossTex, -r, -r, 2 * r, 2 * r);
		ctx.globalAlpha = 0.85; ctx.lineWidth = 0.014; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
		ctx.beginPath(); ctx.arc(0, 0, r - 0.006, -2.7, -0.45); ctx.stroke();
		ctx.globalAlpha = 0.65; ctx.lineWidth = 0.020; ctx.strokeStyle = 'rgba(0,12,26,0.45)';
		ctx.beginPath(); ctx.arc(0, 0, r - 0.006, 0.15, 2.3); ctx.stroke();
		ctx.globalAlpha = 0.55; ctx.lineWidth = 0.007; ctx.strokeStyle = 'rgba(255,255,255,0.30)';
		ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, TAU); ctx.stroke();
		ctx.globalAlpha = 0.70; ctx.fillStyle = 'rgba(255,255,255,0.85)';
		ctx.beginPath(); ctx.arc(-0.38 * r, -0.45 * r, 0.07 * r, 0, TAU); ctx.fill();
		ctx.globalAlpha = isPending ? 0.35 : 0.50; ctx.lineWidth = 0.020; ctx.strokeStyle = col;
		ctx.beginPath(); ctx.arc(0, 0, r - 0.004, 0, TAU); ctx.stroke();
		if (isPending && !REDUCED) {
			const pulse = 0.5 + 0.5 * Math.sin(w.t * 5.2);
			ctx.globalAlpha = 0.22 + 0.18 * pulse;
			ctx.lineWidth = 0.012; ctx.strokeStyle = 'rgba(255,230,170,0.8)';
			ctx.beginPath(); ctx.arc(0, 0, r + 0.022, 0, TAU); ctx.stroke();
		}
		ctx.restore();
	}
	const skin = { setup, floor, disk, surface, shadow, puck };

	function noiseBuffer(ac) {
		const len = Math.max(1, Math.floor(ac.sampleRate * 0.7));
		const buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
		let s = 0x1a2b3c4d;
		for (let k = 0; k < len; k++) { s = (s * 1664525 + 1013904223) >>> 0; data[k] = 2 * s / 4294967296 - 1; }
		return buf;
	}
	function createAudio(ac) {
		const master = ac.createGain(), slide = ac.createGain(), pan = ac.createStereoPanner();
		const band = ac.createBiquadFilter(), loop = ac.createBufferSource(), buf = noiseBuffer(ac);
		master.gain.value = 0; master.connect(ac.destination);
		slide.gain.value = 0; pan.pan.value = 0;
		band.type = 'bandpass'; band.frequency.value = 2200; band.Q.value = 0.8;
		loop.buffer = buf; loop.loop = true;
		loop.connect(band); band.connect(slide); slide.connect(pan); pan.connect(master); loop.start();
		return { ac: ac, master: master, slide: slide, band: band, pan: pan, loop: loop, buf: buf };
	}
	function applyMaster() {
		if (!audio) return;
		const now = audio.ac.currentTime, on = soundOn && !pageHidden;
		audio.master.gain.setTargetAtTime(on ? VOL * volLevel : 0, now, 0.05);
		if (!on) audio.slide.gain.setTargetAtTime(0, now, 0.04);
	}
	function attachAudio(ac) {
		if (!ac || audio) return;
		audio = createAudio(ac);
		needsReset = true;
		applyMaster();
	}
	function set(state) {
		visual = !!state.visual; soundOn = !!state.sound;
		if (typeof state.lamps === 'boolean') lampsOn = state.lamps;
		if (typeof state.decor === 'string') decorMode = state.decor;
		if (typeof state.face === 'string') faceMode = state.face;
		if (typeof state.vol === 'number' && isFinite(state.vol)) volLevel = limit(state.vol, 0, 2);
		if (diskTex && decorMode !== bakedDecor) diskTex = bakeDiskTex(); // a decor switch rebakes only the disk sprite
		applyMaster();
	}
	function mute(hidden) { pageHidden = !!hidden; applyMaster(); }
	// The listener is a mic head on the ice: on the big disk's centre facing the
	// launch lane (the initial puck position) or straight up, or at the bottom edge
	// below the centre facing up. panFor is the source direction's component on the
	// right-ear axis — the facing rotated 90° clockwise in screen coords.
	function panFor(x, y, cfg) {
		let mx = cfg.diskX, my = cfg.diskY, fx = 0, fy = -1;
		if (faceMode === 'bottom') my = cfg.boardH;
		else if (faceMode === 'launch') {
			fx = cfg.launchX - cfg.diskX; fy = cfg.launchY - cfg.diskY;
			const l = Math.sqrt(fx * fx + fy * fy) || 1; fx /= l; fy /= l;
		}
		const dx = x - mx, dy = y - my, d = Math.sqrt(dx * dx + dy * dy);
		if (d < 1e-9) return 0;
		return limit((dy * fx - dx * fy) / d, -1, 1);
	}
	// Every positional event reaches the master through its own stereo panner, so a
	// contact off to one side rings in that ear. The event's partials share the node.
	// Soft near field, then a strong level falloff: 0 m = 1, 1 m = .31, 2 m = .10.
	function gainFor(x, y, cfg) {
		const dy = y - (faceMode === 'bottom' ? cfg.boardH : cfg.diskY);
		const dx = x - cfg.diskX;
		return 1 / (1 + 2.2 * (dx * dx + dy * dy));
	}
	function out(a, pan, level = 1) {
		const p = a.ac.createStereoPanner();
		p.pan.value = pan;
		const g = a.ac.createGain();
		g.gain.value = level;
		p.connect(g); g.connect(a.master);
		return p;
	}
	// One voice per seat colour, in SEAT_COLORS order (js/players.js): a pentatonic
	// ladder gives every colour its own note, `spread` fans the three partials apart so
	// the timbre differs too — red knocks low and warm, blue rings high and thin — and
	// `decay` lets the lower notes ring longer, as a heavier body would.
	const VOICES = [
		{ pitch: 1.000, spread: 1.30, decay: 1.00 }, // red
		{ pitch: 1.100, spread: 1.42, decay: 0.95 }, // amber
		{ pitch: 1.200, spread: 1.54, decay: 0.89 }, // green
		{ pitch: 1.335, spread: 1.68, decay: 0.83 }, // violet
		{ pitch: 1.420, spread: 1.24, decay: 0.79 }, // orange
		{ pitch: 1.600, spread: 1.76, decay: 0.73 }, // teal
		{ pitch: 1.750, spread: 1.60, decay: 0.69 }, // pink
		{ pitch: 1.900, spread: 1.16, decay: 0.65 }, // blue
	];
	// Same colour, different stone: ±1.2 % keeps the voice, drops the machine-gun unison.
	function stoneDetune(uid) { return 1 + ((uid % 7) - 3) * 0.004; }
	function glassPing(a, strength, bright, pitch, spread, decay, pan, level = 1) {
		if (pitch === undefined) { pitch = 1; spread = 1.46; decay = 1; }
		const now = a.ac.currentTime, base = ((bright ? 760 : 520) + 220 * strength) * pitch;
		const dst = out(a, pan || 0, level);
		for (let k = 0; k < 3; k++) {
			const osc = a.ac.createOscillator(), g = a.ac.createGain();
			osc.type = k ? 'sine' : 'triangle';
			osc.frequency.setValueAtTime(base * (1 + spread * k), now);
			g.gain.setValueAtTime(0.0001, now);
			g.gain.exponentialRampToValueAtTime(0.055 * strength / (k + 1), now + 0.006);
			g.gain.exponentialRampToValueAtTime(0.0001, now + (0.16 + 0.09 * k) * decay);
			osc.connect(g); g.connect(dst); osc.start(now); osc.stop(now + 0.4);
		}
	}
	function iceBurst(a, strength, low, pan, level = 1) {
		const now = a.ac.currentTime;
		const src = a.ac.createBufferSource(), f = a.ac.createBiquadFilter(), g = a.ac.createGain();
		src.buffer = a.buf; src.loop = false;
		f.type = low ? 'lowpass' : 'highpass'; f.frequency.value = low ? 850 : 2900; f.Q.value = 0.7;
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.07 * strength, now + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + 0.06 * strength);
		src.connect(f); f.connect(g); g.connect(out(a, pan || 0, level)); src.start(now); src.stop(now + 0.22);
	}
	function voidSound(a, strength, pan, level = 1) {
		const now = a.ac.currentTime, osc = a.ac.createOscillator(), g = a.ac.createGain();
		osc.type = 'sine'; osc.frequency.setValueAtTime(210, now);
		osc.frequency.exponentialRampToValueAtTime(58, now + 0.42);
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.11 * strength, now + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
		osc.connect(g); g.connect(out(a, pan || 0, level)); osc.start(now); osc.stop(now + 0.5);
		iceBurst(a, 0.5 * strength, true, pan, level);
	}
	function throwSound(a, pan, level = 1) { iceBurst(a, 0.8, false, pan, level); glassPing(a, 0.22, false, 1, 1.46, 1, pan, level); }
	// A rail tap is the stone's own voice, dulled by the board; a stone-on-stone contact
	// rings at the mean of the two voices, so red against blue is a pitch neither makes
	// alone. Both stay within three oscillators.
	function wallSound(a, imp, pitch, spread, decay, pan, level = 1) {
		const s = limit(imp / 2.2, 0.2, 1);
		iceBurst(a, 0.55 * s, true, pan, level); glassPing(a, 0.18 * s, false, pitch, spread, decay, pan, level);
	}
	function clinkSound(a, imp, pitch, spread, decay, pan, level = 1) {
		const s = limit(imp / 2.2, 0.2, 1);
		glassPing(a, s, true, pitch, spread, decay, pan, level); iceBurst(a, 0.35 * s, false, pan, level);
	}
	function endSound(a) { glassPing(a, 0.35, true); iceBurst(a, 0.25, true); } // the closing chime stays centred
	function sumLoss(w) {
		let s = 0;
		for (let k = 0; k < w.ownerLosses.length; k++) s += w.ownerLosses[k];
		return s;
	}
	function nearWall(w, i) {
		const c = w.cfg, r = w.r[i], e = 0.012;
		return w.x[i] <= r + e || w.x[i] >= c.boardW - r - e || w.y[i] <= r + e || w.y[i] >= c.boardH - r - e;
	}
	// The stone this one is touching, or −1. The pair's second voice comes from here.
	function nearestTouch(w, i) {
		for (let j = 0; j < w.n; j++) {
			if (j === i) continue;
			const dx = w.x[j] - w.x[i], dy = w.y[j] - w.y[i], sig = w.r[i] + w.r[j] + 0.025;
			if (dx * dx + dy * dy <= sig * sig) return j;
		}
		return -1;
	}
	function resetTracker(w, stateName, loss) {
		seenUid.fill(0); pvx.fill(0); pvy.fill(0); pst.fill(0); lastHit.fill(-1e9);
		ppx.fill(0); ppy.fill(0);
		lastUid = w.nextUid; lastT = w.t; lastThrown = w.thrown; lastLoss = loss; lastState = stateName;
		lastAnyHit = lastVoid = lastThrow = lastRecycle = lastEnd = -1e9;
		needsReset = false;
		if (audio) audio.slide.gain.setTargetAtTime(0, audio.ac.currentTime, 0.03);
	}
	// World-state observer, once per rendered frame: physics and game flow expose no
	// event hooks and stay deterministic. Velocity jumps identify contacts; uid loss
	// identifies a recycled or swallowed puck. No allocations in this loop.
	function frame(dt, w, stateName, paused) {
		if (!audio) return;
		const hidden = pageHidden || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
		const frozen = !!paused || hidden, loss = sumLoss(w);
		const reset = needsReset || lastUid === 0 || w.nextUid < lastUid || w.t < lastT - 0.5;
		if (reset) resetTracker(w, stateName, loss);
		const canPlay = soundOn && !frozen && !reset && audio;
		alive.fill(0);
		let slideSum = 0, slidePan = 0;
		for (let i = 0; i < w.n; i++) {
			const uid = w.uid[i], s = uid & MASK;
			alive[s] = 1;
			if (w.st[i] === SLIDE) {
				const sp = Math.hypot(w.vx[i], w.vy[i]) * gainFor(w.x[i], w.y[i], w.cfg);
				slideSum += sp; slidePan += sp * panFor(w.x[i], w.y[i], w.cfg);
			}
			if (!reset && seenUid[s] === uid) {
				const dvx = w.vx[i] - pvx[s], dvy = w.vy[i] - pvy[s], imp = Math.hypot(dvx, dvy);
				if (imp > 0.32 && pst[s] === SLIDE && w.st[i] === SLIDE && w.t - lastHit[s] > 0.055) {
					const wall = nearWall(w, i), touch = wall ? -1 : nearestTouch(w, i);
					if (wall || touch >= 0) {
						lastHit[s] = w.t;
						if (canPlay && w.t - lastAnyHit > 0.045) {
							lastAnyHit = w.t;
							// The colour of the stone sets the note; a pair of colours meets
							// in the middle of the interval. The place sets the ear.
							const own = VOICES[w.own[i] & 7], pitch = own.pitch * stoneDetune(uid);
							const pan = wall ? panFor(w.x[i], w.y[i], w.cfg)
								: panFor((w.x[i] + w.x[touch]) * 0.5, (w.y[i] + w.y[touch]) * 0.5, w.cfg);
							const level = wall ? gainFor(w.x[i], w.y[i], w.cfg)
								: gainFor((w.x[i] + w.x[touch]) * 0.5, (w.y[i] + w.y[touch]) * 0.5, w.cfg);
							if (wall) wallSound(audio, imp, pitch, own.spread, own.decay, pan, level);
							else {
								const other = VOICES[w.own[touch] & 7];
								clinkSound(audio, imp, Math.sqrt(own.pitch * other.pitch) * stoneDetune(uid),
									(own.spread + other.spread) * 0.5, Math.min(own.decay, other.decay), pan, level);
							}
						}
					}
				}
			}
			seenUid[s] = uid; pvx[s] = w.vx[i]; pvy[s] = w.vy[i]; pst[s] = w.st[i];
			ppx[s] = w.x[i]; ppy[s] = w.y[i];
		}
		let gone = 0, goneX = 0, goneY = 0;
		for (let s = 0; s < TABLE; s++) if (seenUid[s] && !alive[s]) {
			seenUid[s] = 0;
			if (!gone) { goneX = ppx[s]; goneY = ppy[s]; } // the first leaver pans the farewell
			gone++;
		}
		const gonePan = gone ? panFor(goneX, goneY, w.cfg) : 0;
		const now = audio.ac.currentTime, target = canPlay ? limit(slideSum * 0.018, 0, 0.14) : 0;
		audio.slide.gain.setTargetAtTime(target, now, 0.08);
		audio.pan.pan.setTargetAtTime(slideSum > 0.05 ? slidePan / slideSum : 0, now, 0.10);
		audio.band.frequency.setTargetAtTime(1600 + Math.min(2600, slideSum * 420), now, 0.12);
		if (canPlay) {
			if (w.thrown > lastThrown && w.t - lastThrow > 0.05) {
				lastThrow = w.t;
				throwSound(audio, panFor(w.cfg.launchX, w.cfg.launchY, w.cfg), gainFor(w.cfg.launchX, w.cfg.launchY, w.cfg)); // throws leave from the launch box
			}
			if (loss > lastLoss && w.t - lastVoid > 0.12) { lastVoid = w.t; voidSound(audio, limit((loss - lastLoss) * 0.6, 0.35, 1), gonePan, gone ? gainFor(goneX, goneY, w.cfg) : 1); }
			else if (gone && w.t - lastRecycle > 0.12) { lastRecycle = w.t; iceBurst(audio, 0.22, true, gonePan, gone ? gainFor(goneX, goneY, w.cfg) : 1); }
			if (lastState !== 'scored' && stateName === 'scored' && w.t - lastEnd > 0.5) { lastEnd = w.t; endSound(audio); }
		}
		lastUid = w.nextUid; lastT = w.t; lastThrown = w.thrown; lastLoss = loss; lastState = stateName;
	}
	return {
		skin, set, attachAudio, frame, mute, gainFor,
		get lamps() { return LAMPS; }, // the tone check reads the table, nothing else does
		get visual() { return visual; },
		get sound() { return soundOn; },
		get audio() { return audio; },
		get decor() { return decorMode; },
		get face() { return faceMode; },
		get vol() { return volLevel; },
	};
})();
globalThis.GlassFX = GlassFX;
if (typeof module !== 'undefined') module.exports = GlassFX;
