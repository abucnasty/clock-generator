# Belt pickup experiment findings

This report summarizes the belt-pickup experiments, their timing patterns and simulator impact. Detailed
measurements, screenshots and reproduction commands remain in the [mechanics fixtures](../tests/game/mechanics/belt-pickup/README.md).
The [simulator guide](simulator.md#picking-up-from-moving-belts-and-underground-endpoints) defines supported behavior.

The accepted changes are unreleased, reserved for **engine/UI 0.19.0** and **Sidecar 0.11.0**.
Publishing remains on hold. **Splitter implementation is out of scope**; its measurements are retained as research.

## General rules

- Collect an ingredient the destination accepts, preferring the configured lane. Keep collecting the held
  ingredient. A missing ingredient on the other lane does not automatically override eligible preferred stock.
- Take at most **one reachable stack per tick**. Use the upstream-most matching stack on the preferred lane,
  falling back to the other lane for the same item when needed. No universal lane-switch delay was found;
  one normal-speed side-entrance layout exposes an arm-travel delay missing from the point-based model.
- Straight belts expose **one tile per lane**; underground endpoints expose **half a tile**. Moving stacks,
  holes, partial stacks and lane phase persist across hands and circuit windows. Underground pickups have
  less reach, rather than a fixed tick penalty.
- Geometry and supply motion are separate. Omitted `pickup_length` defaults to **1**; undergrounds use **0.5**.
  Moving is the default. The engine approximates backed-up supply as one available stack per tick;
  fast/normal measurements expose finite refill that this approximation does not yet model.
- Replenishment depends on topology. A full incoming belt need not fill the pickup tile, and closing a final
  outlet does not guarantee permanent local saturation when other consumers can reopen a route.

## Belt-speed coverage

**Tested** means native measurements are documented for the named scenario; it does not mean every phase,
orientation or topology is verified, or that the simulator supports it. **Not tested** marks combinations
without documented native evidence in this investigation. Normal means the standard transport-belt speed.
Offline expectations and classifier-only checks do not count as native timing coverage. The speed backfill uses
16-item hands and four-item belt stacks. Historical smaller-hand/interrupted-window/staggered-lane controls
are not an exhaustive cross-speed matrix.

### Straight and underground pickups

“All three geometries” means straight belt, underground entrance and underground exit, with a side pickup.
Front-facing rows cover the measured layouts and both mirroring states.

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Moving, one matching lane — all three geometries | Tested | Tested | Tested | Tested |
| Moving, same item on both lanes — all three geometries | Tested | Tested | Tested | Tested; entrance counterexample |
| Backed up, each ingredient isolated — all three geometries | Tested | Tested | Tested; refill counterexamples | Tested; refill counterexamples |
| Backed up, same item on both lanes — side pickups | Tested | Tested | Tested | Tested; refill counterexamples |
| Reflected side pickups, same item — moving, base release | Tested | Tested | Tested | Tested; entrance counterexample |
| Reflected side pickups, same item — backed up | Tested | Tested | Tested | Tested; refill counterexamples |
| Backed-up straight-belt demand / insertion-limit controls | Tested | Tested | Tested | Tested |
| Front exit, backed up — different and same items | Tested | Tested | Tested; refill counterexample | Tested; refill counterexample |
| Front exit, moving | Not tested | Not tested | Not tested | Not tested |
| Front entrance, moving — different items | Tested | Tested | Tested | Tested (compact layout) |
| Front entrance, moving — same item on both lanes | Tested | Tested | Tested | Tested (compact layout) |
| Front entrance, backed up — different and same items | Tested | Tested | Tested; refill counterexample | Tested; refill counterexample |

The front-exit fixture physically blocks continuation; moving coverage awaits the user-supplied layout.
Normal moving front-entrance controls use a paired compact assembler layout: the original plant needs a tunnel
longer than normal underground range. Equivalent compact controls were also measured at the other speeds.
Front-entrance phase sweeps verify actual first-grab positions, rather than assuming gate-delay labels imply
distinct phases. Other cardinal orientations and arbitrary lane-to-lane phase offsets remain separate dimensions.

### Side-entry and merge controls

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Moving inner-only and outer-only streams, first hand, release 16 | Tested | Tested | Tested | Tested |
| Moving two-stream merge, first hand, release 16 | Tested | Tested | Tested | Tested |
| Single-/two-stream first hands, release 17 | Tested | Tested | Tested | Tested |
| Reflected side feeds and rotated inner feed, first hands | Tested | Tested | Tested | Tested |
| Backed-up inner-only, outer-only and two-stream first hands | Tested | Tested | Tested | Tested |
| Repeated same-item merge, release 16 | Tested | Tested; routing counterexample | Tested; unsupported | Tested; unsupported |
| Repeated same-item merge, release 17 | Tested | Tested; unsupported | Tested; unsupported | Tested; unsupported |
| Repeated merge: pause/resume, outlet block/release and reflection | Tested | Tested; unsupported | Tested; unsupported | Tested; unsupported |
| Repeated different-item merge, both ingredient arrangements | Tested | Tested; unsupported | Tested; unsupported | Tested; unsupported |
| Operating mixed-item merge starvation | Tested | Tested | Tested | Tested |
| Seeded entry-window cutoff and compression controls | Tested | Tested | Tested | Tested |

All four speeds now have repeated native controls. Only the bounded turbo merge is supported by the engine;
measured slower behavior does not establish a correct routing model. Release sweeps cover the tested gate delays,
rather than every possible relative phase of independent incoming streams.

### Splitter research, generated clocks and drops

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Single splitter: ingredients, mirroring, ports, filters and priority controls | Tested | Tested | Tested | Tested |
| Two serial splitters: independent mirroring and priority controls | Tested | Tested | Tested | Tested |
| Seeded splitter routing / admission boundaries | Tested | Tested | Tested | Tested |
| Electromagnetic clocks, all three geometries: moving/backed-up throughput and recovery | Tested | Tested; counterexamples | Tested; counterexamples | Tested; counterexamples |
| Same-item gear clocks, all three geometries: throughput and recovery | Tested | Tested | Tested | Tested |
| Two-stream merge generated gear clock | Tested | Not tested | Not tested | Not tested |
| Belt drops, stack sizes 1–4 | Tested | Tested | Tested | Tested |

The 39 added ordinary clock checks are complete: 29 meet both target and recovery, eight miss baseline targets,
and two meet baseline but fail exact recovery. Slower merge-clock generation is blocked by the intentionally
turbo-only supported merge schema and remains **Not tested**. Splitter backfills restore observation-only probes;
the production routing kernel and splitter implementation remain out of scope.

## Tick-pattern matrix

Unless stated otherwise, these are **grab offsets from the first grab of a hand**, with four-item belt stacks
and a 16-item inserter hand. Each number is one stack pickup: `0,1,2,4` means the fourth grab waits one tick.
Measurements use Factorio **2.1.21** and legendary stack inserters; speeds are identified below. Patterns
describe the measured conditions, rather than every startup phase or an absolute arm-arrival time.

Total pickup ticks counts both the first and last grab ticks: `0,1,2,3` takes **4 ticks** and `0,1,2,4`
takes **5 ticks**. It includes waits between grabs, but excludes waiting before the first grab and travel to/from
the destination. **Moving = false** denotes backed-up supply.

### Straight and underground pickups

| Scenario / speed | Moving | Lane contents | Measured offsets | Total pickup ticks | Interpretation |
| --- | --- | --- | --- | --- | --- |
| Straight, turbo/express | true | One matching lane | `0,1,2,3` in the measured phase | 4 | Later phases/holes remain explicit state |
| Side underground, turbo | true | One matching lane | `0,1,2,4` or `0,1,3,5` | 5 or 6 | Half-tile reach |
| Side underground, express | true | One matching lane | `0,1,2,5`, `0,1,3,5` or `0,1,3,6` | 6 or 7 | Representative repeated patterns |
| Side pickup, fast / normal | true | One matching lane | Depleted hands include `0,1,4,8` / `0,8,16,24` | 9 / 25 | Belt-speed refill limits collection |
| Side pickup, turbo/express/fast | true | Same item on both lanes | `0,1,2,3` in measured controls | 4 | Fallback fills preferred-lane gaps |
| Side entrance, normal | true | Same item on both lanes | First hand `0,1,3,4` | 5 | Observed arm travel; model predicts 4 ticks |
| All geometries, turbo/express | false | Each ingredient isolated | `0,1,2,3` | 4 | Measured full-supply controls |
| Underground, fast / normal | false | Each ingredient isolated | First hand `0,1,2,5` / `0,1,2,9` | 6 / 10 | Finite refill already affects first hand |
| Side straight, normal | false | One matching lane | First `0,1,2,3`; later `0,8,16,24` | 4, then 25 | Initial stock masks later depletion |
| Underground, fast / normal | false | Same item on both lanes | First `0,1,2,3` | 4 | Other lane helps; normal later hands can still wait |
| Front entrance, turbo | true | Different items | `0,1,k,k+2`, `k = 2..3` | 5–6 | Both observed arrival phases |
| Front entrance, express | true | Different items | `0,1,k,k+d`, `k = 2..4`, `d = 2..3` | 5–8 | Eight observed arrival phases |
| Front entrance, fast | true | Different items | `0,1,k,k+4`, `k = 2..5` | 7–10 | Four observed arrival phases |
| Front entrance, normal (compact) | true | Different items | `0,1,k,k+8`, `k = 2..9` | 11–18 | Eight observed arrival phases |
| Front entrance, all speeds | true | Same item on both lanes | `0,1,2,3` | 4 | Every measured phase; distinct from the side-entrance counterexample |

These are representative patterns, not an exhaustive list of repeated-hand states. The fixture baselines retain
all observed patterns and known simulator differences. In the tested front-facing layouts, **unmirrored prefers
lane 1; mirrored prefers lane 2**, preserved by ingredient swaps. Fast/normal backed-up front controls can use
fallback even on the first hand; the turbo rule that all four grabs stay on the preferred lane is not universal.
Moving front-exit grabs remain unmeasured.

### Side-loading onto a straight tile

Inner and outer identify the incoming stream's entry into the receiving lane, not a new inserter preference.
Gate releases 16 and 17 deliberately change initial phase.

| Scenario | Moving | Gate release | Measured offsets | Total pickup ticks | Finding |
| --- | --- | --- | --- | --- | --- |
| Turbo outer stream only | true | 16 | `0,1,2,4` | 5 | Enters near the upstream three-quarter position |
| Turbo inner stream only | true | 16 | `0,2,4,6` | 7 | Enters near the downstream quarter position |
| Turbo inner or outer stream only | true | 17 | `0,1,3,5` | 6 | Phase matters |
| Turbo single-stream controls, drain removed | false | 16 | `0,1,2,3` | 4 | Backed-up first hands; not proof of infinite repeated supply |
| Turbo two-stream merge, same item | true | 16 and 17 | `0,1,2,3` across 45 complete hands per control | 4 | Shared stock replenishes both entry points |
| Turbo two-stream merge, different items, either arrangement | true | 16 | `0,1,2,4` for complete hands | 5 | Outer stream dominates in the inventory-clearing probe |
| Express two-stream merge, same item | true | 16 | `0,1,2,3` across 45 hands | 4 | Same hand timing conceals different routing; unsupported |

Single-stream first hands at gate release 16 are below. Repeated controls have since been captured at every
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
Backed-up fast/normal single-stream repeated hands also expose finite refill. Operating mixed-item controls
starve at every speed and with either ingredient arrangement; inventory-clearing probes cannot prove throughput.

### Direct splitter pickups — unsupported research

These are natural captures with an operating machine. The single-splitter layout has a south pickup port and
north drain; the serial layout has two splitters and two consumers feeding one machine. Priority controls are
independent tests with ingredients, mirroring and gate timing unchanged.

The table below records the original **turbo** controls. Here **Moving = false** describes the locally blocked pickup ports. Other outputs can still drain or route
stock after withdrawals, so this does **not** imply the simulator's saturated backed-up availability rule.
Totals below refer to the first hand; later behavior is listed separately.

| Scenario | Moving | First-hand offsets | Total pickup ticks | Later behavior / interpretation |
| --- | --- | --- | --- | --- |
| One splitter, right priority, drain open | false | `0,1,2,3` | 4 | Next four hands `0,1,2,4`; ordinary saturated supply fails |
| Same layout, ingredients swapped or inserter mirrored | false | `0,1,2,3` | 4 | Same timing limitation; selected physical lane follows mirroring |
| One splitter, right priority, drain removed | false | `0,1,2,3` | 4 | Six hands remain consecutive |
| One splitter, priority unset, drain open | false | `0,1,2,5` | 6 | Stock diverts to the other output while pickup is empty |
| One splitter, priority unset, drain removed | false | `0,1,2,3` | 4 | Six hands remain consecutive in this local control |
| One splitter, priority toward the open drain | false | No grabs in 60 ticks | — (no pickup) | Pickup port receives no stock |
| One splitter, iron or cable output filter | false | `0,1,2,3` | 4 | Supply filter and machine insertion limits still apply |
| Two serial splitters, both right priority | false | Both `0,1,2,3` | 4 each | Ingredient swaps and independent mirroring flips preserve first-hand timing |
| Two serial splitters, both priorities unset | false | Both `0,1,2,5` | 6 each | Each changed splitter delays its own first hand |
| Two serial splitters, only one priority unset | false | Changed: `0,1,2,5`; other: `0,1,2,3` | Changed: 6; other: 4 | Isolates the source of diversion |
| Two serial splitters, both unset, final drain removed | false | Both `0,1,2,3` | 4 each | Upstream second hand becomes `0,1,2,5`; withdrawals reopen the through route |

For reference, a first hand at capture ticks `2,3,4,7` is offsets **`0,1,2,5`**. The usual consecutive control is
at ticks `2,3,4,5`. A later serial wait at `58,59,60,88` comes from the shared machine's insertion limit,
not absent stock. These observations reject a universal splitter delay or a blanket backed-up approximation.

The all-speed observation backfill preserves the priority distinction. For one splitter with an open drain:

| Speed | Moving | Right-priority first-hand offsets | Total pickup ticks | Unset-priority first-hand offsets | Total pickup ticks |
| --- | --- | --- | --- | --- | --- |
| Turbo | false | `0,1,2,3` | 4 | `0,1,2,5` | 6 |
| Express | false | `0,1,3,6` | 7 | `0,1,3,8` | 9 |
| Fast | false | `0,1,3,7` | 8 | `0,1,3,11` | 12 |
| Normal | false | `0,1,2,10` | 11 | `0,1,2,18` | 19 |

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
calibration; an empty-belt formula is not a general finite-output-lane model.

## Simulator impact and verification

**Reach and fallback.** Replacing the always-full underground assumption selected **352 electromagnetic packs /
704 ticks = 30/s**, verified on all three turbo scaffolds with at least 60 periods and recovery interventions.
The former 528/1,056 clock missed 30/35 native periods underground. Same-item fallback also reduced the gear
clock's underground input window from 28 to 26 ticks; all six turbo/express checks held **16 gears / 160 ticks = 6/s**.

**Four-speed collection.** Of 72 naturally supplied repeated-hand controls, 56 match production held counts.
Fifteen fast/normal backed-up cases expose finite refill; one normal moving side-entrance case exposes arm
travel. The 198-combination observed-phase sweep reproduces the latter at four phases; the other 194 agree.
A further 24 reflected same-item controls reproduce every original pattern set and difference count with lane 2
preferred: 20 match production held counts, and the same four normal-speed cases remain counterexamples.
Held-count agreement alone does not establish backed-up lane/stock fidelity, which the current model omits.
Twelve automated demand controls preserve the existing rule: eligible near stock 13 wins over absent far stock;
at near stock 14, selection switches to the far ingredient. No demand-ranking rule was needed.

**Candidate backed-up rule.** Advance a jammed queue at actual belt speed, stop its head at the endpoint,
maintain quarter-tile spacing, and withdraw the upstream-most reachable matching stack. Preserve holes across
hands. Seeded once at the closed gate, a test-only replay matches all exposed stock and held counts across
**59,328 transitions / 4,568 hand starts** in 48 ordinary captures, including both physical near sides. Native arm-arrival/drop boundaries remain
inputs. Ten portable clips preserve refill evidence and five preserve arm-travel evidence; neither is a
production implementation or proof about absolute arm arrival. See the [fixture report](../tests/game/mechanics/belt-pickup/fixtures/different-items/README.md).

**Front controls.** The 228 first-hand captures verify lane preference across ingredients, mirroring, speeds
and observed entrance phases. Normal moving entrance coverage uses the paired compact destination; moving
front-exit coverage remains open.

**Generated clocks.** Collection replay after observed arm arrival does not establish
clock throughput or a reliable stability verdict. Electromagnetic targets scale with belt speed: 22.5/s express,
15/s fast and 7.5/s normal; gear targets stay at 6/s. The measured limitations are:

| Clock / speed | Moving | Generator verdict | Expected per period | Native baseline | Recovery finding |
| --- | --- | --- | --- | --- | --- |
| Express undergrounds | true | No recovery | 528 / 1,408 ticks | 432 or 448 | Shortfall persists |
| Fast undergrounds | false | Stable | 880 / 3,520 ticks | 704 | Shortfall persists |
| Normal straight | true | Stable | 704 / 5,632 ticks | 576 or 608 | Shortfall persists |
| Normal straight | false | Stable | 880 / 7,040 ticks | 624 or 656 | Shortfall persists |
| Normal undergrounds | false | Stable | 880 / 7,040 ticks | 528 | Shortfall persists |
| Normal undergrounds | true | Stable | 176 / 1,408 ticks | 176 | 160/192 after output blockage; both ingredient recoveries return 176 |

Every added clock has at least 60 untouched periods; compact counts match two overlapping detailed recorder
periods and native hardware metadata is audited separately. All 21 added gear cases hold 16 gears / 160 ticks
through all interventions. Eight electromagnetic cases meet baseline/recovery targets; ten show the limits
above, including eight marked **Stable** by the generator. Express straight/backed-up, fast moving and fast
backed-up straight controls meet their targets. Causes remain unresolved: input phase/refill,
output stock history and machine/clock timing must be distinguished. The [build report](../tests/game/builds/README.md)
retains the final comparisons. Mean-rate recovery is insufficient when exact output is required every period.

**Side supply and capture.** Single streams enter at **67 inner / 188 outer** units. The bounded turbo merge
requires finite incoming/receiving/downstream queues, compressed gaps and backpressure; seven repeated controls
match all 511 transitions each, and its generated gear clock held 60/60 periods. Release 17 rejected the earlier
64-unit shift cap. Operating mixed-item layouts starve because refusing outer stock stops opening inner gaps;
supported topology does not guarantee recipe supply. Sidecar's saved support/model metadata distinguishes
supported, unsupported and legacy inputs. Updating software never promotes an old unsupported capture;
recapture is required. See the [capture boundary](pickup-capture.md).

## Shelved splitter calibrations

The archived turbo routing candidate matched **60 natural transitions and 30 seeded controls**, checking all
eight lines and stack identities, positions, items and counts. Observed feeder arrivals/withdrawals remain
boundary inputs; seeded consumers are disabled. This is local routing evidence, not clock verification.

| Boundary | Original turbo finding | Four-speed observation backfill |
| --- | --- | --- |
| Geometry/spacing | Input 179, output 128, normal spacing 64 units | Unchanged |
| Preferred entry | Head `p < 32` lands at `p + 45`, shifted behind stock | Landing `p + 77 - speed` in tested crossings |
| Output admission | 127 accepted; 128 waits | Unchanged |
| Blocked preferred output | Isolated head waits; follower `q < 96` can overflow at `q - 19` | Still requires follower/stock state |
| Follower/output-tail cutoff | 95 accepted; 96 first waits | Last accepted 95/87/79/71 for turbo/express/fast/normal |
| Upstream admission | Shifted tail 178 fits; 179 waits upstream | Unchanged; normal decision can take two ticks |

The controls reject constant entry at 64, unconditional diversion and admission without tail spacing. They do
not establish general memoryless arbitration. The backfill adds 60 slower natural controls, 146 seeded controls
and eight boundary repeats, retaining explicit unsupported capture status.

The original [30 controls](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/splitter-entry-window.game.test.ts)
and [experimental kernel](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/src/state/turbo-splitter-supply.ts)
remain at archived commit `7a1b4e2e`. Eleven replay and five kernel tests passed there, but **no generated
splitter clock was verified**. Observation probes are backfilled here; the production kernel remains absent
from master. **Splitter implementation and capture support remain out of scope.**

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
