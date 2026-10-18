# Side-loading into a straight pickup tile: supply entry and merging

This paired experiment identifies why pickup geometry alone is insufficient. A straight belt's exposed line length does not establish
how much of that line a moving item stream traverses before an inserter can collect it. Items fed from the side
can enter near the downstream end, leaving most of the pickup tile empty even while the incoming lane is full.

## Layouts

![Side-loaded straight pickup tile, with its iron feed approaching from below](side-loaded-scaffold.jpg)

`side-loaded-scaffold.txt` has an eastbound straight turbo pickup belt, an unmirrored legendary stack inserter
north of it, and an iron-plate feed arriving from the south. An empty west-side belt stub keeps the pickup tile's
shape straight. Two legendary feeder inserters keep the incoming right lane full; its left lane stays empty.
The output continues east into a drain loader and disposal chest, so the belt is free to move. The receiving
legendary assembler has the electronic-circuit recipe, but receives no copper cable and cannot start a craft.

![Straight-through control, with the same iron feed approaching from the west](straight-through-scaffold.jpg)

`straight-through-scaffold.txt` rotates the same feed infrastructure west of the pickup and removes the empty
stub it replaces. The pickup tile, input inserter, machine, output drain and feeder capacity are retained.
The side-fed layout uses `config.json`, which describes a moving one-tile straight pickup with iron on physical
lane 2 and `pickup_supply: ["through", "side-inner"]`. The control test omits that supply override.
The screenshot settings are in the [game guide](../../../../README.md#scaffold-screenshots); these are layout
references rather than the probe's exact starting state or evidence of timing.

## Setup and measurement

Measured on 2026-10-18 in Factorio 2.1.21 with legendary stack inserters, hand capacity 16 and four-item turbo
belt stacks. An empty wired constant combinator holds the machine input disabled during 1,200 warm-up ticks.
The probe verifies an empty hand and a straight eastbound pickup tile, disables circuit enable control/filters,
sets hand capacity 16 and clears machine inventories once. It observes ticks 1–30 using the shared capture and
belt snapshot helpers. It does not insert items, modify feeder hands or refill belts through Lua.

Generic staged saturation is deliberately not used: the side-fed pickup tile is never populated along its whole
line. Instead, each sample verifies that the incoming right lane contains 16 items and cannot accept another
stack at its back. This condition holds through both first hands. Machine inputs/output stay empty and crafting
progress stays zero throughout them, excluding destination blocking and upstream feeder starvation as explanations.

| Feed into pickup | Exposed length, each lane | Initial lane-2 stacks | Game grab offsets | Legacy through assumption |
| --- | --- | --- | --- | --- |
| Straight through from west | 1 tile | 4 stacks of 4 | `0,1,2,3` | `0,1,2,3` |
| Side-loaded from south | 1 tile | 1 stack of 4 | `0,2,4,6` | `0,1,2,3` |

Both hands collect 4, 8, 12 and 16 iron plates. The side-fed hand grabs each arriving stack near the pickup tile's
downstream end. The single initial stack is at transport-line position `0.01171875` at probe tick 1; the rest of
that lane is empty. The straight-through control starts at positions `0,0.25,0.5,0.75` and matches the current model.
The incoming lane remains full in both layouts while these differences develop on the pickup tile.

## General finding

**Pickup depends on the stacks actually traversing the reachable part of a lane. A full incoming belt does not
imply a full pickup tile.** Side-loading changes supply, while the inserter's reach and lane preference stay the same.

The extended experiment derives all variants from the photographed side-loaded scaffold. It changes the incoming
lane, reflects or rotates the whole layout, changes belt speed, or removes only the ingredient drain loader.
It leaves the input disabled for 16 observation ticks after warm-up, then releases the existing circuit gate.
A second turbo phase releases it after tick 17. No stacks are placed or feeder hands modified by Lua. All
populated incoming lanes remain full at every sample through the first completed hand, and machine inventories
and crafting progress stay empty/zero. Both receiving transport lines still report length 1.

For the eastbound receiving belt with feed arriving from the south:

- Both incoming lanes feed **receiving lane 2**. They do not become two receiving lanes.
- Incoming lane 2 is on the **inside of the turn** and enters close to the receiving lane's downstream end.
- Incoming lane 1 is on the **outside of the turn** and enters farther upstream.
- Reflecting the layout so feed arrives from the north swaps those incoming lane numbers and feeds receiving
  lane 1. Rotating the inner-feed layout through the other three cardinal directions preserves its timing.

The inner/outer names describe the incoming stream's turn, independently of the inserter's preferred lane.
The inserter in these experiments takes from the sole populated receiving lane; its preferred lane is empty.

### One incoming moving lane

Transport-line positions decrease toward zero at the downstream end. Tracking the same stack ID across the
junction establishes these effective transfer boundaries, in tiles from that end:

| Incoming stream | Boundary `E` | Approximate supplied span of the receiving tile |
| --- | --- | --- |
| Inside of turn | `67/256 = 0.26171875` | Downstream quarter |
| Outside of turn | `188/256 = 0.734375` | Downstream three quarters |

For an unblocked crossing, `new_position = E - (speed - previous_incoming_position)`: unused motion after
crossing the incoming line's end is carried into the receiving line. These constants describe the measured
straight-tile junction in Factorio 2.1.21, not new values for physical `pickup_length`.

A simple independent replay maintains quarter-tile stack spacing, advances at belt speed, restricts the train
to `0 <= position < E`, and removes the upstream-most available stack once per tick. Phase is inferred from the
first sample **before pickup**; only the first attempt tick is taken from the observed hand. That replay matches
every sampled receiving-stack position and hand count through all 15 single-lane moving first hands. It uses no
fixed pickup delay or belt-specific hand offsets.

These are the measured grab offsets for the gate released after tick 16; they are phase-dependent examples:

| Belt speed | Outer stream only | Inner stream only | Both incoming lanes |
| --- | --- | --- | --- |
| Turbo | `0,1,2,4` | `0,2,4,6` | `0,1,2,3` |
| Express | `0,1,2,4` | `0,1,4,6` | `0,1,2,3` |
| Fast | `0,1,2,4` | `0,4,8,12` | `0,1,2,3` |
| Transport | `0,1,2,4` | `0,4,12,20` | `0,1,2,3` |

The reflected turbo layout gives the same inner/outer patterns. The three rotated turbo inner-feed layouts
retain `0,2,4,6`. Releasing the turbo gate one tick later changes **both** single-stream patterns to `0,1,3,5`;
the two-stream hand remains `0,1,2,3`. Thus even the inner stream does not always require two ticks between grabs.

### Two incoming moving lanes

Both streams compete for space on **one** receiving lane. Before pickup, the outer stream keeps flowing and
the leading inner stack ID stays stationary for all 16 observation ticks. After the inserter creates holes,
that waiting inner stack leaves its input queue. Its ID appears on the receiving lane at turbo/express speed
and in the reflected turbo case; at fast/transport speed its departure coincides with a four-item hand increase
between observations. The four consecutive grabs therefore do not establish two independent supplies or a
globally preferred incoming lane. They demonstrate a merge whose available space changes when the inserter withdraws stacks.

In the express merge, an inner stack appears at `0.44921875`, upstream of its free-flow boundary `0.26171875`.
A fixed supplied span alone cannot describe this case: collision and backpressure affect placement, arrivals and phase.
Do not add the two streams' throughput or treat the outer stream as an unconditional priority rule. Different
items in the merging streams, additional rear/side feeds, unequal speeds and repeated hands remain untested.

### Backed-up supply

Removing only the drain loader makes stacks stationary before pickup. All three turbo variants (inner, outer,
and both streams) fill their first hand at `0,1,2,3`. The inner-only receiving lane initially holds three stacks
at `0,0.25,0.5`; the others hold four at `0,0.25,0.5,0.75`. Accumulation lets the inner-only lane extend upstream
of its free-flow entry boundary. Consequently the moving supplied-span restriction must not be applied unchanged
to backed-up stock. These first hands agree with the existing backed-up pickup timing; they do not establish
unlimited stock or repeated-hand throughput.

## Simulator and capture model

Keep the pickup rules small:

1. Check the preferred receiving lane first; fall back to the other lane for the same held item when needed.
2. Take the upstream-most reachable available stack, at most one stack per tick.
3. Let belt supply determine which stacks are present. Geometry and supply motion remain separate.

The simulator represents **supply entry per receiving lane at the pickup**, separately from `pickup_length`
and `near_lane`. For example, the side-fed fixture uses:

```json
"source": {
  "type": "belt", "id": 1, "near_lane": 1, "pickup_length": 1,
  "pickup_supply": ["through", "side-inner"]
}
```

`pickup_supply` names one profile for every lane in the referenced belt's `lanes`. Omitted profiles retain the
existing through-stream assumption. `side-inner` and `side-outer` describe a single continuously full, same-speed
stream into a straight, one-tile pickup. A side profile with half-tile geometry or a mismatched lane count is
rejected. Underground endpoints and bends are not inferred from this straight-tile measurement.

Moving side profiles use the measured free-flow boundary as the supplied span. Internally distances use 1/256-tile
integers, representing the entry offsets, quarter-tile stack spacing and all four speeds exactly. The entry's
fractional offset participates in phase; no fixed pickup delay is added. Holes and partial stacks persist across
control changes. Through profiles preserve previous timing. Backed-up inputs retain their saturated availability
rule and their geometry/profile metadata; the shorter **moving** span does not restrict accumulated stock.

The 15 moving single-stream game cases compare the production pickup mode's hand counts with each sample through
the completed hand. Their phase is aligned from a pre-pickup stack position, not from the later grab pattern.
Initial phase remains an assumption for an ordinary config: blueprint geometry alone does not determine it.
The two single-stream backed-up cases also compare production hand counts. These bounded first-hand checks do
not establish arbitrary initial phases, sparse supply, shared withdrawals or repeated-hand throughput.

Sidecar 0.11.0 captures local receiving lanes and these profiles at side-fed straight pickup tiles. It keeps both
physical lane slots, including empty lanes, so preference and supply metadata retain the same numbering. This
local view is separate from the connected network's aggregated lane contents; two upstream lanes joining one
receiving lane do not become two exported input supplies. Ordinary through/underground capture is unchanged.

An empty connected input is excluded only when its upstream straight path has no observed items, no inserter
that can drop on that lane, and no unresolved input. Traversal is bounded and cycles or unsupported paths remain
ambiguous. An empty but potentially active feeder therefore cannot silently disappear from the classification.
Occupied lanes still establish the same static item/saturated-supply assumption used elsewhere in capture, not
a guarantee of their future rate. Modded inserter reach beyond vanilla's two-tile reach is outside this classifier.

Multiple observed streams joining one receiving lane produce a `merge` pickup warning and no supply profile.
Ambiguous inputs, unequal speeds or unsupported side-feed geometry produce `supply-unknown`. Geometry and
preference remain captured; the copy window and import preview explain the supply limitation. These diagnostics
remain outside the simulator config. Moving/backed-up selection stays explicit: the existence of an outlet or
a snapshot is not proof of sustained motion. Unsupported captures retain the baseline assumption with a warning,
not a claim of timing agreement; resolve that supply before relying on a generated clock.

Merges need shared receiving-lane stock, insertion spacing and backpressure, rather than independent infinite
trains or permanently shortened spans. That behavior remains unmodeled. The matrix asserts merge diagnostics
and preserves the observed blocking/release; it does not claim production simulator agreement for two streams.

## Reproduce

From `clock-generator/`, with the [game setup](../../../../README.md#setup):

```bash
npm run test:game -- tests/game/mechanics/belt-pickup/side-loaded-straight.game.test.ts
npm run test:game -- tests/game/mechanics/belt-pickup/side-loaded-entry.game.test.ts
npm run screenshots -- --case=side-loaded-straight
npm run screenshots -- --case=side-loaded-straight/control
```

The paired game test checks both layouts, incoming fullness, initial source stacks, hand counts, machine
state, Sidecar capture/export and simulator agreement. It composes `probe.lua`, then removes temporary
recordings. The 24-case entry matrix derives its variants in `side-loaded-entry.game.test.ts` and uses the same probe with
a delayed gate release and 96 observation ticks. It checks incoming fullness, transfer IDs/boundaries, the independent
single-stream replay, merge blocking/release, stationary backed-up stock and first-hand counts. Reports retain the
shared `front-pickup.json` schema with `initial` metadata and `samples`, adding incoming `feed` counts/fullness
and detailed stacks to every sample. Raw manual captures remain locally under
`work/belt-pickup/side-loaded-single-lane-moving-01/` and `straight-through-single-lane-moving-01/`.

Extended raw captures are under `work/belt-pickup/side-loading-entry-investigation/`, with one subdirectory per
variant containing its parameters, generated blueprint/config, probe, recording and detailed samples.
