---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: sidecar-export-contents
---

# Data in a sidecar export

The sidecar exports the entities in your selection that the clock generator uses, and the data of each entity.

## Entities and their data

| Entity | Data in the export |
|---|---|
| Assembling machine, furnace | Recipe. Crafting speed, with the effect of modules and beacons. Productivity, with the effect of research. |
| Recycler | The data of a machine, and the machine or container that it puts its results into. |
| Biochamber | The data of a machine, and its energy consumption bonus. |
| Mining drill | Speed bonus and productivity. |
| Inserter | The entity from which it removes items, and the entity into which it puts them. Type, quality, stack size and filters. |
| Belt | The items on each lane. If an inserter removes items from the belt, also the end of each lane and the direction of the items. |
| Chest | The items in it. |
| Car, tank, cargo wagon | The data of a chest. For a cargo wagon, also its quality and its slot filters. |
| Rocket silo | The data of a chest, and the quality, crafting speed and productivity of its recipe. |

If the filters of an inserter are off, the export has no filters for it. The export marks a blacklist filter. The site
does not accept a blacklist filter.

## Belt pickups

For each inserter that removes items from a belt, the export has the pickup position and the lane that the inserter
uses first. This includes:

- Pickups in line with an underground belt entrance or exit, after it in the direction of the belt.
- Pickups across an underground belt exit, from the belt before the exit. At these pickups, the first lane changes
  after you use **Flip horizontal** or **Flip vertical** on the inserter.

The export marks each belt pickup for which the sidecar cannot give data. The site does not accept these pickups:

- A pickup from a belt bend.
- A pickup from a splitter.
- A pickup from a belt tile that has side-loading from a different belt.
- A pickup in line with the belt, or a different pickup position that the site cannot use.

## Lane ends

For each belt from which an inserter removes items, the sidecar follows the belt from the pickup in the direction of the
items. It does not examine the belts that put items on it. The export gives each lane one of these ends (`lane_end`):

- `dead_end`: the lane stops. The belt has no belt after it, or it goes into an underground belt entrance that has no
  exit.
- `outlet`, with no rate: the items move off the lane. The sidecar gives this end only when the belt goes into a loader
  that fills an infinity chest that removes all items. The loader and the chest must be in your selection.
- `unknown`: the sidecar cannot see the end of the lane.

The sidecar gives `unknown` when the belt goes into a splitter, into a different loader, or out of your selection. It
also gives `unknown` when a different belt goes onto the belt, when the belt goes onto a different belt, or when the belt
is a loop.

When the belt goes onto an underground belt from the side, one lane goes into the cover of the underground belt. That
lane is a `dead_end`. The sidecar cannot see the rate of the other lane on the underground belt. That lane is
`unknown`.

If two belts in your selection have the same items on the same lanes, the export shows them as one belt. If their lane
ends are different, the export gives `unknown`.

## Flow direction

For each belt from which an inserter removes items, the export gives the direction in which the items move
(`flow_direction`): 0 north, 4 east, 8 south or 12 west. The sidecar reads the direction at each belt tile from which an
inserter removes items. The export gives no direction if the directions are different, or if one of these tiles is a
belt bend.

A belt from which no inserter removes items has no lane ends and no flow direction.

## Suggested target

The export gives a suggested target output: the product that goes out of your selection, and the maximum rate at
which the machines can make it, in items each second.

### Copy spacing

If your selection has two or more copies of the build, the suggested target can give the copy spacing (`copy_offset`).
This is the distance in tiles from one copy to the next copy. The sidecar reads it from the inserters that remove items
from belts:

1. On each belt, the sidecar starts at the first inserter in the direction of the items.
2. It finds the distance that moves each inserter of a copy to the same inserter of the next copy. The next copy is the
   copy after it in the direction of the items.
3. Each belt that has two or more of these inserters must give the same distance.
4. Each inserter that removes items from a belt must have the same inserter at that distance in the copy before or after
   it. Each copy must have all of these inserters.

Two inserters are the same if they have the same type, quality and direction. The entities that they use must be the
same entity, with the same recipe and the same position from the inserter.

The export gives no copy spacing in these conditions:

- Your selection has one copy.
- The distances between the copies are not all the same.
- A copy is a mirror image of a different copy.
- A copy has only some of the inserters of a full copy.
- No belt has the inserters of two or more copies.
- The export has no suggested target.

One copy can have two or more machines that are the same, with the same inserters, at equal distances along a belt. The
sidecar cannot find the difference between these machines and copies. Then it gives that distance.

The site does not use the copy spacing from the export. Set the distance to the next copy in **Setpoint**.

## Entities that are not in the export

The export does not include an inserter if the entity that it uses is not in the export. The export window shows each
such inserter, with the cause. This is also correct for a mining drill if the entity that it fills is not in the export.

The sidecar does not export:

- An empty belt.
- An empty chest, if the items that go in and out do not show the item that it holds.
- A machine that has no recipe, or a lab.

## Exports from a previous sidecar version

An export or a configuration from a previous version of the sidecar can have belt pickups that the site does not
accept. Export the build again. An update of the mod does not change an export that you made before the update.
