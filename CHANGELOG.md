# Changelog

All notable changes to the clock generator (`clock-generator` and `clock-generator-ui`) will be documented in this file.
The Factorio mods keep their own `changelog.txt`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`clock-generator/package.json` and `clock-generator-ui/package.json` share the same version; the sidecar mod has a version of its own. See Versioning in the README.
From 0.6.0 on, it lists only what people generating clocks will notice. Changes that only matter to working on the generator, such as the recorder, the harness and the samples, are in the git history.

## [0.10.0] - 2026-10-14

### Added
- A potential clock called "Even hands". Every inserter gets one window for each hand it moves in the clock period, spread evenly over the period, and each window is a tick shorter than the inserter's hand cycle, so it moves one hand whenever in it the source has the hand and the machine it puts into takes it. Inserters that move the same hands per period get the same windows and share one window decider: the two halves of a build that do the same thing open and close together, and two inserters that take from one machine at the same rate take from it on the same ticks. It is made straight from the plan, without a search, and is offered where every inserter takes from a machine or a chest and moves a whole number of hands per period, and the build has no mining drills, no loop of machines and no fuel or by-product inserters.

### Fixed
- The planning of fractional swings counted an inserter's hands into a machine as if the machine's stock had to stay at or under the insertion limit after each drop. In the game a machine takes a hand while its stock is under the limit, and the hand goes in whole. Fractional swings can now be planned on builds where it failed before with "maximum allowed is 2 due to insertion limits", and is listed there.

### Changed
- Accumulators at 640 a second ([#152](https://github.com/abucnasty/clock-generator/issues/152)) select even hands: 602 wake-ups per minute against 2,907 for the clock 0.9.1 selected, with 5 window deciders, one for each thing the two halves do. Recorded in the game: 576 accumulators in every period. The searches are no longer run for this build.
- Chemical science with belts moving selects fractional swings, at 10.1 wake-ups per minute against 20.4. Not checked in the game: that sample has no scaffold.
- Utility science with direct-insert low density structures, with "Belts do not move" on, selects fractional swings, which is nearer the target rate than the clock it selected before. No clock holds the target rate on that build, as before.

## [0.9.1] - 2026-10-14

### Fixed
- A clock could hold the target rate in the simulator and fall short in the game on builds where machines feed machines directly, such as accumulators at 640 a second ([#152](https://github.com/abucnasty/clock-generator/issues/152)): the clock 0.9.0 selected for that build made 512 to 544 of its 576 accumulators a period in the game. The simulator now follows two rules of the game it had wrong. An inserter whose window opens in the tick another inserter takes the products of the machine it puts into takes its first items a tick later, unless that other inserter's window opened in the same tick. An inserter holding part of a hand from a machine takes no more while the machine it puts into is full at its output. Such a clock is now unstable, and the clock selected instead holds the rate in the game.

### Changed
- Agricultural science selects batched swings (5 output swings per cycle) again, with fewer wake-ups than the 2-swing clock it selected since 0.6.0: under the corrected rules it gets back to its rate after the nutrients run out. The inserters that bring eggs to the science biochamber are no longer clocked in that build; they stay always enabled.
- Other builds can get another selected clock or other wake-up figures. On the sample builds, utility science with direct-insert low density structures and the chain always on selects uneven output swings, since batched swings no longer gets back after the coal runs out.

## [0.9.0] - 2026-10-14

### Changed
- An imported config file is now checked. One whose structure is broken, or that is not a config, is refused with what is wrong with it. Something left to fix, such as an inserter end left unset after its machine, belt or chest was removed, or 0 items per second, still imports and is marked red in the form.
- The browser tab says "Factorio Clock Generator".
- The sidecar mod is at 0.7.0, and the generator asks for that version. An inserter that takes from or drops into something not in the JSON, such as an empty belt or chest, a lab or a machine outside the selection, is left out of the JSON. It used to point at machine, belt or chest 1, which is some other entity. The window with the JSON lists the inserters left out and why. Selecting an assembling machine without a recipe, or a lab, no longer crashes the game. A paste from 0.6.0 still imports, with a note that nothing in it is affected and that the mod can be updated to 0.7.0.

### Fixed
- Removing a machine, belt or chest unsets the inserter ends and drill targets at it. They kept its id, which pointed at no entity, or at the next one added.
- The id of a removed entity is no longer given to the next one added.
- A saved configuration that cannot be loaded is no longer lost. It is kept in the browser's localStorage under `clock-generator-config.backup`, and the page says so.
- The page shows an error when it cannot start, instead of staying on "Loading Factorio data..." for good.

## [0.8.0] - 2026-10-12

### Added
- "Search for fewer wake-ups" switch under Advanced Overrides (`overrides.search_for_fewer_wake_ups`, off by default). It runs the four searches (observed windows, uneven output swings, shifted swings, full-hand output swings) for every build and selects the clock with the fewest wake-ups among all of them, as earlier versions did.

### Changed
- Generating is faster on most builds. The four searches now only run when no other potential clock is stable. A build that needs a search to get a stable clock still gets all four.
- Where the searches are left out, the Potential Clocks panel says so. The selected clock is stable, and it can have more wake-ups than the one a search would have found. Turn on "Search for fewer wake-ups" to get the selection of earlier versions.
- The Potential Clocks panel says that a clock's wake-ups are counted from one start of the clock. Another start can settle into a different figure.

## [0.7.0] - 2026-10-11

### Changed
- Full-hand output swings are no longer ranked ahead of every other clock on a machine with spare speed. Among the stable clocks the one with the fewest wake-ups is selected, as for every other kind of clock.
- When no clock holds the target rate and two are equally near it, the one that holds its expected output from a clean start is selected before one that drifts.
- Observed windows, uneven output swings, shifted swings and full-hand output swings are now searched for in the same way: each candidate is tried from a dozen clock starts, one whose neighbours also pass is preferred, and the pick is confirmed with the long run. Some builds get a clock with fewer wake-ups, and some get a stable clock where none held before.
- Generating takes about 15% longer, for the more thorough search.

## [0.6.1] - 2026-10-11

### Changed
- The generator was restructured inside. The clocks it makes are the same as in 0.6.0: every sample build gets the same potential clocks, the same windows and the same selected clock.
- The sidecar mod has a version of its own from now on and stays at 0.6.0. This release needs no update of the mod.

## [0.6.0] - 2026-10-10

### Added
- Biochambers, the first machine type that burns fuel: a fuel slot, nutrients burned only while crafting, and fuel use in the machine facts. Machine config gains an optional `energy_consumption_bonus` and `fuel`.
- Fuel inserters run on a clock of their own, sized from how fast the machine burns fuel, so the inserter is enabled as seldom as is safe. A Fuel tab in the results shows burn rates, the fuel clocks and the fuel each machine held.
- An item can be both an ingredient and the fuel of a machine, like nutrients in a pentapod egg biochamber. Validation reports a missing fuel inserter.
- Recipes with more than one result, such as `jellynut-processing`. An inserter that only takes a by-product away gets a clock of its own.
- Recipes that make their own ingredient, such as `pentapod-egg`, and builds where machines feed each other in a loop. The inserters of a loop stay always enabled, except one that feeds the machine the output is taken from, which is disabled while that machine is blocked where the clock still holds. The results warn that the loop must already hold the item and that the clock cannot restart it.
- Wake-ups: each potential clock lists how often the machines wake its enabled, waiting inserters, per minute, and its insights break that down by inserter. Fewer is lighter on update time.
- Belt column: each potential clock names the belt it is made for, "moving (+4 ticks)" with belt pickup slack or "non-moving" when its windows only fit a full belt that stands still. A subtick clock is always non-moving.
- "Belts do not move" switch under Advanced Overrides (`overrides.non_moving_belts`, off by default): clocks are made without belt pickup slack and the one with the fewest wake-ups is selected. An inserter that also takes fuel off the belt gets room for a hand of fuel in its windows when the clock does not hold without it.
- Nearest lane of a belt: an inserter that takes two items off one belt takes from the lane nearest to it first, as the game does. Set it with `near_lane` on the belt an inserter picks up from, or in the inserter's panel; the sidecar mod exports it. Without it the order of the filters is used, as before.
- Backpressure loss: a clock that holds the target rate is also tried for an input that stops arriving and an output that is not taken away. A clock the build does not recover under is listed as "No recovery" with the losses that break it, and is only selected when no clock recovers. It is tried in the simulator only, fluids are not cut, and generating takes up to a fifth longer.
- Deadlock risk: a build where two inserters bring the same item to a machine, and one of them brings another item too, can stop for good. The generator reads this off the config, names it above the potential clocks and warns when a blueprint is copied. On such a build the backpressure verdict is shown and does not decide the selection.
- When no clock holds the target rate, the one nearest to it is selected, and copying its blueprint warns of the rate it runs at.
- Every blueprint has a lock: a constant combinator under the clock, off by default. No inserter is enabled while it is on, and the clocks start again from the beginning when it is switched off.
- Blueprints record their target rate in the description and on the clock combinator. Combinator descriptions name the recipes their inserter or drill works with, and what each modulo and subtick combinator is for.
- Potential clocks show their output swings per cycle and the rate they achieved.
- The timeline shows, under each row, the state the entity would show in Factorio, named as the game names it, with "no fuel" for a burner machine that has run out.
- Pasting from an older sidecar mod says what that version does not export and asks once to update it.

### Changed
- The clock selected for you is the stable one with the fewest wake-ups a minute, where it was the one with the fewest windows. A clock without belt pickup slack is only selected for you when no clock with the slack holds the target rate.
- "Planned + belt pickup slack (+4 ticks)" is now "Batched swings", and "Planned" is "Batched swings, non-moving belt". The ids `planned-belt-slack` and `planned` stay.
- The clock counts from 1 to its period instead of from 0, so a switched-off clock enables nothing. Generated blueprints now need Factorio 2.1.
- Every potential clock is confirmed with a long run, ten minutes of game time or 120 periods, whichever is shorter. It catches drift that a check of one period missed.
- The simulator follows recordings of Factorio 2.1.21 more closely: the state an inserter shows, belt pickups into a machine that takes no more, the tick a clocked or a waiting inserter acts in, and an output block larger than a stack. The rules are in `GOALS.md`.
- Full-hand output swings are searched for in more cases, and ranked first where a machine has at least 5% of spare speed.
- More output swing counts are offered when batched swings backed off to a lower count.
- Generating names the inserter that is missing from the transfer plan instead of failing with `No value found for key`.
- Insights draw where the exported clock swings differently than the plan as a lane chart instead of lists of ticks.

### Fixed
- An inserter or mining drill set to `ALWAYS` gets no combinator, and every clock is checked with it always enabled. It was given clock windows like any other.
- A clock period that is a whole number of ticks is no longer offered as a subtick clock through a rounding error.
- A craft starts whatever the output holds, the output block only stops inserters bringing more, and a full productivity bar pays out when a craft finishes.
- The transfer plan is solved for all machines at once: an item needed at two levels of a chain is no longer counted twice, and an output machine with several output inserters is counted by all of them.
- Inserters move at most what the item stacks to, take turns at a machine they wait on together, and keep a window for a hand that is in flight when the clock period starts.
- Combinator descriptions are cut to the 500 bytes Factorio keeps.

### Removed
- HOCON support. Configurations are JSON.

## [0.5.0] - 2026-10-05

### Added
- Insights: a report for the selected potential clock with a what, a why and an explanation for each thing the simulation found. It covers how much time each machine has to spare per clock period, each ingredient's insertion limit and hands per period, how long a full output hand takes to make, where the exported clock swings differently than the plan, and why an unstable clock misses the target. The range of places shifted swings can go is part of it.
- "Uneven output swings" potential clock: observed windows with one output swing moved off its planned start, so the output swings are not evenly spaced. A machine only has to make up for its output over the whole clock period, so it can craft more between one pair of swings than the next. The swing is tried a craft at a time in both directions and the position with the most working positions on either side is used. Offered when the period has more than one output swing and a moved swing passes the clock-only check from every start phase.
- "Shifted swings" potential clock: the planned windows (with belt pickup slack) with one round of swings (an output swing and the input swings planned with it) moved together to another place in the clock period, keeping window lengths and spacing so swings stay as batched as planned. A machine takes a swing whenever its limits allow, so a round can run earlier or later than the even spacing the plan uses. Every shift is checked with the clock-only simulation and the one with the most working shifts on either side is used. Offered when the clock period has more than one round and a shift of at least an eighth of a crafting cycle passes.
- Selecting an "Uneven output swings" or "Shifted swings" clock shows every place that was tried for the moved swings along an axis of ticks from their planned start: which places work, which do not, and the one the clock uses. For shifted swings it also says what limits each end of the range that works, such as an inserter waiting for its machine to drop below an insertion limit or a machine running out of ingredients before the swings arrive.

### Changed
- New Validate step between configuring and generating. It checks that a clock can be planned (an inserter for every ingredient and output, machines able to reach the target rate) and reports what is wrong when it cannot. Generate is available once the configuration is valid and unchanged since.
- The transfer plan moved from the results to the Validation section of the configuration, where excluding ingredients from the LCM belongs. It is worked out only when validating, never while editing; changing the configuration afterwards marks it out of date until validated again.
- The potential clocks table lists only stable clocks at first, with a button to show the unstable ones that were tried. When no clock is stable, the unstable ones are listed.
- The UI uses Titillium Web font
- The page is split into Configure and Results, with a bar that stays in view for switching between them, generating, and copying the selected clock's blueprint. Generating switches to Results.
- Results show the potential clocks table with one tabbed area below it (Timelines, Insights, Blueprint, Log) instead of a long stack of sections, and the page uses more of a wide screen.

## [0.4.0] - 2026-10-05

### Added
- The timelines can show the selected clock driven only by its exported clock windows ("Exported clock", now the default) or the planning simulation the windows were taken from ("Plan"). The two can differ: with the clock alone an inserter may drop twice after one window and only load its hand in the next.
- The state transition timeline marks each inserter's clock windows along the top of its row.

### Fixed
- The clock-only check no longer calls a clock stable when it reaches the expected output in the simulated period but only repeats every few periods and falls short over them. The output is now also counted over the whole repeat.
- Warmup of a clock-only simulation stops as soon as the build repeats. A field that never changed kept the repeat from being detected, so every warmup ran its full length.

## [0.3.1] - 2026-10-05

### Changed
- Observed-windows clocks give an inserter between two machines that waits at its source machine for a full hand short, evenly spaced windows instead of a long one, when the clock stays stable from every start phase. In game, a long window keeps the inserter rescanning both machines while it waits.
- The search for full-hand output windows now limits its confirmation attempts per window length, so failing short windows no longer rule out longer ones.

## [0.3.0] - 2026-10-03

### Added
- The potential clocks table shows each clock's crafting cycle length next to its output swings (e.g. "4 per 64 ticks") and its clock period.

### Changed
- "Clock Alternatives" is now called "Potential Clocks".
- "Terminal Swing Count" is now "Force Output Swings": every potential clock uses exactly that many output swings per crafting cycle, even if unstable, and no other swing counts are offered. Leave it empty to let the generator pick the count, lower it until the output is stable, and offer other counts as potential clocks.

### Removed
- The "Output Swing Backoff" toggle. `disable_swing_backoff` in a config is still accepted but ignored.

## [0.2.0] - 2026-10-03

### Added
- Export belts: a belt strategy with a consumption rate (items/s) per lane for machines outside the config. The inserters filling the lane are planned and clocked for that rate, and a clock is only stable if the lane is filled at it. Normal belts stay the default and need no extra config. ([#62](https://github.com/abucnasty/factorio-scripts/issues/62))
- Belt strategy selector, per-lane consumption rate and an info popover explaining the belt strategies in the UI.
- Longer crafting cycles as clock alternatives: up to 3 output swing counts above the planned one, for machines that keep crafting while the output inserter takes hands (e.g. 4 swings per 64 ticks for two low density structure foundries).
- Ko-fi support link in the footer. ([#71](https://github.com/abucnasty/factorio-scripts/pull/71))

### Fixed
- Configs with a belt between two machines no longer fail with "No value found for key inserter:N": the inserters filling the belt are planned for what is taken off it and clocked for their swings. ([#62](https://github.com/abucnasty/factorio-scripts/issues/62))
- An inserter filling a belt nothing takes items off gives a clear error asking for an export belt.

## [0.1.0] - 2026-10-03

### Added
- Clock alternatives: each run produces several clocks (planned, derived windows, belt pickup slack, lower output swing counts, fractional periods), and the UI lists each with its rate and stability. ([#67](https://github.com/abucnasty/factorio-scripts/pull/67))
- As-built check: re-simulates a build driven only by the exported clock windows, from several clock start points. ([#67](https://github.com/abucnasty/factorio-scripts/pull/67))
- Verify CLI: `npm run verify -- --config=... --recording=...` compares a `clock-generator-recorder` recording with the simulation. ([#67](https://github.com/abucnasty/factorio-scripts/pull/67))
- Subtick clock alternatives that run fractional periods at the exact target rate. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- Full-hand output alternative, offered when output inserters need extra grabs per hand. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- Modulo clock blueprints: blueprints are exported as a book with a modulo clock version and a raw timings version, with every combinator pre-wired. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- Flow based configuration view (beta). ([#60](https://github.com/abucnasty/factorio-scripts/pull/60))
- Transfer plan shown in the UI, with the option to exclude ingredients from the LCM. ([#58](https://github.com/abucnasty/factorio-scripts/pull/58))
- Drag and drop entity reordering. ([#56](https://github.com/abucnasty/factorio-scripts/pull/56))

### Changed
- Clock alternatives are generated in parallel Web Workers and shown as soon as each one finishes. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- Faster simulation, and debug output is off unless enabled. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- The state transition timeline is drawn on a canvas, fixing out of memory errors in the browser on long periods. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- The clock decider combinator faces south, and virtual signals in descriptions use `[virtual-signal=...]` rich text. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- Long clock periods shorten the warmup instead of failing. ([#69](https://github.com/abucnasty/factorio-scripts/pull/69))

### Fixed
- The simulator matches the game more closely: ingredients are consumed when a craft starts, machines update after inserters, a machine is output-full when its next craft won't fit, and inserters are processed downstream first. ([#67](https://github.com/abucnasty/factorio-scripts/pull/67))
- Decider window bounds are rounded to whole ticks. ([#68](https://github.com/abucnasty/factorio-scripts/pull/68))
- Machines fed through several inserter paths are now planned to supply all of them. ([#69](https://github.com/abucnasty/factorio-scripts/pull/69))
- Input inserter deadlock for multi-ingredient belt to machine inputs with a reduced `terminal_swing_count`. ([#61](https://github.com/abucnasty/factorio-scripts/pull/61))
- Exported configurations no longer include internal UI ids. ([#59](https://github.com/abucnasty/factorio-scripts/pull/59))
