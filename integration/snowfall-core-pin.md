# Snowfall compatibility pin

KeRot's optional Snowfall adapter was checked against:

- Repository: <https://github.com/luncat8/snowfall-core>
- Commit: `f93af67e41d31855f9c7c317e052a09af67542ef` (`Paged mode`, 2026-09-29)
- `Snowfall.version`: `0.7.0`
- `SnowfallGames.version`: `0.6.0`
- Contract exercised: register via `SnowfallGames.add`, mount via `play`, resolve a skipped slot through `Snowfall.ask`, and persist the scalar fallback.

This is a compatibility target, not a submodule or a vendored runtime. The optional gate uses the core's own fake-DOM helper when a separate checkout is supplied:

```sh
SNOWFALL_CORE_DIR=../snowfall-core node experiments/snowfall-compat.js
```

When Snowfall changes its minigame contract, update this pin, review the new contract, and run both repositories' gates before changing the adapter.
