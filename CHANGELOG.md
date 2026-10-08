# Changelog

All notable changes to the clock generator (`clock-generator` and `clock-generator-ui`) will be documented in this file.
The Factorio mods keep their own `changelog.txt`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`clock-generator/package.json`, `clock-generator-ui/package.json` and the sidecar mod (`clock-generator-sidecar/info.json`) share the same version; see Versioning in the README.

## [Unreleased]

## [0.6.0] - 2026-10-07

### Added
- Biochamber machine type, the first machine that burns fuel. It has a fuel slot, burns nutrients only while it crafts, and shows its fuel use in the machine facts. Machine config gains an optional `energy_consumption_bonus` and `fuel`.
- Fuel inserters run on a clock of their own, outside the transfer plan. Its length comes from how fast the machine burned fuel in a simulated run, so the inserter is enabled as seldom as is safe. Where possible the fuel clocks and the clock period count on one merged clock.
- Fuel tab in the results: burn rates, the fuel clocks, and the fuel each machine held over the run.
- Recipes with more than one result, such as `jellynut-processing`. An inserter that only takes a by-product away gets a clock of its own.
- Recipes that make their own ingredient, such as `pentapod-egg`, and builds where machines feed each other in a loop. The results warn that the loop must already hold the item and that the clock cannot restart it.
- In a build with a loop, inserters between machines are always enabled and the clock holds only the output inserters and the inserters on belts. Such a build is checked over ten minutes of game time.
- An item can be both an ingredient and the fuel of a machine, like nutrients in a pentapod egg biochamber. Fuel that arrives on an ingredient inserter is planned.
- Validation reports a missing fuel inserter.
- Combinator descriptions name the recipes their inserter or drill works with, as recipe icons.
- Blueprints record the target rate they were made for, in the blueprint's description and on the clock combinator: `Target: 265 [item=agricultural-science-pack] per second over 5 copies (53 each)`.
- The combinators that take a modulo of the clock, and those of a subtick clock, say what they are for: the signal they put out, how often it repeats, and which inserters read it.
- Potential clocks show their output swings per cycle and the rate they achieved, not the target.
- Pasting from an older sidecar mod says what that version does not export and asks once to update it.
- Verifying a recording covers fuel, fuel inserters and by-product inserters. Recordings can be longer and include mining drills (recorder mod 0.3.0 and 0.4.0).
- Sample configs `gleba-rocket-fuel-1`, `gleba-rocket-fuel-2`, `stone-bricks`, `agriculture-science` and `iron-bacteria-cultivation`. Clocks of the last three ran at exactly their target rate in game.

### Changed
- Generating a clock names the inserter that is missing from the transfer plan, with its source, sink and items, instead of failing with `No value found for key`.

### Fixed
- A burner machine spends fuel as it does in game: it works from a small buffer of energy, its first tick after a stop is slow, and its fuel slot is filled to 5 items or more the faster it burns.
- A craft starts whatever the output holds. Products that do not fit are held by the machine, which stops until there is room.
- A machine's output block no longer stops a machine that has its ingredients; it only stops inserters bringing more.
- A full productivity bar pays out when a craft finishes or at the start of the next tick, and pays the amount less what the recipe ignores for productivity.
- The transfer plan follows the inserters that connect the machines and is solved for all machines at once. An item needed at two levels of a chain is no longer counted twice.
- An output machine with several output inserters is planned and counted by all of them, not by the first.
- The planning run holds the output inserter to its planned swings, and the stability check counts the items the output inserters drop.
- An inserter filling a machine from a belt is refilled by its planned swings, not up to the insertion limit.
- A hand in flight when the clock period starts keeps a window for its pickup at the end of the period.
- An inserter moves at most what the item stacks to, and unloads whole belt lane stacks.
- Inserters waiting on the same machine take turns at what it makes.
- An inserter filtered to a by-product picks it up.
- Combinator descriptions are cut to the 500 bytes Factorio keeps.
- The diagram view lays out machines that feed each other in a loop.

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
