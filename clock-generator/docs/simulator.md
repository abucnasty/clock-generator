# Simulator goals

This page was split out of GOALS.md on 2026-10-15; GOALS.md holds the goals.

## Simulator Goals

This project actively runs a simulation of the machines, inserters and mining drills that are in the configuration file. It simulates all their crafts and transfers every tick. Infinity chests and input belts are endless supplies, and fluids are left out. Moving belt pickups time reachable stacks each tick by the rule below. Omitted pickup length defaults to one tile; ordinary backed-up supply retains finite stock and refills gaps at belt speed. The simulator models each entity's game statuses and is checked against recordings and provides state transition logs in debug mode to provide insights into what each entity is doing and a description for why it wanted to transition to a different state. Any deviation from the game is measured by running "scaffold" tests. These tests are driven by having a "scaffold" blueprint paired with a configuration file. Any scaffold can be tested directly in factorio. The `clock-generator-recorder` can help record and run this scaffold and provide per tick entity statistics to compare against the simulator. This is a verification process that the simulator backing the algorithm is doing the right thing. A scaffold test checks both goals against the game: that every clock period moves exactly the expected output, and that the simulator counts the wake-ups the game shows. It also lays the simulator against the game entity by entity: a run of the same clock in the simulator has to move what the game moved through every inserter and finish what it finished in every machine. For that the simulator writes its run in the format of the recorder, so that one set of functions reads both (`clock-generator/src/verification/compare-recordings.ts`); `npm run verify` makes the same comparison for any recording.

### The status of an inserter

The status the game shows for an inserter is decided by its sink before the inserter itself, and not by what the inserter carries. It is defined in `clock-generator/src/state/factorio-entity-state.ts` and was derived from recordings of five scaffolds in Factorio 2.1.21.

- An inserter that is switched off by its circuit condition shows as disabled from that tick on, even while it finishes the swing and the drop it had already started. A window of 4 ticks shows as 4 ticks that are not disabled.
- The status is a tick ahead of what the inserter does. It takes nothing in the first tick it shows as enabled, and it can still take in the first tick it shows as disabled, never after that. So an inserter acts in as many ticks as its window has, the first one included, and the simulator enables it for exactly those.
- With an empty hand, it is waiting for space in the destination whenever the sink takes nothing from anyone: the output of the machine is at its output block, or every ingredient is at its insertion limit, and its fuel is at its limit too. This is shown even while the arm is still swinging back.
- With an empty hand and a sink that still takes something, it is working while it swings back, and waiting for source items once there is nothing for it to take. This is also what it shows when the sink is full of the one item this inserter brings.
- With a hand it is still filling, it is waiting for more items between pickups.
- A full hand is working, until it cannot be dropped in one go. A hand goes onto a belt one stack at a time and shows as waiting for space in the destination in between.

### What an inserter takes off a belt first

With an empty hand, prefer the configured pickup lane's item when the destination can accept it. Beside a belt,
this is the nearest lane. Centered downstream of an underground entrance or exit and facing back into it,
mirroring selects lane 2 when mirrored and lane 1 otherwise. Once a hand contains an item, continue collecting
that item until the hand is full or the destination stops accepting it. Explicit filters restrict which items may
be collected; they do not override a supplied `near_lane`. Without `near_lane`, item selection keeps the
filter/recipe order and matching physical lanes are tried in their config order.

### Picking up from moving belts and underground endpoints

The [consolidated experiment record](belt-pickup/experiments.md) documents the measurements, rejected
hypotheses and generated-clock checks behind these scoped rules.

**Take one reachable stack per tick: preferred lane first, then the other lane if the preferred lane has none of the item being collected. Leave a hole and keep the remaining stacks moving at belt speed.**

- Saturated lanes have stacks a quarter tile apart. Take the upstream-most reachable stack on the selected lane,
  capped by that lane's stack size and the remaining hand capacity. There is at most one stack total per tick.
- A straight belt exposes **one tile per lane**. Either underground entrance or exit exposes **half a tile per lane**.
  The model assigns no fixed lane-switch delay; an underground has less pickup space, rather than a fixed tick
  penalty. Collection also checks the calibrated arm-extension reach below.
- Lane phases, holes and partially taken stacks persist between hands, across closed windows and when inserter
  controls change. Each lane keeps its own remaining stacks.
- On **backed-up supply**, items stop between pickups and the belt refills gaps. A stack is available each
  pickup tick in the measured turbo first hands, but slower belts can exhaust reachable stock. Ordinary through
  supply uses a bounded queue: stop the head at the endpoint, retain quarter-tile spacing, and refill gaps at belt
  speed. Holes and partial stacks persist across hands; geometry still limits reach. Capture does not infer supply motion from a snapshot.

For example, four grabs from one moving turbo lane can occur at `0,1,2,3` on a straight piece and `0,1,2,4` or
`0,1,3,5` underground, depending on phase. With the same item in four-item stacks on both saturated lanes, the
measured 16-item hands filled at `0,1,2,3` on all three geometries: the far lane supplies a grab when needed.
These are offsets from the first grab, not an arm-arrival or wake-up timing rule.

`source.pickup_length` describes physical reach: **1** tile for a straight belt (the default when omitted), or
**0.5** for either underground endpoint. This default applies both when parsing a config and when constructing
entities from a direct engine input. There is no legacy calculation selected by omitting geometry.
The UI defaults to a straight side pickup. Underground inputs require a specific `source.pickup_layout`: side
entrance/exit, front entrance/exit, or over the exit hood. Layout supplies omitted length; conflicting length is
rejected. Sidecar exports layout with model format 2; older underground captures require recapture. See the
[capture guide](belt-pickup/capture.md#physical-layout).

Supply is a separate choice: **Moving** by default, or **Backed up** with `overrides.backed_up_belts: true`.
The simulator retains the pickup length in both cases. Moving supply models reachable stacks, holes and partial
stacks; ordinary backed-up supply additionally stops and compresses stacks at its closed endpoint. Choosing **Backed up** also omits moving-belt clock slack.
Older `non_moving_belts` config settings migrate to `backed_up_belts` on import. New configs and exports use only
`backed_up_belts`; if both keys are present, the new key takes precedence. Saved results retain their run's assumptions. Older manual underground configs must choose a layout;
physical approach cannot be recovered from half-tile reach alone. Belt slack remains extra margin for late starts and supply gaps.

The [lane model](../src/state/belt-pickup-lane.ts) stores only holes and partial stacks in an otherwise evenly spaced
supply. [Belt pickup logic](../src/control-logic/inserter/modes/pickup/belt-pickup-logic.ts) chooses the physical lane. No whole-belt
simulation or extra search dimension is involved.

Calibration: Factorio 2.1.21, legendary stack inserters, four-item belt stacks, turbo/express belts, and pickups
from both sides of an eastward belt. Same-item probes checked 5,268 uninterrupted hands across 78 captures,
including hand sizes 8/12/16, interrupted windows and staggered turbo lanes; subsequent grabs and lane contents
matched when seeded with the observed first grab, remaining stacks and phases. Game regressions compare actual
simulator grabs and default-clock throughput/recovery on the [same-item fixtures](../tests/game/mechanics/belt-pickup/fixtures/same-item),
and retain the [different-item electromagnetic checks](../tests/game/mechanics/belt-pickup/fixtures/different-items).
Regressions with backed-up turbo belts isolate each ingredient and check the default clock's throughput and recovery on all
three electromagnetic scaffolds. Detailed measurements and reproduction commands live with those fixtures.

One [front-facing underground exit case](../tests/game/mechanics/belt-pickup/fixtures/front-underground-exit/README.md)
also matches the existing simulator: a mirrored inserter north of a northbound exit selects lane 2 supercapacitors
and fills its first backed-up hand at offsets `0,1,2,3`. The config explicitly supplies `near_lane: 2` and
`pickup_length: 0.5`; neither lane is physically nearer. Sidecar 0.10.0 captures this front-exit preference from
inserter mirroring and exports half-tile reach. Sidecar 0.11.0 also captures an inserter upstream of an exit and facing with belt travel as
`pickup_layout: "over-hood-exit"`, with half-tile reach and lane 1 unmirrored / lane 2 mirrored.
Other unsupported inline pickups remain unclassified. Swapping the lane
ingredients changes the selected item to accumulators while retaining lane 2 and
the same grab offsets, supporting lane preference over fixed recipe order for this orientation. Flipping only
the inserter with those swapped ingredients selects lane 1 supercapacitors, again at `0,1,2,3`; the simulator matches
with explicit `near_lane: 1`. Moving front-exit pickups and other cardinal orientations remain unverified.

An [inline underground entrance case](../tests/game/mechanics/belt-pickup/fixtures/front-underground-entrance/README.md)
checks an unmirrored inserter east of an eastbound entrance. It selects lane 1 accumulators with both moving and
backed-up supply. Its first hand fills at `0,1,2,4` moving and `0,1,2,3` backed up, consistent with half-tile reach
and the separate supply rules above. The moving comparison allows the two turbo stream phases rather than
inferring an initial phase from the blueprint. Flipping only the inserter's mirroring changes selection to lane 2
supercapacitors under both supply conditions, retaining those grab offsets. Sidecar 0.11.0 exports `near_lane: 1`
unmirrored or `near_lane: 2` mirrored, plus half-tile reach, without warnings in all four game cases. Capture
keeps supply motion separate from geometry. Classifier rotation checks cover all cardinal directions; actual
entrance grabs in other orientations and repeated hands remain unmeasured here; the backfill below adds ingredient swaps and speed/phase controls.

The entrance's [same-item moving case](../tests/game/mechanics/belt-pickup/fixtures/front-underground-entrance/README.md#same-item-on-both-moving-lanes)
also follows the existing fallback rule in both mirroring states. With accumulators on both lanes, the preferred
lane supplies three grabs and the other supplies the fourth: `1,1,1,2` unmirrored or `2,2,2,1` mirrored. Both fill
at `0,1,2,3` instead of the different-item controls' `0,1,2,4`. The position replay matches both lanes after
seeding the observed first grab; the simulator supports each measured hand and lane sequence for one turbo phase.
These first-hand measurements do not calibrate absolute arrival or initial phase.
The [same-item backed-up controls](../tests/game/mechanics/belt-pickup/fixtures/front-underground-entrance/README.md#same-item-on-backed-up-lanes)
fill at the same offsets while keeping every grab on the preferred lane: `1,1,1,1` unmirrored or `2,2,2,2`
mirrored. The other lane stays stationary and untouched. The existing backed-up availability rule matches the
hand counts; half-tile geometry and lane preference remain separate from the supply setting.
The [same-item front-exit controls](../tests/game/mechanics/belt-pickup/fixtures/front-underground-exit/README.md#same-item-on-both-lanes)
also fill at `0,1,2,3` entirely from lane 1 unmirrored or lane 2 mirrored, leaving the other lane untouched.
Their outlet is physically blocked by the front inserter, so these are backed-up measurements.

The [four-speed backfill](belt-pickup/experiments.md#belt-speed-coverage) now measures side pickups,
front-entrance moving/backed-up controls and front-exit backed-up controls at turbo, express, fast and normal
speeds. Normal moving front-entrance controls use a paired compact destination to respect underground range.
The historical timing examples above describe turbo fixtures.

The production [backed-up queue](../src/state/backed-up-pickup-lane.ts) matches held quantities and exposed stock
in all 48 ordinary backed-up captures, including both physical near sides, after a single full-stock seed.
Native arm-arrival/drop boundaries remain inputs to that comparison. The legendary stack inserter also retains
its radial collection reach between grabs. Advance it toward the selected stack by the prototype's extension
speed (0.25 tile per tick at legendary); collect when within one more extension step. The physical layout
places each stack relative to the pivot. Keep reach while a partial hand waits or controls change; discard its
history from repeat detection once the hand is empty/full, since the next hand initializes its own reach.

This matches all 198 side-pickup arrival phases and all 96 ordinary/reflected repeated-hand controls, including
the normal moving entrance's four delayed phases. Sixteen fresh controls check all eight normal entrance
phases from both physical near sides. This collection constraint is calibrated for through supply and
legendary stack inserters; other prototypes/qualities remain separate calibrations.
Capture geometry and collection replay alone do not establish absolute arrival or generated-clock parity.

Scope remains one controlled through supply. Pickups from a side-loaded tile, with one side stream or two
merging onto the pickup lane, are out of scope and refused, as are pickups from a splitter; see the
[experiment history](belt-pickup/experiments.md#side-loaded-pickups-and-merges). A belt fed through a splitter further
upstream is modelled as a plain belt, which is wrong when the splitter's other output takes items. Sparse supply, shared upstream
withdrawals, bends, other inserters/qualities/orientations and arbitrary relative lane phases remain unverified.
Moving front-exit supply awaits a suitable fixture.

### Captured pickup provenance

[Pickup capture status](belt-pickup/capture.md) is saved on each imported source. Only an explicit supported model
with matching geometry and lane data can drive generation. Unsupported and legacy unclassified pickups
remain unverified after save/reload or version updates; update Sidecar and recapture when support is available.
Manual configurations keep the straight-belt default. A newer engine does not reinterpret an old unsupported
capture as a supported source.

**Side-loaded pickup tiles, merges and splitters are out of scope.** A config that names `source.pickup_supply`
or `source.pickup_merge` is refused, and so is a capture that Sidecar marks unsupported with the reason
`side-loaded` or `splitter`. See the [experiment history](belt-pickup/experiments.md#side-loaded-pickups-and-merges).

### A stack inserter dropping onto a moving lane

A legendary stack inserter deposits one belt stack per successful tick. Output packets persist between hands,
so the empty-belt burst is available only when the receiving space permits it. With four-item stacks, an empty
tile gives deposit offsets `0,1,2,4` on turbo, `0,1,2,5` on express, `0,1,4,8` on fast, and `0,1,8,16` on normal.
A normal belt's next hand can instead use `0,8,16,24` because the previous hand still occupies the tile.

The simulator keeps a finite queue at each drop spot, in 1/256-tile units:

- Move packets downstream at belt speed (8/16/24/32 units per tick). Followers stop behind preceding packets at
  quarter-tile spacing (64 units); an already compressed gap reopens without moving a packet backwards.
- Try to place a new packet one movement step beyond the nominal drop spot, or behind preceding stock when
  necessary. Its landing position must be strictly less than a quarter tile behind the nominal spot.
- An insertion may temporarily compress an upstream follower's gap. Keep that packet and let it wait for space.
- Retain packets between hands and control replacements. Forget them after they pass every drop spot's reach.

To share this queue between output inserters, give every sink on that belt a `drop`, for example
`{"lane": 1, "position": 12.5}`. Lane numbers follow the belt config's lane order; positions are tiles along the
path, increasing downstream from one common origin. Negative and fractional positions are allowed. Either all
output inserters on a belt specify geometry or none do. Without explicit geometry, each inserter uses an
independent local tile at position 0.5 and retains its own output stock; the config does not imply that these
unknown spots collide.

The [drop calibration](../tests/game/mechanics/belt-drop/fixtures/turbo-stacks/README.md) covers all four speeds
and belt stack sizes 1–4, with a finite source and unchanged research. Portable native clips check every source
quantity, held quantity and receiving-tile position from a disabled start. Additional occupied-output controls
check the landing cutoff and compressed gaps. Stack size 3 uses full hands of 15 and leaves the final two items
waiting in the hand. `Belt.amountToDropAtTick` remains an empty-belt reference; runtime drops use actual space.
The existing turbo shared-lane regressions retain their 4-, 6-, 14- and 22-tick drop patterns.

This local output rule assumes a freely draining downstream lane. Downstream blockage and external incoming
traffic require their own modeled transport geometry. Other inserter prototypes and qualities remain uncalibrated.

### Two inserters that bring the same item

When two inserters bring the same item to a machine, one of them can be left holding it. If it starts picking the item up after the other has already put it in, the item is at its insertion limit by the time its hand is ready, and it holds the hand until the machine has used enough for it to drop.

That alone only costs time. It is a deadlock when the inserter that is stuck is also the one that brings another ingredient. While it holds the first item it takes nothing else off the belt. If the machine then runs out of that other ingredient while the first is still at or over its insertion limit, the machine cannot craft, the first item never goes down, and the inserter never lets go. The build stays that way for good, whatever the clock does afterwards.

This is a risk of the build, whatever the items are: a machine with an inserter that brings two items, where another inserter brings one of the same items. Whether it happens is a matter of the timing of the two inserters against each other. This rule comes from my own testing of the game.

Seen on the utility science sample in Factorio 2.1.21 on 2026-10-10, under uneven output swings with backed-up belts: the machine held 16 processing units, 16 low density structures and no flying robot frames, the inserter that brings the frames held 12 low density structures, and the build made 0 of 192 in each of 53 periods. Under batched swings it made 192 in each. The simulator has the deadlock: started in that state it stays in it. None of its checks gets a build into it.

The generator reads the risk off the config alone, with the items of an inserter that has no filters worked out from its belt and its machine (`clock-generator/src/crafting/deadlock-risk.ts`). A build that has it is named as a deadlock risk wherever its clocks are listed, and copying the blueprint of one of its clocks warns which two inserters share which item. On such a build the verdict of the trials for backpressure loss does not decide the selection, since the trials do not see the deadlock: its clocks that hold their expected output are ranked as they were before a clock had to get back from a loss, by their wake-ups.

### When a waiting inserter acts

An inserter that waits for space in a machine is asleep, and acts in the tick after the one that wakes it. Two things wake it: the machine finishes a craft, or another inserter takes the machine's products. So when the output inserter takes a machine down from its output block, an inserter that was waiting to put into it takes its first items one tick later. Only when the machine finished a craft in the tick before the products were taken was it awake already, and then it takes them in the tick they are taken. An inserter whose arm comes back in that tick is not held up. It is defined in `clock-generator/src/control-logic/inserter/waiting-inserter.ts`, and applied by the idle transition of an inserter and by the pickup of a hand from a belt.

Recorded in Factorio 2.1.21 on the scaffolds, on inserters that take from a machine or a chest and had waited 6 ticks or more: the first items came a tick later in 5,777 cases of 5,777 where no craft was finished the tick before, and in the same tick in 3,756 of 3,756 where one was. A hand from a belt that stopped part way at the output block goes by the same rule (843 of 843 and 248 of 248). A hand from a belt that had not started lands its first stack a tick after the products are taken either way.

A hand from a belt that had not started and waited for an ingredient at its insertion limit is woken by the machine's own craft start, which takes the ingredients (see [wake-ups](wake-ups.md)), and lands its first stack in the tick after that start (2026-10-20, roadmap M1). The simulator updates machines after inserters, so it finds the room in that tick too, and the pickup mode takes the stack there without the tick it waits after products are taken (`wokenByItsMachinesCraftStart`, `clock-generator/src/control-logic/inserter/waiting-inserter.ts`). Recorded in Factorio 2.1.21 on the normal moving underground pickups from cold starts at chosen lane phases: in all 102 such resumes of the first runs the game took its first stack in the tick after the craft start, where the simulator took it a tick later; at a window's last enabled tick that lost the stack to the next window, and at the exit's natural lane phase it lost one stack in period 5 and settled into a six-period cycle of 143 a period against 176. With the rule the simulator moves what the game moved from each of the 64 lane-phase starts of both builds, which are pinned as native controls (`tests/game/builds/normal-underground-lane-phase-controls.json`). A hand that stopped part way at the insertion limit is not recorded, and keeps the tick.

An inserter whose window opens in the tick the products are taken is held up as well (decided on 2026-10-14, issue 152). The game shows an inserter on a clock as enabled the tick before its window, and it waits in that tick: it finds the machine at its block, and is asleep on it when the products are taken. So it takes its first items a tick later, also where the machine finished a craft in the tick before. Only when the inserter that takes the products has a window that opens in that same tick too does it take them in that tick. Recorded in Factorio 2.1.21 on inserters that take from a machine, on the accumulator build of the issue and on the scaffolds: a tick later in 1,158 of 1,170 cases where the inserter that took the products was enabled before (44 of 44 where a craft finished the tick before), and in the same tick in 852 of 888 where its window opened too. The 12 are at one sample of the agricultural science recording; the 36 are at one place in the seven-period cycle the 0.9.0 clock of the accumulator build settled into, where the same window a period later takes its items in the tick; what decides it is not known. Recorded since on the same build under an even hands clock whose windows all start at 0 (2026-10-14, see "Even hands" under "Wake-up Lists"): at the one place in the period where all its windows open together, the iron and battery inserters of both accumulator plants took their first items a tick later in all 300 cases (4 places in the period), though the output inserter's window opened in that tick too; the simulator, in the steady state it settles into from its own start, has 22 such places and takes them in the tick. Neither how long the machine had been at its block (1 tick there, 2 to 17 on the advanced circuit build) nor a craft finishing or starting in the tick of the take tells the two apart. No verdict changes with it: game and simulator both move 288 every period.

A hand from a belt is held up by a window that opens on a machine at its output block as well (2026-10-16). An inserter that takes from a belt and waited for its machine goes on a tick after the products are taken in either case, which the pickup mode has. A window that opens starts the pickup from the disabled mode, though, and has no such tick: the inserter finds the machine at its block, is asleep on it when the products are taken, and takes its first stack 2 ticks after its enable (waiting for space, waiting for items, then the hand grows), where the simulator took 1. So `wokenThisTick` (`clock-generator/src/control-logic/inserter/transitions/idle-mode-transition-evaluator.ts`) holds a belt-fed inserter up when its window opens on a machine whose block was lifted in that tick, by the same rule as for a machine source, and leaves the belt source out only where no window opens. Recorded in Factorio 2.1.21 on the utility science scaffold of the Thaeln cell (222 windows): the belt-fed inserters whose first status after the enable was waiting for space in the destination took their first stack 2 ticks after it in 1,373 of about 1,470 windows (the rest wait longer for other reasons), and 1 tick in 329 of 329 where it was waiting for source items; the machine-fed inserters took 1 tick in 4,202 of 4,204 windows. With the rule the belt-fed inserters of a simulated run stay in step with that recording for hundreds of ticks longer (inserters 14 and 15 through all 8,000 ticks checked), where lifting the exclusion for every case parted two of them at tick 40. Not settled: of the other recordings with belt-fed inserters, one Thaeln clock took 2 ticks in 1,322 of about 1,450 waiting windows (supports it), another 2 ticks in 326 and 1 in 108 (mixed), and two recordings have too few cases; two windows of the first recording go the other way. No settled rate of that scaffold moves with it.

The entry for this rule in the shared mechanics docs (factorio-benchmarks, docs/mechanics) is pending.

A hand that an inserter takes from a machine stops filling while the machine it puts into takes nothing of its item, as a hand from a belt does: it keeps what it holds, also through a closed window, and goes on once the machine is under its block. Recorded: such a hand did not grow in 20,701 samples of 20,701 with products to take where the machine it puts into was at its output block, and grew in 11,561 of 11,561 where it was not. It is in the machine pickup logic (`clock-generator/src/control-logic/inserter/modes/pickup/machine-pickup-logic.ts`).

Without these two rules the clock version 0.9.0 selected for the accumulator build of issue 152 (640 a second over 18 copies, `resources/config-samples/intermediates/accumulator/accumulator-640.json`) made 512 to 544 of its 576 a period in the game, in a cycle of seven periods, where the simulator had 576 in every one. The iron and battery inserters of the accumulator plants opened their windows in the tick their output inserter, on its way back from the belt, took the products, and took their hands a tick later than the simulator had them; the battery inserters held 13 of 16 batteries through their closed window where the simulator filled the hand in its last tick. With the two rules the simulator has that clock at 512, and the clock it selects instead made 576 in each of 58 periods in the game, after 3 at 544 while it settled from the scaffold's start.

That one tick decides whether a clock holds when its windows are as long as the hands they are made for. Under a clock for the advanced circuit build with windows of 4 ticks for the inserters that take off a belt, the game made 608 and 624 of 704 a period in turn, where the simulator made 704. One of the two plants had fallen two hands of plastic and of cable behind the other. Its output stood over the output block for the ticks before every output window, the plastic and the cable inserter whose windows opened in those ticks took their hands a tick after the output inserter had cleared it, and a window that was a tick short for it lost a hand: 192 of 256 plastic, 384 of 512 cable and 264 of 352 products a period. With this rule and the output block above, a run of the simulator that starts in the state the game was recorded in holds what every machine and every inserter of the game held, tick for tick, for the 36,372 ticks the recording goes on, and so it does for the recording of the clock tightened by hand that holds 704.

That clock has two states, and the game was in both: one plant made its 352 a period and the other 264, under the same windows. Which one a machine ends up in is decided by what it holds when the clock starts. In the earlier filled-start generator, with machines full of ingredients and emptied of products, the simulator held 704 from every place in the period and classified the clock as meeting goal 1. In that investigation, starting the plants short of ingredients instead fell short from 12 of 108 starts, where the tightened clock and the clock from version 0.5.0 got back to 704 from all 108. Those observations are historical evidence, not the current startup contract. Current clock trials start with full input supplies, empty machines, buffers and hands, phase 0 and the configured one-time loop seed (default 200); planning still uses a separate prepared build. Optional extended checks sample other cold clock phases and competing-taker orders actually listed in `assessment.start_dependence.starts`, not filled or free-running builds. Neither those samples nor the loss trials prove convergence from every live inventory or build order (see [stability](stability.md)).

### Products a machine cannot put out

A machine starts a craft whatever its output holds, and the products are made when the craft finishes. If they do not fit under the stack size, the machine holds them and starts no craft until they do. It puts them in its output in the first tick there is room, in whatever state the machine is: working, short of ingredients or at its output block. In a tick the inserters act first and the machines after them, and the recorder samples at the end of the tick. So when an inserter takes products from a machine that holds some, the machine puts them in during that same tick, and one sample shows both, though the machine has nothing left to craft with. Seen in the game on the agricultural science build from the staged start: the two nutrient machines held 40 nutrients behind a full output, an inserter took 32 and the output read 88 in the sample of tick 92, where the simulator, which put held products in only while the machine was working, read 48. With the rule they agree through the first 600 ticks. A full productivity bar is still paid in the working tick, not before. The statistic `products_finished` is not changed by it: the simulator counts a craft when it finishes, the game when its products are put in the output.

Held products reach the output at once, so a machine whose output was taken down to just under its output block can be put back at the block by them, and its inserters then bring nothing until the output is taken down again. On the utility science build with the direct insert chain and always-on inserters, the casting machine of low density structure held 2 behind a full stack of 50; the inserters took it down to 18 (the block is 19), the 2 are put in at once and the plastic inserter waits. Before, the 2 stayed held until plastic came, which is the fault the rule removes. The 3-swing batched clock for that build moves 192 a period in the simulator when the held products wait, and 176, 160 and 144 in turn (180 a second of 240) when they do not.
