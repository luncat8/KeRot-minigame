// Canvas renderer. Textures/gradients/zone paths baked once (or on resize); per
// frame it only does clipped drawImage calls, stroked paths and puck circles.
// Never mutates the world.
const Render = (() => {
	let cv, ctx, scale = 100, ox = 0, oy = 0, dpr = 1;
	let texDisk = null, texFloor = null, puckGrad = null, wallPath = null;
	let zonePath = null, zoneTri = null, zoneHole = null, hatchPath = null, sectorPath = null;
	const RING_COLORS = ['#e74c3c', '#f39c12', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#fd79a8', '#74b9ff'];
	const Z_FILL = 'rgba(32,178,170,0.16)', Z_LINE = 'rgba(46,204,196,0.55)', Z_HATCH = 'rgba(46,204,196,0.16)';
	const SECTOR_SHADE = 'rgba(45,52,54,0.42)'; // 3 of the 6 face sectors
	let puckFont = '', labelRot = 0;
	function setup(canvas) {
		cv = canvas; ctx = cv.getContext('2d');
		puckGrad = ctx.createRadialGradient(-0.03, -0.03, 0.01, 0, 0, CFG.puckR);
		puckGrad.addColorStop(0, '#f5f6fa'); puckGrad.addColorStop(0.7, '#b2bec3'); puckGrad.addColorStop(1, '#636e72');
		buildZonePaths();
		resize();
	}
	function buildZonePaths() {
		const z = RETURN_ZONES;
		// The eject fan, with the on-disk guard (diskR + puckR) punched out of the
		// fill, so the exemption is drawn instead of implied.
		zoneTri = new Path2D();
		zoneTri.moveTo(z.ax, z.ay); zoneTri.lineTo(z.bx, z.by); zoneTri.lineTo(z.cx, z.cy); zoneTri.closePath();
		zoneHole = new Path2D();
		zoneHole.arc(CFG.diskX, CFG.diskY, CFG.diskR + CFG.puckR, 0, Math.PI * 2);
		zonePath = new Path2D();
		zonePath.addPath(zoneTri); zonePath.addPath(zoneHole);
		hatchPath = new Path2D();
		for (let s = -CFG.boardH; s < CFG.boardW; s += 0.14) { // 45° stripes across the board
			hatchPath.moveTo(s, 0); hatchPath.lineTo(s + CFG.boardH, CFG.boardH);
		}
		// Puck face: 6 sectors, 3 shaded, unit radius (scaled per puck at draw time).
		sectorPath = new Path2D();
		for (let k = 0; k < 3; k++) {
			const a0 = k * 2 * Math.PI / 3;
			sectorPath.moveTo(0, 0);
			sectorPath.arc(0, 0, 1, a0, a0 + Math.PI / 3);
			sectorPath.closePath();
		}
		labelRot = Math.atan2(z.by - z.ay, z.bx - z.ax); // fan edge -> readable label angle
	}
	function resize() {
		dpr = Math.min(2, window.devicePixelRatio || 1);
		const wpx = cv.clientWidth || 960, hpx = wpx * CFG.boardH / CFG.boardW;
		cv.width = Math.round(wpx * dpr); cv.height = Math.round(hpx * dpr);
		cv.style.height = hpx + 'px';
		scale = Math.min(cv.width / CFG.boardW, cv.height / CFG.boardH);
		ox = (cv.width - CFG.boardW * scale) / 2; oy = (cv.height - CFG.boardH * scale) / 2;
		bake();
	}
	function bake() {
		const ppmDisk = Math.max(96, Math.min(512, 2 * scale / dpr));
		texDisk = bakeFieldCanvas({ x: -CFG.diskR, y: -CFG.diskR, w: 2 * CFG.diskR, h: 2 * CFG.diskR }, ppmDisk, null, CFG);
		texFloor = bakeFieldCanvas({ x: 0, y: 0, w: CFG.boardW, h: CFG.boardH }, 40, 0, CFG);
		wallPath = new Path2D();
		wallPath.rect(0, 0, CFG.boardW, CFG.boardH);
		puckFont = 'bold ' + (CFG.puckR * 0.55) + 'px sans-serif';
	}
	function toWorld(clientX, clientY) {
		const r = cv.getBoundingClientRect();
		return { x: ((clientX - r.left) * dpr - ox) / scale, y: ((clientY - r.top) * dpr - oy) / scale };
	}
	function drawZones(mode) {
		if (mode === 'none') return;
		ctx.save();
		ctx.fillStyle = Z_FILL;
		ctx.fill(zonePath, 'evenodd');
		ctx.save(); ctx.clip(zonePath, 'evenodd');
		ctx.strokeStyle = Z_HATCH; ctx.lineWidth = 0.012; ctx.stroke(hatchPath);
		ctx.restore();
		ctx.setLineDash([0.05, 0.04]); ctx.lineWidth = 0.012; ctx.strokeStyle = Z_LINE;
		ctx.stroke(zoneTri); ctx.stroke(zoneHole); ctx.setLineDash([]);
		drawZoneLabel(2.55, 0.75, labelRot); // inside the fan, along its edges
		drawZoneLabel(2.55, CFG.boardH - 0.75, -labelRot);
		ctx.restore();
	}
	function drawZoneLabel(x, y, rot) {
		ctx.save();
		ctx.translate(x, y); ctx.rotate(rot);
		ctx.fillStyle = Z_LINE; ctx.font = '0.09px sans-serif';
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText('RETURN', 0, 0);
		ctx.restore();
	}
	function drawGhost(pred, aim) {
		if (!pred || pred.n < 2) return;
		const path = pred.path, n = pred.n, chunks = 6, per = Math.ceil(n / chunks);
		ctx.save();
		ctx.lineWidth = 0.014; ctx.lineCap = 'round';
		for (let c = 0; c < chunks; c++) {
			const i0 = c * per, i1 = Math.min(n - 1, i0 + per);
			if (i1 <= i0) break;
			ctx.strokeStyle = 'rgba(255,234,167,' + (0.10 + 0.07 * (chunks - c)).toFixed(3) + ')';
			ctx.beginPath();
			ctx.moveTo(path[i0 * 2], path[i0 * 2 + 1]);
			for (let k = i0 + 1; k <= i1; k++) ctx.lineTo(path[k * 2], path[k * 2 + 1]);
			ctx.stroke();
		}
		ctx.globalAlpha = 0.35;
		ctx.fillStyle = '#ffeaa7';
		ctx.beginPath(); ctx.arc(pred.endX, pred.endY, CFG.puckR, 0, Math.PI * 2); ctx.fill();
		if (pred.locked) {
			ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ffeaa7'; ctx.lineWidth = 0.012;
			ctx.setLineDash([0.04, 0.03]);
			ctx.beginPath(); ctx.arc(pred.endX, pred.endY, CFG.puckR * 1.5, 0, Math.PI * 2); ctx.stroke();
			ctx.setLineDash([]);
		}
		ctx.restore();
	}
	function drawWorld(w, aim, opts, pred) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = '#0b1c26'; ctx.fillRect(0, 0, cv.width, cv.height);
		ctx.setTransform(scale, 0, 0, scale, ox, oy);
		// Floor: faint static field copy, then ice tint.
		ctx.save(); ctx.beginPath(); ctx.rect(0, 0, CFG.boardW, CFG.boardH); ctx.clip();
		ctx.globalAlpha = 0.35; ctx.drawImage(texFloor, 0, 0, CFG.boardW, CFG.boardH); ctx.globalAlpha = 1;
		drawZones(opts.mode);
		// Disk: field texture rotated by theta, clipped to the circle.
		ctx.save();
		ctx.beginPath(); ctx.arc(CFG.diskX, CFG.diskY, CFG.diskR, 0, Math.PI * 2); ctx.clip();
		ctx.translate(CFG.diskX, CFG.diskY); ctx.rotate(w.theta);
		ctx.drawImage(texDisk, -CFG.diskR, -CFG.diskR, 2 * CFG.diskR, 2 * CFG.diskR);
		ctx.fillStyle = '#2d3436'; ctx.fillRect(0.55, -0.012, 0.22, 0.024); // spin tick
		ctx.restore();
		ctx.lineWidth = 0.015; ctx.strokeStyle = '#dfe6e9';
		ctx.beginPath(); ctx.arc(CFG.diskX, CFG.diskY, CFG.diskR, 0, Math.PI * 2); ctx.stroke();
		if (opts.ring) {
			const dh = holdRadius(CFG);
			if (dh < CFG.diskR) {
				ctx.setLineDash([0.05, 0.04]); ctx.lineWidth = 0.012; ctx.strokeStyle = '#ffffff';
				ctx.beginPath(); ctx.arc(CFG.diskX, CFG.diskY, dh, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
			}
		}
		// Launch zone
		ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 0.01; ctx.setLineDash([0.04, 0.03]);
		ctx.strokeRect(CFG.launchMinX, CFG.launchMinY, CFG.launchMaxX - CFG.launchMinX, CFG.launchMaxY - CFG.launchMinY);
		ctx.setLineDash([]);
		ctx.restore();
		ctx.lineWidth = 0.02; ctx.strokeStyle = '#dfe6e9'; ctx.stroke(wallPath);
		if (opts.preview && aim && aim.hasStroke) drawGhost(pred, aim);
		drawAim(w, aim);
		for (let i = 0; i < w.n; i++) drawPuck(w, i, aim && aim.pending === i);
	}
	function drawPuck(w, i, isPending) {
		ctx.save();
		ctx.translate(w.x[i], w.y[i]);
		ctx.globalAlpha = isPending ? 0.65 : w.st[i] === ST_SLEEP ? 0.85 : 1;
		ctx.fillStyle = puckGrad;
		ctx.beginPath(); ctx.arc(0, 0, w.r[i], 0, Math.PI * 2); ctx.fill();
		// Face sectors turn with the puck's material rotation (w.th).
		ctx.save();
		ctx.rotate(w.th[i]); ctx.scale(w.r[i], w.r[i]);
		ctx.fillStyle = SECTOR_SHADE; ctx.fill(sectorPath);
		ctx.restore();
		ctx.lineWidth = 0.014; ctx.strokeStyle = RING_COLORS[i % RING_COLORS.length]; ctx.stroke();
		ctx.globalAlpha *= 0.8;
		ctx.fillStyle = '#2d3436'; ctx.font = puckFont;
		ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
		ctx.fillText(String(i + 1), 0, 0.004);
		ctx.restore();
	}
	function drawAim(w, aim) {
		if (!aim || aim.pending < 0 || !aim.hasStroke) return;
		const sx = w.x[aim.pending], sy = w.y[aim.pending];
		const sp = Math.hypot(aim.vx, aim.vy);
		if (sp < 1e-6) return;
		const len = sp / CFG.vMax * CFG.dragFull;
		const ux = aim.vx / sp, uy = aim.vy / sp;
		ctx.save();
		ctx.strokeStyle = '#ffeaa7'; ctx.fillStyle = '#ffeaa7'; ctx.lineWidth = 0.018;
		ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * (len + 0.15), sy + uy * (len + 0.15)); ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(sx + ux * (len + 0.28), sy + uy * (len + 0.28));
		ctx.lineTo(sx + ux * (len + 0.12) - uy * 0.05, sy + uy * (len + 0.12) + ux * 0.05);
		ctx.lineTo(sx + ux * (len + 0.12) + uy * 0.05, sy + uy * (len + 0.12) - ux * 0.05);
		ctx.closePath(); ctx.fill();
		ctx.font = '0.075px sans-serif';
		ctx.fillText(sp.toFixed(2) + ' m/s, stops ~' + (sp * sp / (2 * CFG.muK * CFG.g)).toFixed(1) + ' m', sx + ux * (len + 0.45), sy + uy * (len + 0.45));
		ctx.restore();
	}
	return { setup, resize, drawWorld, toWorld, colors: RING_COLORS };
})();
