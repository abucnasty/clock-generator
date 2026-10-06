# Changelog

All notable changes to the clock generator (`clock-generator` and `clock-generator-ui`) will be documented in this file.
The Factorio mods keep their own `changelog.txt`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`clock-generator/package.json`, `clock-generator-ui/package.json` and the sidecar mod (`clock-generator-sidecar/info.json`) share the same version; see Versioning in the README.

## [Unreleased]

### Added
- Fuel consumption for machines that burn fuel. A machine type declares an energy usage and the fuels it accepts, and machine facts show how many fuel items it burns per second and per craft. Fuel is burned only while crafting; the rate scales with an optional energy consumption bonus (speed modules raise it, efficiency modules lower it, to a minimum of -80%), a craft burns more or fewer items with the machine's crafting speed and recipe time, and productivity does not change the rate.
- Biochamber machine type, the first machine that burns fuel. It crafts like an assembler, uses 500 kW and burns nutrients (2 MJ each, its only fuel), 0.25 nutrients per second at the base energy consumption.
- Machine config gains an optional `energy_consumption_bonus` (percent, default 0) and `fuel` (defaults to the machine type's first accepted fuel). The UI offers a Biochamber machine type and an Energy Consumption field for it, and shows fuel consumption in the machine facts.
- Fuel slot on burner machines. Inserters can drop fuel into a biochamber's fuel slot, up to 5 items, and the machine burns it while crafting, spending energy in proportion to crafting progress. A craft will not start without fuel, and a craft in progress waits for fuel and then carries on. The fuel slot is separate from the ingredients and output, so a biochamber making nutrients can also be fuelled with nutrients. A recipe that uses the fuel as an ingredient is not supported yet.
- Validation reports a missing inserter for the fuel of a burner machine, like it does for missing ingredients.
- Recipes with more than one result, such as `jellynut-processing`. The result with the largest expected amount is the main product; the others are by-products. A by-product is made at its expected amount (its amount times its probability, with productivity applied except to the part of the amount the recipe ignores for productivity), and fractions carry over until they add up to a whole item. Inserters out of a machine can carry any of its results, and a machine is output full as soon as any of its results reaches the stack size of the item. An inserter that only takes by-products no machine in the config uses is not planned: it clears them from the machine whatever belt it fills, so it needs no export rate and adds nothing to the LCM. It has a clock of its own, like a fuel inserter: a short window that repeats every N ticks, N a divisor of the clock period no longer than it takes the machine to build up a hand of the by-product, and no longer than the machine takes to make the room the stack has over a hand. A by-product made by chance comes in streaks, and a machine holding as many as its stack takes is blocked until the next window. When no divisor fits the stack's room, the hand's interval is used. The inserter ignores the machine's output outside the window and takes what is ready inside it, so a combinator clocks its output.
- Recordings of burner machines carry the fuel slot, the energy left in the burning fuel item and which fuel item is burning, and a machine out of fuel (`no_fuel`) counts as waiting when a recording is compared with the simulation. Recordings without them still load.
- Verifying a recording checks inserters outside the plan (fuel inserters and inserters taking a by-product away) against their clock windows, since they swing by their clock and their machine's state and not once per period of the simulation. It also reports the fuel each burner machine burned against what its configured energy consumption predicts, and flags a machine that burned a tenth more or less, or was out of fuel.
- Pasting from the sidecar mod runs the data through a pipeline of steps. Each step returns either nothing or a sentence about what the user is missing because the mod is older than the version that exports it, and the sentences are folded into one message the import dialog shows, with the version that exported the data and one request to update the mod. A step is added for each feature of the config the sidecar exports from a version on. The first one says that biochambers from a sidecar older than 0.6.0 have no energy consumption.
- Fuel inserters have a clock of their own. An inserter that only fills a biochamber's fuel slot is not part of the transfer plan and does not change the LCM. It is enabled for the first ticks of every N, whatever the clock period is. The blueprint still has one clock: it counts, on a signal of its own, as many periods as it takes for every fuel clock to fit a whole number of times (1408 ticks for a 128 tick period with fuel clocks of 88 and 128), and a modulo combinator each gives the clock of the period, on the clock signal as before, and the fuel clocks, on signals of their own. A combinator per fuel clock and window enables the fuel inserters that share them. A subtick clock, or a count too long for a signal, gets a separate clock per fuel interval instead. N is the time the nutrients in a full fuel slot (5) last the machine, so the slot never runs dry, and the slot's limit skips a swing when it is full. Fuel is burned only while crafting, so N is counted over the part of the time the machine crafts in the plan (taken 10% higher, since recordings burned up to 5.3% over the prediction: a machine that stops and starts spends most of a tick's fuel without crafting): 5 nutrients last a rocket fuel biochamber that crafts 89% of the time 91 ticks and a jellynut one that crafts 80% of the time 132, where a divisor of a 128 tick clock gave 64 for both. Fuel clocks of exactly those ticks share no factor with the period, and one clock for them would count 384384 ticks, so each fuel clock is a divisor of a few periods instead: the fewest periods that enable the fuel inserters at most 5% more often than the fuel needs (11 periods here, with fuel clocks of 88 and 128), or the best there is within 10 minutes. A machine that crafts more than planned, as it can while a build starts up, may be out of fuel for a few ticks before its next window. A fuel inserter has no windows on the clock of the period, and a recording is checked for its swings all starting in the same window of the fuel clock. When one inserter cannot keep the machine fuelled, generating a clock says which inserter and why. An inserter that carries fuel and an ingredient is planned and clocked for the ingredient.
- Fuel tab in the results. Fuel is outside the transfer plan, so a build with fuel inserters gets a tab of its own instead of a view in the timelines. It says whether any machine ran out of fuel, and lists for each burner machine its fuel, burn rate while crafting, planned crafting share, effective burn rate (per second and per clock period), how long the fuel slot's limit of 5 lasts, its energy consumption bonus, and the burn rate and lowest fuel in the simulation. For each fuel inserter it lists the exported fuel clock: the interval, the enable window, the machine it feeds, enables per minute, how long a hand lasts, the swings per minute to expect and the share of enables that swing, next to the swings simulated. It also gives the length of the merged clock, or says why each fuel clock has a counter of its own. A hand of fuel lasts a machine longer than one clock period, so the fuel timeline runs the exported clock for about four hands of the slowest burning machine and draws each machine's fuel over time with its inserters' fuel clock windows and swings. The clock, its length and its checks stay one period. The result gains `fuel_plan`, and `fuel_consumption_view` gains `fuel_levels` and `ran_out_of_fuel`.
- Combinator descriptions name the recipes of the machines their inserter or drill works with, as recipe icons: `Inserter 3 for [item=jellynut] into [recipe=jellynut-processing]`, `from` for the machine it empties, and both for an inserter between two machines. A combinator shared by inserters with the same windows lists every inserter number, with a line per recipe when their machines differ.

### Fixed

- An inserter filling a machine from a belt is refilled by its planned swings (3 hands for 3/2 swings per cycle) instead of up to the machine's insertion limit. A refill up to the limit takes as many hands as the limit has room for, which has nothing to do with the clock period, so the one period the clock windows are read from could hold more or fewer hands than every period needs: the jellynut inserter of a rocket fuel build got a window for 1 of its 3 hands, and its planned clocks made a third of the target as built. The "4 output swings per cycle" clock of the `low-density-two-foundry-120-per-second` sample is stable as built again for the same reason.
- A hand that is in flight when the clock period starts keeps a window for its pickup at the end of the period. An inserter with no time to spare (15 jelly a hand, 8 hands of 8 ticks in a 64 tick period) always has one, and without the window the exported clock moved 7 of its 8 hands.
- A crafting machine's output block works like in game. The block (overload multiplier times the recipe's result amount, productivity not counted, so 11 rocket fuel for a biochamber making 4 rocket fuel per craft from jelly) never stops a machine that has its ingredients: it keeps crafting up to the stack size of the item (20 rocket fuel). The block only does two things: a machine's inserters do not pick up ingredients for it while its output is at the block, and a machine that cannot start a craft shows output full while its output is at the block and ingredient shortage once its output drops under it. A machine that was output full works again as soon as its ingredients arrive, even with its output still at the block; before, it waited for its output to drop under the block, and it stayed output full when its output dropped under the block without ingredients. Derived from recordings of Factorio 2.1 (advanced circuits, chemical science, utility science, metallurgic science, rocket fuel), where machines crafted with their output well over the block (an advanced circuit machine with a block of 21 started crafts with 35 in its output), showed full output only at or over the block and ingredient shortage only under it. The shifted swings report counts a machine that is output full and then short of ingredients until the moved swings arrive as one stop.
- An inserter moves at most what the item stacks to, and when it drops on a belt it unloads early instead of waiting for a count that would leave a partial stack on the belt. An item that stacks to 10 on a belt lane of 4 moves 8 per swing, not the inserter's stack size. The transfer plan, the simulation and the clock use this hand size instead of the inserter's stack size for every item and inserter.
- An inserter taking a by-product off a machine picks it up: it only looked for the machine's main product, so an inserter filtered to a by-product never picked anything up, the by-product filled its stack and blocked the machine.
- The description of a combinator in a blueprint is at most 500 bytes, which is all Factorio keeps of it. Longer descriptions are cut after the last line that fits, with an ellipsis, instead of being exported whole.

### Changed
- Generating a clock names the inserter that is missing from the transfer plan, with its source, sink and items, instead of failing with `No value found for key`. A clock cannot yet be generated for a config with an inserter that fills a fuel slot.
- Sample configs `gleba-rocket-fuel-1` and `gleba-rocket-fuel-2`: three biochambers making rocket fuel from jelly, with jellynut-seed as a by-product put on an export belt, with jelly inserters of 16 and of 15 a hand.

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
