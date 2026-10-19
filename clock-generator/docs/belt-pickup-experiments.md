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
  falling back to the other lane for the same item when needed. Switching lanes adds no fixed delay.
- Straight belts expose **one tile per lane**; underground endpoints expose **half a tile**. Moving stacks,
  holes, partial stacks and lane phase persist across hands and circuit windows. Underground pickups have
  less reach, rather than a fixed tick penalty.
- Geometry and supply motion are separate. Omitted `pickup_length` defaults to **1**; undergrounds use **0.5**.
  Moving is the default. Explicit backed-up supply uses the calibrated one-stack-per-tick availability rule.
- Replenishment depends on topology. A full incoming belt need not fill the pickup tile, and closing a final
  outlet does not guarantee permanent local saturation when other consumers can reopen a route.

## Belt-speed coverage

**Tested** means native measurements are documented for the named scenario; it does not mean every phase,
orientation or topology is verified, or that the simulator supports it. **Not tested** marks combinations
without documented native evidence in this investigation. Normal means the standard transport-belt speed.
Offline expectations and classifier-only checks do not count as native timing coverage.

### Straight and underground pickups

“All three geometries” means straight belt, underground entrance and underground exit, with a side pickup.
Front-facing rows cover the measured layouts and both mirroring states.

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Moving, one matching lane — all three geometries | Tested | Not tested | Not tested | Not tested |
| Moving, same item on both lanes — all three geometries | Tested | Tested | Not tested | Not tested |
| Backed up, each ingredient isolated — all three geometries | Tested | Not tested | Not tested | Not tested |
| Backed up, same item on both lanes — side pickups | Not tested | Not tested | Not tested | Not tested |
| Straight-belt ingredient-demand / insertion-limit controls | Tested (manual) | Not tested | Not tested | Not tested |
| Front exit, backed up — different and same items | Tested | Not tested | Not tested | Not tested |
| Front exit, moving | Not tested | Not tested | Not tested | Not tested |
| Front entrance, moving — different items | Tested | Not tested | Not tested | Not tested |
| Front entrance, moving — same item on both lanes | Tested | Not tested | Not tested | Not tested |
| Front entrance, backed up — different and same items | Tested | Not tested | Not tested | Not tested |

The current front-exit fixture physically blocks continuation; moving coverage needs a suitable new layout.

### Side-entry and merge controls

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Moving inner-only and outer-only streams, first hand, release 16 | Tested | Tested | Tested | Tested |
| Moving two-stream merge, first hand, release 16 | Tested | Tested | Tested | Tested |
| Single-/two-stream first hands, release 17 | Tested | Not tested | Not tested | Not tested |
| Reflected side feeds and rotated inner feed, first hands | Tested | Not tested | Not tested | Not tested |
| Backed-up inner-only, outer-only and two-stream first hands | Tested | Not tested | Not tested | Not tested |
| Repeated same-item merge, release 16 | Tested | Tested (routing counterexample) | Not tested | Not tested |
| Repeated same-item merge, release 17 | Tested | Not tested | Not tested | Not tested |
| Repeated merge: pause/resume, outlet block/release and reflection | Tested | Not tested | Not tested | Not tested |
| Repeated different-item merge, both ingredient arrangements | Tested | Not tested | Not tested | Not tested |
| Operating mixed-item merge starvation | Tested | Not tested | Not tested | Not tested |
| Seeded entry-window cutoff and compression controls | Tested | Not tested | Not tested | Not tested |

First-hand merge measurements at fast/normal speeds do not establish repeated routing behavior. Express's
repeated control is measured but remains unsupported because the turbo routing rule fails there.

### Splitter research, generated clocks and drops

| Scenario | Turbo | Express | Fast | Normal (transport) |
| --- | --- | --- | --- | --- |
| Single splitter: ingredients, mirroring, ports, filters and priority controls | Tested | Not tested | Not tested | Not tested |
| Two serial splitters: independent mirroring and priority controls | Tested | Not tested | Not tested | Not tested |
| Shelved splitter replay and 30 seeded routing calibrations | Tested (archived) | Not tested | Not tested | Not tested |
| Electromagnetic clocks, all three geometries: moving/backed-up throughput and recovery | Tested | Not tested | Not tested | Not tested |
| Same-item gear clocks, all three geometries: throughput and recovery | Tested | Not tested | Not tested | Not tested |
| Two-stream merge generated gear clock | Tested | Not tested | Not tested | Not tested |
| Belt drops, stack sizes 1–4 | Tested | Not tested | Not tested | Not tested |

Splitter implementation remains out of scope.

## Tick-pattern matrix

Unless stated otherwise, these are **grab offsets from the first grab of a hand**, with four-item belt stacks
and a 16-item inserter hand. Each number is one stack pickup: `0,1,2,4` means the fourth grab waits one tick.
Measurements primarily use Factorio **2.1.21**, legendary stack inserters and turbo belts. Patterns describe
these measured conditions, rather than every startup phase or an absolute arm-arrival time.

Total pickup ticks counts both the first and last grab ticks: `0,1,2,3` takes **4 ticks** and `0,1,2,4`
takes **5 ticks**. It excludes waiting before the first grab and arm travel. **Moving = false** denotes backed-up supply.

### Straight and underground pickups

| Scenario | Moving | Lane contents | Measured offsets | Total pickup ticks | Lane behavior |
| --- | --- | --- | --- | --- | --- |
| Straight belt, side pickup | true | One matching lane | `0,1,2,3` in the measured phase | 4 | Preferred matching lane |
| Underground entrance or exit, side pickup | true | One matching lane | `0,1,2,4` or `0,1,3,5`, depending on phase | 5 or 6, respectively | Half-tile reach exposes gaps |
| All three geometries, side pickup | true | Same item on both lanes | `0,1,2,3` | 4 | Other lane fills preferred-lane gaps |
| All three geometries, side pickup | false | Each ingredient isolated | `0,1,2,3` | 4 | Other lane stays untouched |
| Front underground exit | false | Different items or same item | `0,1,2,3` | 4 | All four from the preferred lane |
| Front underground entrance | true | Different items | `0,1,2,4` | 5 | Preferred lane supplies the held item |
| Front underground entrance | true | Same item | `0,1,2,3` | 4 | Lane sequence `1,1,1,2` unmirrored; `2,2,2,1` mirrored |
| Front underground entrance | false | Different items or same item | `0,1,2,3` | 4 | All four from the preferred lane |

In the tested front-facing entrance and exit layouts, **unmirrored prefers lane 1; mirrored prefers lane 2**.
Ingredient swaps distinguish lane preference from recipe order. The front-exit inserter blocks continuation,
so its controls are backed up; moving front-exit grabs remain unmeasured. Classifier rotation tests do not
establish native pickup timing in every cardinal orientation.

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

Earlier single-stream speed controls measured the following at gate release 16. Further investigation focused
on turbo; these first hands do not establish two-stream support at the other speeds.

| Incoming speed | Moving | Stream | Measured offsets | Total pickup ticks |
| --- | --- | --- | --- | --- |
| Express | true | Outer only | `0,1,2,4` | 5 |
| Express | true | Inner only | `0,1,4,6` | 7 |
| Fast | true | Outer only | `0,1,2,4` | 5 |
| Fast | true | Inner only | `0,4,8,12` | 13 |
| Transport | true | Outer only | `0,1,2,4` | 5 |
| Transport | true | Inner only | `0,4,12,20` | 21 |

### Direct splitter pickups — unsupported research

These are natural captures with an operating machine. The single-splitter layout has a south pickup port and
north drain; the serial layout has two splitters and two consumers feeding one machine. Priority controls are
independent tests with ingredients, mirroring and gate timing unchanged.

Here **Moving = false** describes the locally blocked pickup ports. Other outputs can still drain or route
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

### Related belt-drop calibration

These are **deposit offsets**, not pickups. A finite 32-item source feeds a turbo belt; only the belt-stack
bonus changes, with researched technologies checked unchanged.

| Belt stack size | Effective full hand | First-hand deposit offsets | Next hand's first deposit, relative to the first hand's start |
| --- | --- | --- | --- |
| 1 | 16 | `0,1,2,4,6,…,28` | 36 |
| 2 | 16 | `0,1,2,4,6,8,10,12` | 20 |
| 3 | 15 | `0,1,2,4,6` | 14 |
| 4 | 16 | `0,1,2,4` | 12 |

Every deposit and empty tick matches `Belt::amountToDropAtTick`; all 32 items are conserved. Stack size 3
leaves two items held after depositing 30. No production timing change was needed; other speeds remain deferred.

## Simulator impact and verification

**Reach and fallback.** The original full-supply assumption selected 528 electromagnetic packs / 1,056 ticks,
missing the target in 30/35 native periods on each underground. Reachable-stack timing selected **352 packs /
704 ticks = 30 packs/s**, verified on straight, entrance and exit scaffolds. Current regressions cover at least
60 complete periods, ingredient cuts and output blockage for moving and backed-up supply. Same-item fallback
was checked across **78 captures / 5,268 uninterrupted hands**; six generated gear-clock checks held
**16 gears / 160 ticks = 6/s**, with a 26-tick input window instead of the former underground 28.

**Ingredient eligibility.** Manual straight-belt controls preferred a near ingredient stocked at 13 even when
the far ingredient was absent. Swapping ingredients preserved that choice; at the measured insertion limit of
14, selection switched to the far ingredient. Existing eligibility rules agreed; no demand-ranking rule was added.

**Side-entry supply.** Single-stream profiles use measured entry positions **67 inner / 188 outer**, in
1/256-tile units. The supported turbo merge keeps finite incoming, receiving and downstream queues, preserving
backpressure and compressed gaps. Seven repeated controls cover both release phases, pause/resume, outlet
blocking/release, reflection and both mixed-item arrangements; each matches **511 consecutive transitions**.
Ten seeded controls establish entry shifts **89–95 accepted, 96 rejected**. The original 64-unit cap was
falsified by release 17. Followers can slow or wait, never move upstream. A generated gear clock held 60/60 periods.

**Mixed-merge starvation.** An operating machine without inventory clearing ended 1,200 ticks with 16 iron,
zero cable and zero products: no longer accepting outer iron stopped opening inner-stream gaps. Preparation
now reports the repeating stalled state. Supported topology does not guarantee that a recipe can be supplied.

**Capture compatibility.** Sidecar captures front-underground lane preference, geometry and supported supply
profiles. Saved `pickup_capture` metadata distinguishes supported, unsupported and legacy unclassified inputs;
unknown model versions are refused. Updating the engine or mod does not promote an old unsupported capture:
recapture is required. Manual configs retain the straight-belt default. See the [capture boundary](pickup-capture.md).

## Shelved splitter calibrations

A later finite-routing investigation matched a naturally supplied baseline through **60 consecutive
transitions** and **30 independent seeded native controls**, checking all eight transport lines and each
stack's identity, position, item and count. Seeded controls disabled consumers and asserted initial positions;
they calibrate local routing, not natural clock throughput. Observed feeder arrivals and withdrawals remain
explicit boundary inputs in the baseline replay.

For the tested north-input, right-priority turbo layout, distances are in 1/256 tile units:

| Boundary | Calibrated finding |
| --- | --- |
| Movement and spacing | 32 units/tick, normal spacing 64; input length 179, output length 128 |
| Preferred entry | Input head `p < 32` lands at `p + 45`, shifted behind output stock if needed |
| Output admission | Position 127 fits; proposed 128 waits |
| Blocked preferred output | An isolated head waits; follower-dependent overflow was required |
| Overflow window | Follower `q < 96` permits alternate free landing `q - 19`; 95 admits, 96 first waits |
| Upstream admission | Respect input-tail spacing; shifted position 178 fits, 179 remains upstream |

The controls varied input phase, output congestion, follower spacing, insertion order, other-lane saturation
and ordinary upstream arrivals. They rejected constant entry at 64, an assumed cutoff at 77, unconditional
diversion when blocked, and admission without tail spacing. No extra remembered-choice state was needed to
fit these captures; that does not establish general memoryless splitter routing.

The work remains frozen at
[`7a1b4e2e`](https://github.com/abucnasty/clock-generator/commit/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a):
[all 30 calibration variants](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/splitter-entry-window.game.test.ts),
[probe](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/fixtures/splitter/entry-window-probe.lua),
[experimental kernel](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/src/state/turbo-splitter-supply.ts)
and [compact native cuts](https://github.com/abucnasty/clock-generator/blob/7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a/clock-generator/tests/game/mechanics/belt-pickup/fixtures/splitter/right-priority-transitions.json).
Sub-PRs #239, #241 and #242 merged only into the shelved feature; #240 was closed. Eleven replay tests and five
kernel tests passed there, but **no generated splitter clock was verified**. These sources are absent from
master and require a separate archived checkout to reproduce. They do not enable configuration or capture support.

## Evidence limits

The fixture reports distinguish manual observations, automated mechanics checks and generated-clock checks.
Replays aligned to observed stock or arm timing do not independently prove startup phase or feeder timing.
Inventory-clearing probes do not establish crafting throughput; seeded controls do not establish natural supply.
Matching hand counts does not prove routing, as the express merge counterexample demonstrated.

Supported merge scope remains the bounded turbo, four-item-stack, single-consumer straight layout. Express
and other uncalibrated merges, sparse/arbitrary-phase supply, broader orientations and competing-consumer
networks remain unverified. Early disabled-filter probes and a mixed-machine run with a closed gate were
excluded from the corresponding findings. Detailed fixture reports retain those corrections and reproduction
instructions. Full raw captures stay in ignored `work/` directories; fixture images use the shared native
screenshot-to-JPEG script.
