# Findings / pitfalls

- Disk friction must oppose `v − v_surf` (velocity relative to the moving surface),
  never `v` alone — otherwise pucks on the disk lose energy instead of being flung.
  No centrifugal/Coriolis terms anywhere; ejection emerges from tangent straight-line motion.
- Advance LOCKED pucks by exact rotation about the disk centre. A tangent step
  (`p += v_surf*h`) grows the radius by ~(v·h)²/2d per step and slowly ejects held pucks.
- `v_surf = ω·(−dy, dx)` is defined over the whole plane. Any test using it (sleep, lock)
  must be gated on contact area `a`; ungated, floor pucks never sleep (hit in 0.1.0).
- Positional separation (spawn, pair overlap) must clamp inside the walls afterwards,
  or it shoves pucks through walls. Caught by fuzzing at 50 m/s with overlapping starts.
- A puck dropped at lab rest on a spinning disk is NOT captured out to `d_hold`:
  it spirals outward during spin-up (capture ≈0.5R at defaults). `d_hold` is the
  holding radius for a puck already co-rotating. Test both series separately.
- Kinetic friction as a capped velocity decrement reaches exactly 0 in finite time,
  but a state will still never sleep without an ε_sleep snap + state flag.
- In experiments, measure collision invariants immediately after the event:
  friction en route and later wall bounces contaminate "expected" values
  (wall-bounce check must use e·v_impact with v_impact from the friction-loss formula).
- Node duality for classic scripts: browser shares top-level `const` globals across
  `<script>` tags, Node does not. Node-safe files start with
  `if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'), ...)`.
- Designing two rule variants (e.g. "behind midline" vs "painted zones"): measure
  where things actually end up (death-map histogram) before choosing shapes — the
  first zone design provably collapsed into the half-plane rule and would have made
  the radio group meaningless. Raw area math also lied: zones clipped by walls/on-disk
  guards need Monte-Carlo area checks, not hand integration.
- eval() of a browser IIFE in node does not leak its `const` binding; smoke-testing
  `js/game.js` headless needs `src.replace('const Game =', 'globalThis.Game =')`
  plus a `window` stub. Cheap way to test the real state machine without a DOM.
- Canvas `Path2D.arc` angles in y-down coords: clockwise on screen = *increasing*
  angle. The left half from top to bottom is `arc(cx, cy, r, -π/2, π/2, true)`
  (anticlockwise=true), not the default direction — easy to draw the right half
  by accident.
- Seedable xorshift32 closures (allocated per game, not per throw) make bot
  competitions reproducible; give every bot the same per-game seed stream and the
  comparison is stable across runs (identical JSON).
- Two-surface drag can *sandwich* a puck: on the rim the disk patch pulls at μk·g·a while
  the floor patch pulls back at μk·g·(1−a), so for `a <= 1−a` the puck is held at exactly
  v = 0 — a static equilibrium, not a bug. A sleep gate that only accepts the surface-matched
  relative velocity (`rv <= epsSleep`) therefore leaves it `SLIDE` forever: every later
  resolve runs into `maxResolve` and the round crawls. A **budget** comparison (which
  surface can hold whom) is the right test — but note the correction in the 0.1.5 round:
  the area-share form of it, `a <= 1 - a`, freezes a straddler on the spot the frame it
  is touched, because it is applied at any speed and at rest alike. Compare the drive
  and the floor's capacity *as forces and moments* (`holdable()`, `js/physics.js`) and
  apply it only to a puck that has already stopped.
- Don't put a spin gate in a capture/lock condition. A linearly co-rotating puck drifts
  out of the hold radius within ~0.1 s (kinetic friction cannot supply ω²d), while the
  spin ramp needs ω_d/((4/3)μk g/r) ≈ 0.2–1 s: the gate delays capture past the very
  drift that locking exists to stop and the whole lock band collapses (measured). Snap
  the spin when locking, exactly like the velocity snap that was already there.
- Friction "at the contact patch" is *exactly* the field at the patch centroid: the disk's
  surface velocity is linear in position, so its mean over a patch equals its value at the
  patch centroid (true for any region and any linear field). The lens centroid is the
  area-weighted combination of the two circular caps beyond the common chord
  (`h = (2/3)(R²−a²)^{3/2}/A` from the centre, same formula for both circles). Validate
  such an identity against a dense grid quadrature of a linear test field — that catches
  sign/index mistakes that area-only checks miss.
- The cap area `R²·acos(a/R) − a√(R²−a²)` loses ~3 digits to cancellation for thin caps
  (a → R), but the loss is only ~1e-13 relative in doubles; the *centroid* stays bounded
  because it is a convex combination of two cap centroids. Guard the `0/0` (empty cap)
  case instead of adapting the formula.
- Node smoke tests for the browser layers: load the classic scripts with
  `src.replace(/\bconst (Render|Game) =/, 'globalThis.$1 =')`, strip the
  `if (typeof module !== 'undefined')` guard line (its `require('./cfg.js')` would resolve
  against the *experiment's* directory), and also alias any plain `function` the browser
  relies on as a cross-script global (`function bakeFieldCanvas` — `render.js` calls it but
  it is not in `field.js`'s exports). A stub 2D context that records op names is enough to
  assert "the frame loop draws the fan with an evenodd hole" without a browser.
- Off-disk spin decay is **not** independent of the linear slip once the contact is
  integrated. A quickly sliding puck sees an almost uniform slip under itself, so the
  torque integrals cancel and it barely turns; a slowly sliding one is close to the pure
  spin (`|ω̇| = (4/3)μk g/r`). The saturated-couple model this replaced had them equal,
  which is a nice-looking invariant that was also wrong: check such invariants against
  an independent quadrature before enshrining them.
- Don't decompose a partially-covered contact into "a patch per surface, each sampled
  once" and reconcile them by hand. The disk's surface velocity is *not* constant over a
  puck, so a single sample cannot see that the drag cancels; adding a lever plus an
  independently saturated couple to recover the moment makes the pair cross-couple
  through ρ and pump energy (measured: a puck on the turning disk winding up to
  |ω| ≈ 9 ω_disk and walking along the rim for 11.75 m). Integrate the contact over a
  fixed pattern of cells instead — dissipative by construction, and the moment appears
  without being added. A 4×16 pattern with equal weights and radii `√((k+½)/n)`
  rescaled so `Σw|ρ| = (2/3)r³` matches a 40×160 quadrature to 0.0 % in force and ~2 %
  in torque at 9.4 µs/step.
- Fixed quadratures are worth calibrating against the closed forms they must reproduce:
  `Σw = 1` makes a translating puck feel exactly μk·g, `Σw|ρ| = (2/3)r³` makes a pure
  spin decay at exactly `spinDrag·μk·g/r`. Without the Σ|ρ| rescale the spin rate was
  off by 9 % *and* the "still disk = bare ice" symmetry broke at the 1e-12 level.
- A hand-written gate can encode the model's own construction rather than the physics
  (0.1.4's spin gate asserted "the spin ramp on the disk equals spinDrag·μk·g/r", which
  is only true when the drag is applied at the puck centre). When a gate and a fix come
  from the same reasoning, get a second, independent opinion on the *result*: here a
  160²-cell all-kinetic quadrature of the same law, which settled a case the model had
  been arguing about for two rounds.
- `spawnPuck()` leaves the puck asleep: a test that only spawns it measures a statue.
  Call `throwPuck(w, i, 0, 0)` (or set `st[i] = ST_SLIDE`) to wake it — including in
  the browser, where the exception surfaced as 0 s settle times.
- If simulation can swap-remove entities mid-run, an array index is not an identity:
  copy a stable uid with the entity and resolve the tracked index after a removal. A
  predictor that follows only its original index silently starts tracing the swapped-in
  puck. When a roster is spliced, remove the departing owner's entities first, then
  reindex every surviving `own[]` entry and owner-indexed counter; test that a survivor
  still scores afterward.
- Under load-independent Coulomb friction a lone puck's **mass cancels** — from the
  deceleration (μ·m·g/m) and from the hold limit (ω²d ≤ μs·g) — and a slider that sets
  every mass equal cancels it from collisions too. kerot-s shipped exactly that no-op. A
  mass control needs a physical door: ice friction falls with load (Hertzian contact
  area A ∝ N^(2/3), constant shear strength → μ ∝ m^(−1/3)). Gate it as an equivalence
  (mass m on μ ≡ the reference mass on μ·loadFactor(m), to 1e-16) plus the effects
  (stop ∝ m^(1/3), hold radius ∝ m^(−1/3)), and pick the reference so the default is
  bit-identical. Take the shared factor once per step: a `cbrt` per puck cost 15 %.
- Real frames without a browser: `experiments/render-frames.js` renders the actual
  `js/render.js` through `@napi-rs/canvas` (`cd experiments/tools && npm install` once;
  `node_modules` is git-ignored), one PNG per colour scheme × disk schema, which
  `read_file` shows. A pixel diff against a frame from a worktree of the previous commit
  proves claims like "only the floor changed" (count the differing pixels per region).
- Evaluate browser files in **strict mode** in the node smoke test (`eval('"use strict";'
  + src)`): an assignment to an undeclared name — a silent `window` global in a classic
  script — throws on the spot. It found `bakeZone`'s leaked `l1, l2, a0, a1`. And make
  the guard-stripping regex global (`/gm`): with `/m` alone only the first
  `if (typeof module …)` line goes, and a file's bottom `module.exports = …` then runs
  inside the eval and overwrites the *harness's* exports.
- `node -e "const CFG = …; require('./js/field.js')"` → "CFG is not defined" inside the
  module: the script's top-level `const CFG` shadows the `globalThis.CFG` the classic-
  script modules publish. A test artifact, not a bug — use other names in one-liners.
- Checking an estimator over a puck that hangs over the rim: a cell-count reference
  quantises a *sliver's* area and becomes the larger error (constant "1.00 %" whatever
  the estimator did). Use exact lens area × fine-grid mean, and judge slivers in
  absolute terms (shares of one full puck), not relative ones.
- Integrating over a circle-circle lens: rays from the puck centre clipped to the disk
  are smooth in angle *except* where the two circles cross, and a fixed fan converges
  slowly through those kinks (32 rays 2.4 %, 128 rays 0.4 %). Split the angle at the two
  crossings (`acos((R² − d² − r²)/(2rd))` around the outward direction) and use Gauss in
  angle per arc and along each ray (≥ 4 radial points for piecewise-linear paint).
- A finer lookup table is not automatically better: with a sparse sample pattern on top,
  a coarse bilinear grid low-passes sharp paint edges for it. On the ring schemas the
  whole-puck error *grew* from 96 → 160 → 192 cells; measure, then pick (128).
- Shell: `while pgrep -f "script args"; do sleep 1; done` matches its own command line
  and never ends. Wait on PIDs (`cmd & pid=$!; wait $pid`) instead.
- `cd dir && (a) & (b)` runs `b` in the *old* directory: the `&` takes the whole
  `cd && (a)` list into the background.
- The rate at handoff is not an annuity. A puck crossing a red lobe at t = 4 s can
  read the maximum and still be flung a moment later; only a locked (or already
  asleep) puck keeps paying. Pricing the instantaneous rate made every profile
  prefer the fly-by, which is why the rim schema and the 3-seat league both looked
  like a sampling problem when they were a value-function problem. Follow the
  *thrown* puck for a short tail if you want late captures — following every slider
  on a crowded board bills each candidate for pucks that throw did not touch.
- The rim lock band from the launch lane is a few centimetres per second wide
  (~1.07–1.13 m/s) and about 4° wide, on the co-rotating tangent. A ±0.12 m/s
  jitter misses it every time. The floor-friction solve for that tangent
  (`v² = v_surf² + 2 μ g · chord`) is ~10 % fast, because the disk drags less than
  the floor once the puck is on it; sample ~0.86–0.94 of that solve. Which hold
  radius lands on red depends on phase; one radius is blue for a sixth of the
  period. Physics itself does not care about phase — the disk is rotationally
  symmetric — so a lock-band scan at θ = 0 is a lock-band scan at every θ.
- Do not rewrite a boot URL down to `?preset=name`. The individual keys after the
  preset are overrides; collapsing them makes a refresh drop what the link said.
  Fold names (`Preset=Stones`, `seats=Human, Hunter`) or a hand-typed link misses.
- Profile weights summed over every enemy are right for targeted effects (one
  enemy's puck knocked off) and wrong for a symmetric room effect across a round.
  Every thrower gets the same room from disk speed. Summing denial over N − 1
  enemies made hunters and black holes vote the disk up every round: ω 1.45 rad/s,
  48 throws, 35 votes in one 4-seat game. For the round-wide room comparison, weigh
  denial against the mean enemy (denial / (N − 1)) so only the profile's lean remains.
  A `turn` vote is different: only the next throw is exposed, so its targeted denial
  incentive can still produce a majority speed-up. Keep that rule optional unless
  that adversarial effect is wanted.
- When a vote closes after a timed window, evaluate the next ramp from the motor speed
  expected at closure, not the speed at vote-open or the previous target. If an old
  ramp can overlap the window, project its end-of-window speed before pricing rider
  retention.
- A candidate grid centered on the current setting can miss both ends of an exact
  range. Include the current setting and closed-range endpoints, sort them, and
  compute an exact-vote plateau midpoint from actual speeds. Keep delta-vote requests
  on their 0.01 rad/s grid so displayed values match what gets tallied.
- A value landscape over a candidate grid with i.i.d. per-candidate noise fragments
  every plateau into random spikes. Find the plateau on noiseless values; put the
  noise (and a tiny cost of change, as the tie-break) on the pick only.
- "Best red reachable" is flat on the classic disk (the centre is red at any speed),
  so a bot model built on it sees speeding up as free. What a faster disk takes from
  a thrower is room: the red averaged over the area it can still hold.
- Before using committed results as a baseline, re-run them at HEAD. A detached
  `git worktree add /tmp/base HEAD --detach` runs the old code beside the new one for
  byte-for-byte output diffs. It registers in `.git/worktrees`, so remove it at the
  end (`git worktree remove --force`). `node -r preload.js experiment.js` flips a
  CFG default for one run without editing the experiment (CFG is one shared module
  object).
- Test through the entry points the UI uses, not by writing CFG. Once Game kept a
  "configured speed" to restore on reset, a test that wrote `CFG.omega` directly
  was silently undone by the next reset.
- The board settles, and only then are pucks resting in the return fan handed back
  to stock. So "every seat has 0 balls at SCORED" holds only by chance. Snapshot
  end-of-game invariants at the SETTLE transition.
- "Undo the turn" is cheap when the throw goes into a *copy*: snapshot the live state, play
  the candidate in the copy, reload the snapshot for the next one, and hand the winner to
  the real game. Mutating the live game and repairing it afterwards needs every side effect
  reversible (recycle counts, spin ramps, seat rng) and breaks the moment one is forgotten.
  Measured: 14 ms per one-turn rollout of a 6-seat board, ~190 ms per `chooseStroke` — the
  reload costs nothing next to either.
- A headless copy has to be built by the same factory the page runs, with the differences
  behind one flag (`createGame({world, roster, cfg, sim})`). Watch the per-state guards:
  `tick` returned early on `!aim.hasStroke`, which only a *human* aim ever sets, so every
  rollout after the first turn of a copy ran to the step fuse (214 ms/try instead of 14).
  A flag like `sim` belongs in those guards (`!sim && !aim.hasStroke`), not in a pre-seeded
  fake value.
- Anything a rollout can leave dirty must be reset *per try*, not per plan: a copy's seats
  keep their speed votes until the tally closes, so candidates 2..6 started from a game in
  which somebody had already voted — the same line measured 0.3 of a ball differently inside
  one search. Gate the class, not the instance: "a line costs the same measured on its own
  or taken out of the search" caught it; a parity test of one turn did not.
- Two `createGame({})` instances in one process share the module `CFG`, and `closeVote`
  writes `cfg.omega` on it — so sibling test games steer each other's disk speed and a parity
  check fails on nothing real. Harness games need `createGame({cfg: Object.assign({}, CFG)})`.
- `js/bots.js` answers with one shared scratch record (`botOut`), valid until the next call.
  A caller that keeps "the greedy line" to compare later must copy it, or it keeps whatever
  the *last* decision was — this turned a search that changed nothing into a reported
  +0.30-ball improvement.
- The lock band does not depend on the disk's phase (the disk is rotationally symmetric) and
  the paint does, so a policy that cannot simulate should choose among the (radius, speed)
  pairs measured to lock at every phase and pick the one whose *arrival* lands on red:
  price a spot with `w.theta += ω·flightTime` for the read (5 pairs, 12/12 phases on all
  three schemas; the old single pair was 0/18 on rim6). A puck locked on a blue gap stays on
  it — it co-rotates — so a phase miss is a whole-game loss, not a delay to wait out.
- Before writing a rollout's opponents as searchers, cost them: 4 s of physics on a sparse
  board is 0.5 ms, one `chooseStroke` is 190 ms, so a search per rollout seat costs more than
  all the physics in the rollout. Give copies a policy (0.03 ms) and keep the search on the
  seat that is actually deciding.
- A search spread over frames must read a result at the end of a unit of work, never when the
  time budget expires — otherwise where the frame is cut changes the answer. Then "cut at
  0.4 ms slices gives the same pick as one call" is a gate that costs nothing to write.
- An "is this good enough to stop searching" bar should be the gain over the state the search
  started from, with the *same* annuity horizon for every candidate (freeze `future` at the
  snapshot). Against the greedy value it is satisfied by definition; against the absolute lead
  a bot that is winning never searches and a bot that is losing searches forever.
- Keep a file's node require-header on one line: harnesses that eval the source strip
  `^if (typeof module …)$`, and with `/m` (not `/gm`) only the first line goes — the rest of
  a wrapped header is left as a syntax error in the evalled file.
- A precision mode on an angle must scale deltas from an anchor, never the absolute
  angle (180° at 1/32 gain is 6° of nonsense). Anchor the first event at its own
  direction, rebase both axes on every shift flip, and plain-vs-precise stays
  continuous in both directions — at the price of path dependence (returning the
  pointer does not return the aim after a fine segment).
- Measure a search in wins with an asymmetric harness: only one profile searches per
  variant, toggled per turn by direct `cfg` assignment (`setWarp` cancels a running
  plan), same per-game rng in every variant, and a game count divisible by the seat
  count so the rotation is even. A good-enough bar over the snapshot stops the search
  on the greedy line whenever greedy looks good — log how often it takes another
  line, or a whole variant can be byte-identical games that prove nothing.
