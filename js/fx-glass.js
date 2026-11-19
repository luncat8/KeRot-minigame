// Optional glass-ice presentation, loaded by js/fx.js only when the page asks for it.
// Everything here is additive: the score map, seat rings, numbers, gauges and physics
// stay in the shipped renderer; the skin bakes its sprites once and only draws them.
// Audio is procedural WebAudio (no files): an ice hiss follows total sliding speed,
// glass partials answer puck contacts, and low noise answers walls, holes and throws.
const GlassFX = (() => {
	const TAU = 2 * Math.PI, GOLDEN = 2.399963;
	const TABLE = 128, MASK = TABLE - 1, VOL = 0.32;
	const SLIDE = typeof ST_SLIDE !== 'undefined' ? ST_SLIDE : 0;
	const REDUCED = typeof window !== 'undefined' && window.matchMedia
		? !!window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
	let visual = false, soundOn = false, pageHidden = false, audio = null, needsReset = true;
	let floorTex = null, diskTex = null, grainTex = null, glossTex = null, shadowTex = null, bakedCfg = null;
	const seenUid = new Uint32Array(TABLE), alive = new Uint8Array(TABLE);
	const pvx = new Float64Array(TABLE), pvy = new Float64Array(TABLE);
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
	// Transparent overlay for the rotating disk. Low alpha keeps the field's red
	// channel — the score map — legible; nothing here feeds scoring or bot aims.
	function bakeDiskTex() {
		const S = 512, c = S / 2, R = S * 0.5 - 2, cv = makeCanvas(S, S), g = cv.getContext('2d');
		const r = rng(0xc0ffee);
		g.save(); g.beginPath(); g.arc(c, c, R, 0, TAU); g.clip();
		const sheen = g.createLinearGradient(0, 0, S, S);
		sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
		sheen.addColorStop(0.38, 'rgba(255,255,255,0.02)');
		sheen.addColorStop(0.72, 'rgba(120,180,255,0.035)');
		sheen.addColorStop(1, 'rgba(0,8,24,0.10)');
		g.fillStyle = sheen; g.fillRect(0, 0, S, S);
		const glow = g.createRadialGradient(S * 0.27, S * 0.20, 0, S * 0.27, S * 0.20, S * 0.72);
		glow.addColorStop(0, 'rgba(255,255,255,0.22)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = glow; g.fillRect(0, 0, S, S);
		const streak = g.createLinearGradient(0, S * 0.26, S, S * 0.74);
		streak.addColorStop(0, 'rgba(255,255,255,0)');
		streak.addColorStop(0.44, 'rgba(255,255,255,0.075)');
		streak.addColorStop(0.56, 'rgba(255,255,255,0.075)');
		streak.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = streak; g.fillRect(0, 0, S, S);
		g.lineWidth = 0.8;
		for (let k = 0; k < 190; k++) {
			const a = k * TAU / 190, r0 = R * (0.10 + 0.12 * r()), r1 = R * (0.78 + 0.20 * r());
			g.strokeStyle = k % 3 ? 'rgba(235,250,255,0.045)' : 'rgba(8,24,48,0.05)';
			g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
			g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
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
		if (floorTex && bakedCfg === cfg) return;
		bakedCfg = cfg;
		floorTex = bakeFloorTex(); diskTex = bakeDiskTex(); grainTex = bakeGrainTex();
		glossTex = bakeGlossTex(); shadowTex = bakeShadowTex();
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
		ctx.globalAlpha = dark ? 0.72 : 0.90;
		ctx.drawImage(diskTex, -cfg.diskR, -cfg.diskR, 2 * cfg.diskR, 2 * cfg.diskR);
		ctx.globalAlpha = dark ? 0.48 : 0.62;
		ctx.lineWidth = 0.018; ctx.strokeStyle = 'rgba(235,250,255,0.55)';
		ctx.beginPath(); ctx.arc(0, 0, cfg.diskR - 0.009, Math.PI * 1.06, Math.PI * 1.70); ctx.stroke();
		ctx.strokeStyle = 'rgba(0,8,22,0.42)';
		ctx.beginPath(); ctx.arc(0, 0, cfg.diskR - 0.009, Math.PI * 0.06, Math.PI * 0.70); ctx.stroke();
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
	const skin = { setup, floor, disk, shadow, puck };

	function noiseBuffer(ac) {
		const len = Math.max(1, Math.floor(ac.sampleRate * 0.7));
		const buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
		let s = 0x1a2b3c4d;
		for (let k = 0; k < len; k++) { s = (s * 1664525 + 1013904223) >>> 0; data[k] = 2 * s / 4294967296 - 1; }
		return buf;
	}
	function createAudio(ac) {
		const master = ac.createGain(), slide = ac.createGain();
		const band = ac.createBiquadFilter(), loop = ac.createBufferSource(), buf = noiseBuffer(ac);
		master.gain.value = 0; master.connect(ac.destination);
		slide.gain.value = 0;
		band.type = 'bandpass'; band.frequency.value = 2200; band.Q.value = 0.8;
		loop.buffer = buf; loop.loop = true;
		loop.connect(band); band.connect(slide); slide.connect(master); loop.start();
		return { ac: ac, master: master, slide: slide, band: band, loop: loop, buf: buf };
	}
	function applyMaster() {
		if (!audio) return;
		const now = audio.ac.currentTime, on = soundOn && !pageHidden;
		audio.master.gain.setTargetAtTime(on ? VOL : 0, now, 0.05);
		if (!on) audio.slide.gain.setTargetAtTime(0, now, 0.04);
	}
	function attachAudio(ac) {
		if (!ac || audio) return;
		audio = createAudio(ac);
		needsReset = true;
		applyMaster();
	}
	function set(v, s) { visual = !!v; soundOn = !!s; applyMaster(); }
	function mute(hidden) { pageHidden = !!hidden; applyMaster(); }
	function glassPing(a, strength, bright) {
		const now = a.ac.currentTime, base = (bright ? 760 : 520) + 220 * strength;
		for (let k = 0; k < 3; k++) {
			const osc = a.ac.createOscillator(), g = a.ac.createGain();
			osc.type = k ? 'sine' : 'triangle';
			osc.frequency.setValueAtTime(base * (1 + 1.46 * k), now);
			g.gain.setValueAtTime(0.0001, now);
			g.gain.exponentialRampToValueAtTime(0.055 * strength / (k + 1), now + 0.006);
			g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 + 0.09 * k);
			osc.connect(g); g.connect(a.master); osc.start(now); osc.stop(now + 0.4);
		}
	}
	function iceBurst(a, strength, low) {
		const now = a.ac.currentTime;
		const src = a.ac.createBufferSource(), f = a.ac.createBiquadFilter(), g = a.ac.createGain();
		src.buffer = a.buf; src.loop = false;
		f.type = low ? 'lowpass' : 'highpass'; f.frequency.value = low ? 850 : 2900; f.Q.value = 0.7;
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.07 * strength, now + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + 0.06 * strength);
		src.connect(f); f.connect(g); g.connect(a.master); src.start(now); src.stop(now + 0.22);
	}
	function voidSound(a, strength) {
		const now = a.ac.currentTime, osc = a.ac.createOscillator(), g = a.ac.createGain();
		osc.type = 'sine'; osc.frequency.setValueAtTime(210, now);
		osc.frequency.exponentialRampToValueAtTime(58, now + 0.42);
		g.gain.setValueAtTime(0.0001, now);
		g.gain.exponentialRampToValueAtTime(0.11 * strength, now + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
		osc.connect(g); g.connect(a.master); osc.start(now); osc.stop(now + 0.5);
		iceBurst(a, 0.5 * strength, true);
	}
	function throwSound(a) { iceBurst(a, 0.8, false); glassPing(a, 0.22, false); }
	function wallSound(a, imp) { const s = limit(imp / 2.2, 0.2, 1); iceBurst(a, 0.55 * s, true); glassPing(a, 0.18 * s, false); }
	function clinkSound(a, imp) { const s = limit(imp / 2.2, 0.2, 1); glassPing(a, s, true); iceBurst(a, 0.35 * s, false); }
	function endSound(a) { glassPing(a, 0.35, true); iceBurst(a, 0.25, true); }
	function sumLoss(w) {
		let s = 0;
		for (let k = 0; k < w.ownerLosses.length; k++) s += w.ownerLosses[k];
		return s;
	}
	function nearWall(w, i) {
		const c = w.cfg, r = w.r[i], e = 0.012;
		return w.x[i] <= r + e || w.x[i] >= c.boardW - r - e || w.y[i] <= r + e || w.y[i] >= c.boardH - r - e;
	}
	function nearPuck(w, i) {
		for (let j = 0; j < w.n; j++) {
			if (j === i) continue;
			const dx = w.x[j] - w.x[i], dy = w.y[j] - w.y[i], sig = w.r[i] + w.r[j] + 0.025;
			if (dx * dx + dy * dy <= sig * sig) return true;
		}
		return false;
	}
	function resetTracker(w, stateName, loss) {
		seenUid.fill(0); pvx.fill(0); pvy.fill(0); pst.fill(0); lastHit.fill(-1e9);
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
		let slideSum = 0;
		for (let i = 0; i < w.n; i++) {
			const uid = w.uid[i], s = uid & MASK;
			alive[s] = 1;
			if (w.st[i] === SLIDE) slideSum += Math.hypot(w.vx[i], w.vy[i]);
			if (!reset && seenUid[s] === uid) {
				const dvx = w.vx[i] - pvx[s], dvy = w.vy[i] - pvy[s], imp = Math.hypot(dvx, dvy);
				if (imp > 0.32 && pst[s] === SLIDE && w.st[i] === SLIDE && w.t - lastHit[s] > 0.055) {
					const wall = nearWall(w, i), pair = wall ? false : nearPuck(w, i);
					if (wall || pair) {
						lastHit[s] = w.t;
						if (canPlay && w.t - lastAnyHit > 0.045) {
							lastAnyHit = w.t;
							if (wall) wallSound(audio, imp); else clinkSound(audio, imp);
						}
					}
				}
			}
			seenUid[s] = uid; pvx[s] = w.vx[i]; pvy[s] = w.vy[i]; pst[s] = w.st[i];
		}
		let gone = 0;
		for (let s = 0; s < TABLE; s++) if (seenUid[s] && !alive[s]) { seenUid[s] = 0; gone++; }
		const now = audio.ac.currentTime, target = canPlay ? limit(slideSum * 0.018, 0, 0.14) : 0;
		audio.slide.gain.setTargetAtTime(target, now, 0.08);
		audio.band.frequency.setTargetAtTime(1600 + Math.min(2600, slideSum * 420), now, 0.12);
		if (canPlay) {
			if (w.thrown > lastThrown && w.t - lastThrow > 0.05) { lastThrow = w.t; throwSound(audio); }
			if (loss > lastLoss && w.t - lastVoid > 0.12) { lastVoid = w.t; voidSound(audio, limit((loss - lastLoss) * 0.6, 0.35, 1)); }
			else if (gone && w.t - lastRecycle > 0.12) { lastRecycle = w.t; iceBurst(audio, 0.22, true); }
			if (lastState !== 'scored' && stateName === 'scored' && w.t - lastEnd > 0.5) { lastEnd = w.t; endSound(audio); }
		}
		lastUid = w.nextUid; lastT = w.t; lastThrown = w.thrown; lastLoss = loss; lastState = stateName;
	}
	return {
		skin, set, attachAudio, frame, mute,
		get visual() { return visual; },
		get sound() { return soundOn; },
		get audio() { return audio; },
	};
})();
globalThis.GlassFX = GlassFX;
if (typeof module !== 'undefined') module.exports = GlassFX;
