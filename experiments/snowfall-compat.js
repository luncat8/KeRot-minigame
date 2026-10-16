'use strict';

/* Optional conformance gate against a separate snowfall-core checkout.
   SNOWFALL_CORE_DIR=/path/to/snowfall-core node experiments/snowfall-compat.js
   No engine source is copied into this repository. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const core = process.env.SNOWFALL_CORE_DIR;
if (!core) {
	console.log('snowfall-compat: SKIP — set SNOWFALL_CORE_DIR to a snowfall-core checkout');
	process.exit(0);
}
const coreRoot = path.resolve(core);
const harnessPath = path.join(coreRoot, 'test/lib/fakedom.js');
if (!fs.existsSync(harnessPath)) throw new Error('Snowfall fake-DOM gate not found: ' + harnessPath);
const FD = require(harnessPath);
const VH = 800;
function measure(node, vh, inner) {
	const cls = (node.attrs.class || '').split(/\s+/).filter(Boolean);
	if (cls.includes('spacer')) return vh;
	if (cls.includes('kerot-slot')) return Math.max(576, inner);
	if (node.tag === 'section') return Math.max(224, 32 + inner + 32);
	if (node.tag === 'p') return 16 + Math.max(1, Math.ceil(FD.nodeText(node).trim().length / 58)) * 26 + 16;
	return inner;
}
const bundleRel = path.relative(coreRoot, path.join(ROOT, 'games/kerot.js')).split(path.sep).join('/');
const source = '<!doctype html><html data-story="kerot-compat"><head></head><body>'
	+ '<div id="app"><section id="cover"><h1>KeRot test</h1><p>Scroll past the match slot.</p></section>'
	+ '<div class="spacer"></div><div class="spacer"></div><div class="spacer"></div>'
	+ '<section id="match"><h2>Match</h2><div class="kerot-slot" id="kerot-match"><p>idle</p></div>'
	+ '<script type="txt" event="skip">window.openKerot()</script></section>'
	+ '<div class="spacer"></div><div class="spacer"></div><output id="qa"></output></div>'
	+ '<script src="snowfall.js"></script><script src="snowfall-games.js"></script>'
	+ '<script src="' + bundleRel + '"></script><script>'
	+ 'window.openKerot = function(){ window.kerotLive = SnowfallGames.play("kerot", {'
	+ 'el: document.getElementById("kerot-match"), key: "kerot.compat-match", fallback: 0,'
	+ 'done: function(value, mode){ window.kerotDone = { value: value, mode: mode }; } }); };'
	+ '</script></body></html>';
const page = FD.buildPage(source, VH, { dir: coreRoot, measure: measure });
assert(page.S && page.S.version === '0.7.0', 'expected the pinned Snowfall engine API');
assert(page.win.SnowfallGames && page.win.SnowfallGames.version === '0.6.0', 'expected the minigame runner API');
assert(page.win.SnowfallGames.get('kerot'), 'the game registered in SnowfallGames');
assert.strictEqual(page.win.SnowfallGames.get('kerot').fallback, 0);
page.win.setScroll(page.bottom());
assert(page.win.kerotDone, 'the skipped story slot resolved through Snowfall.ask');
assert.strictEqual(page.win.kerotDone.value, 0);
assert.strictEqual(page.win.kerotDone.mode, 'default');
assert.strictEqual(page.win.SnowfallGames.live, 0, 'skip did not mount a live physics session');
assert.strictEqual(page.S.store.counts.defaults, 1, 'Snowfall marked the fallback as a default result');
assert.strictEqual(page.store().keys['kerot.compat-match'], 0, 'the scalar result was stored by the engine');
assert(!page.el('kerot-match').querySelector('.kerot-board'), 'skip painted no interactive game board');
console.log('snowfall-compat: real Snowfall ' + page.S.version + ' + SnowfallGames ' + page.win.SnowfallGames.version + ' passed (skip/default contract)');
