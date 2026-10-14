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
