# KeRot — rotating-disk curling

KeRot is a browser curling minigame: stones slide across a rotating scoring disk, and seats compete
for the red area they hold. The standalone game runs directly from `index.html` with classic scripts
and no build step.

## Run

Open `index.html` in a modern browser, or serve the repository as static files. Drag on the board to
aim, then throw with the button or Space. The page includes the full settings panel, bot profiles,
score maps, recycling rules, and speed voting.

## Snowfall VN integration

A separate Snowfall adapter is available as one distributable classic script:
`games/kerot.js` (its scoped source is `minigame/entry.js` and `minigame/kerot.css`). It runs the
existing physics and renderer as a short human-versus-bot match and resolves through
`SnowfallGames.play` with a scalar result: win `1`, draw `0`, loss `-1`; skipped slots default to `0`.

```html
<script src="snowfall.js?v=439c0a6814"></script>
<script src="snowfall-games.js?v=439c0a6814"></script>
<script src="games/kerot.js"></script>

<div class="kerot-slot" id="match"><p>The rink waits.</p></div>
<script type="txt" event="view,skip">
	SnowfallGames.play('kerot', {
		el: document.getElementById('match'),
		key: 'kerot.chapter-one',
		fallback: 0
	});
</script>
```

The slot must use `.kerot-slot` before Snowfall's first measure; this reserves the game/result
height and prevents later prose anchors from jumping. See [`docs/snowfall-integration.md`](docs/snowfall-integration.md)
for options, development/testing, the tested Snowfall pin, and recommendations for the draft engine.
`snowfall-demo.html` is a runnable story example when this repository and the pinned `snowfall-core`
checkout are siblings.

Build and validate the committed single-file package with:

```sh
node tools/build-minigame.js
node tools/build-minigame.js --check
node experiments/minigame-smoke.js
```

For an optional test against a separate Snowfall checkout:

```sh
SNOWFALL_CORE_DIR=../snowfall-core node experiments/snowfall-compat.js
```

The game does not vendor or submodule the VN engine; compatibility is pinned and tested separately.
