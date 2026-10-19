# Belt pickup experiment findings

[Belt pickup documentation](README.md)

This report summarizes the belt-pickup experiments, their timing patterns and simulator impact. Detailed
measurements, screenshots and reproduction commands remain in the [mechanics fixtures](../../tests/game/mechanics/belt-pickup/README.md).
The [simulator guide](../simulator.md#picking-up-from-moving-belts-and-underground-endpoints) defines supported behavior.
The [diagram glossary](glossary.md) illustrates the layouts and test conditions named in the tables,
including a [phase A vs phase B example](glossary.md#phase-a-vs-phase-b).

The accepted changes are unreleased, reserved for **engine/UI 0.19.0** and **Sidecar 0.11.0**.
Publishing remains on hold. **Splitters are out of scope.**

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
  refills holes at belt speed. Side-fed backed-up supply also retains its finite receiving and incoming queues.
- Replenishment depends on topology. A full incoming belt need not fill the pickup tile, and closing a final
  outlet does not guarantee permanent local saturation when other consumers can reopen a route.

## Belt-speed coverage

**Tested** means native measurements are documented for the named scenario; it does not mean every phase,
orientation or topology is verified, or that the simulator supports it. **Not tested** marks combinations
without documented native evidence in this investigation. A suffix identifies an unresolved limitation:

- **simulator timing mismatch**: the production simulator predicts different grab ticks from the game.
- **generator result mismatch**: the generator's rate or stability assessment disagrees with the game.
- **no verified moving default**: the selected fallback requires backed-up supply and misses the target
  with moving supply; it is not a verified default for that setup.
- **experimental merge stock mismatch**: the experimental rule predicts the wrong stock movements or supplying
  stream, even when grab ticks agree. This is not a production simulator comparison.
- **no simulator support**: measurements exist, but no supported production model is available for that case.

Remove a mismatch suffix once the corrected model passes the corresponding native regression; the status then
becomes **Tested**. Remove a support suffix only after support is implemented and verified. Plain **Tested**
records coverage with no additional disagreement flagged here; it does not imply every model detail was compared.
Normal means the standard transport-belt speed.
Offline expectations and classifier-only checks do not count as native timing coverage. The speed backfill uses
16-item hands and four-item belt stacks. Historical smaller-hand/interrupted-window/staggered-lane controls
are not an exhaustive cross-speed matrix.

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

### Side-entry and merge controls

See the [side-loading diagrams](glossary.md#side-loading-and-merging) for inner-only, outer-only
and two-stream supply.

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Moving inner-only and outer-only streams, first hand, initial belt phase | Tested | Tested | Tested | Tested |
| Moving two-stream merge, first hand, initial belt phase | Tested | Tested; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Single-stream first hands, shifted belt phase | Tested | Tested | Tested | Tested |
| Two-stream first hands, shifted belt phase | Tested | Tested; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Reflected side feeds and rotated inner feed, first hands | Tested | Tested | Tested | Tested |
| Backed-up inner-only and outer-only first hands | Tested | Tested | Tested | Tested |
| Repeated single-stream moving and backed-up hands | Tested | Tested | Tested | Tested |
| Backed-up two-stream first hands | Tested | Tested; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Repeated same-item merge, initial belt phase | Tested | Tested; experimental merge stock mismatch; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Repeated same-item merge, shifted belt phase | Tested | Tested; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Repeated merge: pause/resume, outlet block/release and reflection | Tested | Tested; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Repeated different-item merge, both ingredient arrangements | Tested | Tested; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Operating mixed-item merge starvation | Tested | Tested; no simulator support | Tested; no simulator support | Tested; no simulator support |
| Seeded entry-window cutoff and compression controls | Tested | Tested | Tested | Tested |

All four speeds now have repeated native controls. Only the bounded turbo merge is supported by the engine;
measured slower behavior does not establish a correct routing model. Different starting belt phases are tested
by changing when the inserter gate opens. These controls do not cover every possible relative phase of
independent incoming streams; exact gate ticks remain in the fixture instructions.

### Generated clocks and drops

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Electromagnetic clocks, all three geometries: moving/backed-up throughput and recovery | Tested | Tested; no verified moving default for undergrounds | Tested | Tested |
| Same-item gear clocks, all three geometries: throughput and recovery | Tested | Tested | Tested | Tested |
| Over-the-hood mixed-item clocks, both mirroring states and supplies | Tested; generator result mismatch | Tested; generator result mismatch | Tested | Tested |
| Over-the-hood same-item clocks, both mirroring states and supplies | Tested | Tested | Tested | Tested |
| Two-stream merge generated gear clock | Tested | Not tested | Not tested | Not tested |
| Belt drops, finite source and retained output stock, stack sizes 1–4 | Tested | Tested | Tested | Tested |
| Occupied output: landing cutoff, stack size 4 | Tested | Tested | Tested | Tested |

The post-fix recapture covers **48 ordinary clocks** across all four speeds: **46 meet exact baseline and recovery output**.
Of those, 44 are correctly marked stable. Both normal backed-up underground clocks pass the warm run, but
fully jammed cold-start controls alternate 144/208 items at offset 1287, matching their unstable verdict.
The two express moving underground defaults require backed-up supply and miss the target under moving supply.
The original 39 recordings remain separate historical evidence.
Slower merge clocks remain **Not tested** under the turbo-only supported schema. The belt-drop rows also compare
finite receiving stock, including the normal-speed second hand.

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
| Side entrance, normal | true | Same item on both lanes | First hand `0,1,3,4` | 5 | Observed arm travel; model predicts 4 ticks |
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
| Front entrance / over-hood exit, all speeds | true | Same item on both lanes | `0,1,2,3` | 4 | Every measured phase; distinct from the side-entrance counterexample |

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
agrees with all **42 backed-up first hands**, conditioned on native arrival. Production pickup-mode comparisons
also match held items, quantities and exposed stock for all 258 controls. Sidecar captures the explicit
over-the-hood layout. First-hand agreement does not establish generated-clock parity: the operating-clock
controls below expose a recovery failure when the lanes acquire different phases.

### Side-loading onto a straight tile

The [diagram glossary](glossary.md#side-loading-and-merging) shows each supply arrangement.

Inner and outer identify the incoming stream's entry into the receiving lane, not a new inserter preference.
Different starting belt phases are tested by opening the inserter gate one tick later. The table distinguishes
the initial and shifted controls; exact gate ticks remain in the [fixture instructions](../../tests/game/mechanics/belt-pickup/fixtures/side-loaded-straight/README.md).

| Scenario | Moving | Starting belt phase | Measured offsets | Total pickup ticks | Finding |
| --- | --- | --- | --- | --- | --- |
| Turbo outer stream only | true | Initial | `0,1,2,4` | 5 | Enters near the upstream three-quarter position |
| Turbo inner stream only | true | Initial | `0,2,4,6` | 7 | Enters near the downstream quarter position |
| Turbo inner or outer stream only | true | Shifted | `0,1,3,5` | 6 | Phase matters |
| Turbo single-stream controls, drain removed | false | Stationary | `0,1,2,3` | 4 | Backed-up first hands; not proof of infinite repeated supply |
| Turbo two-stream merge, same item | true | Initial and shifted | `0,1,2,3` across 45 complete hands per control | 4 | Shared stock replenishes both entry points |
| Turbo two-stream merge, different items, either arrangement | true | Initial | `0,1,2,4` for complete hands | 5 | Outer stream dominates in the inventory-clearing probe |
| Express two-stream merge, same item | true | Initial | `0,1,2,3` across 45 hands | 4 | Same hand timing conceals different routing; unsupported |

Single-stream first hands with the initial belt phase are below. Repeated controls have since been captured at every
speed; the first-hand patterns alone do not establish two-stream routing support.

| Incoming speed | Moving | Stream | Measured offsets | Total pickup ticks |
| --- | --- | --- | --- | --- |
| Express | true | Outer only | `0,1,2,4` | 5 |
| Express | true | Inner only | `0,1,4,6` | 7 |
| Fast | true | Outer only | `0,1,2,4` | 5 |
| Fast | true | Inner only | `0,4,8,12` | 13 |
| Transport | true | Outer only | `0,1,2,4` | 5 |
| Transport | true | Inner only | `0,4,12,20` | 21 |

With the incoming head seeded at position zero, the inner-entry shift cutoff is **strictly less than
`64 + speed`**, using 1/256-tile units: last accepted / first rejected is **95/96 turbo, 87/88 express, 79/80 fast, 71/72 normal**.
This local boundary is not a complete merge rule: express still has an upstream-clearance counterexample.
The equivalent observed landing limit is below 131 units; arbitrary incoming head phases remain uncalibrated.
Backed-up single-stream repeated hands now match the finite receiving/incoming queue model at all four speeds,
including the fast/normal cases that exhausted the old unlimited-stock approximation. Eight portable clips
compare both queues and held quantities over 4,096 ticks, conditioned on native arm starts/drops. Operating mixed-item controls
starve at every speed and with either ingredient arrangement; inventory-clearing probes cannot prove throughput.

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
it does not establish generated-clock recovery through downstream blockage.

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
**59,328 transitions / 4,568 hand starts** in 48 side-pickup captures, including both physical near sides. Native arm-arrival/drop boundaries remain
inputs. Ten portable clips exercise the production pickup logic and preserve refill evidence; five separate clips
preserve the arm-travel evidence and exercise production reach and stock. Neither comparison proves absolute arm arrival. See the [fixture report](../../tests/game/mechanics/belt-pickup/fixtures/different-items/README.md).

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
| Express undergrounds | true | No recovery; backed-up fallback | 528 / 1,408 ticks | Baseline 432/448; target not recovered | No verified moving default |
| Fast undergrounds | false | Stable | 176 / 704 ticks | 176 throughout | Historical shortfall resolved |
| Normal straight | true | Stable | 176 / 1,408 ticks | 176 throughout | Historical shortfall resolved |
| Normal straight | false | Stable | 176 / 1,408 ticks | 176 throughout | Historical shortfall resolved |
| Normal undergrounds | false | Unstable | 176 / 1,408 ticks | Warm: 176; fully jammed cold offset 1287: 144/208 | Correctly rejects startup-sensitive clock |
| Normal undergrounds | true | Stable | 176 / 1,408 ticks | 176 throughout | Historical recovery alternation resolved |

All 24 gear configurations hold 16 gears / 160 ticks through their baseline and recovery windows. Forty-four
ordinary defaults are correctly marked stable; two are startup-sensitive, and two select a fallback for a
different supply condition. Four additional cold-start controls cover both normal undergrounds at offsets
0 and 1287, matching all 16 output periods each. A full lane can still move: these controls verify stationary
initial stock and empty machines/hands before comparing the simulator. The [build report](../../tests/game/builds/README.md)
links current controls and preserves the original 39-run summaries. Broader startup timing remains a separate
verification gate; warm throughput alone does not establish it.

**Over-the-hood clock recovery.** A mixed-item turbo default produces 64 circuits per 640 ticks before an
interruption, in both mirroring states. After one ingredient is interrupted, recovery repeatedly contains
one 48-item period among four 64-item periods, despite the generator's stable verdict.
The [bounded native trace](../../tests/game/builds/over-hood-lane-phase-control.json) shows the interrupted
lane shift by half a stack interval while the other lane keeps its phase. The existing pickup kernel reproduces
this output pattern with separate lane phases; clock verification currently initializes both alike.
The mirrored express default similarly recovers to 96/112 rather than 112 items per 1,120 ticks.
The [32 operating controls](../../tests/game/builds/over-hood-clock-controls.json) cover all four speeds, both
mirroring states and supplies, and same/different ingredients: 21 meet exact baseline and recovery output,
including all 16 same-item cases; eight already receive unstable/no-recovery verdicts; these three receive
false stable verdicts. Two fast moving mixed-item baselines already contain zero-output periods, so their
recovery counts are retained without certifying recovery. This is a clock-verification gap, not a different
lane-preference rule. Its simulator correction remains a separate release gate.

**Side supply and capture.** Single streams enter at **67 inner / 188 outer** units. The bounded turbo merge
requires finite incoming/receiving/downstream queues, compressed gaps and backpressure; seven repeated controls
match all 511 transitions each, and its generated gear clock held 60/60 periods. Testing a shifted starting
belt phase rejected the earlier 64-unit shift cap. Operating mixed-item layouts starve because refusing outer
stock stops opening inner gaps;
supported topology does not guarantee recipe supply. Sidecar's saved support/model metadata distinguishes
supported, unsupported and legacy inputs. Updating software never promotes an old unsupported capture;
recapture is required. See the [capture boundary](capture.md).

## Evidence limits

The fixture reports distinguish manual observations, automated mechanics checks and generated-clock checks.
Replays aligned to observed stock or arm timing do not independently prove startup phase or feeder timing.
Inventory-clearing probes do not establish crafting throughput; seeded controls do not establish natural supply.
Matching hand counts does not prove routing, as the express merge counterexample demonstrated.

Supported merge scope remains the bounded turbo, four-item-stack, single-consumer straight layout. Express
and other slower merges remain unsupported despite native measurements. Sparse or independently phased supply,
broader orientations and competing-consumer networks remain unverified. Early disabled-filter probes and a mixed-machine run with a closed gate were
excluded from the corresponding findings. Detailed fixture reports retain those corrections and reproduction
instructions. Full raw captures stay in ignored `work/` directories; fixture images use the shared native
screenshot-to-JPEG script.
