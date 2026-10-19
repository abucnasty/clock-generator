# Belt pickup experiments

Start with the [consolidated findings and coverage matrix](../../../../docs/belt-pickup/experiments.md).
Use the [diagram glossary](../../../../docs/belt-pickup/glossary.md) to identify layouts and test conditions,
and the [timing reference](../../../../docs/belt-pickup/timing.md) to compare grab ticks and total collection time.
It distinguishes native measurements, simulator agreement and remaining gaps. Detailed fixture reports below
retain the setup, corrections, screenshots and reproduction commands. **Publishing remains on hold.**
**Splitters are out of scope.**

## Choose an experiment

| Question | Fixture findings | Automated checks |
| --- | --- | --- |
| Side pickups: reach, refill, ingredient eligibility and repeated hands | [Different items and four-speed controls](fixtures/different-items/README.md) | `belt-speed-coverage.game.test.ts`, `ordinary-reflection.game.test.ts`, `ordinary-phase.game.test.ts`, `ingredient-demand.game.test.ts` |
| Same-item lane fallback, hand sizes and circuit windows | [Same-item fixtures](fixtures/same-item/README.md) | `same-item-pickup-fixture.game.test.ts` |
| Downstream/open-end underground exit, mirroring and ingredient swaps | [Front exit](fixtures/front-underground-exit/README.md) | `front-underground-exit.game.test.ts` |
| Over-the-hood underground exit, mirroring and moving/backed-up supply | [Over-the-hood exit](fixtures/over-the-hood-underground-exit/README.md) | `over-the-hood-underground-exit.game.test.ts` |
| Front-facing underground entrance, moving/backed-up and observed arrival phases | [Front entrance](fixtures/front-underground-entrance/README.md) | `front-underground-entrance.game.test.ts`, `front-underground-entrance-fallback.game.test.ts` |
| Side entry, finite merge stock, cutoff boundaries and starvation | [Side-loaded straight tile](fixtures/side-loaded-straight/README.md) | `side-loaded-straight.game.test.ts`, `side-loaded-entry.game.test.ts`, `two-stream-merge-replay.test.ts` |
| Capture support and stale/unsupported metadata | [Capture boundary](../../../../docs/belt-pickup/capture.md) | `pickup-capture.game.test.ts` |
| Belt-drop stack sizes and finite output stock | [All-speed drop controls](../belt-drop/fixtures/turbo-stacks/README.md) | `../belt-drop/turbo-stacks.game.test.ts` |
| Generated-clock throughput and recovery | [Build checks](../../builds/README.md) | `../../builds/moving-pickup.game.test.ts`, `../../builds/same-item-pickup-clock.game.test.ts` |

All four belt speeds now have side-pickup, front-entrance, backed-up front-exit, over-the-hood exit, side-entry
and drop measurements. Passing a capture regression can preserve a **known simulator counterexample**.
Fast/normal backed-up supplies expose finite refill; normal moving side-entrance fallback can expose arm travel.
A test-only jammed-queue replay fits the backed-up side-pickup evidence without changing the production model.

The downstream front-exit fixture blocks belt continuation at the inserter's tile. Over-the-hood exit pickups
have their own fixture: the inserter sits upstream and leaves the downstream route open. Normal moving front-entrance controls use a
paired compact assembler because the original plant's tunnel exceeds normal underground range. Only the bounded
turbo two-stream merge is implemented. Slower native captures do not enable configuration support.
The over-the-hood matrix has 84 baseline first hands and 174 delayed moving controls, covering both mirrors,
moving/backed-up supply, original/swapped/same-item lanes and all observed aligned arrival phases. Compact controls
cover all four speeds, with original-plant counterparts at the three speeds that can pair its longer tunnel.
Independent lane alignment and repeated hands remain unverified. Sidecar still warns unsupported/inline.

## Run a targeted check

From `clock-generator/`, with the [game setup](../../README.md#setup) configured:

```bash
# One naturally supplied case; retain raw evidence in a new directory.
BELT_SPEED_CAPTURE_DIR=../work/belt-speed-coverage/new-run \
  npm run test:game -- tests/game/mechanics/belt-pickup/belt-speed-coverage.game.test.ts \
  -t '^express-straight-belt-moving-accumulator$'

# Check already-retained ordinary reports without launching Factorio.
BELT_SPEED_REPLAY_DIR=../work/belt-speed-coverage/ordinary-gated-05 \
  npm run test:game -- tests/game/mechanics/belt-pickup/belt-speed-coverage.game.test.ts

# Portable native clips, simulator unit regression and generation regression.
npm test -- tests/game/mechanics/belt-pickup/jammed-pickup-replay.test.ts
npm test -- src/control-logic/inserter/modes/pickup/belt-lane-fallback.test.ts
npm run test:generation -- src/crafting/moving-belt-pickup.generation.test.ts
```

Other families have their own retained-replay variables and filters documented beside the fixture. Do not launch
the whole game suite to check a documentation or import-only change. Native captures use at most two isolated
Factorio instances concurrently; each process needs its own working/output directory. Full recordings stay in
ignored `work/`; compact reviewed expectations belong with the fixture. A capture directory must be fresh.

## Probe and evidence conventions

[`helpers/lua/capture.lua`](../../helpers/lua/capture.lua) owns bounded sampling, output and cleanup;
[`helpers/lua/belt-pickup.lua`](../../helpers/lua/belt-pickup.lua) observes hands and exposed stack positions/IDs.
Scenario probes retain entity selection, filtering, circuit changes and destination clearing. Use the shared
composer or `npm run probe -- ...`; a standalone scenario source is not directly runnable with `--lua`.

Observation precedes inventory clearing. Inventory-clearing probes isolate collection; operating-machine runs
measure crafting. Seeded boundary controls isolate routing decisions; they do not prove natural supply or
throughput. A position replay aligned to observed first grabs does not independently calibrate arm arrival.
Hand-count agreement alone does not prove routing: the express merge counterexample has matching counts and
different stack movements. Native screenshots illustrate layouts and are not timing evidence.
