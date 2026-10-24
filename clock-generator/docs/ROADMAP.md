# Roadmap

The clock generator is working towards clocking the cells that real Space Age bases are made of: foundries, electromagnetic plants, recyclers, quality drills, and cars and cargo wagons used as chests. Each milestone below adds one family of such cells. The live board is the GitHub project "Real Boy": https://github.com/users/abucnasty/projects/2.

The plans of the coming releases, one theme each, with their packages and what is left, are in [roadmap/](roadmap/): [0.22.0](roadmap/0.22.0.md), real cells hold; [0.23.0](roadmap/0.23.0.md), fewer, simpler, clearer clocks; and [0.24.0](roadmap/0.24.0.md), lanes, recovery and wake-ups against the game. Work with no release of its own ships when it is ready and is listed in [roadmap/later.md](roadmap/later.md). Each plan is dropped when its release ships.

When the generator refuses a config because it does not model something yet, the message names the milestone or follow-up where that gap is planned, such as "roadmap milestone M2 (containers)" or "follow-up F1". You can look each name up here.

## Milestones

| Id | Name | What it delivers | Status |
|---|---|---|---|
| M0 | Ship what is built | Release 0.13.0: clocks are ranked by wake-ups counted at the start of a craft, which is when an inserter waiting to fill a machine is woken, not at a productivity payout. | Released as 0.13.0 |
| M0.5 | Foundations | Release 0.14.0: Factorio 2.1.21 game data, refusals that say why, filters on belts and chests, long chains that no longer overflow, a check of copies, and inserter kind and quality. | Released as 0.14.0 |
| M1 | Calibration | Cells farmed from real bases are placed in the game with the generator's best clock. The generator's rate model is compared with what machines really finish, and cells whose fluid input is dropped are checked. The result is a verdict per cell and a written finding. It is a finding, not a release. | Done (#189): five real cells are samples with their scaffolds |
| M2 | Containers | Phase 1: cars, tanks and cargo wagons as chests, holding mixed items in slots that can be filtered, with wagon slots by quality taken from the game data; a rocket silo as a chest, its rocket inventory filled by weight and its rocket part ingredients held to the insertion limit, with no craft run. Phase 2: a rocket silo that crafts and launches, recorded in the game first; whether it is then a machine or something new is open. Checked on cells farmed from real bases. | Phase 1 in 0.20.0; phase 2 open, when ready ([roadmap/later.md](roadmap/later.md)) |
| M3 | Recyclers and quality tiers | Machines that drop their output directly in front of them, recycler recipes with expected amounts, and a progress bar per quality tier for quality drills and recyclers, scaled by productivity. | Investigation in 0.23.0 ([roadmap/0.23.0.md](roadmap/0.23.0.md)); building support is decided from its proposal |
| M4 | Stability on real cells | Whatever M1 finds: the rate model fixed, or the search extended, so multi-machine Space Age cells and moving belts are clocked at their as-built rate in the game. | In progress: 0.19.0 did it for belt pickups; the gaps it left are in [0.22.0](roadmap/0.22.0.md), [0.23.0](roadmap/0.23.0.md) (biochambers and spoilage) and [0.24.0](roadmap/0.24.0.md) |
| M5 | Backpressure rule | Finding out why single-foundry cells do not recover after backpressure, then keeping, changing or dropping the rule with game recordings as evidence. | In progress: since 0.19.0 recovery is proven by an exact repeat of the simulated state and belt builds are checked in the game after three disturbances; [0.24.0](roadmap/0.24.0.md) takes the gaps left |

The tools that build the test scaffolds live in a separate repository and are not part of this roadmap.

### What release 0.14.0 changed

- The game data is Factorio 2.1.21.
- Refusals say why a cell is not supported and where it is on this page.
- An inserter dropping onto a belt or into a chest may be filtered to any item of the game.
- Long chains no longer overflow.
- A config holding several copies of one unit is checked.
- Inserters have a kind and a quality in the config, and their swing comes from the game data.

### Releases since 0.14.0

- 0.15.0: `copies` may be a fraction, for a build that holds part of a block.
- 0.16.0: clocks are judged from the start a game build has (belts full, machines empty); shorter-period clocks are offered where one ingredient lengthens the period; a belt drop may name its lane and position.
- 0.17.0: the web app is rebuilt: several saved builds, examples, import previews, and an inspector of the selected clock.
- 0.18.0: belt pickups are modelled from the stacks within reach, with the pickup layout (straight belt or underground) chosen per inserter and captured by Sidecar.
- 0.19.0: belt pickups match the game at all four belt speeds (normal, fast, express and turbo) in every pickup layout in scope, and a clock is called stable only where the game agrees.

## Follow-ups

Each follow-up becomes a GitHub issue. Until then, it is listed here.

- F1: machines whose only product is a fluid, paced by the rate downstream.
- F2: item byproducts that come out beside a fluid.
- F3: a game recording of products finished and productivity payouts for fluid products, made before any such cell is scored.
- F4: quality upcycling loops.
- F6: spoilage-removal inserters clocked from the spoil time. It ships when ready ([roadmap/later.md](roadmap/later.md)).
- F7: belt pickup and drop timing for inserters other than the legendary stack inserter. Until it is measured, a belt pickup by another kind or quality is refused, and a belt drop by one is "not checked". With it, belt pickup at belt stack sizes 1–3 and with hands other than 16, which the generator warns about until then. If it is chosen, it ships when ready ([roadmap/later.md](roadmap/later.md)).
- F8: the capture contract. First measure whether two output inserters sharing a lane change a verdict; only if they do, capture belt identity and drop positions, version the capture's facts apart from the target and operating assumptions, and prune the search with them where results stay the same.
- F9: a Pickup details panel for a belt-fed inserter: its layout, speed, supply, lane, hand and stack size from the config and capture, and a timeline of its grabs and waits from the simulation, with measured examples kept apart from the current run.
