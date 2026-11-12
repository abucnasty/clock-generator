# Changelog

All notable changes to the clock generator (`clock-generator` and `clock-generator-ui`) will be documented in this file.
The Factorio mods keep their own `changelog.txt`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`clock-generator/package.json` and `clock-generator-ui/package.json` share the same version; the sidecar mod has a version of its own. See Versioning in the README.
From 0.6.0 on, it lists only what people generating clocks will notice. Changes that only matter to working on the generator, such as the recorder, the harness and the tests, are in the git history.
Entries from 0.6.0 on follow Changelogs in [Contributing](CONTRIBUTING.md#changelogs).

## [Unreleased]

### Removed
- ui: the Never on override is removed; older files and links load with Auto
- ui: the input belts setting is removed; older builds load with their input lane ends stated

### Changed
- generation: clocks with observed windows are found faster on large builds
- ui: the input belts setting still works in configuration files and is deprecated
- generation: 0.28 Moving builds, stating no lane end, now get dead ends on input lanes
- ui: a rounded clock that meets the target reads Stable, not Overproduces
- ui: every clock shows its status beside its name, Stable included
- ui: the note on a clock that overproduces says only what was measured
- ui: a clock that loses swings on a shared lane shows what all its copies make

## [0.28.1] - 2026-11-07

### Fixed
- ui: the page starts in Safari and on iPhones instead of loading forever

## [0.28.0] - 2026-11-07

### Added
- generation: a new clock that enables some inserters for one tick at each swing
- generation: a new router, Coordinated Sources, gives each source's inserters the strategy that fits them

### Changed
- generation: 24 builds recommend clocks with fewer wakeups, among them accumulator, processing unit and chemical science
- generation: Euclidean Swings now falls back to fewer output swings where the machine cannot take them
- ui: the site's terms follow the glossary: enable window, wakeup, window cycle time, recovery, configuration
- generation: inserters from a belt into a chest are named when the build is refused
- ui: clocks are named for the practice they follow, and the table shows signals a minute
- ui: the Clocked override's window cycle time is renamed; older files and links still load

### Fixed
- ui: an unexpected error in the check now says the generator failed, not your build
- ui: the install guide says Enable if, and the site's words follow the glossary
- simulation: belt slack and low insertion limits honor the item's stack size during a swing

## [0.27.2] - 2026-11-05

### Fixed
- simulation: inserters taking several items from one infinity chest now pick them in the game's order

## [0.27.1] - 2026-11-04

### Changed
- generation: fractional swings is now a potential clock on every build, replacing its switch
- ui: the Electromagnetic science example no longer forces swings or hand-made output conditions
- ui: the Logistic science pack example is now 1 machine and 2 inserters

## [0.27.0] - 2026-11-04

### Removed
- ui: the recycling scrap silo sample is removed

### Changed
- simulation: inserters now update in the order the game updates them
- simulation: wake-ups shown for each clock now match the game's count, mostly going up
- generation: a clock that falls one item short over a long run is no longer stable
- generation: moving express belts into electromagnetic plants, and their front exits, now get a stable clock

## [0.26.0] - 2026-11-01

### Changed
- generation: observed wake windows and shifted swings find fewer wake-ups on periods up to 480 ticks
- generation: on a wake-up tie, the clock recovering sooner from stopped inputs or backed-up outputs wins
- simulation: an inserter still swinging back from its drop no longer counts as woken
- generation: a stable clock running over the target rate now beats a nearer unstable one
- ui: the page says how far the selected clock runs over the target rate

### Removed
- generation: All results at once is no longer offered for a recycler's rare results
- generation: a subtick clock is no longer also listed rounded down to whole ticks
- generation: other output swing counts and fractional swings are no longer also listed with shared windows

### Fixed
- generation: clocks for a recycler fed back its own results are no longer wrongly called stable
- ui: the Items per Second field no longer accepts a rate that Check then refuses

## [0.25.0] - 2026-10-28

### Changed
- generation: inserters between looped machines, as in agricultural science and iron bacteria cultivation, get wake windows
- generation: on builds with a machine loop, clocks are ranked by average wake-ups over 12 starts
- ui: the Potential Clocks panel says when its wake-ups are an average over 12 starts
- ui: an unreachable target rate is refused at once, naming the limiting machines, inserters or belts
- ui: a refusal for one inserter taking several recycler results names the items and chest

### Fixed
- ui: screen readers now name the copy spacing and side fields
- ui: the transfer history's marks can be reached by keyboard
- generation: short clock periods no longer overstate items a second, which can change the closest clock
- simulation: productivity skips results the game excludes, like returned asteroid chunks and barrel recipes
- simulation: only inserters that wait for full hands in the game, like stack inserters, still do
- simulation: stone and steel furnaces, burner mining drills and captive biter spawners now burn fuel
- ui: a mining drill's state shows when it is disabled by circuit or waiting to drop
- ui: a refused build lists each problem separately, without internal field names
- ui: after a refusal, Generate waits until the build is changed

## [0.24.0] - 2026-10-27

### Changed
- generation: large builds take less memory and generate faster
- generation: clocks are made only for the build's belt setting, moving or backed up
- generation: pickups from an underground end on backed-up normal-speed belts now get a stable clock

## [0.23.0] - 2026-10-27

### Added
- generation: builds whose recycler puts its results into a container or another machine get a clock
- generation: recyclers with rare results, such as scrap into a rocket silo, now get a clock
- ui: Target Output counts items made or destroyed, such as by an ore voider
- ui: Sidecar 0.15.0 exports where a recycler's results go
- generation: Small batches moves a few hands at a time where no planned clock holds
- generation: builds outputting straight into item-removing infinity chests, with no buffer chest, now get a clock
- generation: inputs picking up from supported belt bends now get a clock
- ui: machine details list every recipe result with its rate and output routes
- ui: machine details gain tabs and a compact inserter editor
- ui: machine details offer a repair that adds a missing output chest

### Changed
- blueprint: clocks use fewer deciders, one shared by inserters with the same windows
- generation: chains, loops and inserters taking turns at one machine get clocks with fewer wake-ups
- simulation: inserters taking from one machine are served in the game's order
- generation: a clock is stable only if it holds whichever inserter the game serves first
- generation: recovery is tried only on losses shorter than spoil times, stopping at the first failure
- ui: results say why an inserter is always on
- ui: losses in the results name their items
- ui: results group the combinators
- ui: results explain Fewest deciders
- generation: builds with long clock periods generate much faster
- ui: older sidecar captures picking up from a belt bend must be captured again

### Removed
- generation: clocks for a shorter period ("not in the period") are no longer offered

### Fixed
- generation: buffered outputs no longer make a working clock look unstable
- generation: chance-only products are planned at their average rate
- ui: the timeline shows a settled period

## [0.22.0] - 2026-10-24

### Added
- generation: a foundry feeding four assemblers, and other shared sources, now get a clock that holds
- generation: direct insertion builds now get a clock that holds and recovers
- generation: direct insertion builds no longer fall back to the slow search
- ui: the result says whether copies' drops onto a shared belt fit between each other
- ui: a note says when a belt's lanes are exactly full
- ui: the result lists copy spacings and inserter distances at which the drops fit
- ui: the result and editor warn when copies drop more hands than the belt holds

### Changed
- generation: clocks that do not hold are ranked by long-run output, not one period
- generation: a clock is stable only if every output belt gets what its consumers take
- ui: the result card says how much each output belt gets

### Fixed
- ui: Diagram and Swing Plan stop logging errors for belts with one item on both lanes
- ui: the clock timeline's header shows a rounded clock's rounded period

## [0.21.1] - 2026-10-23

### Fixed
- blueprint: making a large build's blueprint no longer fails with "Maximum call stack size exceeded"

## [0.21.0] - 2026-10-23

### Added
- ui: Sidecar 0.13.0 marks a drop onto a belt that side-loads onto another belt
- ui: the result names a drop onto a side-loading belt as a known limit
- ui: when no clock holds because an output chest fills up, the result names it

### Changed
- ui: the paste preview names each chest's type
- ui: the paste preview says "Imported as one unit" only for an export of several copies
- ui: the paste preview describes the inserters in the game's words
- blueprint: the wiring reference shows each combinator's first line and icons like the game, drills included
- ui: machines are picked from the row's machine icon, with groups, search and icons like recipes
- ui: a row says when its machine cannot make its recipe
- ui: Crafting Speed shows the machine's own speed at its quality
- ui: results show "Belt pickups: None" for a build without belt pickups
- ui: results note an inserter that is on for part of the period but never woken
- ui: a holding clock's first note no longer reads as a fault
- ui: clock details say how the clock was checked and how wake windows and swings differ

## [0.20.0] - 2026-10-23

### Added
- ui: cars, tanks, cargo wagons and rocket silos can be chests
- ui: car, tank, wagon and silo chests take mixed items, slot filters and quality
- ui: Sidecar 0.12.0 exports cars, tanks, cargo wagons and rocket silos
- simulation: slots filtered to No item or a Deconstruction planner stay blocked
- ui: the inventory editor can block every unfiltered slot at once
- ui: a mining drill can drop into a chest, car, tank, cargo wagon or rocket silo
- generation: a drill dropping into a chest is switched on just in time, not always
- blueprint: a drill dropping into a chest must be wired with Read resources off
- generation: a product can leave through the container its machine fills
- generation: a container shared by several machines gets a clock
- blueprint: each clock names the generator version and site that made it
- ui: a machine is picked by what it is and its quality
- ui: a machine's recipe picker lists only the recipes it can make

### Changed
- ui: the Type setting is gone, and older configs and exports still load
- blueprint: the clock's combinators describe what each switches on in plain terms, with icons
- blueprint: a one-tick window is now one combinator condition instead of two
- ui: each mining drill sets its own productivity, and older single-level configs and exports still load
- ui: the mining speed bonus is entered in percent
- ui: cars, tanks, wagons and silos are named by what they are, such as "Car 1"
- ui: the inventory grid draws filtered and blocked slots as the game does
- ui: a paste whose target is the export's maximum warns to lower it

### Fixed
- simulation: mining drills mine as in the game, including slow drills and productivity bonus timing
- simulation: a mining drill now fills a machine to the same limit as the game
- ui: the Diagram opens without freezing the page
- ui: a clock rounded down to whole ticks shows the rate it really runs
- generation: a rounded-down clock holds the target when it runs at most 0.1% fast
- generation: a clock whose recovery could not be tried is no longer selected over recovering clocks

## [0.19.0] - 2026-10-21

### Fixed
- simulation: belt pickups match the game for every belt speed, supply and supported pickup layout
- simulation: backed-up belts run out of reachable stacks and refill at belt speed
- simulation: an inserter arm's reach between grabs is now modelled
- simulation: inserters dropping onto a belt wait for real space on it at every belt speed
- simulation: a belt-fed inserter takes its first stack in the same tick as in the game
- generation: a belt-fed inserter no longer picks up an extra stack and over-produces
- simulation: a clock enables nothing in its first two ticks after placement, as in the game
- generation: stable verdicts are stricter for long-run output and recovery after a loss
- generation: moving input lanes are checked out of step as well as aligned
- generation: express moving undergrounds, over-the-hood two-ingredient builds, normal backed-up undergrounds and front exits get stable clocks
- ui: in Node, a config missing an inserter is refused, naming the missing inserters
- ui: inserter kind, quality and filter mode are read from Sidecar 0.11.0 captures
- ui: older captures, which ran every inserter as a legendary stack inserter, ask for a recapture

### Added
- ui: the result says why no clock is stable: lane phases, unrecovered losses or closest rate ([#288](https://github.com/abucnasty/clock-generator/pull/288))
- ui: belt pickups with stacks other than 4 or hands other than 16 are flagged untested
- ui: underground pickups name their layout: side or front entrance or exit, or over the hood
- ui: underground pickups entered by hand need a layout
- ui: older Sidecar underground captures need a recapture
- ui: Sidecar 0.11.0 captures pickups over an underground exit's hood and in front of an entrance
- ui: each pickup keeps its capture status through import and saving
- ui: an unclassified or unsupported capture must be recaptured before generating

### Changed
- ui: asking one belt lane for more than it carries is refused, showing the numbers
- ui: a lane over capacity only when all copies are counted gets a warning instead
- ui: belt pickups from a side-loaded tile are refused with the reason, like splitter pickups
- ui: belt pickups by any inserter but the legendary stack inserter are refused
- ui: inserter blacklist filters are refused with the reason
- generation: generating takes about a fifth less time than 0.18.0, but longer with moving belt pickups ([#244](https://github.com/abucnasty/clock-generator/pull/244), thanks blousy)
- ui: the one-swing clock can be inspected while the other potential clocks still run
- ui: the metallurgic science example now matches its build's machine speeds, inserter lanes and pack chest

## [0.18.0] - 2026-10-18

### Fixed
- simulation: moving belt pickups take from the stacks within reach, shorter at underground entrances and exits
- simulation: inserters fall back to the far lane when it carries the same item

### Added
- ui: each belt-fed inserter can be set to Straight belt or Underground belt in either editor
- ui: Sidecar 0.9.1 captures pickups and flags bends, splitters and inline pickups it cannot classify
- ui: imports and saved results show pickup coverage and the assumptions used for that run

### Changed
- simulation: a pickup without a length is treated as a straight belt
- simulation: underground pickups use a half-tile reach
- ui: input supply is set as Moving or Backed up, independently of pickup geometry
- ui: the older "Belts do not move" setting migrates on import
- ui: editing supply or pickup geometry marks previous results out of date

## [0.17.0] - 2026-10-17

### Added
- ui: several named builds can be kept in the browser, created, duplicated, renamed and switched
- ui: builds can be shared by link
- ui: edits, removals and whole-build replacements can be undone
- ui: compatible saved results are restored after a reload
- ui: each build's working views and page position are remembered
- ui: a run can be cancelled, keeping previous results or the clocks already found
- ui: a new build starts from an example, by hand, or from the Sidecar paste guide
- ui: import previews show what will be replaced
- ui: import previews suggest a target recipe, rate and Copies
- ui: verified repeated layouts can be simplified into one group plus Copies, with preview and Undo
- ui: selected inserters' stack sizes, filters and enable rules can be bulk-edited, including back to Automatic
- ui: panels show the selected clock's wake windows, machine activity, inventories, crafting cycles and item transfers
- ui: the build diagram replays recorded item flow and steps through a selected route's transfers
- ui: connected entities can be inspected from the build diagram
- ui: the selected clock workspace can open fullscreen and switch clocks there
- blueprint: a dedicated installation guide and wiring reference are added
- simulation: infinity chests support Remove unfiltered items, including empty ones removing everything
- ui: Sidecar 0.8.0 exports Remove unfiltered items
- ui: Sidecar 0.8.0 reads infinity chests' configured filters instead of current contents

### Changed
- ui: the Clock Generator page has a fresh, reimagined design
- ui: Configure uses one compact Build layout, with category help and entity settings on demand
- ui: machine rates can show maximum capacity or their share of the target output
- ui: results lead with the selected clock and explain its selection and assumptions
- ui: clock comparison, deeper searches and developer details stay available on demand
- ui: Generate checks the current build first
- ui: Check only inspects the plan, without generating clocks
- ui: validation points to the problem and shows machine capacity when the target is too high
- ui: validation offers connection and chest repairs
- ui: a final buffer chest that can fill up gets a warning
- ui: the warning offers converting to an infinity chest or enabling an existing one's disposal
- ui: chest and missing-connection problems share one validation flow
- ui: item and recipe pickers show searchable game names and icons
- ui: entity pickers group and filter by type
- ui: enable-rule editing adds plain-language summaries, timing previews and context-aware templates
- ui: enable-rule editing confirms before replacing or discarding drafts
- ui: results from an earlier build are marked, with what changed
- blueprint: copying the blueprint of an earlier build's results asks for confirmation
- ui: Generate and Copy are highlighted as the next step in a responsive sticky toolbar
- ui: messages no longer cover the editor
- ui: light and system themes are added under More options, with dark as the default
- ui: diagrams use a shared tile grid
- ui: keyboard focus, accessible control names, chart patterns and narrow-screen layouts are improved

### Fixed
- ui: each finished generation shows its new selected clock, also after switching builds
- ui: empty infinity chests keep their inserter connections on sidecar import
- ui: custom enable rules, fractional Copies and automatic inserter capacity survive editing and imports
- ui: Backspace in an editor no longer deletes the selected inserter
- ui: diagram routes avoid node overlaps and separate shared paths
- ui: selection and replay stepping follow connected routes consistently
- ui: diagram transfer quantities show only at the recorded transfer tick
- ui: opening a category picker reveals the current selection
- ui: fullscreen floating labels stay below the tabs
- ui: the footer no longer hides page content

## [0.16.0] - 2026-10-16

### Added
- generation: shorter-period clocks are offered where one ingredient lengthens the period, like Thaeln's cell at 480/s
- generation: a config-only override names clocks that reach the target from some starts only
- ui: an inserter dropping onto a shared moving lane can name its lane and position

### Changed
- generation: clocks are judged from the game build's start, with belts full and machines empty

### Fixed
- simulation: a belt-fed inserter whose window opens on a full machine starts a tick later
- simulation: a machine puts out held products as soon as there is room
- simulation: inserters taking from one machine take turns, as in the game

## [0.15.2] - 2026-10-16

### Fixed
- ui: sidecar 0.7.1 exports belts carrying the same items on opposite lanes as two belts
- ui: the generator asks for sidecar 0.7.1

## [0.15.1] - 2026-10-16

### Fixed
- ui: machine facts show the right output block, such as 146 for a cryogenic plastic plant
- generation: output feeders and output-block conditions use a machine's output block when it exceeds a stack

## [0.15.0] - 2026-10-15

### Changed
- ui: Copies may be a fraction, such as 5.5, for a partial block
- ui: the chemical science samples are replaced by one shared-foundry block at 5.5 copies

## [0.14.0] - 2026-10-15

### Changed
- simulation: game data now comes from Factorio 2.1.21
- ui: the calls header shows the game version
- ui: unsupported builds are refused with the reason and the roadmap item that adds them
- ui: inserters dropping onto a belt or into a chest may filter any item
- ui: inserters can name their kind and quality
- ui: an inserter's stack size is now optional
- simulation: belt timing is not yet checked for inserters other than the legendary stack inserter
- ui: a config repeating one unit several times is refused, asking for one unit and Copies

### Fixed
- generation: long chains no longer fail with "Invalid input format"

## [0.13.0] - 2026-10-15

### Changed
- simulation: an inserter waiting to fill a machine now counts as woken when a craft starts
- ui: wake-ups shown for builds with productivity mostly fall, without changing any selected clock
- ui: game recordings show the same wake-up count, and how far each machine's reading is checked

## [0.12.1] - 2026-10-15

### Changed
- ui: the clocking advice is now also confirmed on the advanced circuit electromagnetic plant

## [0.12.0] - 2026-10-15

### Changed
- ui: clocking advice counts an input inserter as woken when its machine starts a craft
- ui: clocking advice now leaves unwired below 53 wake-ups a minute, marginal between 53 and 175.7
- ui: each group still shows the 0.11.0 count and call beside the new one
- ui: each group says how far its wake-up count has been checked against the game

## [0.11.0] - 2026-10-14

### Added
- ui: each group of inserters gets update-time advice: "clock" or "leave unwired", firm or marginal
- ui: the advice compares the selected clock with every inserter always enabled, or two game recordings

## [0.10.0] - 2026-10-14

### Added
- generation: the "Even hands" potential clock spreads one window per hand evenly over the period
- blueprint: in Even hands, inserters moving the same hands per period share one window decider
- generation: Even hands skips builds with mining drills, machine loops, or fuel or by-product inserters

### Fixed
- generation: fractional swings no longer fails with "maximum allowed is 2 due to insertion limits"

### Changed
- generation: accumulators at 640 a second now select Even hands, with far fewer wake-ups ([#152](https://github.com/abucnasty/clock-generator/issues/152))
- generation: chemical science with moving belts now selects fractional swings, halving its wake-ups
- generation: utility science with direct-insert low density structures on still belts selects fractional swings

## [0.9.1] - 2026-10-14

### Fixed
- simulation: inserters between machines feeding each other directly now wait as in the game
- generation: accumulators at 640 a second and similar direct-feed builds get a clock holding in-game ([#152](https://github.com/abucnasty/clock-generator/issues/152))

### Changed
- generation: agricultural science selects batched swings again, with fewer wake-ups than its 2-swing clock
- generation: agricultural science's egg inserters to the science biochamber are no longer clocked
- generation: utility science with direct-insert low density structures, chain always on, selects uneven output swings

## [0.9.0] - 2026-10-14

### Changed
- ui: a broken file imported as a config is refused, saying what is wrong
- ui: an import with fixable problems, like an unset inserter end, loads with them marked red
- ui: the browser tab says "Factorio Clock Generator"
- ui: the generator asks for sidecar 0.7.0
- ui: sidecar 0.7.0 leaves out an inserter whose source or target is not exported
- ui: the sidecar's export window lists the inserters left out and why
- ui: sidecar 0.7.0 no longer crashes the game on an assembling machine without recipe or lab
- ui: a paste from sidecar 0.6.0 still imports, noting the mod can be updated

### Fixed
- ui: removing a machine, belt or chest unsets the inserter ends and drill targets at it
- ui: a removed entity's id is no longer given to the next one added
- ui: an unloadable saved configuration is kept as a browser backup, and the page says so
- ui: the page shows an error when it cannot start, instead of loading forever

## [0.8.0] - 2026-10-12

### Added
- generation: a "Search for fewer wake-ups" switch runs all four searches and selects the fewest wake-ups

### Changed
- generation: the four searches now run only when no other potential clock is stable, generating faster
- ui: the Potential Clocks panel says when the searches were left out
- ui: the Potential Clocks panel says a clock's wake-ups are counted from one start

## [0.7.0] - 2026-10-11

### Changed
- generation: full-hand output swings are no longer ranked first on machines with spare speed
- generation: of two equally near clocks, the one not drifting from a clean start is selected
- generation: observed windows, uneven, shifted and full-hand output swings are now searched more thoroughly
- generation: generating takes about 15% longer

## [0.6.1] - 2026-10-11

### Changed
- generation: every sample build still gets the same potential clocks, windows and selected clock as 0.6.0
- ui: the sidecar mod now has its own version, staying at 0.6.0 with no update needed

## [0.6.0] - 2026-10-10

### Added
- simulation: biochambers are supported, with a fuel slot and nutrients burned only while crafting
- ui: machine facts show fuel use
- ui: a machine can set its energy consumption bonus and fuel
- generation: fuel inserters get a clock of their own, enabled as seldom as is safe
- ui: a Fuel results tab shows burn rates, fuel clocks and each machine's fuel held
- simulation: an item can be both ingredient and fuel, like nutrients in a pentapod egg biochamber
- ui: validation reports a missing fuel inserter
- simulation: recipes with more than one result, such as jellynut processing, are supported
- generation: an inserter that only takes a by-product away gets a clock of its own
- simulation: recipes that make their own ingredient, like pentapod egg, and machine loops are supported
- generation: loop inserters stay always enabled, except the one feeding the output machine
- ui: results warn that a loop must already hold its item and cannot be restarted
- ui: each potential clock lists its wake-ups a minute
- ui: insights break each clock's wake-ups down by inserter
- ui: a Belt column names whether each potential clock is for moving or non-moving belts
- generation: a subtick clock is always made for non-moving belts
- generation: a "Belts do not move" switch makes clocks without belt pickup slack
- generation: an inserter taking fuel off the belt too gets window room for a fuel hand
- simulation: an inserter taking two items off one belt takes from its nearest lane first
- ui: a belt's nearest lane is set in the inserter's panel or exported by the sidecar
- generation: clocks are tried against a stopped input and an output not taken away
- ui: non-recovering clocks are listed "No recovery", with the losses that break them
- generation: a "No recovery" clock is selected only when no clock recovers
- generation: recovery checks make generating take up to a fifth longer
- ui: a deadlock risk warning appears where one of two same-item inserters brings another item too
- blueprint: copying a blueprint of a build at deadlock risk warns
- generation: on a deadlock-risk build, the recovery verdict is shown but does not decide selection
- generation: when no clock holds the target rate, the nearest one is selected
- blueprint: copying an off-target clock's blueprint warns of the rate it runs at
- blueprint: every blueprint has a lock combinator that holds all inserters off and restarts the clock
- blueprint: blueprints record their target rate in the description and on the clock combinator
- blueprint: combinator descriptions name their recipes and what each modulo and subtick combinator does
- ui: potential clocks show their output swings per cycle and the rate they achieve
- ui: the timeline shows each entity's state as Factorio names it, including "no fuel"
- ui: a paste from an older sidecar names what it lacks and asks once to update

### Changed
- generation: the selected clock is the stable one with the fewest wake-ups, not fewest windows
- generation: a clock without belt pickup slack is selected only when none with slack holds
- ui: "Planned + belt pickup slack" is now "Batched swings", and "Planned" "Batched swings, non-moving belt"
- blueprint: a switched-off clock now enables nothing, counting from 1 instead of 0
- blueprint: generated blueprints now need Factorio 2.1
- generation: every potential clock is confirmed with a long run, catching drift a one-period check missed
- simulation: inserter states, belt pickups into full machines and inserter timing now match Factorio 2.1.21
- simulation: an output block larger than a stack now matches Factorio 2.1.21
- generation: full-hand output swings are searched for in more cases
- generation: full-hand output swings rank first where a machine has at least 5% spare speed
- generation: more output swing counts are offered when batched swings backs off to a lower count
- ui: a missing inserter in the transfer plan is named, not "No value found for key"
- ui: insights show where the clock swings off-plan as a lane chart, not tick lists

### Fixed
- blueprint: an always-enabled inserter or mining drill gets no combinator and is checked always on
- generation: a whole-tick clock period is no longer offered as a subtick clock
- simulation: a craft starts whatever its machine's output holds
- simulation: the output block only stops inserters bringing more
- simulation: a full productivity bar pays out when a craft finishes
- generation: an item needed at two levels of a chain is no longer counted twice
- generation: an output machine with several output inserters is counted by all of them
- simulation: inserters move at most what the item stacks to
- simulation: inserters waiting on one machine together take turns
- generation: an inserter keeps a window for a hand in flight when the clock period starts
- blueprint: combinator descriptions are cut to the 500 bytes Factorio keeps

### Removed
- ui: HOCON configurations are no longer supported, only JSON

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
