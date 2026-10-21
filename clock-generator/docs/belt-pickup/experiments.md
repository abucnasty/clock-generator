# Belt pickup experiment findings

[Belt pickup documentation](README.md)

This report summarizes the belt-pickup experiments, their timing patterns and simulator impact. Detailed
measurements, screenshots and reproduction commands remain in the [mechanics fixtures](../../tests/game/mechanics/belt-pickup/README.md).
The [simulator guide](../simulator.md#picking-up-from-moving-belts-and-underground-endpoints) defines supported behavior.
The [diagram glossary](glossary.md) illustrates the layouts and test conditions named in the tables,
including a [phase A vs phase B example](glossary.md#phase-a-vs-phase-b).

The accepted changes are unreleased, reserved for **engine/UI 0.19.0** and **Sidecar 0.11.0**.
Publishing remains on hold. **Side-loaded pickup tiles, merges and splitters are out of scope**; see the
[side-loading history](#side-loaded-pickups-and-merges).

## General rules

- Collect an ingredient the destination accepts, preferring the configured lane. Keep collecting the held
  ingredient. A missing ingredient on the other lane does not automatically override eligible preferred stock.
- Take at most **one reachable stack per tick**. Use the upstream-most matching stack on the preferred lane,
  falling back to the other lane for the same item when needed. No universal lane-switch delay was found;
  the calibrated arm-reach model accounts for position-dependent delays between grabs.
- Straight belts expose **one tile per lane**; underground endpoints expose **half a tile**. Moving stacks,
  holes, partial stacks and lane phase persist across hands and circuit windows. Underground pickups have
  less reach, rather than a fixed tick penalty.
- Geometry and supply motion are separate. Omitted `pickup_length` defaults to **1**; undergrounds use **0.5**.
  Moving is the default. Ordinary backed-up supply retains finite stock, stops stacks at the endpoint and
  refills holes at belt speed.
- Replenishment depends on topology. Closing a final outlet does not guarantee permanent local saturation when
  other consumers can reopen a route.

## Belt-speed coverage

**Tested** means native measurements are documented for the named scenario; it does not mean every phase,
orientation or topology is verified, or that the simulator supports it. **Not tested** marks combinations
without documented native evidence in this investigation. A suffix identifies an unresolved limitation:

- **simulator timing mismatch**: the production simulator predicts different grab ticks from the game.
- **generator result mismatch**: the generator's rate or stability assessment disagrees with the game.
- **no verified moving default**: the selected fallback requires backed-up supply and misses the target
  with moving supply; it is not a verified default for that setup.

Remove a mismatch suffix once the corrected model passes the corresponding native regression; the status then
becomes **Tested**. Plain **Tested** records coverage with no additional disagreement flagged here; it does not
imply every model detail was compared.
Normal means the standard transport-belt speed.
Offline expectations and classifier-only checks do not count as native timing coverage. The speed backfill uses
16-item hands and four-item belt stacks, and so does every native clock control: belt pickup timing is calibrated
there only. Historical smaller-hand/interrupted-window/staggered-lane controls are not an exhaustive cross-speed
matrix. Pickup from one- to three-item belt stacks and with hands other than 16 is **Not tested**
([below](#belt-stack-sizes-and-hand-sizes)).

### Side pickups

The [side pickups](glossary.md#side-pickups) category covers a straight belt, underground entrance and
underground exit. “All three geometries” refers to those variants, with the inserter beside the belt.

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Moving, one matching lane — all three geometries | Tested | Tested | Tested | Tested |
| Moving, same item on both lanes — all three geometries | Tested | Tested | Tested | Tested |
| Backed up, each ingredient isolated — all three geometries | Tested | Tested | Tested | Tested |
| Backed up, same item on both lanes — side pickups | Tested | Tested | Tested | Tested |
| Reflected side pickups, same item — moving, initial belt phase | Tested | Tested | Tested | Tested |
| Reflected side pickups, same item — backed up | Tested | Tested | Tested | Tested |
| Backed-up straight-belt demand / insertion-limit controls | Tested | Tested | Tested | Tested |

### Front-facing and over-the-hood pickups

These rows cover the measured front approaches and both mirroring states.

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Front exit, backed up — different and same items | Tested | Tested | Tested | Tested |
| Over-the-hood exit, moving — different items | Tested | Tested | Tested | Tested |
| Over-the-hood exit, moving — same item on both lanes | Tested | Tested | Tested | Tested |
| Over-the-hood exit, backed up — different and same items | Tested | Tested | Tested | Tested |
| Front entrance, moving — different items | Tested | Tested | Tested | Tested |
| Front entrance, moving — same item on both lanes | Tested | Tested | Tested | Tested |
| Front entrance, backed up — different and same items | Tested | Tested | Tested | Tested |

The downstream front-exit fixture places the inserter on the next belt tile, physically blocking continuation.
The supplied over-the-hood exit is a separate approach: its inserter sits upstream and leaves the downstream route open.
Production collection and exposed stock agree with all 258 first-hand controls. Sidecar now captures
`over-hood-exit`, half-tile reach and mirroring-selected preference with model format 2. Old unsupported
captures remain unsupported and require recapture.
Normal moving front-entrance controls use a paired compact assembler layout: the original plant needs a tunnel
longer than normal underground range. Equivalent compact controls were also measured at the other speeds.
Front-entrance phase sweeps verify actual first-grab positions, rather than assuming gate-delay labels imply
distinct phases. Other cardinal orientations and arbitrary lane-to-lane phase offsets remain separate dimensions.
The separate [over-the-hood exit](../../tests/game/mechanics/belt-pickup/fixtures/over-the-hood-underground-exit/README.md)
has 84 baseline controls: 48 compact cases across all four speeds and 36 original-plant counterparts at
turbo/express/fast. Another 174 moving controls cover the observed aligned arrival phases at both mirroring
states with original/swapped/same-item lanes. Normal's original seven-tile tunnel exceeds its range.
These are 258 first-hand controls; independent lane alignment and repeated throughput remain separate questions.

### Belt stack sizes and hand sizes

Every pickup row above is a legendary stack inserter with a 16-item hand on four-item belt stacks. Drops onto a belt
were measured at stack sizes 1–4 ([below](#generated-clocks-and-drops)); pickups were not.

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Pickup from 1-, 2- or 3-item belt stacks, any geometry and supply | Not tested | Not tested | Not tested | Not tested |
| Pickup with a hand other than 16 (an inserter `stack_size`, or an item that stacks to less), any geometry and supply | Not tested | Not tested | Not tested | Not tested |

The same-item probes' 8- and 12-item hands ([calibration](../simulator.md#picking-up-from-moving-belts-and-underground-endpoints))
matched subsequent grabs when seeded with the observed first grab, on moving turbo and express belts of four-item
stacks; they cover no other speed, no backed-up supply and no clock, so these rows stay Not tested. A config with
such a pickup is generated, not refused: the log, the clocks' insights and the web form's Build validation warn that
its timing is not tested. Measuring them is follow-up F7.

### Generated clocks and drops

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Electromagnetic clocks, all three geometries: moving/backed-up throughput and recovery | Tested | Tested | Tested | Tested |
| Same-item gear clocks, all three geometries: throughput and recovery | Tested | Tested | Tested | Tested |
| Over-the-hood mixed-item clocks, both mirroring states and supplies | Tested | Tested | Tested | Tested |
| Over-the-hood same-item clocks, both mirroring states and supplies | Tested | Tested | Tested | Tested |
| Front entrance clocks, both families, mirroring states and supplies | Tested | Tested | Tested | Tested |
| Front exit clocks, backed up, both mirroring states | Tested | Tested | Tested | Tested |
| Front exit clocks on a moving config (the belt backed up in the game), both mirroring states | Tested | Tested | Tested | Tested |
| Belt drops, finite source and retained output stock, stack sizes 1–4 | Tested | Tested | Tested | Tested |
| Occupied output: landing cutoff, stack size 4 | Tested | Tested | Tested | Tested |
| Blocked output behind a belt drop, chest-fed: throughput and recovery, stack sizes 1–4 | Tested | Tested | Tested | Tested |

The ordinary clocks are verified on **48 configurations** across all four speeds
(`tests/game/builds/pickup-clock-controls.json`, each entry with the PR that recorded it): the recapture after the belt
window-end trim (#265), with the 20 electromagnetic clocks the belt hand's resume fix changed recorded again (#266), the
fast straight moving clock the belt-fed window rule changed recorded once more (#267), the two express moving
underground clocks #269 changed, and the two normal backed-up underground clocks #275 changed.
**All 48 meet exact baseline and recovery output**, 44 of them marked stable; the turbo moving straight clock no longer
over-produces in its early periods. The two normal moving
underground defaults hold their baseline in these warm recordings and got back to target after every loss, but the
generator says "unstable": it finds the clock failing from cold lane phase [3,0], and a native sweep of all 64 lane
phases shows the game never settling from it or from four other phases, the exit's natural one among them, where
it cycles at 143 a period against 176 (`tests/game/builds/lane-phase-controls.json`, #266).
The two normal backed-up underground defaults are the clock planned with the belts moving, given belt pickup slack
and checked on the backed-up belts (#275): 176 in every baseline period and after every disturbance. A backed-up belt
at normal speed refills the pickup slower than a stack a tick, so every clock planned for backed-up supply closes its
windows before the hand is full; the fractional clock selected before missed natively (128, 128, 96 against 176),
matching its holds false. The generator makes the moving-belt clock last, only when no other clock can be selected as
stable. Their fully jammed cold-start controls alternate 144/208 items at offset 1287 as fixed-window simulator
checks. The two express moving underground defaults are
observed windows at 3 output swings, made for moving supply (#269): exact baseline and recovery in the game, while the
generator says "no recovery", its loss trials failing from lane phase [1,5] alone, which the capture cannot set up
(`lane-phase-controls.json`). Through this half-tile pickup the game moves 704 to 716 a period with
every inserter always enabled, the plant's own limit: the pickup was never the bound. The clock before, made for
backed-up supply, moved 352 a period under moving supply, in the model as in the game. The #265 recapture's own clocks (43 of 48 exact,
41 stable), the earlier post-fix recapture (#253: 46 of 48 exact, 42 stable after the lane-phase audit) and the original
39 recordings (#245) remain separate historical evidence (`tests/game/builds/pickup-clock-history-controls.json`). The belt-drop rows also compare finite receiving stock, including the normal-speed second hand.

The front clocks are verified on **48 configurations** (`tests/game/builds/front-clock-controls.json`, #274): the
front entrance on the owner's compact assembler scaffold (32: both families, mirroring states and supplies) and the
front exit on the electromagnetic plant, backed up (8) and on a moving config (8). All 48 are exact in baseline and
recovery. All 32 entrance clocks are stable. The backed-up exit's are stable at every tier; at normal, in both
mirroring states, every clock planned for backed-up supply fails (the fractional clock selected before, holds false,
missed natively, 128, 128, 96 repeating against 176, the generator's own as-built repeat), and the selection is the
clock planned with the belts moving and checked on the backed-up belts (#275), the same clock the moving config gets,
which moves 176 in every period. **A moving config on
the front exit is safe on this layout:** the input stands on the exit's output tile, so the belt is backed up in the
game whatever the config says, and the clock made for moving belts holds and recovers exactly at every tier. That
includes the express clocks the generator calls "no recovery" and the normal ones it calls "unstable", both judged
from moving lane-phase starts ([1,5] or [5,1]; [0,3]) this exit cannot have; at normal it moves the 176 the
backed-up config's own clock misses.

**Recovery through a blocked output** is verified on **16 configurations**
(`tests/game/builds/blocked-output-clock-controls.json`, recorded 2026-10-21): iron gears in a legendary assembler 3
(crafting speed 3.125) fed from an infinity chest, its output inserter dropping onto a belt that runs ten tiles to a
loader, at every tier and belt stack size 1–4 (the force's `belt_stack_size_bonus`, set as the belt-drop calibration
sets it; the chest-fed input keeps the stack size away from any pickup), 5 gears a second. The loader is removed for 24
periods. All 16 selected clocks are stable and exact in their 63 baseline periods and in all 33 periods after the
release; the hand is 15 at stack size 3. **The simulator holds the output inserter from the tick its belt stops taking
the product; the game first fills the belt behind the drop.** The ten-tile lane takes about 39 stacks: 9 to 39 more
items at stack size 1 (part of the lane is already in flight), 62 to 78 at 2, 102 to 117 at 3 and 140 to 156 at 4, so
output stops one to ten periods into the block. The 104 belt-output clock controls above (the electromagnetic side
pickups, over the hood and the front clocks, all at stack size 4) buffer 112 to 192 items. Replayed in the simulator on
the game's own schedule, the 120 recordings differ in the blocked periods and just after the release, where the
simulator makes up the machine's surplus that the game had already put onto the belt: both are back at the expected
output within a few periods (the game 0 to 5 periods after the release period, the simulator 1 to 6, neither always
first), and every period the captures judge, from 6 or 10 periods after the release, is the same number in game and
simulator in all 120 (the four that miss there miss alike). The generator's own loss trials, run with a belt that
fills to an outlet 10 or 25 tiles past the drop (a scratch rule patch), change no selected clock, selection, or verdict
of any alternative in the 208 sample and fixture jobs of the blast, nor in these 16 configurations: no verdict depends
on the instant hold, and the simulator keeps it ([simulator](../simulator.md#a-stack-inserter-dropping-onto-a-moving-lane)).

## Tick-pattern matrix

The [visual timing reference](timing.md) plots these measured patterns as grab-by-grab timelines
with total collection time, alongside the [layout glossary](glossary.md).

Unless stated otherwise, these are **grab offsets from the first grab of a hand**, with four-item belt stacks
and a 16-item inserter hand. Each number is one stack pickup: `0,1,2,4` means the fourth grab waits one tick.
Measurements use Factorio **2.1.21** and legendary stack inserters; speeds are identified below. Patterns
describe the measured conditions, rather than every startup phase or an absolute arm-arrival time.

Total pickup ticks counts both the first and last grab ticks: `0,1,2,3` takes **4 ticks** and `0,1,2,4`
takes **5 ticks**. It includes waits between grabs, but excludes waiting before the first grab and travel to/from
the destination. **Moving = false** denotes backed-up supply.

### Side pickups

| Scenario / speed | Moving | Lane contents | Measured offsets | Total pickup ticks | Interpretation |
| --- | --- | --- | --- | --- | --- |
| Straight, turbo/express | true | One matching lane | `0,1,2,3` in the measured phase | 4 | Later phases/holes remain explicit state |
| Underground side pickups, turbo | true | One matching lane | `0,1,2,4` or `0,1,3,5` | 5 or 6 | Half-tile reach |
| Underground side pickups, express | true | One matching lane | `0,1,2,5`, `0,1,3,5` or `0,1,3,6` | 6 or 7 | Representative repeated patterns |
| Side pickups, fast / normal | true | One matching lane | Depleted hands include `0,1,4,8` / `0,8,16,24` | 9 / 25 | Belt-speed refill limits collection |
| Side pickups, turbo/express/fast | true | Same item on both lanes | `0,1,2,3` in measured controls | 4 | Fallback fills preferred-lane gaps |
| Side entrance, normal | true | Same item on both lanes | First hand `0,1,3,4` | 5 | Observed arm travel; the arm-reach model also predicts `0,1,3,4` |
| All geometries, turbo/express | false | Each ingredient isolated | `0,1,2,3` | 4 | Measured full-supply controls |
| Underground, fast / normal | false | Each ingredient isolated | First hand `0,1,2,5` / `0,1,2,9` | 6 / 10 | Finite refill already affects first hand |
| Side straight, normal | false | One matching lane | First `0,1,2,3`; later `0,8,16,24` | 4, then 25 | Initial stock masks later depletion |
| Underground, fast / normal | false | Same item on both lanes | First `0,1,2,3` | 4 | Other lane helps; normal later hands can still wait |

### Front-facing and over-the-hood pickups

| Scenario / speed | Moving | Lane contents | Measured offsets | Total pickup ticks | Interpretation |
| --- | --- | --- | --- | --- | --- |
| Front entrance / over-hood exit, turbo | true | Different items | `0,1,k,k+2`, `k = 2..3` | 5–6 | Both observed arrival phases |
| Front entrance / over-hood exit, express | true | Different items | `0,1,k,k+d`, `k = 2..4`, `d = 2..3` | 5–8 | Eight observed arrival phases |
| Front entrance / over-hood exit, fast | true | Different items | `0,1,k,k+4`, `k = 2..5` | 7–10 | Four observed arrival phases |
| Front entrance / over-hood exit, normal (compact) | true | Different items | `0,1,k,k+8`, `k = 2..9` | 11–18 | Eight observed arrival phases |
| Front entrance / over-hood exit, all speeds | true | Same item on both lanes | `0,1,2,3` | 4 | Every measured phase; no arm-travel delay, unlike the normal side entrance |

These are representative patterns, not an exhaustive list of repeated-hand states. The fixture baselines retain
all observed patterns and known simulator differences. In these tested front and over-the-hood layouts, **unmirrored prefers
lane 1; mirrored prefers lane 2**, preserved by ingredient swaps. Fast/normal backed-up front controls can use
fallback even on the first hand; the turbo rule that all four grabs stay on the preferred lane is not universal.
Continuous moving supply is blocked in the downstream front-exit fixture; over-the-hood exit pickups are a separate case.

### Over-the-hood underground exits

The inserter sits upstream of the exit and reaches across its hood, leaving the downstream route open.
Its moving phase sweeps follow the same half-tile pattern families as the front entrance in the matrix above.
Both observed lanes cover 2/8/4/8 arrival phases at turbo/express/fast/normal for every measured layout,
mirroring state and ingredient arrangement. Fast/normal backed-up first hands use same-item fallback for their
fourth grab, consistent with the finite-refill controls.

Independent moving-stock replays agree with all **216 moving first hands**; the production backed-up queue
agrees with all **42 backed-up first hands**, conditioned on native arrival; from placement, with no arrival given,
the whole simulation reproduces all 42 and all 216 moving ones as well ([startup](#startup-from-placement)). Production pickup-mode comparisons
also match held items, quantities and exposed stock for all 258 controls. Sidecar captures the explicit
over-the-hood layout. First-hand agreement does not establish generated-clock parity: the operating-clock
controls below expose a recovery failure when the lanes acquire different phases.

### Related belt-drop calibration

These are **deposit offsets**, not pickups. The original turbo table is below. A finite 32-item source feeds the belt; only the belt-stack
bonus changes, with researched technologies checked unchanged.

| Belt stack size | Effective full hand | First-hand deposit offsets | Next hand's first deposit, relative to the first hand's start |
| --- | --- | --- | --- |
| 1 | 16 | `0,1,2,4,6,…,28` | 36 |
| 2 | 16 | `0,1,2,4,6,8,10,12` | 20 |
| 3 | 15 | `0,1,2,4,6` | 14 |
| 4 | 16 | `0,1,2,4` | 12 |

The four-speed backfill covers all **16 speed/stack-size combinations** and conserves all 32 items every tick.
Every first hand matches `Belt::amountToDropAtTick`. Stack size 3 leaves two items held after depositing 30.
At normal speed, the second hand can encounter three stacks left on the receiving tile: its deposit offsets become
`0,8,16,…`, losing the initial two-tick burst. This occupied-tile case is retained separately from the empty-belt
calibration. Runtime now retains output stock and admits deposits only when space is available, reproducing
both hands at every speed/stack size. A further 28 occupied-output recordings check the strict landing cutoff
and temporary compressed gaps. Across 44 portable clips, the simulator matches every source quantity, held
quantity and receiving-tile position for 9,120 ticks from a disabled start. This validates freely draining output;
recovery through a blocked output is measured on generated clocks ([above](#generated-clocks-and-drops)).

## Simulator impact and verification

**Reach and fallback.** Replacing the always-full underground assumption selected **352 electromagnetic packs /
704 ticks = 30/s**, verified on all three turbo scaffolds with at least 60 periods and recovery interventions.
The former 528/1,056 clock missed 30/35 native periods underground. Same-item fallback also reduced the gear
clock's underground input window from 28 to 26 ticks; all six turbo/express checks held **16 gears / 160 ticks = 6/s**.

**Four-speed collection.** All 72 naturally supplied repeated-hand controls and 24 reflected same-item controls
now match production held counts. The finite-stock model resolves refill discrepancies; the radial collection
model resolves the normal side-entrance delay. All 198 observed arrival-phase controls match production too.
Sixteen fresh normal entrance controls verify all eight phases from both physical near sides.
The backed-up stock comparison below also checks lane positions, counts and items.
Twelve automated demand controls preserve the existing rule: eligible near stock 13 wins over absent far stock;
at near stock 14, selection switches to the far ingredient. No demand-ranking rule was needed.

**Implemented ordinary backed-up rule.** Advance a jammed queue at actual belt speed, stop its head at the endpoint,
maintain quarter-tile spacing, and withdraw the upstream-most reachable matching stack. Preserve holes across
hands. Seeded once at the closed gate, the production queue matches all exposed stock and held counts across
**59,328 transitions / 4,568 hand starts** in 48 side-pickup captures, including both physical near sides. That comparison
takes the game's arm arrival and drop; the [startup replay](#startup-from-placement) predicts them. Ten portable clips exercise the production pickup logic and preserve refill evidence; five separate clips
preserve the arm-travel evidence and exercise production reach and stock. See the [fixture report](../../tests/game/mechanics/belt-pickup/fixtures/different-items/README.md).

**Arm reach.** In the calibrated legendary stack-inserter model, extend or retract toward the selected stack
at 0.25 tile per tick; collect when it is within one further extension step, then snap collection reach to that
stack. Four normal entrance phases need an extra tick to cross to the far lane; the other four do not. Layout
places those stacks relative to the pivot. Keep partial-hand reach through control replacement and pauses,
and include it in repeat detection only while it can affect another grab. This models collection after arrival,
not the complete swing or rendered hand coordinates. The stock-only reference replay intentionally retains
its former four counterexamples; production comparisons are separate.

**Front controls.** The 228 first-hand captures verify lane preference across ingredients, mirroring, speeds
and observed entrance phases. Normal moving entrance coverage uses the paired compact destination. The
downstream front-exit fixture blocks continuous flow; the over-the-hood exit is documented separately.
Its 258 controls reproduce the lane preference and finite-stock rules across observed aligned phases.
The production model matches collection and stock, and Sidecar now exports a supported explicit layout.

**Generated clocks.** The post-fix recapture uses one sustained baseline and three effective disruptions
per configuration, without resetting machines or clocks. Each has 63 baseline periods; compact counts agree
with two overlapping detailed recorder periods. Electromagnetic targets scale with speed: 30/s turbo,
22.5/s express, 15/s fast and 7.5/s normal; gear targets remain 6/s.

| Clock / speed | Moving | Generator verdict | Expected per period | Native baseline and recovery | Finding |
| --- | --- | --- | --- | --- | --- |
| Express undergrounds | true | No recovery (lane phase [1,5]) | 528 / 1,408 ticks | 528 throughout | Observed windows at 3 swings, made for moving supply (#269); unclocked bound 704–716 |
| Fast undergrounds | false | Stable | 176 / 704 ticks | 176 throughout | Historical shortfall resolved |
| Normal straight | true | Stable | 176 / 1,408 ticks | 176 throughout | Historical shortfall resolved |
| Normal straight | false | Stable | 176 / 1,408 ticks | 176 throughout | Historical shortfall resolved |
| Normal undergrounds | false | Stable | 176 / 1,408 ticks | 176 throughout; fully jammed cold offset 1287 (fixed windows): 144/208 | Planned with the belts moving, checked on the backed-up belts (#275); every clock planned for backed-up supply misses |
| Normal undergrounds | true | Unstable | 176 / 1,408 ticks | Warm: 176 throughout | Historical recovery alternation resolved; a modeled cold lane-phase start alternates 192/160 and has not been reproduced natively |

All 24 gear configurations hold 16 gears / 160 ticks through their baseline and recovery windows. Forty-four
ordinary defaults are correctly marked stable, the two normal backed-up undergrounds among them since #275; the two
normal moving undergrounds are rejected on lane phases the game fails from too (#266), and the two express moving
undergrounds keep a cautious "no recovery" from a lane phase the capture cannot set up (#269). Four
additional cold-start controls cover both normal backed-up undergrounds at offsets
0 and 1287, matching all 16 output periods each. A full lane can still move: these controls verify stationary
initial stock and empty machines/hands before comparing the simulator. The [build report](../../tests/game/builds/README.md)
links current controls and preserves the original 39-run summaries. Broader startup timing remains a separate
verification gate; warm throughput alone does not establish it.

**Over-the-hood clock recovery.** The earlier mixed-item turbo default produced 64 circuits per 640 ticks before an
interruption, in both mirroring states. After one ingredient is interrupted, recovery repeatedly contains
one 48-item period among four 64-item periods, despite the generator's stable verdict.
The [bounded native trace](../../tests/game/builds/lane-phase-controls.json) shows the interrupted
lane shift by half a stack interval while the other lane keeps its phase. The existing pickup kernel reproduces
this output pattern with separate lane phases. The mirrored express default similarly recovers to 96/112
rather than 112 items per 1,120 ticks. Clock verification now varies lane phases for both output and recovery.
The [32 operating controls](../../tests/game/builds/over-hood-clock-history-controls.json) (#254) cover all four speeds, both
mirroring states and supplies, and same/different ingredients: 21 meet exact baseline and recovery output,
including all 16 same-item cases; eight already receive unstable/no-recovery verdicts; these three receive
false stable verdicts in that historical capture. Two fast moving mixed-item baselines already contain zero-output
periods, so their recovery counts are retained without certifying recovery.

The [replacement controls](../../tests/game/builds/over-hood-clock-history-controls.json) (#255) verify the new turbo
clock at **32 circuits / 320 ticks** in both mirroring states. Unmirrored recovery holds target throughout the
assessed windows; mirrored recovery takes seven periods after the final interruption, then holds 32 for the
remaining 18 periods. That transient differs from the old clock's persistent shortfall. Express keeps its
original clock but is now marked **no recovery**. A changed fast candidate remains unstable and misses
native target periods. This fixes the three false-stable verdicts without changing the pickup timing rule.

Since #269 an observed-windows clock holds when its own windows hold, not when the run they were observed in does, and
nine mixed-item selections change to observed windows; six had no stable default (fast in both mirroring states and
supplies, normal mirrored at both supplies, among them the fast unmirrored backed pick that repeated every 16,160
ticks). All nine hold their baseline natively and get back to target after every disturbance, the normal mirrored
moving one after two short periods following the last
([controls](../../tests/game/builds/over-hood-clock-controls.json), recorded in #269).

That left the mirrored express moving build "no recovery", which the game shared: six 112s and one 96 after each
disturbance. Its observed windows (7 output swings, 1,120 ticks) held their first period from every lane-phase start,
which is all the clock-only check judged of a start; run on with nothing cut, 9 of the 64 starts (the lanes about half a
stack interval apart) repeat that same cycle, and so do all four losses from them. The input window ended 2 ticks too
early for those starts. The game holds 6 a second with exact recovery at 5, 6 and 8 output swings too, the counts the
model calls stable, and moves 320 to 336 a period unclocked, as the model does. Since #272 every clock-only check made
while observed windows are made judges each moving lane-phase start over its repeating cycle, as the loss report's run
with nothing cut is judged: their padding search then takes 4 ticks instead of 1, and the build gets observed windows
at 7 output swings with the input window 3 ticks longer, which hold **112 in all 63 baseline periods and exactly 112
after all three disturbances** in the game. The unmirrored express moving clock's input window grows a tick and holds
96 throughout, as before ([controls](../../tests/game/builds/over-hood-clock-controls.json), recorded in #272). The check adds
about 1 to 2% to generation in total; builds with moving pickups whose observed windows are searched take longer: three
samples 4 to 8 seconds more each (one of them about twice as long), this build 3 seconds more (about twice as long),
and metallurgic science a third less.

**Capture.** Sidecar's saved support/model metadata distinguishes supported, unsupported and legacy inputs.
Updating software never promotes an old unsupported capture; recapture is required. See the
[capture boundary](capture.md).

## Startup from placement

The simulator predicts a supplied belt's first hand and every hand after it from the clock's start, with only the lane
state at placement taken from the game ([startup contract](../simulator.md#starting-on-supplied-belts); #273,
2026-10-20; Factorio 2.1.21).

| Evidence | Runs | From placement, tick for tick |
| --- | --- | --- |
| Retained gated side captures (`ordinary-gated-05`, `ordinary-reflected-01`): 4 tiers × straight, entrance, exit × moving, backed; near lane 1 (three ingredient set-ups) and 2 | 96 | 96: held count and item, every hand start, both pickup lanes' stock (9,012 hands) |
| Retained backed-up over-the-hood first-hand captures (`over-hood-base-02`) | 42 | 42 (several hands each, through the machine's insertion limit) |
| Retained moving over-the-hood captures (`over-hood-base-02`, `over-hood-phase-01`) | 216 | 216 |
| Clocked cold starts on the generator's selected clock: 4 tiers × 2 near sides × 3 side topologies × 2 supplies, the game's own lane phase | 48 | 48 on both clocked inserters, with the clock's start rule; 44 without it |
| Deciding cases: the clock started inside an input window (moving and backed, side and over the hood), the deciders built in reverse, the inserters built in reverse, the build moved | 9 | 8; the ninth from the start, one later hand a tick early (below) |

The probes' frame: a gated probe's input takes its first stack two samples after the script releases it; a clocked
start's model `held[i]` is sample `i + 4` and its lane phase the native one minus `4u`, at every tier (the frame grid
of each tier's preflight run is exact at a shift of 4 and nowhere else). The clock's start: no window reaches an
inserter in the first two ticks after the clock starts, which matters where the latency carries a window that ends at
the period's end (or a start inside a window) into ticks 0-1; in the 11 such runs the game follows the rule, the
simulator without it in none. A near-lane-2 crafting cell needs its plant mirrored as well as the reflection
(`reflectOrdinaryPickup` turns it half a turn, leaving its fluid inputs off the pipes). The 57 clocked runs are pinned
by `pickup-clock-cold-start.generation.test.ts` against `tests/game/builds/pickup-clock-start-controls.json` (`cold_start`).

One later hand differs: on the backed turbo entrance started inside a window, a hand that comes back from its swing in
the tick the output inserter takes the machine's products off its output block waits a tick in the game and not in
the simulator (5 input ticks once in 16 periods; output exact). It is not the start; it is held as a known difference,
below.

**A hand back from its swing as its machine's block is lifted** (#276, 2026-10-20). Every retained recording was
searched for such hands (656 recordings, about 40,000 returns from a swing), and that start was recorded once more with
the clock's deciders reversed: the machine at its output block as its last tick left it, and another inserter's take
bringing it below in the tick the belt-fed hand is back at the belt. The hand shows "waiting for space", and its first
stack comes:

| The taker drops | The taker's decider, against the hand's | Hands | First stack |
| --- | --- | --- | --- |
| onto a belt | built first (the pickup fixture; the belted-moving electromagnetic science recovery runs) | 55 | a tick after the take |
| onto a belt | built after (the fixture's start above, its deciders reversed) | 1 | a tick after the take |
| into a chest | built after (agricultural science, its deciders as exported) | 52 | in the tick of the take |
| into a chest | built first (agricultural science, its deciders reversed) | 27 | a tick after the take |

A hand that comes a tick late shows "waiting for source items" in the tick of the take. Six more were held up by another
wait and are left out; no recording has such a hand whose taker drops into a machine, and the inserters' build order and
a craft finished in the tick before decide nothing. The simulator takes the first stack in the tick of the take every
time: right for agricultural science's clock as the generator exports it, a tick early wherever the taker drops onto a
belt. A rule by the taker's drop target, and for a chest the decider order (the game updates the last built first, as
for windows that open together), matches all 135; tried in the simulator it moves no selected clock in the 214 blast
jobs (18 change other alternatives only) and no clocked native control but this hand, which it makes exact. Every such
hand a tick later would move agricultural science's selected clock, which the game's 52 hands contradict. The simulator
keeps its rule in 0.19.0: no recording varies the drop target alone, and for windows that open together the drop target
once stood in for the decider order.

**Clock latencies never checked tick for tick in the game.** The simulator gives the window deciders of the period
clock two ticks of latency, pinned tick for tick on whole-tick clocks by the runs above, the eight staged cold starts of the
normal underground pickups that preceded #266 and its 128 lane-phase cells. Two kinds of clock rest on the blueprint's encoding alone:

- **A subtick clock** (a fractional period) runs in the simulator on the same two ticks. Its blueprint puts a multiply
  and a modulo between the counter and the deciders and makes up for them by moving the windows back a tick, so its
  steady state is the period clock's by construction; the one recording of such a clock (the advanced circuit scaffold
  at 230 a second) agrees per period and by state shares, not tick for tick. At its start the encoding differs further:
  the lock filter adds its 1 before the multiply and the modulo have put anything out, so for its first ticks the
  inserters see the window position of tick 1. Not recorded.
- **A fuel inserter's clock of its own** runs in the simulator with no latency: its window is not moved, so its start
  leaves nothing dark. Its blueprint decider is encoded as every window, behind a counter and a lock filter of its own
  (or a modulo of the one clock), so the game's fuel windows would open two ticks later than the simulator's. The
  recorder does not record a fuel clock, and the comparisons check fuel swings by their spacing and state shares only,
  so nothing pins it. A two-tick dark start of these clocks moves no clock the generator selects (166 of 166 blast jobs
  identical with and without it). Nor does the whole latency: with the fuel windows moved by the encoding's two ticks
  and their start dark, in every check that stands for the game, no clock, verdict or selection changes in any of the
  214 blast jobs (2026-10-20); only the simulator's wake-up figure does, in 7 of the 8 jobs with such a clock (four
  samples at both supplies; for a selected clock at most biochamber fuel's, 2.07 to 4.14 a minute), none of which has a
  build. No retained recording has a fuel inserter on a clock of its own (none of the 17 scaffold builds has one). A
  check needs such a build recorded from a staged start, where every clock starts with the one lock, so the fuel clock's
  position at each sample follows from the start, and a comparison of each fuel window's first enabled sample with the
  window's start, which the comparisons do not make.

## Side-loaded pickups and merges

Picking up from a belt tile that another belt side-loads onto is **out of scope**, as splitters are. This covers
one side stream onto the pickup tile (formerly the per-lane `source.pickup_supply` profiles `side-inner` and
`side-outer`) and two side streams merging onto one receiving lane (formerly `source.pickup_merge`). The generator
models a belt that runs straight onto the pickup tile (through supply), an underground endpoint and an
over-the-hood pickup. A config that names `pickup_supply` or `pickup_merge` is refused. Sidecar 0.11.0 marks a
pickup from a side-loaded tile unsupported with the reason `side-loaded`, and the generator refuses that capture
instead of timing it as an ordinary belt. A manual config or a capture from an older Sidecar does not record
side-loading. Neither model was released.

The measurements are kept here as history. They used Factorio 2.1.21, legendary stack inserters, 16-item hands
and four-item stacks at all four belt speeds:

- **A full incoming belt does not fill the pickup tile.** One side stream joins the receiving lane part-way
  along the tile. The incoming lane on the inside of the turn supplies about the downstream quarter (entry at
  67/256 tile); the lane on the outside supplies about three quarters (188/256).
- Moving turbo first hands took `0,1,2,4` with the outer stream only and `0,2,4,6` with the inner stream only,
  against `0,1,2,3` for through supply. Outer-only hands took `0,1,2,4` at every speed. Inner-only hands took
  `0,1,4,6` express, `0,4,8,12` fast and `0,4,12,20` normal.
- Two streams compete for one receiving lane. With the incoming head at position zero, an inner entry shifted
  by less than `64 + speed` units (1/256 tile) was accepted: last accepted / first rejected 95/96 turbo,
  87/88 express, 79/80 fast, 71/72 normal.
- Two-stream merges were measured at all four speeds; only the bounded turbo merge had production support.
  Its model matched all 511 transitions in each of seven repeated controls, and its generated gear clock held
  60 of 60 periods. At express the same rule matched hand counts but not stream origins or stock movement, so
  slower merges were never supported.
- Different items on the two streams starved the inner ingredient in an operating machine at every speed: once
  the machine stops accepting the outer ingredient, pickup stops opening gaps for the inner stream.
- Backed-up single streams matched a finite receiving and incoming queue model in eight clips over 4,096 ticks.

The removed model and tests, the `side-loaded-straight` fixture with its native controls, clips and screenshots,
the turbo merge clock check, and the former coverage rows, timing tables and diagrams are at commit `52b4e9f0`
on `master`. See the [fixture report](https://github.com/abucnasty/factorio-scripts/tree/52b4e9f0f125a7072c1665fe1fb8f3378ab63ce1/clock-generator/tests/game/mechanics/belt-pickup/fixtures/side-loaded-straight)
for the setup, corrections and reproduction commands, and the
[belt pickup documentation](https://github.com/abucnasty/factorio-scripts/tree/52b4e9f0f125a7072c1665fe1fb8f3378ab63ce1/clock-generator/docs/belt-pickup)
at that commit for the tables and diagrams. The raw captures were not kept in the repository.

## Evidence limits

The fixture reports distinguish manual observations, automated mechanics checks and generated-clock checks.
Replays aligned to observed stock or arm timing do not independently prove startup phase or feeder timing.
Inventory-clearing probes do not establish crafting throughput; seeded controls do not establish natural supply.

Sparse or independently phased supply, broader orientations and competing-consumer networks remain unverified.
Early disabled-filter probes were excluded from the corresponding findings. Detailed fixture reports retain those
corrections and reproduction instructions. Full raw captures go to the ignored `clock-generator/.scratch/` and are not
kept in the repository; fixture images
use the shared native screenshot-to-JPEG script.
