# Lane ends

[Belt pickup documentation](README.md)

Each lane of a belt has an end: the position downstream where its items stop or leave. This page tells what a lane
end is and how to state it in a configuration. It then shows how to find the end in two layouts. The terms are in
the [glossary](../../../docs/maintainer/glossary.md).

## The three lane ends

| Lane end | What the items do at the end | In the configuration (`lane_end`) |
| --- | --- | --- |
| Dead end | The lane stops. The items stay on it until a hand takes them. The lane is a standing queue. | `{"kind": "dead_end"}` |
| Infinite end | The lane continues. All items that no hand takes go off the lane, as into an infinity chest. The end takes as many items as the lane carries. | `{"kind": "infinite"}` |
| Unknown end | The configuration does not know the end. The generator checks the clock as a dead end and as an infinite end. The clock must hold under both. The Sidecar gives this end only when it cannot see the end of the lane. | `{"kind": "unknown"}` |

A lane end is a fact of the build. It does not change while the build runs. Backpressure and moving are different.
Each one is the state of one lane at one tick.

## How to state the facts of a lane

Each lane in `belts[].lanes` can state its facts. Each fact is optional, and the generator reads each one
independently:

- `supply_rate`: the items per second that come onto the lane where it starts. Without it, the supply rate is the
  capacity of the lane.
- `lane_end`: the end of the lane, as in the table above.
- `sharing`: `shared` (the default) or `per_copy`.

The flow direction is a fact of the belt, not of each lane: `flow_direction` on the belt.

An export lane can have a secondary setpoint (`consumption_per_second`). That rate tells what goes off the end of the
lane. Thus the lane states no lane end, and its end is an infinite end.

## The end of a lane that states none

The generator finds the role of each lane from the inserters, item by item
([lane role](../../../docs/maintainer/glossary.md)):

| Lane role | What the inserters do | End when the lane states none |
| --- | --- | --- |
| Input | An inserter takes the item of the lane from it. No inserter drops that item on it. | Dead end |
| Buffer | Inserters drop the item of the lane on it and take it from it. | Dead end |
| Output | An inserter drops the item of the lane on it. No inserter takes that item from it. | Infinite end |

A lane with no item (`"ingredient": ""`) has the role and the end of the other lane of its belt. A lane that no
inserter takes from or drops on has no role, and its end is an infinite end. The generator never gives an unknown end.

`overrides.backed_up_belts` is deprecated: state the `lane_end` of each lane instead. The generator still reads it, and
it changes the ends only where the configuration states it:

- `true`: each lane that states no end is a dead end. An export lane is an infinite end.
- `false`: each lane that states no end is an infinite end.

Thus a build that states no lane end and no `backed_up_belts` has dead ends on its input lanes: the generator makes
its clocks for pickups with backpressure. A stated `lane_end` is always the end of the lane.

The page has no setting for `backed_up_belts`. When it loads a file, a share link or a saved build that states the
field, it states on each input or buffer lane with no end and no secondary setpoint the end that the field gave it: a dead end
for `true`, an infinite end for `false`. Output lanes, and lanes with no role, get no end and keep the end of their
role. Then the field goes.

To find the end, follow the lane downstream from the last inserter of the configuration that takes from it:

- Where the items stop, the end is a dead end.
- Where the items move on to entities outside the configuration, the end is an infinite end. The configuration
  states no rate at a lane end: the generator lets the end take as many items as the lane carries.
- Where you cannot see what the items do, the end is unknown.

## A belt with one lane stated

A belt that states one lane in `belts[].lanes` has one lane. The generator has no facts for the other lane: no
supply rate, no lane end and no sharing. Thus only the stated lane tells if all the lanes of the belt are dead ends:

- If the stated lane is a dead end, all the lanes of the belt are dead ends. Where all the input lanes of the
  configuration are dead ends, the generator makes the clock for pickups with backpressure.
- If the stated lane is an infinite end or an unknown end, the belt has a lane that is not a dead end.

A lane end comes only to a lane that the belt states. A lane with `"ingredient": ""` is a stated lane. It carries no
item, and its end is the end that it states, the end that the deprecated `backed_up_belts` gives, or the end of the
other lane. A lane with a secondary setpoint (`consumption_per_second`) does not take the end of the other lane: its
end is an infinite end.

An inserter can drop items onto the two sides of a belt with one lane stated. The generator keeps the other side only
for these items.

## A side pickup takes from its near lane first

At a side pickup, the inserter is adjacent to the belt ([pickup layouts](glossary.md#side-pickups)). Both lanes can
carry the item that it takes. Then it takes from the lane nearest to it first. It takes from the far lane only when
the near lane has none of the item in reach. The configuration states the near lane as `source.near_lane`.

Thus the far lane gives what an empty space on the near lane does not give. For this reason, such a pickup gets no
room for one more hand at the end of its enable windows.

## A side-load into an underground end

Belt A side-loads into an underground end of belt B. A stops at the side of the underground end, and its items go
onto B. The two lanes of A then have different ends:

- The lane of A at the hood stops, because the hood blocks it. It is a dead end.
- The lane of A at the opening continues onto B. It is an infinite end. The configuration states no rate at a lane
  end. Thus the generator does not use the rate of the entities on B after the side-load.
- B can already carry items on that lane from upstream. Then state the lane of A as unknown. B has priority at a
  side-load. The items of A go only into the empty spaces on that lane of B. The generator does not model this.

This is the end of a lane that an inserter takes from, downstream of the inserter. It is not a pickup from a belt
tile that another belt side-loads onto. The generator does not accept that pickup
([side-loaded pickups](experiments.md#side-loaded-pickups-and-merges)).

## Example: the inserter build of three copies

The sample `INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK`
([configuration](../../resources/config-samples/intermediates/inserter-crafting/inserter-crafting-240-shared-signal-clock.json))
shows the two layouts together. Two belts bring iron ore on both lanes. On each belt, two inserters at side pickups
take ore for two furnaces.

| Belt | Near lane | End of the near lane | End of the far lane |
| --- | --- | --- | --- |
| 1 | 2 | dead end | infinite end; outside the configuration, 53 1/3 items per second go on |
| 4 | 1 | dead end | infinite end; outside the configuration, 53 1/3 items per second go on |

The sample is cut from a larger build. In that build, each ore belt side-loads into an underground exit after the
third copy. The hood blocks the near lane, so it is a dead end. The far lane continues to two furnaces outside the
configuration. They take 53 1/3 iron ore per second. The configuration cannot state that rate at a lane end.
