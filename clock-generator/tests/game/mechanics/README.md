# Mechanics experiments

These local game checks isolate a rule or a recording behavior. See the [game guide](../README.md) for setup,
targeted commands and screenshot regeneration. Screenshots are layout references, rather than timing evidence.

- [Belt pickup](belt-pickup/README.md): exposed reach, moving lane fallback, backed-up supply and front exit mirroring.
- [Belt lanes](belt-lanes/README.md): physical lanes in recordings and opposite-lane ingredient layouts.
- [Source pickup](source-search/README.md): destination refusal, source inventory shapes and real pickup quantities.
- [Circuit evaluation](circuit-evaluation/README.md): fixed/changing condition checks and a carried full hand.
- [Busy inputs](busy-input/README.md): bounded target-full and pickup-check observations with explicit observation exclusions.
- [Activation order](activation-order/README.md): bounded observed alarms, wakes, sleeps and updates in an offline scheduler replay.
- [Source order](source-order/README.md): compact native shared-source allocations replayed without Factorio.
- [Staged start](staged-start/README.md): saturated belts and fresh inserters of the build put down in a controlled order.
- [Clock wiring](clock-wiring/README.md): replacing inserter conditions inherited from a real build.
- [Containers](containers/README.md): cars, wagons and rocket silos as chests, against the simulator inserter by inserter.
- [Drills](drills/README.md): mining drills at a low research level, their progress bars against the simulator tick by tick.
- [Burner fuel](fuel/README.md): furnaces, a burner drill and a captive biter spawner against a biochamber, tick by tick: the energy buffer, the top-up, stops and restarts, running out of fuel, an inserter filling the slot.
- [Insertion limit](insertion-limit/README.md): inserters dropping into assembling machines and furnaces near the automated insertion limit: where they stop, how much goes in, against the simulator's rule.
- [Drill status](drill-status/README.md): the status the game shows for mining drills that are switched off, blocked by a full chest or at a machine's stop, against the simulator's tick by tick.
- [Belt drop lane](belt-drop-lane/README.md): the lane an inserter drops on, from each side and each end of a belt running in each direction, against the simulator's two lane choices.
- [Control latency](control-latency/README.md): a decider switching inserters waiting at a chest, in sleep at a machine, over a belt, in pairs and while moving; inserters woken by a take or a craft.
- [Drop spacing](drop-spacing/README.md): the hands of several copies on one belt lane, why a pitch and an offset make them fit or collide.

The [screenshot catalog](screenshots.json) references 18 mechanics fixture blueprints. Pictures are of the
mechanics fixtures only; a topic that uses a sample links to the sample's scaffold. Their [generated provenance](screenshots.generated.json) records source hashes, Factorio version,
framing and compressed image sizes. Run `npm run screenshots -- --all` from `clock-generator/` to backfill missing
or stale images, or `--case=<id>` to capture one.
