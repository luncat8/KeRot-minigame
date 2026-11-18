# KeRot image prompts — ComfyUI generator pack

Compatible with `gravity-trajectory/photos/generator` (`comfy_queue.py`, `launch.py`, and
`gallery.py`). Grounded in the actual renderer (`js/cfg.js`, `js/field.js`, `js/render.js`,
`js/players.js`, `index.html`, `minigame/kerot.css`).

Prompts **1–10** in front are rewritten finished-image captions engineered to stop models
from hallucinating curling gear or misdrawing the board. Prompts **11–17** at the end keep
the original A1–B3 drafts converted into generator syntax under `legacy` for reference or
A/B comparison.

## Why earlier prompts failed (editing rules)

1. **Remove hidden sport and prop triggers.** Even without naming the sport, combining
   *granite / stone + puck + ice sheet / rink / arena + kneeling lunge + red-and-blue
   circle* pulls models straight into Olympic curling (top handles on stones, brooms,
   concentric house rings, stadium boards) or hockey (black rubber pucks, sticks). Also
   avoid *turntable* (triggers vinyl record spindles and tonearms) and *coin / medallion /
   trophy* (triggers embossed lettering and relief portraits). Describe **thick flat
   cylindrical porcelain game pieces with a completely smooth flush top painted in six
   alternating pearl-white and dark charcoal pie-slice wedges** on a **rectangular dark
   frosted slate game board**.
2. **Replace bullseye and thermal-map wording with exact 2D shapes.** Avoid *heat map*,
   *target*, *ring*, and *red core inside blue*. Describe a **large smooth circular inlay
   set seamlessly flush with the floor in the left half of the rectangle**, using one real
   `js/field.js` pattern per caption:
   - `classic` — asymmetric left-to-right gradient: two soft cobalt-blue crescents along
     the upper-left and lower-left edge blending through milky white into one soft rounded
     coral-red patch sitting slightly right of center.
   - `rim6` — solid cobalt-blue circle with six evenly spaced coral-red half-circle
     scallops touching the inside of its white perimeter edge, each softened by a narrow
     milky-white halo.
   - `circles` — solid cobalt-blue circle containing three separate soft coral-red circles
     of unequal size (large upper-left, medium lower-right, small upper-right), each
     surrounded by a soft milky-white halo.
3. **Budget details so small models keep layout right.** Put at most four clear geometric
   elements in one shot; avoid stacking multiple dashed lines, tiny tick marks, and HUD
   bars in the same prompt. Place the two black violet-edged semicircles flush against the
   top and bottom straight board rails near the far-left corners, separated from the
   circular inlay by dark slate floor.
4. **Stay positive and visual inside `>` captions.** Keep negations (`no`, `not`, `without`,
   `-less`), raw hex codes, and code terms (`seat red`, `void`, `HUD`) out of captions;
   put exclusions in the workflow negative prompt. For pixel-exact board geometry, render
   a clean frame from `index.html` / `experiments/render-frames.js` and run img2img or a
   depth/canny guide over captions 4–7.

## Generator settings

| Setting | Recommended value |
|---|---|
| Workflow | `image_moss_image_t2i` (`--workflow moss --no-refine`, 35–50 steps, CFG 3.0, SLG on) or `image_krea2_turbo_t2i_int8` (`--workflow krea --no-refine`) |
| Negative prompt | `curling, curling stone, kettle handle, top handle, broom, sweeper, hockey stick, hockey puck, hockey goal, concentric target rings, bullseye, dartboard, vinyl record, tonearm, spindle, embossed text, stadium, bleachers, crowd, jersey, photo, 3d render, text, letters, numbers, watermark, logo, signature, worst quality, blur, jpeg artifact` |
| Categories | `drawer` (2:3 help-drawer backdrop), `board` (3:2 / 16:9 accurate field & backdrop), `win` (16:9 / 3:4 victory art), `legacy` (converted original drafts) |
| Palette reference | midnight teal `#0b1c26`, slate floor `#49586f` (`kerot-s` deep navy `#0e1620`), frost white `#dfe6e9`, pewter `#b2bec3`→`#636e72`, field cobalt `#375af0` → milky white `#f5f5fa` → coral red `#ff503c`, pale gold `#ffeaa7` / amber `#ffc078`, pocket violet `#9b59b6` on `#090812`, piece rims `#e74c3c` `#f39c12` `#2ecc71` `#74b9ff` `#fd79a8` |
| Valid `*Aspect:*` ratios | `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9` (`comfy_queue.py` `ASPECT_LABELS`) |

Example project JSON (save next to `gallery.py` as `kerot.json`, adjusting relative paths):

```json
{
	"name": "kerot",
	"prompts": ["../../../KeRot-minigame/img/kerot img.txt"],
	"workflows": ".",
	"output": "../../../KeRot-minigame/img",
	"gallery_output": "output/kerot",
	"prefix": "kerot",
	"default_workflow": "image_moss_image_t2i",
	"category_sizes": {
		"drawer": ["2:3", 1.5],
		"board": ["16:9", 1.5],
		"win": ["16:9", 1.5],
		"legacy": ["16:9", 1.5]
	}
}
```

CLI usage (renders only the improved sections; skips `legacy`):

```sh
python comfy_queue.py --project kerot.json --list
python comfy_queue.py --project kerot.json --situation drawer --workflow moss --no-refine --wait
python comfy_queue.py --project kerot.json --situation board --workflow moss --no-refine --wait
python comfy_queue.py --project kerot.json --situation win --workflow moss --no-refine --wait
```

---

## Improved drawer backgrounds (tall 2:3, calm dark space for rules text)

### 1 · drawer · pinwheel piece close-up → `drawer/piece-closeup.jpg`

*Style: clean 2D digital illustration, soft airbrush gradients, quiet midnight-teal space.*
*Aspect: 2:3 · 1.5 MP.*

> Clean 2D digital illustration viewed from a low three-quarter angle over a smooth dark slate-blue frosted surface at night. Resting in the lower right corner is a single thick, low cylindrical porcelain game piece with vertical sides and a completely flat, level, smooth circular top face divided cleanly into six equal pie-slice wedges alternating pearl-white and dark slate charcoal, framed around its outer edge by a thin solid crimson stripe. Warm pale-gold rim light catches the right bevel of the piece, and a delicate glowing golden curve trails gently behind it across fine frost grain. Along the bottom edge in soft focus gleams a curved section of a flush floor inlay blending smoothly from cobalt blue through milky white into warm coral red. The entire left half and upper two-thirds dissolve into calm, uninterrupted deep midnight-teal shadow.

### 2 · drawer · quiet flush inlay corner → `drawer/inlay-corner.jpg`

*Style: clean 2D geometric illustration, soft airbrush glow, deep teal falloff.*
*Aspect: 2:3 · 1.5 MP.*

> Stylized 2D digital illustration from a high three-quarter angle cropping the lower right corner of a dark midnight-teal frosted tabletop game board. Curving across the lower right quadrant is part of a large flat circular floor inlay set seamlessly flush and level with the dark slate surface, bordered by a thin crisp frost-white circular seam. The flat inlay surface carries a smooth matte airbrushed gradient flowing from rich cobalt blue through misty milky white into a warm glowing coral-red zone. Resting flat atop the coral-red zone are two small low cylindrical porcelain game pieces, each with a completely smooth flat top painted in six alternating pale-silver and dark charcoal pie-slice wedges and edged by a thin amber or emerald-green rim band. Cool soft light enters from the upper left while the entire left column and upper two-thirds stay smooth, quiet, dark midnight teal for overlaid text.

### 3 · drawer · mitten fingertip flick → `drawer/mitten-flick.jpg`

*Style: warm stylized 2D game illustration, crisp silhouettes, open dark upper half.*
*Aspect: 2:3 · 1.5 MP.*

> Stylized 2D digital illustration in tall portrait framing, concentrating all detail in the lower right third while the left half and upper two-thirds fade cleanly into calm deep midnight-teal darkness. In the lower right foreground, a cozy cream knitted mitten rests lightly on a smooth dark slate-blue frosted tabletop, open fingertips having just flicked a low flat-topped cylindrical porcelain game piece leftward. The flat circular top of the gliding piece is completely smooth and even, painted in six crisp alternating pearl-white and dark charcoal pie-slice wedges encircled by a thin bright sky-blue edge band. A delicate fan of tiny sparkling frost crystals trails its back edge, and a faint warm-gold curved trajectory line leads forward toward a soft coral-red and cobalt-blue glow flush with the distant floor. Crisp flat shapes, soft airbrush shading, gentle golden rim light.

---

## Improved board and backdrop art (accurate KeRot field geometry)

### 4 · board · overhead classic asymmetric field → `board/overhead-classic.jpg`

*Style: crisp top-down 2D tabletop board illustration, clean graphic geometry.*
*Aspect: 3:2 · 1.5 MP.*

> Crisp directly top-down 2D digital illustration of a horizontal rectangular dark slate-blue frosted game board framed by a thin pale-white perimeter line inside a narrow deep midnight-teal margin. Centered inside the left half of the rectangle, leaving wide open slate space across the right half, sits one large flat circular inlay set seamlessly flush with the floor and outlined by a thin white circle. The flat circular inlay is smoothly airbrushed in an asymmetric left-to-right gradient: two soft cobalt-blue crescents fill its upper-left and lower-left side, blending smoothly through a milky-white middle band into a single soft rounded warm coral-red patch positioned slightly right of the circle's center. Flush against the straight top border edge and straight bottom border edge near the far-left corners, clearly separate from the circle, sit two small pitch-black semicircles outlined in bright amethyst violet. Four small flat round game pieces with six-wedge pearl-white and charcoal pinwheel faces and thin crimson, amber, emerald, and sky-blue edge stripes sit across the coral-red patch and the open right half, with one faint pale-gold curved path leading leftward from the right side onto the coral-red zone.

### 5 · board · overhead six-petal field → `board/overhead-rim6.jpg`

*Style: sleek 2D digital game board illustration, deep navy and warm coral contrast.*
*Aspect: 16:9 · 1.5 MP.*

> Sleek elevated three-quarter 2D digital illustration showing the full horizontal rectangle of a dark midnight-navy frosted tabletop game board framed by a thin luminous pale-blue border inside a quiet dark room. Set completely flush and level into the left half of the rectangular surface, with broad open dark navy floor stretching to the right edge, sits a large flat circular inlay outlined by a thin white seam. The flat circular inlay is deep solid cobalt blue patterned with six evenly spaced bright coral-red half-circle scallops touching the inside of its white outer rim like six warm petals facing inward, each coral-red half-circle edged by a narrow soft milky-white halo around the plain cobalt-blue center. Flush against the near and far straight side rails toward the left corners sit two small pitch-black semicircles edged in glowing violet. Four small low flat-topped warm-ivory cylindrical game pieces with thin crimson, amber, emerald, and sky-blue edge bands rest across the board; one glides leftward from the right side along a faint warm-amber curved glow line toward a coral-red rim scallop, leaving calm dark navy air above the board.

### 6 · board · three-circle tabletop match → `board/tabletop-circles.jpg`

*Style: cozy stylized 2D illustration, warm lamp glow against midnight-teal winter dusk.*
*Aspect: 16:9 · 1.5 MP.*

> Cozy stylized 2D digital illustration seen from a high three-quarter viewpoint inside a quiet wood-and-glass winter evening lounge, deep midnight-teal dusk beyond the windows. In the center stands a wide waist-high rectangular frosted slate-blue game table framed by a slim pale-white wooden rail. Inlaid seamlessly flush into the left half of the smooth tabletop is a large flat circular cobalt-blue panel painted with three separate soft-edged coral-red circles of different sizes placed asymmetrically — one large circle toward the upper left, one medium toward the lower right, and one smaller toward the upper right — each bordered by a soft milky-white halo. Standing at the right end of the table, two smiling friends in cozy knitted sweaters lean over the open right side as one gently pushes a flat low cylindrical porcelain game piece forward with bare fingertips. Four flat smooth-topped circular pieces painted in six alternating pearl-silver and dark charcoal pie wedges with bright crimson, amber, emerald, and sky-blue edge stripes glide and rest on the coral-red circles under warm golden pendant light and cool teal shadows.

### 7 · board · calm match result backdrop → `board/result-backdrop.jpg`

*Style: minimal atmospheric 2D digital backdrop, wide quiet dark sky for UI overlay.*
*Aspect: 16:9 · 1.5 MP.*

> Minimal atmospheric 2D digital illustration designed as a calm widescreen night backdrop, with smooth uncluttered deep midnight-navy darkness filling the entire upper half and a quiet frosted dark slate-blue game surface spanning the lower half in gentle three-quarter perspective. Set completely flush and level into the lower left of the surface is a large smooth circular inlay bordered by a thin frost-white seam, its flat face softly airbrushed from rich cobalt blue on the far left through misty milky white into a warm glowing coral-red patch right of center. Resting peacefully on the coral-red patch are three low flat-topped cylindrical porcelain game pieces, each with a completely level smooth top divided into six alternating pearl-white and dark charcoal pie-slice wedges and rimmed with a crisp amber, crimson, or emerald stripe catching soft warm-gold edge light. Sparse tiny luminous frost motes float upward into the dark teal-navy stillness.

---

## Improved win-screen art (joyful victory, crisp character + game piece reads)

### 8 · win · pedestal victory wave → `win/victory-wave.jpg`

*Style: joyful 2D digital game illustration, clean character art, warm golden rim light.*
*Aspect: 16:9 · 1.5 MP.*

> Joyful stylized 2D digital illustration set on a quiet polished dark slate-blue frosted terrace under a deep midnight-teal night sky. In the lower right third, a cheerful young girl with rosy cheeks dressed in a fluffy cream-white winter coat with soft fur trim, a knitted pom-pom beanie, and bright red mittens sits happily perched on the edge of a giant low flat-topped cylindrical porcelain pedestal, raising one mittened hand in a bright celebratory wave. The wide circular pedestal beneath her has vertical sides ringed by a glowing crimson band and a completely flat, smooth top painted in six alternating pearl-white and dark charcoal pie-slice wedges. Across the floor to the left, set seamlessly flush with the dark slate surface, stretches a large flat circular inlay glowing softly with two cobalt-blue crescents blending through milky white into a warm coral-red patch, where three smaller flat six-wedge cylinders with amber, emerald, and sky-blue rims rest calmly. Tiny sparkling frost crystals drift through the air, warm pale-gold rim light outlines the girl, and generous quiet midnight-teal space stays open across the upper left.

### 9 · win · hugging the amber piece → `win/piece-portrait.jpg`

*Style: cozy stylized 2D character portrait, soft glowing bokeh, crisp flat shading.*
*Aspect: 3:4 · 1.5 MP.*

> Cozy stylized 2D digital portrait illustration of a cheerful young girl with rosy cheeks and eyes closed in a happy smile, wearing a fluffy cream-white winter coat with plush fur trim, a white knitted pom-pom hat, and soft dark-teal mittens. With both mittened hands she hugs a chunky flat cylindrical porcelain game piece lovingly against her chest, tilting its smooth flat circular face toward the viewer. The piece is a clean low cylinder with a completely flat, even, unornamented front surface painted in six sharp equal pie-slice wedges alternating pearl-white and dark slate charcoal meeting at a neat center point, framed around its outer rim by a solid glowing warm-amber band. Cool gentle light falls from the upper left while warm pale-gold rim light highlights her hat, mittens, and the amber rim. Behind her, a softly blurred deep midnight-teal night background glows with gentle out-of-focus coral-red, milky-white, and cobalt-blue bokeh circles and tiny floating frost sparkles, with calm dark headroom above.

### 10 · win · gliding over six-petal inlay → `win/petal-glide.jpg`

*Style: energetic 2D digital game illustration, crisp motion spray, warm spotlight.*
*Aspect: 16:9 · 1.5 MP.*

> Energetic stylized 2D digital illustration of a laughing young girl in a fluttering fluffy white winter coat, knitted scarf, pom-pom hat, and mittens standing balanced with both arms spread wide atop a wide, low flat-topped cylindrical game piece as it glides smoothly from right to left across a dark slate-blue frosted pavilion floor at night. The flat circular top under her winter boots is painted in six alternating pearl-white and dark charcoal pie-slice wedges, and its bright emerald-green outer rim kicks up a graceful sparkling fan of tiny frost crystals behind her. Beneath and ahead of her, inlaid completely flush and level with the dark floor, lies a large flat circular cobalt-blue panel patterned with six evenly spaced glowing coral-red half-circle scallops along the inside of its thin white edge, each softened by a milky-white halo, with two smaller flat crimson- and amber-rimmed pieces resting on nearby coral scallops. A warm pale-gold spotlight pools over her against deep calm midnight-teal corners and open dark space across the upper right.

---

## Original drafts (converted to generator format for reference / A-B testing)

Uncheck `legacy` entries in the gallery or pass `--situation drawer`, `board`, or `win` on
the CLI to render only the improved set above. Kept so the original A1–B3 drafts remain
runnable side-by-side (`A2.1`'s cut-off final line is completed and `B2` uses `3:4` so
`ResolutionSelector` accepts it).

### 11 · legacy · A1 the push → `legacy/a1-push.jpg`

*Style: clean 2D game illustration, flat shapes, soft airbrush shading.*
*Aspect: 2:3 · 1.5 MP.*

> Close-up of a single thick stone puck resting on scratched arctic ice, seen from a low
> three-quarter angle in the lower right of the frame: a chunky rounded disc of granite
> gray, pale and heavy, its flat face catching a warm gold rim light. Far behind it,
> softly out of focus, a kid in a puffy winter jacket and knitted hat leans into an
> energetic push, gloved hand thrust forward, one knee skimming low over the ice. A faint
> gold aim-line glow trails from the puck. Everything left of center dissolves into deep
> teal darkness. Cool rink key light from the upper left, dark teal vignette, scattered
> frost grain on the ice. Clean 2D game illustration, flat shapes with soft airbrush
> shading, subtle ice texture, gentle bloom, no text, no photorealism.

### 12 · legacy · A2 the disk at night → `legacy/a2-disk-night.jpg`

*Style: clean 2D game illustration, flat shapes, soft airbrush shading.*
*Aspect: 16:9 · 1.5 MP.*

> Wide side view of a night ice arena: a large glowing disk hovering just above the
> polished floor, its surface a slow heat map of deep blue lobes bleeding into a hot
> pale-red core, a small dark tick mark on its rim quietly showing its spin. Two
> violet-rimmed void semicircles hug the disk's top and bottom edges. One stone puck
> slides across the foreground ice trailing a fine spray of ice crystals, its side ringed
> in seat red. At the far right a small figure pushes off from a glowing launch spot. Deep
> teal #0b1c26 atmosphere, gold #ffeaa7 accent light, void violet #9b59b6 outlines, dark
> vignette. Clean 2D game illustration, flat shapes, soft airbrush shading, subtle grain,
> gentle glow, no text.

### 13 · legacy · A2.1 the disk at night 2 → `legacy/a2-1-disk-night.jpg`

*Style: clean 2D game illustration, flat shapes, soft airbrush shading.*
*Aspect: 3:2 · 1.5 MP.*

> Wide side view of a night sheet: a large polished disk floating above the translucent ice,
> disk surface a rotating heat map of deep blue lobes bleeding into a hot pale-red core,
> a small dark tick mark on disk's rim showing spin. Two violet-rimmed void semicircles hug
> the disk's top and bottom edges. One figure slides across the foreground ice
> trailing a fine spray of ice crystals, its ring rimmed in seat red. At the far right, a
> small figure pushes off from the launch spot. Deep teal #0b1c26 atmosphere, gold
> #ffeaa7 accent light, void violet #9b59b6 outlines, dark vignette. Clean 2D game
> illustration, flat shapes, soft airbrush shading, subtle grain, gentle glow, no text.

### 14 · legacy · A3 overhead practice → `legacy/a3-overhead.jpg`

*Style: clean 2D game illustration, flat shapes, soft shading.*
*Aspect: 4:3 · 1.5 MP.*

> Three-quarter top-down view over a sheet of polished night ice: the big heat disk
> glowing blue-to-red off-center to the left, a teal dashed wedge zone painted on the
> ice, and four stone pucks scattered around it, each a chunky granite-gray disc with a
> colored rim (red, amber, green, blue) and a six-sector face showing its spin. A mitted
> hand hovers just above the ice near one puck as if guiding it without touching. Deep
> teal ice, gold light accents, calm empty space in the upper right. Clean 2D game
> illustration, flat shapes, soft shading, frost grain, gentle glow, no text.

### 15 · legacy · B1 champion on the puck → `legacy/b1-champion.jpg`

*Style: clean 2D game illustration, flat shapes, soft airbrush shading, joyful mood.*
*Aspect: 16:9 · 1.5 MP.*

> A cute girl with rosy cheeks sits proudly on top of a giant stone puck as if it
> were a throne in the middle of the ice, wearing a fluffy white winter dress with fur
> trim, a pom-pom hat and mittens, one hand raised waving. Behind her the big heat disk
> glows warm, its blue-to-red field bright, lit like a victory bonfire. Floating above in
> the dark teal air: a translucent score bar with glowing colored cells and one cell lit,
> the winner's. Ice-crystal confetti sparkles around her. Other stone pucks rest on the
> ice nearby, each ringed in a different seat color. Cool key light from the upper left,
> warm gold rim light on the girl and the winning puck, deep teal vignette. Clean 2D game
> illustration, flat shapes, soft airbrush shading, joyful mood, gentle bloom, no text.

### 16 · legacy · B2 best friends with the puck → `legacy/b2-portrait.jpg`

*Style: clean 2D game illustration, flat shapes, soft shading, shallow-depth feel.*
*Aspect: 3:4 · 1.5 MP.*

> Cozy close-up of the same cute girl hugging a chunky granite-gray stone puck against
> her cheek with both mittened hands, eyes closed in a happy squint, fluffy winter dress
> and fur-trimmed hat. The puck's six-sector face and colored rim are clearly visible,
> catching the warm gold light. Background: soft bokeh of rink lights over deep teal ice,
> the big heat disk a blurred blue-red glow far behind. Shallow-depth feel, cool key
> light, warm highlights, dark teal falloff. Clean 2D game illustration, flat shapes,
> soft shading, subtle frost, gentle glow, no text.

### 17 · legacy · B3 victory lap on the ice → `legacy/b3-victory-lap.jpg`

*Style: clean 2D game illustration, flat shapes, soft airbrush shading, dynamic pose.*
*Aspect: 16:9 · 1.5 MP.*

> The cute girl in a fluffy winter dress stands balanced on a sliding stone puck, riding
> it across the ice with arms spread wide, laughing, spray of ice crystals fanning out
> behind her. Around her the arena at night: the big heat disk glowing warm red at the
> center of the floor, parked stone pucks with colored rims, violet void semicircles at
> the disk edges, teal dashed zone lines on the ice. A warm spotlight pools on her from
> above against the deep teal dark. Clean 2D game illustration, flat shapes, soft
> airbrush shading, dynamic pose, subtle grain, gentle bloom, no text.
