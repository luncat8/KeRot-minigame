# KeRot as a Snowfall minigame

KeRot now has a Snowfall adapter while keeping the standalone game as the source of truth.
The adapter is a human-versus-bot match using the existing physics, scoring, bots, and canvas renderer;
it is not an iframe around `index.html`.

## Story-page contract

Load the pinned Snowfall core, its optional minigame runner, and KeRot in that order as classic scripts:

```html
<script src="snowfall.js?v=439c0a6814"></script>
<script src="snowfall-games.js?v=439c0a6814"></script>
<script src="games/kerot.js"></script>
```

Reserve a stable-height slot in the story markup **before Snowfall measures anchors**. `kerot.css` is
inlined into the distributable script at build time, so the host page does not need another KeRot
asset or a CSS URL whose base would depend on the story page:

```html
<div class="kerot-slot" id="ice-road-match">
	<p>The rink waits below.</p>
</div>
<script type="txt" event="view,skip">startKerot()</script>
```

```js
window.startKerot = function() {
	SnowfallGames.play('kerot', {
		el: document.getElementById('ice-road-match'),
		key: 'kerot.ice-road-match',
		fallback: 0,
		opts: { balls: 2, bot: 'balanced', schema: 'rim6' },
		done: function(value, mode) {
			// value: 1 win, 0 draw/neutral, -1 loss; mode: live, saved, or default.
		}
	});
};
```

`0` is both a draw and the neutral skip fallback; `mode` distinguishes them. A game key records one
scalar, which can be summed or used in later story conditions without introducing a second save
system. Options accepted by the adapter are `balls` (1–4, default 2), `bot` (`balanced`, `keeper`,
`hunter`, `retriever`, `blackhole`, or `random`), `schema` (`classic`, `circles`, or `rim6`),
`theme` (`kerot` by default or `classic`), `mass`, `omega`, `botDelay`, `handoffT`, `settleTime`,
`seed`, plus text-only `title` and `instructions`.

The mount reserves 44rem (36rem on narrow screens) for live and resolved states. Keep the
`kerot-slot` class and do not put flow-changing content outside that reserved box. The game owns a
per-session renderer, input listeners, a fixed-step loop, and teardown. Its loop pauses while the
mount is off-screen or the document is hidden; Snowfall's current `refresh()` teardown remains a
second cleanup path. It does not capture page-global keyboard input: focus the board or its controls
first.

A minimal real-engine example is in `snowfall-demo.html`. It expects a sibling checkout at
`../snowfall-core` pinned as recorded in `integration/snowfall-core-pin.md`.

## Source and distribution layout

- `js/` remains the authoritative game implementation.
- `minigame/entry.js` is the Snowfall-specific session adapter; `minigame/kerot.css` is its scoped
  stylesheet and the pre-measure mount-height contract.
- `games/kerot.js` is the committed, standalone delivery artifact: one classic script, one game
  registration, no network requests, no third-party runtime, no story-engine code.
- `tools/build-minigame.js` makes that artifact deterministically and inlines CSS. Rebuild with
  `node tools/build-minigame.js`; check drift with `node tools/build-minigame.js --check`.

The packager wraps the existing classic-script/CommonJS-compatible source files in a small private
loader, so the 165 KB artifact reuses the real simulation and isolates its globals from the VN page.
It is generated code: edit the source and rebuild, never patch `games/kerot.js` by hand. This keeps
the integration testable without adopting a framework, npm dependency, or second implementation of
the physics.

## Development and testing

Fast local gates, with Node only:

```sh
node tools/build-minigame.js --check
node experiments/minigame-smoke.js
node experiments/client-smoke.js
node experiments/determinism.js
node --check minigame/entry.js
node --check games/kerot.js
git diff --check
```

`minigame-smoke.js` boots the actual distributable against a stubbed canvas and SnowfallGames
boundary, drives a complete short match, checks a scalar result, verifies two simultaneous sessions
have isolated renderer state, and checks teardown/default painting. It has no browser or npm
requirements. The existing client smoke still exercises the full standalone page and real game loop.

For a contract check against Snowfall itself, keep a normal sibling checkout (not a submodule) and
run:

```sh
SNOWFALL_CORE_DIR=../snowfall-core node experiments/snowfall-compat.js
```

That optional gate uses Snowfall's own fake-DOM harness and verifies load order, game registration,
`skip`/default resolution, the recorded fallback, and the scalar value visible to story callbacks. The
pin in `integration/snowfall-core-pin.md` should be reviewed whenever updating the engine. In the VN
repository, continue to run its full `node test/run.js` gate as well. The adapter consumes the
published `SnowfallGames.add/play` contract; it does not import or copy `snowfall.js`.

## Repository strategy: no submodule, no vendored engine

Keep the two projects independent. Snowfall is still draft-stage and has its own release cadence;
a submodule would force every KeRot checkout to initialize and update another repository, while
making a draft engine revision look like part of this game's source. Vendoring `snowfall.js` or
`snowfall-games.js` would create two copies of a moving engine and make bug fixes ambiguous. Instead:

1. keep only the game-specific adapter and generated game artifact here;
2. record the exact tested engine commit and API versions;
3. use an adjacent checkout for optional compatibility tests and the demo; and
4. update the pin deliberately when Snowfall's public contract changes.

If either project later needs automated cross-repo CI, a CI job can check out both repositories at
the recorded SHAs. That gives reproducibility without a permanent submodule or a vendored engine.

## Suggestions for snowfall-core

KeRot works on the current contract; these are future-facing improvements, not requirements for this
adapter:

1. **A public minigame lifecycle/visibility hook.** Today a game owns its ticker and can be cleaned
   up on answer or engine refresh, but the runner does not tell it when the reader scrolls away or
   when a core instance is destroyed. An optional `g.signal`/abort signal plus `g.onVisibility`
   (or a tiny frame/visibility subscriber) would standardize pause and teardown, reduce battery use,
   and let all games avoid their own `IntersectionObserver` plumbing. KeRot already self-pauses so
   it behaves well without this addition.
2. **A stable conformance-test entry point.** The current cross-repo gate uses the core's internal
   `test/lib/fakedom.js`; a small documented runner contract test or exported test helper would let
   downstream games test load order, skip, saved replay, fallback, and cleanup without depending on
   a private test file.
3. **Keep outcome storage scalar-first.** Win/draw/loss fits the current `ask` store and is simple to
   replay. If stories later need a scoreline or replay record, offer an optional serializable
   per-game result payload in addon state rather than making every game encode JSON into its scalar
   or maintaining a second save store.
