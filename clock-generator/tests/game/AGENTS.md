# Game verification

Read `README.md` and the affected mechanic/fixture README before changing an experiment.

- Keep general sample builds in `resources/config-samples/`; keep isolated mechanic assets here.
- Preserve measured assertions when moving files or extracting helpers. Do not update expected timing just to make a test pass.
- Use `helpers/lua/` for shared observation and bounded capture. Scenario Lua must make filters, inventory clearing, and other interventions visible. Use `composeProbeSource` for host-side loading and JSON parameters; a scenario file is not directly runnable via `--lua`.
- Only one probe owns `script.on_nth_tick(1, ...)` per run. Never replace the recorder's `on_tick` handler. Compare samples relative to probe installation, which precedes settling/final recording.
- CI checks code and simulator regressions; fresh game evidence requires a local compatible Factorio and staging save. `.env.example` documents the two settings. Do not count skipped cases as passes.
- Select affected files and, when useful, `-t` cases. Moving a file alone does not justify running all clock-recovery or scaffold tests. Shared capture changes need representative coverage of each consuming scenario; changes to mechanic assertions may require their full parameter matrix.
- Use `npm run probe -- ...` for retained raw captures. Choose a new output directory. Its generated Lua, config, blueprint, recording and detailed report should stay under ignored `work/`.
- Existing game tests delete their own scratch directories even after assertion failure. For inspectable artifacts, reproduce with the manual capture command; do not claim the test retained them.
- When adding a fixture: document its question, entity/config mapping, interventions, measured scope and exact commands. Reuse helpers. Add the smallest relevant simulator regression and game comparison; keep ordinary throughput/recovery checks under `builds/`.
