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
| Belt | The items on each lane. |
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

## Suggested setpoint

The export gives a suggested setpoint: the product that goes out of your selection, and the maximum rate at
which the machines can make it, in items each second.

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
