# KeRot — rotating-disk curling

KeRot is a browser curling minigame: stones slide across a rotating scoring disk, and seats compete
for the red area they hold. The standalone game runs directly from `index.html` with classic scripts
and no build step.

## Run

Open `index.html` in a modern browser, or serve the repository as static files. Press or drag on
the ice outside your puck to aim. Hold Shift while dragging for fine adjustments. Tap or click the
puck once to throw, or use the Throw button or Space. When the last throw is done the result card over the
board names the winner; **double-click the board** (or press **R**) to deal a new game. The page
includes the full settings panel, bot profiles, score maps, recycling rules, and speed voting.

## Field marking shapes

Two rule groups in the settings pick the shape of the return zone and of the black
holes; what is drawn is exactly what the rule tests. **Return zone shape**: the straight
hatched wedge (shipped), the same wedge with wavy lines, *rounded* (an outline that hugs
the disk and the holes, filled with inset copies of itself), or *one arc* around the
disk with the holes inside the zone. **Black holes**: round with a dashed reach
(shipped), rim only, a stepped well, or a triangle standing on its wall with sides
parallel to the wedge and the semicircle's area. A checkbox rounds the score cards.
URL keys: `zones=hatch|wavy|rounded|arcs`, `holes=classic|rim|well|triangle`,
`cards=round`. Validate with `node experiments/zone-shapes.js`.

## Optional glass presentation

The shipped page stays lightweight. **Plain** loads only the classic scripts below; the
richer ice is an opt-in add-on in the same page, not a second game or a second HTML/CSS
copy. The **presentation** select (`fx=glass`) and **ice / glass sound** checkbox
(`sfx=1`) are also available as the `crystal` preset and as URL keys:

```text
index.html?preset=crystal
index.html?fx=glass&sfx=1
```

`js/fx.js` is a small controller that injects `js/fx-glass.js` on first use. That file
bakes frost grain, a rotating disk overlay, soft shadows and glassy puck rims
once, then draws only cached sprites; it also synthesises WebAudio ice hiss, glass
clinks, rail taps, throw swishes and black-hole swishes — no image or audio assets, no
network requests, no new dependencies. The disk's etched finish is a setting: the
radial skate brush (scratches of random length and position) or worn hex cells with
soft, partly missing edges (`decor=hex`). The sound is stereo around a mic head on the
disk's centre — contacts, throws and voids pan to where they happened — with a
listener facing setting (`face=launch|up|bottom`) and a volume slider (`vol`, 100 % is
the original level, 130 % as shipped). The disk's markings are drawn as paint under
ice: a scattered copy of the schema, a thin glaze with frost and trapped air over it,
and the brushed surface polish above that. Ice costs light rather than adding it, so
the skin never lifts the room: the frozen veil is a cold depth tint, the grain is
zero-mean, and a ceiling lamp lands in two passes — a soft dark seat where its housing
blocks the sky, multiplied in, then a narrow tube with a hot filament, rubbed-out ribs
and a cool fringe, added on top. The five reflections are baked in board space at
200 px/m (so the bar's detail survives at 1:1) and never turn with the disk. Every seat
colour rings at its own note — a pentatonic ladder with its own partial spread — and a
contact between two colours rings between them.
`js/render.js` exposes six no-op hook points, and `js/main.js` passes one world
observation per frame to the optional sound layer. With the option off, the base page
downloads no add-on and pays only those hook checks.
The field paint, scoring, bot aims, seat rings and puck numbers remain the shipped ones:
the glass layer is decorative and does not change gameplay.

The Snowfall distribution `games/kerot.js` intentionally stays plain. It reuses the
renderer with the new hooks but does not include `fx.js`, `fx-glass.js`, WebAudio or
the page chrome, so the story-page artifact keeps its small single-file payload.
Validate the optional layer with `node experiments/fx-smoke.js`; render real before/
after PNGs with `node experiments/render-frames.js [outDir]` and
`node experiments/render-frames.js --glass [outDir]` (the latter needs
`npm install` once in `experiments/tools`). `node experiments/render-frames.js --tone`
is the gate for the lighting: it draws the same board plain and with the skin and fails
if the ice lifts the floor, the polished plate or the frame average beyond its budget.

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
