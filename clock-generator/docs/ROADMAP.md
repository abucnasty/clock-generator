# Roadmap

The clock generator is working towards clocking the cells that real Space Age bases are made of: foundries, electromagnetic plants, recyclers, quality drills, and cars and cargo wagons used as chests. The live board is the GitHub project "Real Boy": https://github.com/users/abucnasty/projects/2.

Two rules set the order of the releases:

- Every release ends with a game result. A release is done when the game agrees with the generator on the builds the release is about.
- Every second release adds a kind of build that the generator refuses today. The releases between them make the clocks of the builds it already takes better.

A patch has no game result of its own. Its checks are the tests and the record of the sample builds.

When the generator refuses a config because it does not model something yet, the message names the milestone or follow-up where that gap is planned, such as "roadmap milestone M2 (containers)" or "follow-up F1". You can look each name up here.

## The order of the releases

| Release | What it adds | Done when |
|---|---|---|
| 0.29.2 | Patch: clocks on fractional window cycles are judged right and get made. | The tests and the record of the sample builds pass. |
| 0.30.0 | Copies in the choice: the generator judges the clock of a build with all its copies, and goes on to the next clock when a lane loss breaks one. | The moved clock of the automation science 240 sample holds in the game on all its copies. Every other clock that moves holds too, or the release names its limit. |
| 0.31.0 | One judged start, checked in the game. Faster generation by exact cuts. | Each sample build has a game result from that start, or a named limit. |
| 0.32.0 | New family: buffers and belts. | Three new samples of the family hold in the game. |
| 0.33.0 | Refinement, with its speed. | A timed game pair shows that the refined clock is not dearer than today's clock. Then the refined clocks hold with the copies. |
| 0.34.0 | New family: fluid products. | Two foundry chains with a fluid step hold in the game. |
| 0.35.0 | New family: other inserters. | Samples of bulk, fast and long-handed inserters hold in the game. |
| 0.36.0 | New family: whole builds. | Three whole builds import and hold, with no hand edits. |
| 0.37.0 | New family: quality and loops. | Two quality builds hold in the game. |
| Later | One family each: see below. | Each one has a game result when it is chosen. |

The numbers after 0.33.0 follow the themes. The order can change when a game result says so.

A cut of wakeups alone is not a gain in the game. A release that cuts wakeups says that the clocks hold, with fewer wakeups. It says that a clock costs less only after a timed game pair.

### 0.29.2: fractional window cycles

Clocks on fractional window cycles are judged right and get made. The patch follows the loss trials that are judged on whole bins. Coordinated Sources stays off on fractional window cycles for now.

### 0.30.0: copies in the choice

Coordinated Sources judges its composition with the copies. When a lane loss breaks a clock, it goes on to the next clock. Clocks that hold on one copy give the parts of the new clock, and the copies come first in the ranking. The release also shows, for each belt, the facts that the search will use later. It does not change the choice with those facts yet.

The release closes [#741](https://github.com/abucnasty/clock-generator/issues/741).

### 0.31.0: one judged start

Clocks are judged from one start, the backpressure start, and a switch on the site gives the cold start. The release ends the warm-up at the exact tick and fills the stock in stages.

The game then checks the sample builds from that start. A count comes first: which sample builds have a game recording of the clock that the generator selects today. The recordings that are missing come next. A recording that fails brings its fix forward.

Generation gets faster here by cuts that change no result. A survey of the real-base cells that the generator accepts and refuses runs in this release. It sets the family of 0.32.0.

### 0.32.0: buffers and belts

The belt layouts that users build and the generator refuses today: belt to chest to machine, results of a drill or a recycler onto a belt, and the front pickup at the end of a belt. A refusal that names the inserter is part of it. Game recordings come before any model. The survey of 0.31.0 can change this list.

### 0.33.0: refinement with its speed

The refinement moves the windows of a clock one at a time, and keeps a move when the clock holds, recovers and wakes less. The timed pair of the release shows what the refinement costs in update time.

- The refinement is a selected step, judged with the copies, from the judged start.
- Windows come from the ticks that all copies need. The repair after a lane loss and the refit of every inserter come with it.
- A margin for crafting speed sits beside the margin for the phase.
- The generation time stays within a bound. The cuts of its own speed are part of the release.

If the pair fails, the refinement stays as it is today and 0.34.0 moves up.

### 0.34.0: fluid products

Foundry chains with a fluid step get a clock. A game recording of fluid products and their productivity payouts comes first. Then come machines whose only product is a fluid, paced by the rate downstream, and the item byproducts that come out beside a fluid. The generator does not simulate a fluid network.

### 0.35.0: other inserters

Belt pickups and drops by inserters other than the legendary stack inserter. Each kind, quality, hand size and belt stack size gets a scaffold and a recording. The planner learns the hand arithmetic for inserters that do not wait for a full hand.

### 0.36.0: whole builds

A whole build imports and gets its clocks with no hand edits. The release adds facts for each copy, splitters and loaders on lanes, output at a stated rate, and a Sidecar export of a whole build. It does not cover trains.

### 0.37.0: quality and loops

A progress bar per quality tier. A target that takes several results of a machine. Upcycling loops.

### Later, one family each

A rocket silo that crafts and launches. Wagons that leave. Spoilage clocks. Labs. Platform collectors. Each gets a game result when it is chosen.

### The pricing track

Pricing is not a release. It is one question that runs beside the releases: should the generator say "clock this group" or "leave this group unwired"? The answer must come from timed game runs. Nothing is removed from the search on price until a price is trusted.

The run on builds that were held out of the fitting is timed in the window of 0.34.0. It covers enable conditions, the number of update threads (2, 4, 8 and 16), and a rerun of the recycler clocking benchmark on Factorio 2.1.

## Milestones

| Id | Name | What it delivers | Status |
|---|---|---|---|
| M0 | Ship what is built | Release 0.13.0: clocks are ranked by wakeups counted at the start of a craft, which is when an inserter waiting to fill a machine is woken, not at a productivity payout. | Released as 0.13.0 |
| M0.5 | Foundations | Release 0.14.0: Factorio 2.1.21 game data, refusals that say why, filters on belts and chests, long chains that no longer overflow, a check of copies, and inserter kind and quality. | Released as 0.14.0 |
| M1 | Calibration | Cells farmed from real bases are placed in the game with the generator's best clock. The generator's rate model is compared with what machines really finish, and cells whose fluid input is dropped are checked. The result is a verdict per build and a written finding. It is a finding, not a release. | Done (#189): five real cells are samples with their scaffolds |
| M2 | Containers | Phase 1: cars, tanks and cargo wagons as chests, holding mixed items in slots that can be filtered, with wagon slots by quality taken from the game data; a rocket silo as a chest, its rocket inventory filled by weight and its rocket part ingredients held to the insertion limit, with no craft run. Phase 2: a rocket silo that crafts and launches, recorded in the game first; whether it is then a machine or something new is open. Checked on cells farmed from real bases. | Phase 1 in 0.20.0; phase 2 later, one family when it is chosen |
| M3 | Recyclers and quality tiers | Machines that drop their output directly in front of them, recycler recipes with expected amounts, and a progress bar per quality tier for quality drills and recyclers, scaled by productivity. | Recyclers in 0.23.0 ([CHANGELOG.md](../../CHANGELOG.md)): a recycler that puts its results into a container, such as an ore voider, or straight into another machine gets a clock, a target can count the items it destroys, and results that come by small chances, such as scrap into a rocket silo, get one window a window cycle for each result. Quality tiers in 0.37.0, with a target that accepts several of a recycler's results |
| M4 | Stability on real cells | Whatever M1 finds: the rate model fixed, or the search extended, so multi-machine Space Age cells and moving belts are clocked at their as-built rate in the game. | In progress: 0.19.0 did it for belt pickups, 0.22.0 for cells whose machines draw from one source or from each other, and 0.23.0 for biochamber loops, builds whose items spoil, recyclers and the original electromagnetic science scaffold ([CHANGELOG.md](../../CHANGELOG.md)). It continues in 0.31.0, where each sample build gets a game result from one judged start, and in the survey of real cells that the generator refuses. The open issues are on the [Real Boy board](https://github.com/users/abucnasty/projects/2) |
| M5 | Backpressure rule | Finding out why single-foundry builds have no recovery after backpressure, then keeping, changing or dropping the rule with game recordings as evidence. | In progress: since 0.19.0 recovery is proven by an exact repeat of the simulated state and belt builds are checked in the game after three disturbances, and since 0.23.0 a build whose items spoil is tried with losses shorter than three quarters of its spoil time. It ends in 0.31.0, where the backpressure start is the judged start and the game checks it |

The tools that build the test scaffolds live in a separate repository and are not part of this roadmap.

### What release 0.14.0 changed

- The game data is Factorio 2.1.21.
- Refusals say why a build is not supported and where it is on this page.
- An inserter dropping onto a belt or into a chest may be filtered to any item of the game.
- Long chains no longer overflow.
- A config holding several copies of one unit is checked.
- Inserters have a kind and a quality in the config, and their swing comes from the game data.

### Releases since 0.14.0

- 0.15.0: `copies` may be a fraction, for a build that holds part of a block.
- 0.16.0: clocks are judged from the start a game build has (belts full, machines empty); clocks with a shorter window cycle are offered where one ingredient lengthens the window cycle; a belt drop may name its lane and position.
- 0.17.0: the web app is rebuilt: several saved builds, examples, import previews, and an inspector of the selected clock.
- 0.18.0: belt pickups are modelled from the stacks within reach, with the pickup layout (straight belt or underground) chosen per inserter and captured by Sidecar.
- 0.19.0: belt pickups match the game at all four belt speeds (normal, fast, express and turbo) in every pickup layout in scope, and a clock is called stable only where the game agrees.

## Follow-ups

Each follow-up becomes a GitHub issue. Until then, it is listed here. Each one has a release now.

- F1 (0.34.0): machines whose only product is a fluid, paced by the rate downstream.
- F2 (0.34.0): item byproducts that come out beside a fluid.
- F3 (0.34.0): a game recording of products finished and productivity payouts for fluid products, made before any such build is scored.
- F4 (0.37.0): quality upcycling loops.
- F6 (later): spoilage-removal inserters clocked from the spoil time. It ships when ready.
- F7 (0.35.0): belt pickup and drop timing for inserters other than the legendary stack inserter. Until it is measured, a belt pickup by another kind or quality is refused, and a belt drop by one is "not checked". With it, belt pickup at belt stack sizes 1–3 and with hands other than 16, which the generator warns about until then. The samples and scaffolds are [#501](https://github.com/abucnasty/clock-generator/issues/501).
- F8 (0.36.0): the capture contract. Drop positions and the way a belt runs where an inserter drops onto it are captured (Sidecar 0.12.0, 0.14.0) and read by the drop-spacing check. Left: version the capture's facts apart from the target and operating assumptions, and prune the search with them where results stay the same.
- F9 (after 0.33.0): a Pickup details panel for a belt-fed inserter: its layout, speed, supply, lane, hand and stack size from the config and capture, and a timeline of its grabs and waits from the simulation, with measured examples kept apart from the current run.
