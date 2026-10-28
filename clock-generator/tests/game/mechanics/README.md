# Mechanics experiments

These local game checks isolate a rule or a recording behavior. See the [game guide](../README.md) for setup,
targeted commands and screenshot regeneration. Screenshots are layout references, rather than timing evidence.

- [Belt pickup](belt-pickup/README.md): exposed reach, moving lane fallback, backed-up supply and front exit mirroring.
- [Belt lanes](belt-lanes/README.md): physical lanes in recordings and opposite-lane ingredient layouts.
- [Staged start](staged-start/README.md): saturated belts and fresh cell inserters built in a controlled order.
- [Clock wiring](clock-wiring/README.md): replacing inserter conditions inherited from a real build.
- [Containers](containers/README.md): cars, wagons and rocket silos as chests, against the simulator inserter by inserter.
- [Drills](drills/README.md): mining drills at a low research level, their progress bars against the simulator tick by tick.
- [Drill status](drill-status/README.md): the status the game shows for mining drills that are switched off, blocked by a full chest or at a machine's stop, against the simulator's tick by tick.
- [Drop spacing](drop-spacing/README.md): the hands of several copies on one belt lane, why a pitch and an offset make them fit or collide.

The [screenshot catalog](screenshots.json) references 14 local fixture blueprints and 3 shared sample
blueprints. Their [generated provenance](screenshots.generated.json) records source hashes, Factorio version,
framing and compressed image sizes. Run `npm run screenshots -- --all` from `clock-generator/` to backfill missing
or stale images, or `--case=<id>` to capture one.
