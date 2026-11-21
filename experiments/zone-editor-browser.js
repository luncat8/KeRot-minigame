// Optional real-browser gate. Requires playwright-core and a local Chromium binary.
// NODE_PATH=<tools>/node_modules CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node experiments/zone-editor-browser.js
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { chromium } = require('playwright-core');
const url = 'file://' + path.resolve(__dirname, '../index.html');
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
	const root = path.resolve(__dirname, '..');
	const server = http.createServer((req, res) => {
		const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
		if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
		fs.readFile(file, (error, data) => {
			if (error) { res.writeHead(404).end(); return; }
			res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(data);
		});
	});
	await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
	const liveUrl = 'http://127.0.0.1:' + server.address().port + '/index.html';
	let browser;
	try {
		browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
			args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader'] });
		const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
		const errors = [], requests = [];
		page.on('pageerror', error => errors.push(error.message));
		page.on('request', req => requests.push(req.url()));
		await page.addInitScript(() => {
			const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window), active = [];
			window.__windowListeners = active;
			window.addEventListener = (type, fn, options) => { active.push({ type, fn, options }); add(type, fn, options); };
			window.removeEventListener = (type, fn, options) => {
				const i = active.findIndex(v => v.type === type && v.fn === fn && v.options === options);
				if (i >= 0) active.splice(i, 1);
				remove(type, fn, options);
			};
		});
		await page.goto(liveUrl); await frame(page);
		assert(!requests.some(u => u.endsWith('/zone-editor.js')), 'ordinary visit never downloads the editor');
		await page.route('**/zone-editor.js', route => route.abort(), { times: 1 });
		await page.click('#btnEdit');
		await page.waitForFunction(() => document.getElementById('btnEdit').textContent === 'Retry editor');
		assert.equal(await page.locator('#zoneEditorDrawer').count(), 0);
		const listenerCount = await page.evaluate(() => window.__windowListeners.length);
		await page.click('#btnEdit'); await page.waitForSelector('#zoneEditorDrawer');
		assert(await page.evaluate(() => Game.paused && Game.editing && !Game.canAim() && document.getElementById('panel').inert));
		const original = await page.evaluate(() => boardGeometry(CFG));
		const t = await page.evaluate(() => Game.world.t); await frame(page);
		assert.equal(await page.evaluate(() => Game.world.t), t, 'simulation stays paused');
		await page.evaluate(() => document.activeElement.blur());
		await page.keyboard.press('r'); await page.keyboard.press('Space');
		assert.equal(await page.evaluate(() => Game.world.thrown), 0);
		async function point(x, y) {
			return page.evaluate(({ x, y }) => { const r = document.getElementById('c').getBoundingClientRect();
				return { x: r.left + x / CFG.boardW * r.width, y: r.top + y / CFG.boardH * r.height }; }, { x, y });
		}
		let p = await point(original.diskX, original.diskY);
		await page.mouse.move(p.x, p.y); await page.mouse.down();
		await page.mouse.move(p.x + 15, p.y + 5, { steps: 3 }); await page.mouse.up();
		assert(await page.evaluate(x => CFG.diskX > x && validBoardGeometry(boardGeometry(CFG)), original.diskX));
		const moved = await page.evaluate(() => boardGeometry(CFG));
		p = await point(moved.diskX, moved.diskY);
		await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 12, p.y);
		await page.evaluate(() => document.getElementById('zoneEditorOverlay').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
		await page.mouse.up();
		assert.deepEqual(await page.evaluate(() => boardGeometry(CFG)), moved, 'pointer cancel restores the drag start');
		await page.locator('#zoneEditorDrawer summary').first().click();
		const puck = page.locator('[data-param="puckR"]');
		await puck.fill('0.08'); await puck.press('Tab');
		assert.equal(await page.evaluate(() => CFG.puckR), 0.08);
		assert(await page.evaluate(() => Game.world.r[Game.pending] === CFG.puckR));
		const radius = page.locator('[data-param="diskR"]');
		await radius.fill('99'); await radius.press('Tab');
		assert.equal(await page.evaluate(() => CFG.diskR), original.diskR, 'invalid numeric edits are rejected');
		await radius.fill('0.72'); await radius.press('Tab');
		await page.locator('#zoneEditorDrawer select').nth(2).selectOption('3-rounded');
		const gap = page.locator('[data-param="zoneCutGap"]');
		await gap.fill('0.12'); await gap.press('Tab');
		await page.locator('[data-param="maxThrows"]').fill('67'); await page.locator('[data-param="maxThrows"]').press('Tab');
		const edited = await page.evaluate(() => boardGeometry(CFG));
		await page.setViewportSize({ width: 1100, height: 700 }); await frame(page);
		assert.deepEqual(await page.evaluate(() => boardGeometry(CFG)), edited, 'resize must not refit custom geometry');
		assert(await page.evaluate(() => {
			const a = document.getElementById('c').getBoundingClientRect(), b = document.getElementById('zoneEditorOverlay').getBoundingClientRect();
			return Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
		}));
		// Force both clipboard paths and verify honest fallback feedback.
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window.__copied = text; return Promise.resolve(); } } });
		});
		await page.getByRole('button', { name: 'Copy preset', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('.editor-status').textContent === 'Preset copied.');
		assert((await page.evaluate(() => window.__copied)).includes('geometry='));
		const setup = await page.evaluate(() => JSON.parse(document.querySelector('#zoneEditorDrawer textarea').value.split('\njson: ')[1].split('\nsummary: ')[0]));
		await page.evaluate(() => {
			navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'));
			document.execCommand = () => false;
		});
		await page.getByRole('button', { name: 'Copy preset', exact: true }).click();
		await page.waitForFunction(() => document.querySelector('.editor-status').textContent.startsWith('Clipboard blocked.'));
		assert(await page.evaluate(() => { const out = document.querySelector('#zoneEditorDrawer textarea'); return out.selectionEnd === out.value.length; }));
		await page.keyboard.press('Escape'); await frame(page);
		assert.equal(await page.locator('#zoneEditorDrawer, #zoneEditorOverlay').count(), 0);
		assert.equal(await page.evaluate(() => window.__windowListeners.length), listenerCount, 'editor window listeners are removed');
		assert(await page.evaluate(() => !Game.editing && !Game.paused && !document.getElementById('panel').inert));
		// Preset text is actually sufficient to reopen the edited board, without loading the editor.
		const query = await page.evaluate(s => ZoneEditor.setupQuery(s), setup);
		await page.goto(url + '?' + query); await frame(page);
		assert.deepEqual(await page.evaluate(() => boardGeometry(CFG)), edited);
		assert.equal(await page.evaluate(() => CFG.maxThrows), 67);
		assert.equal(await page.locator('script[src="js/zone-editor.js"]').count(), 0);
		await page.evaluate(() => UI.applyPreset('default')); await frame(page);
		assert.equal(await page.evaluate(() => CFG.customGeometry), false);
		// Narrow view + retained pause + repeated open/close + revert.
		await page.setViewportSize({ width: 390, height: 844 }); await frame(page);
		await page.evaluate(() => Game.togglePause());
		await page.click('#btnEdit'); await page.waitForSelector('#zoneEditorDrawer'); await page.click('#btnEdit');
		const narrowListeners = await page.evaluate(() => window.__windowListeners.length);
		for (let i = 0; i < 3; i++) {
			await page.click('#btnEdit'); await page.waitForSelector('#zoneEditorDrawer');
			assert(await page.evaluate(() => {
				const r = document.getElementById('zoneEditorDrawer').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
			}));
			if (i === 0) {
				await page.locator('[data-param="balls"]').fill('6'); await page.locator('[data-param="balls"]').press('Tab');
				await page.getByRole('button', { name: 'Revert edits' }).click();
				assert.equal(await page.evaluate(() => CFG.ballsPerPlayer), 4);
			}
			await page.click('#btnEdit');
			assert(await page.evaluate(() => Game.paused && !Game.editing));
			assert.equal(await page.evaluate(() => window.__windowListeners.length), narrowListeners);
		}
		assert.deepEqual(errors, [], 'no browser exceptions');
		await page.close();
		console.log('OK (HTTP lazy retry, file:// reload, drag/cancel, inputs, resize, clipboard, URL reload, cleanup, mobile, pause/revert)');
	} finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
