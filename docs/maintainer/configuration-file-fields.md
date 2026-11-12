---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: configuration-file-fields
---

# Configuration file fields

The fields of a configuration file, as the engine reads it. This topic is generated from `ConfigSchema` in
`clock-generator/src/config/schema.ts`: do not edit it. To change a field or its description, change the schema, then
run `npm run docs:fields` in `clock-generator/`. CI fails when this topic is not current.

There is one table for each top-level field. A field below another has the path from the top-level field:

- `[]` is an item of an array, and `[0]` the first item of an array of a fixed length.
- `{type=belt}` is the variant of a union whose `type` is `belt`.
- `{2}` is the second variant of a union that has no such field.

The type comes from the JSON Schema that zod makes of `ConfigSchema`. The type of a field that JSON Schema cannot
show, such as a custom check or a transform, is "any, see schema.ts". "Required" is yes when the field must be in its object
after the engine reads the file: a field with a default is required, but a configuration file can leave it out.

## setpoint

| Field | Type | Required | Description |
|---|---|---|---|
| `setpoint` | object | yes | The setpoint: the product that the build must make, and the rate it must hold. The clock never changes it. |
| `setpoint.recipe` | string | yes | The name of the item that the setpoint counts. |
| `setpoint.items_per_second` | number > 0 | yes | The rate of the setpoint for all copies together, in items per second. |
| `setpoint.copies` | number > 0 | yes | The number of identical builds in the game, which can be partial, for example 2.25. The fraction is a part copy: on each lane that the copies share, it holds that fraction of a copy's inserters, with the machines that they feed. In the check of the shared lanes, a machine of the part copy is held to its share of a whole copy's target ([stability](../../clock-generator/docs/stability.md#copies-that-share-a-lane)). |
| `setpoint.copy_offset` | object | no | The distance from this build to the next copy, in tiles. |
| `setpoint.copy_offset.x` | number | yes | The x coordinate, in tiles. |
| `setpoint.copy_offset.y` | number | yes | The y coordinate, in tiles. |
| `setpoint.counts` | one of `made`, `destroyed` | no | What the rate counts: "made" (default) for items that the build makes, or "destroyed" for items that it destroys. |

## machines

| Field | Type | Required | Description |
|---|---|---|---|
| `machines` | array of objects | yes | The machines of the build. |
| `machines[].id` | integer > 0 | yes | The number that identifies the machine in the configuration. |
| `machines[].recipe` | string | yes | The name of the recipe that the machine makes. |
| `machines[].productivity` | number ≥ 0 | yes | The productivity bonus of the machine, in percent. |
| `machines[].crafting_speed` | number > 0 | yes | The crafting speed of the machine, with its modules and beacons. |
| `machines[].energy_consumption_bonus` | number ≥ -80 | no | The change in energy consumption of the machine from modules and beacons, in percent. |
| `machines[].fuel` | string | no | The name of the fuel item that the machine burns. |
| `machines[].prototype` | string | no | The prototype name of the machine in the game data, for example "assembling-machine-3". |
| `machines[].quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no | The quality of the machine, for labels only: the crafting speed already includes it. |
| `machines[].recipe_quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no | The quality of the recipe that the machine makes, for labels only. |
| `machines[].position` | object | no | Where the machine is in the game, in tiles, from the sidecar. |
| `machines[].position.x` | number | yes | The x coordinate, in tiles. |
| `machines[].position.y` | number | yes | The y coordinate, in tiles. |
| `machines[].result_target` | one of 2 objects, by `type`: `chest`, `machine` | no | The machine or chest into which a machine that puts its own results, such as a recycler, puts them. |
| `machines[].result_target{type=chest}.id` | integer > 0 | yes | The id of the chest that receives the results. |
| `machines[].result_target{type=machine}.id` | integer > 0 | yes | The id of the machine that receives the results. |

## drills

| Field | Type | Required | Description |
|---|---|---|---|
| `drills` | object | no | The mining drills of the build. |
| `drills.configs` | array of objects | yes | The mining drills of the build. |
| `drills.configs[].id` | integer > 0 | yes | The number that identifies the drill in the configuration. |
| `drills.configs[].type` | one of `electric-mining-drill`, `burner-mining-drill`, `big-mining-drill` | yes | The prototype name of the drill. |
| `drills.configs[].mined_item_name` | string | yes | The name of the item that the drill mines. |
| `drills.configs[].speed_bonus` | number | yes | The mining speed bonus of the drill, as the game gives it. |
| `drills.configs[].productivity` | number ≥ 0 | yes | The mining productivity of the drill from research and modules, in percent. |
| `drills.configs[].target` | one of 2 objects, by `type`: `machine`, `chest` | yes | The machine or chest into which the drill puts its items. |
| `drills.configs[].target{type=machine}.id` | integer > 0 | yes | The id of the machine. |
| `drills.configs[].target{type=chest}.id` | integer > 0 | yes | The id of the chest. |
| `drills.configs[].overrides` | object | no | Settings that replace what the generator chooses for this drill. |
| `drills.configs[].overrides.enable_control` | one of 4 objects, by `mode`: `AUTO`, `ALWAYS`, `CLOCKED`, `CONDITIONAL` | no | The Enable Control Strategy override of the drill. |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.ranges` | array (at least 1) of objects | yes | The enable windows of the entity, as tick ranges of the window cycle. |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.ranges[].start` | integer ≥ 0 | yes | The tick of the window cycle at which the enable window starts. |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.ranges[].end` | integer > 0 | yes | The tick of the window cycle at which the enable window ends. |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.window_cycle_ticks` | integer > 0 | no | The window cycle time of these enable windows, in ticks; the default is the time of the planned output cycles. |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.decider_build_order` | integer ≥ 0 | no | The position, from 0, of the decider combinator for these enable windows in the order of the clock's blueprint. |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.latency_ticks` | integer ≥ 0 | no | The circuit latency of these enable windows, in ticks. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | object | yes | The rule set that enables the entity when it is true. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.operator` | one of `AND`, `OR` | yes | AND: all rules must be true. OR: one rule must be true. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules` | array (at least 1) of object or the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes | The conditions and the rule sets that this rule set combines. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left` | one of 9 objects, by `type`: `CONSTANT`, `INVENTORY_ITEM`, `AUTOMATED_INSERTION_LIMIT`, `OUTPUT_BLOCK`, `CRAFTING_PROGRESS`, `BONUS_PROGRESS`, `HAND_QUANTITY`, `MACHINE_STATUS`, `INSERTER_STACK_SIZE` | yes | The value on the left side of the comparison. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=CONSTANT}.value` | number | yes | The number. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=INVENTORY_ITEM}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=INVENTORY_ITEM}.item_name` | string | yes | The name of the item to count. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=AUTOMATED_INSERTION_LIMIT}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=AUTOMATED_INSERTION_LIMIT}.item_name` | string | yes | The name of the item. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=OUTPUT_BLOCK}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=CRAFTING_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=BONUS_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=HAND_QUANTITY}.item_name` | string | no | The name of the item to count; without it, all items in the hand count. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=MACHINE_STATUS}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=MACHINE_STATUS}.status` | one of `INGREDIENT_SHORTAGE`, `WORKING`, `OUTPUT_FULL`, `NO_FUEL` | yes | The machine status to compare with. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].operator` | one of `>`, `<`, `>=`, `<=`, `==`, `!=` | yes | The comparison operator. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right` | one of 9 objects, by `type`: `CONSTANT`, `INVENTORY_ITEM`, `AUTOMATED_INSERTION_LIMIT`, `OUTPUT_BLOCK`, `CRAFTING_PROGRESS`, `BONUS_PROGRESS`, `HAND_QUANTITY`, `MACHINE_STATUS`, `INSERTER_STACK_SIZE` | yes | The value on the right side of the comparison. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=CONSTANT}.value` | number | yes | The number. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=INVENTORY_ITEM}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=INVENTORY_ITEM}.item_name` | string | yes | The name of the item to count. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=AUTOMATED_INSERTION_LIMIT}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=AUTOMATED_INSERTION_LIMIT}.item_name` | string | yes | The name of the item. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=OUTPUT_BLOCK}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=CRAFTING_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=BONUS_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=HAND_QUANTITY}.item_name` | string | no | The name of the item to count; without it, all items in the hand count. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=MACHINE_STATUS}.entity` | one of `SOURCE`, `SINK` | yes | The end of the inserter that the value comes from: SOURCE or SINK. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=MACHINE_STATUS}.status` | one of `INGREDIENT_SHORTAGE`, `WORKING`, `OUTPUT_FULL`, `NO_FUEL` | yes | The machine status to compare with. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.latch` | object | no | Keeps the entity enabled after its rule set is true, until the release rule set is true. |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.latch.release` | the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes | The rule set that disables the entity again when it is true. |
| `drills.configs[].overrides.extra_window_ticks` | integer ≥ 0 | no | Extra ticks at the start of each enable window that the generator makes for a drill into a chest. |
| `drills.configs[].position` | object | no | Where the drill is in the game, in tiles, from the sidecar. |
| `drills.configs[].position.x` | number | yes | The x coordinate, in tiles. |
| `drills.configs[].position.y` | number | yes | The y coordinate, in tiles. |
| `drills.configs[].direction` | integer 0 to 15 | no | The direction that the drill faces: 0 north, 4 east, 8 south, 12 west. |

## inserters

| Field | Type | Required | Description |
|---|---|---|---|
| `inserters` | array of objects | yes | The inserters of the build. |
| `inserters[].id` | integer > 0 | no | The number that identifies the inserter in the configuration. |
| `inserters[].source` | one of 3 objects, by `type`: `belt`, `machine`, `chest` | yes | The belt, machine or chest from which the inserter takes items. |
| `inserters[].source{type=belt}.id` | integer > 0 | yes | The id of the belt. |
| `inserters[].source{type=belt}.near_lane` | `1` or `2` | no | The lane, 1 or 2, from which the inserter takes items first. |
| `inserters[].source{type=belt}.pickup_length` | `0.5` or `1`, default `1` | yes | The length of belt from which the inserter can take items, in tiles: 1 on a straight belt, 0.5 at an underground belt end. |
| `inserters[].source{type=belt}.pickup_layout` | one of `side-straight`, `side-entrance`, `side-exit`, `front-entrance`, `front-exit`, `over-hood-exit`, `bend-right-upstream` | no | The layout of the belt at the pickup, which a manual underground pickup must have. |
| `inserters[].source{type=belt}.pickup_supply` | any, see schema.ts | no | Not supported: the generator refuses a side-loaded pickup. |
| `inserters[].source{type=belt}.pickup_merge` | any, see schema.ts | no | Not supported: the generator refuses a side-loaded pickup. |
| `inserters[].source{type=belt}.pickup_capture` | one of 2 objects | no | What the sidecar recorded about the belt at the pickup; a manual configuration does not have it. |
| `inserters[].source{type=belt}.pickup_capture{1}.status` | `supported` | yes | The sidecar supports this pickup. |
| `inserters[].source{type=belt}.pickup_capture{1}.model` | `belt` | yes | The model of the pickup: belt. |
| `inserters[].source{type=belt}.pickup_capture{1}.model_version` | `1` or `2` or `3` | yes | The version of the pickup model. |
| `inserters[].source{type=belt}.pickup_capture{1}.entity_type` | one of `transport-belt`, `underground-belt` | yes | The type of the belt at the pickup. |
| `inserters[].source{type=belt}.pickup_capture{1}.entity_name` | string | no | The prototype name of the belt at the pickup. |
| `inserters[].source{type=belt}.pickup_capture{1}.sidecar_version` | string | no | The version of the sidecar that recorded the pickup. |
| `inserters[].source{type=belt}.pickup_capture{2}.status` | one of `unsupported`, `unclassified` | yes | The sidecar does not support this pickup, or did not classify it. |
| `inserters[].source{type=belt}.pickup_capture{2}.entity_type` | string | no | The type of the entity at the pickup. |
| `inserters[].source{type=belt}.pickup_capture{2}.entity_name` | string | no | The prototype name of the entity at the pickup. |
| `inserters[].source{type=belt}.pickup_capture{2}.sidecar_version` | string | no | The version of the sidecar that recorded the pickup. |
| `inserters[].source{type=belt}.pickup_capture{2}.reason` | string | yes | Why the sidecar does not support the pickup. |
| `inserters[].source{type=belt}.drop` | object | no | Not used on a source: the generator refuses it, because a drop belongs on the sink. |
| `inserters[].source{type=belt}.drop.lane` | `1` or `2` | yes | The lane on which the inserter drops items: 1 or 2, by its place in the belt's lanes. |
| `inserters[].source{type=belt}.drop.position` | number | yes | Where the inserter drops along the belt, in tiles in the direction of travel. |
| `inserters[].source{type=machine}.id` | integer > 0 | yes | The id of the machine. |
| `inserters[].source{type=chest}.id` | integer > 0 | yes | The id of the chest. |
| `inserters[].sink` | one of 3 objects, by `type`: `belt`, `machine`, `chest` | yes | The belt, machine or chest into which the inserter puts items. |
| `inserters[].sink{type=belt}.id` | integer > 0 | yes | The id of the belt. |
| `inserters[].sink{type=belt}.drop` | object | no | Where the inserter drops on a shared lane; give it to all inserters that drop on the belt, or to none. |
| `inserters[].sink{type=belt}.drop.lane` | `1` or `2` | yes | The lane on which the inserter drops items: 1 or 2, by its place in the belt's lanes. |
| `inserters[].sink{type=belt}.drop.position` | number | yes | Where the inserter drops along the belt, in tiles in the direction of travel. |
| `inserters[].sink{type=belt}.drop_capture` | object | no | A note from the sidecar that the drop side-loads onto another belt; it does not change the clock. |
| `inserters[].sink{type=belt}.drop_capture.status` | `side-loaded` | yes | The items that the inserter drops side-load onto another belt. |
| `inserters[].sink{type=belt}.drop_capture.tiles` | integer > 0 | yes | The number of belt tiles from the drop tile to the belt that the items side-load onto. |
| `inserters[].sink{type=belt}.drop_capture.sidecar_version` | string | no | The version of the sidecar that recorded this. |
| `inserters[].sink{type=belt}.belt_direction` | integer 0 to 15 | no | The direction in which the belt moves at the drop tile. |
| `inserters[].sink{type=machine}.id` | integer > 0 | yes | The id of the machine. |
| `inserters[].sink{type=chest}.id` | integer > 0 | yes | The id of the chest. |
| `inserters[].prototype` | string | no | The prototype name of the inserter in the game data; the default is "stack-inserter". |
| `inserters[].quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no | The quality of the inserter, which sets how fast its arm turns; the default is "legendary". |
| `inserters[].stack_size` | integer > 0 | no | The number of items that the hand holds; the default is what all research gives. |
| `inserters[].filters` | array of string | no | The names of the items that the inserter moves. |
| `inserters[].filter_mode` | one of `whitelist`, `blacklist` | no | How the game reads the filters: "whitelist" (default); the generator refuses "blacklist". |
| `inserters[].overrides` | object | no | Settings that replace what the generator chooses for this inserter. |
| `inserters[].overrides.animation` | object | no | Settings that replace the movement times of the inserter. |
| `inserters[].overrides.animation.pickup_duration_ticks` | integer > 0 | no | The number of ticks that the inserter takes to pick up items. |
| `inserters[].overrides.enable_control` | one of 4 objects, by `mode`: `AUTO`, `ALWAYS`, `CLOCKED`, `CONDITIONAL` | no | The Enable Control Strategy override of the inserter. |
| `inserters[].overrides.enable_control{mode=CLOCKED}.ranges` | array (at least 1) of objects | yes | The enable windows of the entity, as tick ranges of the window cycle. |
| `inserters[].overrides.enable_control{mode=CLOCKED}.ranges[].start` | integer ≥ 0 | yes | The tick of the window cycle at which the enable window starts. |
| `inserters[].overrides.enable_control{mode=CLOCKED}.ranges[].end` | integer > 0 | yes | The tick of the window cycle at which the enable window ends. |
| `inserters[].overrides.enable_control{mode=CLOCKED}.window_cycle_ticks` | integer > 0 | no | The window cycle time of these enable windows, in ticks; the default is the time of the planned output cycles. |
| `inserters[].overrides.enable_control{mode=CLOCKED}.decider_build_order` | integer ≥ 0 | no | The position, from 0, of the decider combinator for these enable windows in the order of the clock's blueprint. |
| `inserters[].overrides.enable_control{mode=CLOCKED}.latency_ticks` | integer ≥ 0 | no | The circuit latency of these enable windows, in ticks. |
| `inserters[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes | The rule set that enables the entity when it is true. |
| `inserters[].overrides.enable_control{mode=CONDITIONAL}.latch` | object | no | Keeps the entity enabled after its rule set is true, until the release rule set is true. |
| `inserters[].overrides.enable_control{mode=CONDITIONAL}.latch.release` | the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes | The rule set that disables the entity again when it is true. |
| `inserters[].position` | object | no | Where the inserter is in the game, in tiles, from the sidecar. |
| `inserters[].position.x` | number | yes | The x coordinate, in tiles. |
| `inserters[].position.y` | number | yes | The y coordinate, in tiles. |
| `inserters[].direction` | integer 0 to 15 | no | The direction that the inserter faces: 0 north, 4 east, 8 south, 12 west. |

## belts

| Field | Type | Required | Description |
|---|---|---|---|
| `belts` | array of one of 2 objects, by `strategy`: `normal`, `export` | yes | The belts of the build. |
| `belts[]{strategy=normal}.id` | integer > 0 | yes | The number that identifies the belt in the configuration. |
| `belts[]{strategy=normal}.type` | one of `transport-belt`, `fast-transport-belt`, `express-transport-belt`, `turbo-transport-belt` | yes | The prototype name of the belt. |
| `belts[]{strategy=normal}.flow_direction` | `0` or `4` or `8` or `12` | no | The direction in which the belt flows along the row of copies: 0 north, 4 east, 8 south, 12 west. Without it, the check runs the items in the two directions along the copies. A direction across copy_offset, on a lane that the copies share, is refused. |
| `belts[]{strategy=normal}.lanes` | array of exactly 1 or array of exactly 2 | yes | The lanes of the belt, one or two, the left lane in the direction of travel first. |
| `belts[]{strategy=normal}.lanes[0]` | object | yes |  |
| `belts[]{strategy=normal}.lanes[0].ingredient` | string | yes | The name of the item on the lane. |
| `belts[]{strategy=normal}.lanes[0].stack_size` | integer > 0 | yes | The number of items in each stack on the lane. |
| `belts[]{strategy=normal}.lanes[0].supply_rate` | number > 0 | no | The items per second that come onto the lane where it starts. The default is the lane's capacity. |
| `belts[]{strategy=normal}.lanes[0].lane_end` | one of 3 objects, by `kind`: `dead_end`, `infinite`, `unknown` | no | The end of the lane. Without it, backed_up_belts sets the end if the configuration states it. If not, the role of the lane sets the end: an input or a buffer lane is a dead end, an output lane is an infinite end. |
| `belts[]{strategy=normal}.lanes[0].sharing` | one of `shared`, `per_copy` | no | shared (default): all copies take from this lane. per_copy: each copy has a lane of its own. |
| `belts[]{strategy=normal}.lanes[1]` | object | yes |  |
| `belts[]{strategy=normal}.lanes[1].ingredient` | string | yes | The name of the item on the lane. |
| `belts[]{strategy=normal}.lanes[1].stack_size` | integer > 0 | yes | The number of items in each stack on the lane. |
| `belts[]{strategy=normal}.lanes[1].supply_rate` | number > 0 | no | The items per second that come onto the lane where it starts. The default is the lane's capacity. |
| `belts[]{strategy=normal}.lanes[1].lane_end` | one of 3 objects, by `kind`: `dead_end`, `infinite`, `unknown` | no | The end of the lane. Without it, backed_up_belts sets the end if the configuration states it. If not, the role of the lane sets the end: an input or a buffer lane is a dead end, an output lane is an infinite end. |
| `belts[]{strategy=normal}.lanes[1].sharing` | one of `shared`, `per_copy` | no | shared (default): all copies take from this lane. per_copy: each copy has a lane of its own. |
| `belts[]{strategy=export}.id` | integer > 0 | yes | The number that identifies the belt in the configuration. |
| `belts[]{strategy=export}.type` | one of `transport-belt`, `fast-transport-belt`, `express-transport-belt`, `turbo-transport-belt` | yes | The prototype name of the belt. |
| `belts[]{strategy=export}.flow_direction` | `0` or `4` or `8` or `12` | no | The direction in which the belt flows along the row of copies: 0 north, 4 east, 8 south, 12 west. Without it, the check runs the items in the two directions along the copies. A direction across copy_offset, on a lane that the copies share, is refused. |
| `belts[]{strategy=export}.lanes` | array of exactly 1 or array of exactly 2 | yes | The lanes of the belt, one or two, the left lane in the direction of travel first. |
| `belts[]{strategy=export}.lanes[0]` | object | yes |  |
| `belts[]{strategy=export}.lanes[0].ingredient` | string | yes | The name of the item on the lane. |
| `belts[]{strategy=export}.lanes[0].stack_size` | integer > 0 | yes | The number of items in each stack on the lane. |
| `belts[]{strategy=export}.lanes[0].supply_rate` | number > 0 | no | The items per second that come onto the lane where it starts. The default is the lane's capacity. |
| `belts[]{strategy=export}.lanes[0].lane_end` | one of 3 objects, by `kind`: `dead_end`, `infinite`, `unknown` | no | The end of the lane. Without it, backed_up_belts sets the end if the configuration states it. If not, the role of the lane sets the end: an input or a buffer lane is a dead end, an output lane is an infinite end. |
| `belts[]{strategy=export}.lanes[0].sharing` | one of `shared`, `per_copy` | no | shared (default): all copies take from this lane. per_copy: each copy has a lane of its own. |
| `belts[]{strategy=export}.lanes[0].consumption_per_second` | number > 0 | no | The items per second that entities outside the configuration take off this lane. |
| `belts[]{strategy=export}.lanes[1]` | object | yes |  |
| `belts[]{strategy=export}.lanes[1].ingredient` | string | yes | The name of the item on the lane. |
| `belts[]{strategy=export}.lanes[1].stack_size` | integer > 0 | yes | The number of items in each stack on the lane. |
| `belts[]{strategy=export}.lanes[1].supply_rate` | number > 0 | no | The items per second that come onto the lane where it starts. The default is the lane's capacity. |
| `belts[]{strategy=export}.lanes[1].lane_end` | one of 3 objects, by `kind`: `dead_end`, `infinite`, `unknown` | no | The end of the lane. Without it, backed_up_belts sets the end if the configuration states it. If not, the role of the lane sets the end: an input or a buffer lane is a dead end, an output lane is an infinite end. |
| `belts[]{strategy=export}.lanes[1].sharing` | one of `shared`, `per_copy` | no | shared (default): all copies take from this lane. per_copy: each copy has a lane of its own. |
| `belts[]{strategy=export}.lanes[1].consumption_per_second` | number > 0 | no | The items per second that entities outside the configuration take off this lane. |

## chests

| Field | Type | Required | Description |
|---|---|---|---|
| `chests` | array of one of 6 objects, by `type`: `buffer-chest`, `infinity-chest`, `car`, `tank`, `cargo-wagon`, `rocket-silo` | no | The chests of the build, and the cars, tanks, cargo wagons and rocket silos that it uses as chests. |
| `chests[]{type=buffer-chest}.id` | integer > 0 | yes | The number that identifies the chest in the configuration. |
| `chests[]{type=buffer-chest}.storage_size` | integer > 0 | yes | The number of slots of the chest. |
| `chests[]{type=buffer-chest}.item_filter` | string | yes | The name of the one item that the chest holds. |
| `chests[]{type=buffer-chest}.prototype` | string | no | The prototype name of the chest in the game data, for example "steel-chest". |
| `chests[]{type=buffer-chest}.position` | object | no | Where the chest is in the game, in tiles, from the sidecar. |
| `chests[]{type=buffer-chest}.position.x` | number | yes | The x coordinate, in tiles. |
| `chests[]{type=buffer-chest}.position.y` | number | yes | The y coordinate, in tiles. |
| `chests[]{type=infinity-chest}.id` | integer > 0 | yes | The number that identifies the chest in the configuration. |
| `chests[]{type=infinity-chest}.item_filter` | array of objects, default `[]` | yes | The items that the chest supplies. |
| `chests[]{type=infinity-chest}.item_filter[].item_name` | string, not empty | yes | The name of the item that the chest supplies. |
| `chests[]{type=infinity-chest}.item_filter[].request_count` | integer ≥ 0 | yes | The number of items that the chest keeps. |
| `chests[]{type=infinity-chest}.remove_unfiltered_items` | boolean | no | Whether the chest removes the items that are not in its filters. |
| `chests[]{type=infinity-chest}.position` | object | no | Where the chest is in the game, in tiles, from the sidecar. |
| `chests[]{type=infinity-chest}.position.x` | number | yes | The x coordinate, in tiles. |
| `chests[]{type=infinity-chest}.position.y` | number | yes | The y coordinate, in tiles. |
| `chests[]{type=car}.id` | integer > 0 | yes | The number that identifies the entity in the configuration. |
| `chests[]{type=car}.slot_filters` | array of one of 2 objects | no | The slots that take one item only, or no item. |
| `chests[]{type=car}.slot_filters[]{1}.slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=car}.slot_filters[]{1}.item` | string, not empty | yes | The only item that the slot takes. |
| `chests[]{type=car}.slot_filters[]{1}.blocked` | not allowed | no | Not used with item. |
| `chests[]{type=car}.slot_filters[]{2}.slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=car}.slot_filters[]{2}.blocked` | `true` | yes | The slot takes no item. |
| `chests[]{type=car}.slot_filters[]{2}.item` | not allowed | no | Not used with blocked. |
| `chests[]{type=car}.contents` | array of objects | no | The items that the entity holds when the build starts. |
| `chests[]{type=car}.contents[].slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=car}.contents[].item` | string, not empty | yes | The name of the item in the slot. |
| `chests[]{type=car}.contents[].count` | integer > 0 | yes | The number of items in the slot, at most one stack. |
| `chests[]{type=car}.storage_size` | any, see schema.ts | no | Not used: the game data gives the slots, and the generator refuses a configuration with this field. |
| `chests[]{type=car}.position` | object | no | Where the entity is in the game, in tiles, from the sidecar. |
| `chests[]{type=car}.position.x` | number | yes | The x coordinate, in tiles. |
| `chests[]{type=car}.position.y` | number | yes | The y coordinate, in tiles. |
| `chests[]{type=tank}.id` | integer > 0 | yes | The number that identifies the entity in the configuration. |
| `chests[]{type=tank}.slot_filters` | array of one of 2 objects | no | The slots that take one item only, or no item. |
| `chests[]{type=tank}.slot_filters[]{1}.slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=tank}.slot_filters[]{1}.item` | string, not empty | yes | The only item that the slot takes. |
| `chests[]{type=tank}.slot_filters[]{1}.blocked` | not allowed | no | Not used with item. |
| `chests[]{type=tank}.slot_filters[]{2}.slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=tank}.slot_filters[]{2}.blocked` | `true` | yes | The slot takes no item. |
| `chests[]{type=tank}.slot_filters[]{2}.item` | not allowed | no | Not used with blocked. |
| `chests[]{type=tank}.contents` | array of objects | no | The items that the entity holds when the build starts. |
| `chests[]{type=tank}.contents[].slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=tank}.contents[].item` | string, not empty | yes | The name of the item in the slot. |
| `chests[]{type=tank}.contents[].count` | integer > 0 | yes | The number of items in the slot, at most one stack. |
| `chests[]{type=tank}.storage_size` | any, see schema.ts | no | Not used: the game data gives the slots, and the generator refuses a configuration with this field. |
| `chests[]{type=tank}.position` | object | no | Where the entity is in the game, in tiles, from the sidecar. |
| `chests[]{type=tank}.position.x` | number | yes | The x coordinate, in tiles. |
| `chests[]{type=tank}.position.y` | number | yes | The y coordinate, in tiles. |
| `chests[]{type=cargo-wagon}.id` | integer > 0 | yes | The number that identifies the entity in the configuration. |
| `chests[]{type=cargo-wagon}.slot_filters` | array of one of 2 objects | no | The slots that take one item only, or no item. |
| `chests[]{type=cargo-wagon}.slot_filters[]{1}.slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=cargo-wagon}.slot_filters[]{1}.item` | string, not empty | yes | The only item that the slot takes. |
| `chests[]{type=cargo-wagon}.slot_filters[]{1}.blocked` | not allowed | no | Not used with item. |
| `chests[]{type=cargo-wagon}.slot_filters[]{2}.slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=cargo-wagon}.slot_filters[]{2}.blocked` | `true` | yes | The slot takes no item. |
| `chests[]{type=cargo-wagon}.slot_filters[]{2}.item` | not allowed | no | Not used with blocked. |
| `chests[]{type=cargo-wagon}.contents` | array of objects | no | The items that the entity holds when the build starts. |
| `chests[]{type=cargo-wagon}.contents[].slot` | integer > 0 | yes | The slot number, from 1. |
| `chests[]{type=cargo-wagon}.contents[].item` | string, not empty | yes | The name of the item in the slot. |
| `chests[]{type=cargo-wagon}.contents[].count` | integer > 0 | yes | The number of items in the slot, at most one stack. |
| `chests[]{type=cargo-wagon}.storage_size` | any, see schema.ts | no | Not used: the game data gives the slots, and the generator refuses a configuration with this field. |
| `chests[]{type=cargo-wagon}.position` | object | no | Where the entity is in the game, in tiles, from the sidecar. |
| `chests[]{type=cargo-wagon}.position.x` | number | yes | The x coordinate, in tiles. |
| `chests[]{type=cargo-wagon}.position.y` | number | yes | The y coordinate, in tiles. |
| `chests[]{type=cargo-wagon}.quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no | The quality of the wagon, which sets its slots; the default is "normal". |
| `chests[]{type=rocket-silo}.id` | integer > 0 | yes | The number that identifies the rocket silo in the configuration. |
| `chests[]{type=rocket-silo}.recipe_quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no | The quality of the rocket part recipe; the default is "normal". |
| `chests[]{type=rocket-silo}.crafting_speed` | number > 0 | no | The crafting speed of the rocket silo, which sets its automated insertion limit. |
| `chests[]{type=rocket-silo}.productivity` | number ≥ 0 | no | The productivity bonus of the rocket silo, which changes nothing at this time. |
| `chests[]{type=rocket-silo}.contents` | array of objects | no | The items that the rocket silo holds when the build starts. |
| `chests[]{type=rocket-silo}.contents[].item` | string, not empty | yes | The name of the item. |
| `chests[]{type=rocket-silo}.contents[].count` | integer > 0 | yes | The number of items. |
| `chests[]{type=rocket-silo}.storage_size` | any, see schema.ts | no | Not used: the game data gives the slots, and the generator refuses a configuration with this field. |
| `chests[]{type=rocket-silo}.position` | object | no | Where the rocket silo is in the game, in tiles, from the sidecar. |
| `chests[]{type=rocket-silo}.position.x` | number | yes | The x coordinate, in tiles. |
| `chests[]{type=rocket-silo}.position.y` | number | yes | The y coordinate, in tiles. |

## overrides

| Field | Type | Required | Description |
|---|---|---|---|
| `overrides` | object | no | Settings that replace what the generator chooses for the configuration. |
| `overrides.lcm` | integer > 0 | no | The number of output cycles in one window cycle; without it, the generator calculates the number. |
| `overrides.terminal_swing_count` | integer > 0 | no | The number of output swings in each output cycle; without it, the generator chooses the number. |
| `overrides.backed_up_belts` | boolean | no | Whether the input belts are backed up at the pickup. true: each lane without a lane_end is a dead end. false: each such lane is an infinite end. Without it, the role of the lane sets the end. |
| `overrides.search_for_fewer_wake_ups` | boolean | no | Whether the generator always does the four searches, to find a clock with fewer wakeups. |
| `overrides.check_start_dependence` | boolean | no | Whether the generator tests each clock from more starts than the cold start. |
| `overrides.disturbance_trials_on_copies` | boolean | no | Whether the generator makes the disturbance trials again on the copies that share a lane. |
| `overrides.kick_start_items` | integer ≥ 0 | no | The kick start: the number of its own product that a machine gets before its clock starts, when its recipe uses that product. |
| `overrides.disable_swing_backoff` | boolean | no | Not used: set terminal_swing_count to give the number of output swings. |
| `overrides.derive_clock_windows` | boolean | no | Whether the generator finds the enable windows of other inserters from a run in which only the output inserters have a clock. |
| `overrides.ignored_lcm_ingredients` | array of string | no | The items that do not change the window cycle time; set each inserter that moves only these items to ALWAYS. |

## output_belt

| Field | Type | Required | Description |
|---|---|---|---|
| `output_belt` | object | no | The output belt: the side belt that each copy's output inserter drops on, and the stretches of belt from the copies to the infinite end, in tiles. The run of the copies moves the output on it, and an output blockage shuts its infinite end. |
| `output_belt.side_belt` | object | no | The side belt that each copy's output inserter drops on, the same for every copy that has one. |
| `output_belt.side_belt.lane` | one of `left`, `right` | yes | The lane of the side belt that the output inserter drops on: "left" or "right" in the direction of travel. |
| `output_belt.side_belt.tiles` | integer > 0 | yes | The steps from the drop tile to the tile that the side belt side-loads onto, as the sidecar's walk counts them. This is the number that `drop_capture.tiles` holds. On a drop tile and one curve, it is 2. |
| `output_belt.side_belt.left_curves` | integer ≥ 0 | no | The left curves of the side belt after its drop tile. |
| `output_belt.side_belt.right_curves` | integer ≥ 0 | no | The right curves of the side belt after its drop tile. |
| `output_belt.stretches` | array (at least 1) of objects | yes | The stretches of the output belt, each from where items first come onto it to where it ends. Stretch 1 is the first. |
| `output_belt.stretches[].points` | array (at least 1) of objects | yes | The points of the stretch, upstream first. |
| `output_belt.stretches[].points[].tiles` | integer > 0 | no | The steps from the previous point to this point, as the sidecar's walk counts them. Each belt entity is one step. An underground pair is the tiles between its ends. The tile that a stretch side-loads onto, the splitter and the infinite end are one step each. After a point that lists copies, count from the last copy of the list. The first point of a stretch has no tiles. |
| `output_belt.stretches[].points[].left_curves` | integer ≥ 0 | no | The left curves between the previous point and this point. |
| `output_belt.stretches[].points[].right_curves` | integer ≥ 0 | no | The right curves between the previous point and this point. |
| `output_belt.stretches[].points[].side_load` | array (at least 1) of integer > 0 or object | no | What side-loads onto this point: a list of copies, or another stretch. A side load is stated once, at the point that takes it. The first copy of a list side-loads at this point, and each next copy `setpoint.copy_offset` further along the stretch. |
| `output_belt.stretches[].points[].side_load.stretch` | integer > 0 | yes | The stretch, from 1, that side-loads onto this point from its last point. |
| `output_belt.stretches[].points[].lane` | one of `left`, `right` | no | The lane that takes the side load or the drop: "left" or "right" in the direction of travel. |
| `output_belt.stretches[].points[].layout` | one of `side-straight`, `side-entrance`, `side-exit` | no | The belt piece that takes the side load, as `pickup_layout` names it: side-straight (a straight belt), side-entrance (an underground entrance) or side-exit (an underground exit). |
| `output_belt.stretches[].points[].drop` | integer > 0 | no | The copy, from 1, with the output inserter that drops onto this point. |
| `output_belt.stretches[].points[].splitter_input` | one of `left`, `right` | no | The splitter's input that this stretch ends in: "left" or "right" in the direction of travel. |
| `output_belt.stretches[].points[].splitter_output` | one of `left`, `right` | no | The splitter's output that this stretch starts at: "left" or "right" in the direction of travel. |
| `output_belt.stretches[].points[].lane_end` | object | no | The infinite end of the output belt, on the last point of its stretch. |
| `output_belt.stretches[].points[].lane_end.kind` | `infinite` | yes | infinite: the items leave the build here, at the capacity of the lane. |
| `output_belt.splitter` | object | no | The splitter of the output belt, with its priorities. Its inputs and outputs are the points that name them. |
| `output_belt.splitter.input_priority` | one of `left`, `right` | yes | The input priority of the splitter: "left" or "right". The generator does not accept "none". |
| `output_belt.splitter.output_priority` | one of `left`, `right` | yes | The output priority of the splitter: "left" or "right". The generator does not accept "none". |
