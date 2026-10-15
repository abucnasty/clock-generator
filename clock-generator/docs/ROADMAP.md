# Roadmap

The clock generator is working towards clocking the cells that real Space Age bases are made of: foundries, electromagnetic plants, recyclers, quality drills, and cars and cargo wagons used as chests. Each milestone below adds one family of such cells. The live board is the GitHub project "Real Boy": https://github.com/users/abucnasty/projects/2.

When the generator refuses a config because it does not model something yet, the message names the milestone or follow-up where that gap is planned, such as "roadmap milestone M2 (containers)" or "follow-up F1". You can look each name up here.

## Milestones

| Id | Name | What it delivers | Status |
|---|---|---|---|
| M0 | Ship what is built | Release 0.13.0: clocks are ranked by wake-ups counted at the start of a craft, which is when an inserter waiting to fill a machine is woken, not at a productivity payout. | Released as 0.13.0 |
| M0.5 | Foundations | Release 0.14.0: Factorio 2.1.21 game data, refusals that say why, filters on belts and chests, long chains that no longer overflow, a check of copies, and inserter kind and quality. | Release 0.14.0 |
| M1 | Calibration | Three cells that were unstable are placed in the game with the generator's best clock. The generator's rate model is compared with what machines really finish, and cells whose fluid input is dropped are checked. The result is a verdict per cell and a written finding. It is a finding, not a release. | Not started |
| M2 | Containers | Cars and cargo wagons as chests, with wagon slots by quality taken from the game data. A rocket silo works either as a chest or as a machine, never both. Checked on cells farmed from real bases. | Not started |
| M3 | Recyclers and quality tiers | Machines that drop their output directly in front of them, recycler recipes with expected amounts, and a progress bar per quality tier for quality drills and recyclers, scaled by productivity. | Not started |
| M4 | Stability on real cells | Whatever M1 finds: the rate model fixed, or the search extended, so multi-machine Space Age cells and moving belts are clocked at their as-built rate in the game. | Not started |
| M5 | Backpressure rule | Finding out why single-foundry cells do not recover after backpressure, then keeping, changing or dropping the rule with game recordings as evidence. | Not started |
| M6 | Validation resumes | The advice on which inserters are worth clocking is checked again on fresh saves of real bases, with the latest release. | Blocked on M1 to M4 |

The tools that build the test scaffolds live in a separate repository and are not part of this roadmap.

### What release 0.14.0 changed

- The game data is Factorio 2.1.21.
- Refusals say why a cell is not supported and where it is on this page.
- An inserter dropping onto a belt or into a chest may be filtered to any item of the game.
- Long chains no longer overflow.
- A config holding several copies of one unit is checked.
- Inserters have a kind and a quality in the config, and their swing comes from the game data.

## Follow-ups

Each follow-up becomes a GitHub issue. Until then, it is listed here.

- F1: machines whose only product is a fluid, paced by the rate downstream.
- F2: item byproducts that come out beside a fluid.
- F3: a game recording of products finished and productivity payouts for fluid products, made before any such cell is scored.
- F4: quality upcycling loops.
- F5: moving trains, including a wagon on a moving train.
- F6: spoilage-removal inserters clocked from the spoil time.
- F7: belt pickup and drop timing for inserters other than the legendary stack inserter. Until it is measured, other kinds and qualities are "not checked" on belts.
