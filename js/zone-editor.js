// Optional standalone-page editor. No DOM work until open().
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));
const ZoneEditor = (() => {
	let session = null;
	const labels = {
		boardW: 'Board width', boardH: 'Board height', diskX: 'Disk centre X', diskY: 'Disk centre Y', diskR: 'Disk radius',
		puckR: 'Puck radius', launchX: 'Launch X', launchY: 'Launch Y', launchMinX: 'Lane left', launchMaxX: 'Lane right',
		launchMinY: 'Lane top', launchMaxY: 'Lane bottom', zoneCutGap: 'Cut-zone gap', zoneReach: 'Wedge / fan reach (fraction)',
	};
	// Project a pointer proposal onto the last valid board, stopping at obstacles.
	function project(from, to) {
		if (validBoardGeometry(to)) return to;
		const out = JSON.parse(JSON.stringify(from));
		let lo = 0, hi = 1;
		for (let n = 0; n < 24; n++) {
			const t = (lo + hi) / 2;
			for (const k of GEOMETRY_KEYS) out[k] = from[k] + (to[k] - from[k]) * t;
			for (let i = 0; i < 2; i++) for (const k of ['x', 'y', 'r']) out.holes[i][k] = from.holes[i][k] + (to.holes[i][k] - from.holes[i][k]) * t;
			if (validBoardGeometry(out)) lo = t;
			else hi = t;
		}
		for (const k of GEOMETRY_KEYS) out[k] = from[k] + (to[k] - from[k]) * lo;
		for (let i = 0; i < 2; i++) for (const k of ['x', 'y', 'r']) out.holes[i][k] = from.holes[i][k] + (to.holes[i][k] - from.holes[i][k]) * lo;
		return out;
	}
	function setupOf(cfg, game, opts) {
		return {
			geometry: boardGeometry(cfg), omega: game.omegaStart, muK: cfg.muK, muS: cfg.muS, puckM: cfg.puckM,
			schema: cfg.diskSchema, recycle: cfg.recycleMode, zones: cfg.zoneStyle, holes: cfg.holeStyle, diskScale: cfg.diskScale,
			balls: cfg.ballsPerPlayer, maxThrows: cfg.maxThrows, vote: cfg.speedVote, voteMode: cfg.voteMode,
			botspeed: cfg.botSpeed, warp: cfg.warp, warpTries: cfg.warpTries, warpTurns: cfg.warpTurns, warpGoal: cfg.warpGoal,
			seats: game.seatTypes, theme: opts.theme, cards: opts.cards, fx: opts.fx, sfx: opts.sfx,
			decor: opts.decor, face: opts.face, vol: opts.vol, ring: opts.ring, ghost: opts.preview, holeFill: opts.holeFill,
		};
	}
	function setupQuery(setup) {
		const aliases = { muK: 'muk', muS: 'mus', puckM: 'mass', voteMode: 'votemode' };
		const parts = [];
		for (const key of Object.keys(setup)) {
			const value = key === 'geometry' ? JSON.stringify(setup[key]) : key === 'seats' ? setup[key].join(',') : String(setup[key]);
			parts.push((aliases[key] || key.toLowerCase()) + '=' + encodeURIComponent(value));
		}
		return parts.join('&');
	}
	function descriptor(setup) {
		const b = setup.geometry, f = v => Number(v.toFixed(3));
		return 'Make a KeRot preset from this board:\nurl: index.html?' + setupQuery(setup) + '\njson: ' + JSON.stringify(setup) +
			'\nsummary: board ' + f(b.boardW) + ' × ' + f(b.boardH) + ' m; disk r=' + f(b.diskR) + ' @ (' + f(b.diskX) + ',' + f(b.diskY) +
			'); holes ' + b.holes.map(h => 'r=' + f(h.r) + ' @ (' + f(h.x) + ',' + f(h.y) + ')').join(', ') +
			'; puck r=' + f(b.puckR) + '; cut gap ' + f(b.zoneCutGap * 100) + ' cm; ' + setup.balls + ' pucks/seat; ω=' + f(setup.omega);
	}
	function element(tag, parent, text) {
		const node = document.createElement(tag);
		if (text) node.textContent = text;
		if (parent) parent.appendChild(node);
		return node;
	}
	function open(env) {
		if (session) return;
		const { canvas, game, render, ui, button } = env, cfg = game.cfg;
		const previousPause = game.paused, original = setupOf(cfg, game, ui.opts()), wasCustom = cfg.customGeometry;
		game.setEditing(true);
		game.reset();
		document.body.dataset.editing = '1';
		button.textContent = 'Done editing'; button.setAttribute('aria-expanded', 'true');
		const blocked = ['panel', 'menuTab', 'helpTab', 'help'].map(id => document.getElementById(id)).filter(Boolean);
		const inert = blocked.map(node => node.inert);
		blocked.forEach(node => { node.inert = true; });
		// Editing owns the screen: the help drawer and its edge hover stay out of it.
		if (typeof Help !== 'undefined') Help.suspend();
		const host = document.getElementById('app');
		const overlay = element('canvas', host), drawer = element('section', host), style = element('style', document.head);
		overlay.id = 'zoneEditorOverlay'; drawer.id = 'zoneEditorDrawer';
		drawer.setAttribute('aria-label', 'Board editor');
		style.textContent = `
#zoneEditorOverlay { position: fixed; z-index: 22; touch-action: none; border-radius: 8px; box-shadow: none; }
#zoneEditorDrawer { position: fixed; z-index: 25; right: 12px; top: 12px; bottom: 12px; width: min(320px, 42vw); box-sizing: border-box;
	padding: 14px; overflow-y: auto; background: var(--panel, #152332); font-size: 13px; border: 1px solid #648398; border-radius: 10px; color: var(--txt, #fff); }
#zoneEditorDrawer h2 { margin: 0 0 8px; font-size: 16px; }
#zoneEditorDrawer p { line-height: 1.5; }
#zoneEditorDrawer label { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 7px 0; }
#zoneEditorDrawer input { width: 88px; box-sizing: border-box; }
#zoneEditorDrawer select { max-width: 150px; }
#zoneEditorDrawer .editor-copy { display: flex; gap: 8px; margin: 8px 0; }
#zoneEditorDrawer .editor-copy button { flex: 1 1 auto; }
#zoneEditorDrawer label:has(textarea) { display: block; }
#zoneEditorDrawer textarea { display: block; margin-top: 7px; width: 100%; box-sizing: border-box; height: 90px; font-size: 11px; }
#zoneEditorDrawer summary { cursor: pointer; padding: 8px 0; font-weight: bold; }
#zoneEditorDrawer .editor-status { min-height: 2.6em; color: #ffd38a; }
@media(max-width: 650px) { #zoneEditorDrawer { top: auto; left: 6px; right: 6px; bottom: 6px; width: auto; max-height: 42vh; }
	body[data-editing] #btnEdit { bottom: auto; top: 8px; } }
`;
		element('h2', drawer, 'Board editor');
		element('p', drawer, 'Paused preview · drag the labelled handles. Values are metres unless noted. Closing starts a fresh game.');
		const done = element('button', drawer, 'Done · play'), revert = element('button', drawer, 'Revert edits');
		const status = element('p', drawer, 'Changes stay on this board, including after Reset. Copy to keep or share them.');
		status.className = 'editor-status'; status.setAttribute('role', 'status');
		const controls = [], handles = [];
		let symmetry = false;
		const geometryGroup = element('details', drawer); geometryGroup.open = false;
		element('summary', geometryGroup, 'Geometry · exact values');
		function number(parent, label, key, get, set, step = '0.01') {
			const row = element('label', parent, label), input = element('input', row);
			input.type = 'number'; input.step = step; input.value = String(get()); input.dataset.param = key;
			controls.push({ input, get });
			input.addEventListener('change', () => {
				const value = Number(input.value);
				if (input.value.trim() && Number.isFinite(value)) set(value);
				else status.textContent = 'Enter a finite number.';
				refresh();
			});
		}
		for (const key of GEOMETRY_KEYS) number(geometryGroup, labels[key], key, () => cfg[key], value => {
			const b = boardGeometry(cfg); b[key] = value; changeGeometry(b, false);
		});
		for (let i = 0; i < 2; i++) for (const key of ['x', 'y', 'r']) number(geometryGroup,
			'Hole ' + (i + 1) + ' ' + (key === 'r' ? 'radius' : key.toUpperCase()), 'hole' + i + key,
			() => cfg.holes[i][key], value => { const b = boardGeometry(cfg); b.holes[i][key] = value; changeGeometry(b, false); });
		const rulesGroup = element('details', drawer); rulesGroup.open = true;
		element('summary', rulesGroup, 'Rules and pieces');
		function select(label, key, choices) {
			const row = element('label', rulesGroup, label), input = element('select', row);
			for (const value of choices) { const option = element('option', input, value); option.value = value; }
			const get = () => cfg[key]; input.value = get(); controls.push({ input, get });
			input.addEventListener('change', () => { cfg[key] = input.value; changed(); });
		}
		function checkbox(label, get, set) {
			const row = element('label', rulesGroup, label), input = element('input', row);
			input.type = 'checkbox'; input.checked = !!get();
			controls.push({ input, get, checkbox: true });
			input.addEventListener('change', () => set(input.checked, input));
		}
		select('Score map', 'diskSchema', Object.keys(DISK_SCHEMAS));
		select('Return rule', 'recycleMode', ['none', 'zones', 'advance']);
		select('Return shape', 'zoneStyle', ZONE_STYLES);
		select('Hole shape', 'holeStyle', HOLE_STYLES);
		checkbox('Symmetry mirror (half-Y)', () => symmetry, setSymmetry);
		checkbox('Big-disk scales contents (scale | crop)', () => cfg.diskScale, on => {
			cfg.diskScale = on;
			if (on) game.setOmega(clamp(autoOmega(cfg), 0, cfg.omegaMax));
			changed();
		});
		number(rulesGroup, 'Disk speed (rad/s)', 'omega', () => game.omegaStart, value => { game.setOmega(clamp(value, 0, cfg.omegaMax)); changed(); }, '0.001');
		number(rulesGroup, 'Pucks per seat', 'balls', () => cfg.ballsPerPlayer, value => { cfg.ballsPerPlayer = Math.round(clamp(value, 1, 8)); changed(); }, '1');
		number(rulesGroup, 'Maximum throws', 'maxThrows', () => cfg.maxThrows, value => { cfg.maxThrows = Math.round(clamp(value, 1, 512)); changed(); }, '1');
		const copyRow = element('div', drawer); copyRow.className = 'editor-copy';
		const copy = element('button', copyRow, 'Copy preset');
		const copyChanges = element('button', copyRow, 'Copy changes only');
		const outputLabel = element('label', drawer, 'Preset / link text (select to copy manually)');
		const output = element('textarea', outputLabel); output.readOnly = true;
		function refresh() {
			for (const c of controls) {
				if (document.activeElement === c.input) continue;
				if (c.checkbox) c.input.checked = !!c.get();
				else c.input.value = String(Number.isFinite(c.get()) ? Number(c.get().toFixed(6)) : c.get());
			}
			syncSymmetryControls();
			output.value = descriptor(setupOf(cfg, game, ui.opts()));
			draw();
		}
		function changed() {
			game.reset(); render.resize(true); game.invalidateGhost(); ui.refreshEditor(); refresh();
		}
		// Symmetry across the half-Y line: the disk centre stays on the midline and the
		// second hole mirrors the first, so the two holes are always the same pair.
		function enforceSymmetry(b) {
			b.diskY = b.boardH / 2;
			const h0 = b.holes[0];
			b.holes[1] = { x: h0.x, y: b.boardH - h0.y, r: h0.r };
		}
		function symmetryInputs() {
			const out = [];
			const dy = controls.find(c => c.input.dataset.param === 'diskY');
			if (dy) out.push(dy.input);
			for (const k of ['hole1x', 'hole1y', 'hole1r']) {
				const c = controls.find(c => c.input.dataset.param === k);
				if (c) out.push(c.input);
			}
			return out;
		}
		function syncSymmetryControls() {
			for (const i of symmetryInputs()) i.disabled = symmetry;
		}
		function setSymmetry(on) {
			symmetry = on;
			if (on) {
				const b = boardGeometry(cfg);
				enforceSymmetry(b);
				if (applyBoardGeometry(cfg, b)) status.textContent = 'Symmetry on: holes mirror across the half-board line and the disk stays on it.';
				else status.textContent = 'Mirror would overlap the holes — move a hole off the centre line first.';
			} else status.textContent = 'Symmetry off: holes and the disk move freely.';
			syncSymmetryControls();
			changed();
		}
		function changeGeometry(proposal, drag) {
			if (symmetry) enforceSymmetry(proposal);
			const oldR = cfg.diskR;
			const b = drag ? project(boardGeometry(cfg), proposal) : proposal;
			if (!applyBoardGeometry(cfg, b)) {
				status.textContent = 'Not applied: keep the disk inside the board, holes apart, and a clear launch lane (at least one puck wide).';
				return;
			}
			status.textContent = 'Board updated. Close to play, or copy this setup.';
			if (cfg.diskScale && cfg.diskR !== oldR) game.setOmega(clamp(autoOmega(cfg), 0, cfg.omegaMax));
			changed();
		}
		function handle(label, get, set, visible = () => true) { handles.push({ label, get, set, visible }); }
		handle('disk', () => [cfg.diskX, cfg.diskY], (b, x, y) => { b.diskX = x; b.diskY = y; });
		handle('disk radius', () => [cfg.diskX + cfg.diskR, cfg.diskY], (b, x, y) => { b.diskR = Math.max(0.15, Math.hypot(x - b.diskX, y - b.diskY)); });
		for (let i = 0; i < 2; i++) {
			const vis = () => i === 0 || !symmetry;
			handle('hole ' + (i + 1), () => [cfg.holes[i].x, cfg.holes[i].y], (b, x, y) => { b.holes[i].x = x; b.holes[i].y = y; }, vis);
			handle('hole radius', () => [cfg.holes[i].x + cfg.holes[i].r, cfg.holes[i].y], (b, x, y) => { b.holes[i].r = Math.max(0.02, Math.hypot(x - b.holes[i].x, y - b.holes[i].y)); }, vis);
		}
		handle('reach', () => [cfg.diskX + (cfg.recycleMode === 'zones' ? cfg.boardW - cfg.diskX : -cfg.diskX) * cfg.zoneReach, cfg.diskY],
			(b, x) => { b.zoneReach = clamp(cfg.recycleMode === 'zones' ? (x - b.diskX) / (b.boardW - b.diskX) : (b.diskX - x) / b.diskX, 0.1, 1); },
			() => !isFieldZone(cfg) && cfg.recycleMode !== 'none');
		handle('cut gap', () => [cfg.diskX - cfg.diskR - cfg.puckR - cfg.zoneCutGap, cfg.diskY],
			(b, x) => { b.zoneCutGap = clamp(b.diskX - b.diskR - b.puckR - x, 0, 0.5); }, () => isCutZone(cfg));
		handle('puck radius', () => [cfg.launchX + cfg.puckR, cfg.launchY], (b, x, y) => { b.puckR = clamp(Math.hypot(x - b.launchX, y - b.launchY), 0.02, 0.25); });
		handle('launch', () => [cfg.launchX, cfg.launchY], (b, x, y) => { b.launchX = x; b.launchY = y; });
		handle('lane left', () => [cfg.launchMinX, cfg.launchY + 0.3], (b, x) => { b.launchMinX = x; b.launchX = Math.max(x, b.launchX); });
		handle('lane right', () => [cfg.launchMaxX, cfg.launchY + 0.3], (b, x) => { b.launchMaxX = x; b.launchX = Math.min(x, b.launchX); });
		let rect, drag = null;
		const ctx = overlay.getContext('2d');
		function draw() {
			if (!rect) return;
			ctx.clearRect(0, 0, overlay.width, overlay.height);
			ctx.save(); ctx.scale(overlay.width / cfg.boardW, overlay.height / cfg.boardH);
			ctx.strokeStyle = '#ffdc88'; ctx.lineWidth = cfg.boardW / rect.width;
			ctx.strokeRect(cfg.launchMinX, cfg.launchMinY, cfg.launchMaxX - cfg.launchMinX, cfg.launchMaxY - cfg.launchMinY);
			ctx.restore();
			const dpr = overlay.width / rect.width;
			ctx.save(); ctx.scale(dpr, dpr); ctx.font = '11px sans-serif';
			for (const h of handles) {
				if (!h.visible()) continue;
				const p = h.get(), x = p[0] / cfg.boardW * rect.width, y = p[1] / cfg.boardH * rect.height;
				ctx.fillStyle = '#123043'; ctx.strokeStyle = '#ffdc88'; ctx.lineWidth = 2;
				ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
				ctx.fillStyle = '#fff4cf'; ctx.textAlign = x > rect.width * 0.75 ? 'right' : 'left';
				ctx.fillText(h.label, x + (x > rect.width * 0.75 ? -10 : 10), clamp(y + (h.label === 'launch' ? 24 : -10), 12, rect.height - 4));
			}
			ctx.restore();
		}
		function resize() {
			rect = canvas.getBoundingClientRect();
			overlay.style.left = rect.left + 'px'; overlay.style.top = rect.top + 'px';
			overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px';
			const dpr = Math.min(window.devicePixelRatio || 1, 3);
			overlay.width = Math.max(1, Math.round(rect.width * dpr)); overlay.height = Math.max(1, Math.round(rect.height * dpr));
			draw();
		}
		function pointerDown(e) {
			if (drag || e.button > 0 || e.isPrimary === false) return;
			resize();
			let best = null, distance = 22;
			for (const h of handles) {
				if (!h.visible()) continue;
				const p = h.get(), d = Math.hypot(e.clientX - rect.left - p[0] / cfg.boardW * rect.width, e.clientY - rect.top - p[1] / cfg.boardH * rect.height);
				if (d < distance) { best = h; distance = d; }
			}
			if (!best) return;
			e.preventDefault(); overlay.setPointerCapture(e.pointerId);
			drag = { id: e.pointerId, handle: best, start: boardGeometry(cfg) };
		}
		function pointerMove(e) {
			if (!drag || drag.id !== e.pointerId) return;
			const b = boardGeometry(cfg), p = render.toWorld(e.clientX, e.clientY);
			drag.handle.set(b, clamp(p.x, 0, cfg.boardW), clamp(p.y, 0, cfg.boardH));
			changeGeometry(b, true);
		}
		function pointerEnd(e) {
			if (!drag || drag.id !== e.pointerId) return;
			if (e.type === 'pointercancel') changeGeometry(drag.start, false);
			overlay.releasePointerCapture(e.pointerId); drag = null;
		}
		overlay.addEventListener('pointerdown', pointerDown);
		overlay.addEventListener('pointermove', pointerMove);
		overlay.addEventListener('pointerup', pointerEnd);
		overlay.addEventListener('pointercancel', pointerEnd);
		overlay.addEventListener('lostpointercapture', () => { drag = null; });
		async function copyText(text, done) {
			output.value = text;
			try {
				if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
				await navigator.clipboard.writeText(output.value);
				status.textContent = done;
			} catch (e) {
				output.focus(); output.select();
				let copied = false;
				try { copied = document.execCommand('copy'); } catch (error) { /* Manual copy stays available. */ }
				status.textContent = copied ? done : 'Clipboard blocked. Preset selected: press Ctrl+C / ⌘C, or long-press to copy.';
			}
		}
		copy.addEventListener('click', () => copyText(descriptor(setupOf(cfg, game, ui.opts())), 'Preset copied.'));
		// The changes link skips every value the shipped board already has, so a shared
		// link keeps the reader's attention on what this board sets differently.
		copyChanges.addEventListener('click', () => {
			const query = ui.changesQuery();
			copyText('index.html' + (query ? '?' + query : ''), query ? 'Changes copied.' : 'Nothing differs from the default board — plain link copied.');
		});
		done.addEventListener('click', close);
		revert.addEventListener('click', () => {
			ui.applySetup(original); cfg.customGeometry = wasCustom; changed();
			status.textContent = 'Restored the setup from when you opened the editor.';
		});
		function keydown(e) {
			if (e.key !== 'Escape') return;
			e.preventDefault(); e.stopImmediatePropagation(); close();
		}
		window.addEventListener('keydown', keydown, true);
		window.addEventListener('resize', resize);
		window.addEventListener('scroll', resize, true);
		const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
		if (observer) observer.observe(canvas);
		session = { close() {
			if (drag && overlay.hasPointerCapture(drag.id)) overlay.releasePointerCapture(drag.id);
			if (observer) observer.disconnect();
			window.removeEventListener('keydown', keydown, true); window.removeEventListener('resize', resize); window.removeEventListener('scroll', resize, true);
			overlay.remove(); drawer.remove(); style.remove();
			blocked.forEach((node, i) => { node.inert = inert[i]; });
			if (typeof Help !== 'undefined') Help.resume();
			delete document.body.dataset.editing;
			game.setEditing(false); game.reset();
			if (previousPause) game.togglePause();
			button.textContent = 'Edit board'; button.setAttribute('aria-expanded', 'false');
			env.refit(); ui.refreshEditor(); button.focus();
		} };
		resize(); refresh(); done.focus();
	}
	function close() {
		if (!session) return;
		const current = session; session = null; current.close();
	}
	return { open, close, project, setupOf, setupQuery, descriptor, get active() { return !!session; } };
})();
if (typeof module !== 'undefined') module.exports = ZoneEditor;
