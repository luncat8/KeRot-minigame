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
