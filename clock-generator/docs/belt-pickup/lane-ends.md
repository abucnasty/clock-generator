# Lane ends

[Belt pickup documentation](README.md)

Each lane of a belt has an end: the position downstream where its items stop or leave. This page tells what a lane
end is and how to state it in a configuration. It then shows how to find the end in two layouts. The terms are in
the [glossary](../../../docs/maintainer/glossary.md).

## The three lane ends

| Lane end | What the items do at the end | In the configuration (`lane_end`) |
| --- | --- | --- |
| Dead end | The lane stops. The items stay on it until a hand takes them. The lane is a standing queue. | `{"kind": "dead_end"}` |
| Outlet | The lane continues. The items that no hand takes leave the lane at its outlet rate. | `{"kind": "outlet", "outlet_rate": 40}`. Without `outlet_rate`, it is a free outlet at the capacity of the lane. |
| Unknown end | The configuration does not know the end. The generator checks the clock as a dead end and as a free outlet. The clock must hold under both. | `{"kind": "unknown"}` |

A lane end is a fact of the build. It does not change while the build runs. Backpressure and moving are different.
Each one is the state of one lane at one tick.

## How to state the facts of a lane

Each lane in `belts[].lanes` can state its facts. Each fact is optional, and the generator reads each one
independently:

- `supply_rate`: the items per second that come onto the lane where it starts. Without it, the supply rate is the
  capacity of the lane.
- `lane_end`: the end of the lane, as in the table above.
- `sharing`: `shared_by_copies` (the default) or `one_per_copy`.

The flow direction is a fact of the belt, not of each lane: `flow_direction` on the belt.

An export lane can have a secondary setpoint (`consumption_per_second`). That rate is its outlet rate. Thus the lane
states no lane end. For a lane that states no lane end, see `lane_end` in
[Configuration file fields](../../../docs/maintainer/configuration-file-fields.md).

To find the end, follow the lane downstream from the last inserter of the configuration that takes from it:

- Where the items stop, the end is a dead end.
- Where the items move on to entities outside the configuration, the end is an outlet. The outlet rate is the rate
  at which those entities take the items.
- Where you cannot see what the items do, the end is unknown.

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
- The lane of A at the opening continues onto B. It is an outlet. Its outlet rate is the rate at which the
  inserters on B after the side-load take the items.
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
| 1 | 2 | dead end | outlet at 53 1/3 items per second |
| 4 | 1 | dead end | outlet at 53 1/3 items per second |

Each ore belt side-loads into an underground end. The hood blocks the near lane, so it is a dead end. The far lane
continues to two furnaces after the third copy, outside the configuration. They take 53 1/3 iron ore per second. That
is the outlet rate of the far lane. In the game, the near lane stops and the far lane moves on after the side-load.
