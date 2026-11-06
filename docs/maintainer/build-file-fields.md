---
$schema: urn:oasis:names:tc:dita:xsd:reference.xsd
id: build-file-fields
---

# Build file fields

The fields of a build file, as the engine reads it. This topic is generated from `ConfigSchema` in
`clock-generator/src/config/schema.ts`: do not edit it. To change a field or its description, change the schema, then
run `npm run docs:fields` in `clock-generator/`. CI fails when this topic is not current.

There is one table for each top-level field. A field below another has the path from the top-level field:

- `[]` is an item of an array, and `[0]` the first item of an array of a fixed length.
- `{type=belt}` is the variant of a union whose `type` is `belt`.
- `{2}` is the second variant of a union that has no such field.

The type comes from the JSON Schema that zod makes of `ConfigSchema`. The type of a field that JSON Schema cannot
show, such as a custom check or a transform, is "any, see schema.ts". "Required" is yes when the field must be in its object
after the engine reads the file: a field with a default is required, but a build file can leave it out.

## target_output

| Field | Type | Required | Description |
|---|---|---|---|
| `target_output` | object | yes |  |
| `target_output.recipe` | string | yes |  |
| `target_output.items_per_second` | number > 0 | yes |  |
| `target_output.copies` | number > 0 | yes |  |
| `target_output.copy_offset` | object | no |  |
| `target_output.copy_offset.x` | number | yes |  |
| `target_output.copy_offset.y` | number | yes |  |
| `target_output.counts` | one of `made`, `destroyed` | no |  |

## machines

| Field | Type | Required | Description |
|---|---|---|---|
| `machines` | array of objects | yes |  |
| `machines[].id` | integer > 0 | yes |  |
| `machines[].recipe` | string | yes |  |
| `machines[].productivity` | number ≥ 0 | yes |  |
| `machines[].crafting_speed` | number > 0 | yes |  |
| `machines[].energy_consumption_bonus` | number ≥ -80 | no |  |
| `machines[].fuel` | string | no |  |
| `machines[].prototype` | string | no |  |
| `machines[].quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no |  |
| `machines[].recipe_quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no |  |
| `machines[].position` | object | no |  |
| `machines[].position.x` | number | yes |  |
| `machines[].position.y` | number | yes |  |
| `machines[].result_target` | one of 2 objects, by `type`: `chest`, `machine` | no |  |
| `machines[].result_target{type=chest}.id` | integer > 0 | yes |  |
| `machines[].result_target{type=machine}.id` | integer > 0 | yes |  |

## drills

| Field | Type | Required | Description |
|---|---|---|---|
| `drills` | object | no |  |
| `drills.configs` | array of objects | yes |  |
| `drills.configs[].id` | integer > 0 | yes |  |
| `drills.configs[].type` | one of `electric-mining-drill`, `burner-mining-drill`, `big-mining-drill` | yes |  |
| `drills.configs[].mined_item_name` | string | yes |  |
| `drills.configs[].speed_bonus` | number | yes |  |
| `drills.configs[].productivity` | number ≥ 0 | yes |  |
| `drills.configs[].target` | one of 2 objects, by `type`: `machine`, `chest` | yes |  |
| `drills.configs[].target{type=machine}.id` | integer > 0 | yes |  |
| `drills.configs[].target{type=chest}.id` | integer > 0 | yes |  |
| `drills.configs[].overrides` | object | no |  |
| `drills.configs[].overrides.enable_control` | one of 5 objects, by `mode`: `AUTO`, `ALWAYS`, `NEVER`, `CLOCKED`, `CONDITIONAL` | no |  |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.ranges` | array (at least 1) of objects | yes |  |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.ranges[].start` | integer ≥ 0 | yes |  |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.ranges[].end` | integer > 0 | yes |  |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.period_duration_ticks` | integer > 0 | no |  |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.decider_build_order` | integer ≥ 0 | no |  |
| `drills.configs[].overrides.enable_control{mode=CLOCKED}.latency_ticks` | integer ≥ 0 | no |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | object | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.operator` | one of `AND`, `OR` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules` | array (at least 1) of object or the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left` | one of 9 objects, by `type`: `CONSTANT`, `INVENTORY_ITEM`, `AUTOMATED_INSERTION_LIMIT`, `OUTPUT_BLOCK`, `CRAFTING_PROGRESS`, `BONUS_PROGRESS`, `HAND_QUANTITY`, `MACHINE_STATUS`, `INSERTER_STACK_SIZE` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=CONSTANT}.value` | number | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=INVENTORY_ITEM}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=INVENTORY_ITEM}.item_name` | string | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=AUTOMATED_INSERTION_LIMIT}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=AUTOMATED_INSERTION_LIMIT}.item_name` | string | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=OUTPUT_BLOCK}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=CRAFTING_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=BONUS_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=HAND_QUANTITY}.item_name` | string | no |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=MACHINE_STATUS}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].left{type=MACHINE_STATUS}.status` | one of `INGREDIENT_SHORTAGE`, `WORKING`, `OUTPUT_FULL`, `NO_FUEL` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].operator` | one of `>`, `<`, `>=`, `<=`, `==`, `!=` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right` | one of 9 objects, by `type`: `CONSTANT`, `INVENTORY_ITEM`, `AUTOMATED_INSERTION_LIMIT`, `OUTPUT_BLOCK`, `CRAFTING_PROGRESS`, `BONUS_PROGRESS`, `HAND_QUANTITY`, `MACHINE_STATUS`, `INSERTER_STACK_SIZE` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=CONSTANT}.value` | number | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=INVENTORY_ITEM}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=INVENTORY_ITEM}.item_name` | string | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=AUTOMATED_INSERTION_LIMIT}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=AUTOMATED_INSERTION_LIMIT}.item_name` | string | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=OUTPUT_BLOCK}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=CRAFTING_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=BONUS_PROGRESS}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=HAND_QUANTITY}.item_name` | string | no |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=MACHINE_STATUS}.entity` | one of `SOURCE`, `SINK` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set.rules[].right{type=MACHINE_STATUS}.status` | one of `INGREDIENT_SHORTAGE`, `WORKING`, `OUTPUT_FULL`, `NO_FUEL` | yes |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.latch` | object | no |  |
| `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.latch.release` | the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes |  |
| `drills.configs[].overrides.extra_window_ticks` | integer ≥ 0 | no |  |
| `drills.configs[].position` | object | no |  |
| `drills.configs[].position.x` | number | yes |  |
| `drills.configs[].position.y` | number | yes |  |
| `drills.configs[].direction` | integer 0 to 15 | no |  |

## inserters

| Field | Type | Required | Description |
|---|---|---|---|
| `inserters` | array of objects | yes |  |
| `inserters[].id` | integer > 0 | no |  |
| `inserters[].source` | one of 3 objects, by `type`: `belt`, `machine`, `chest` | yes |  |
| `inserters[].source{type=belt}.id` | integer > 0 | yes |  |
| `inserters[].source{type=belt}.near_lane` | `1` or `2` | no |  |
| `inserters[].source{type=belt}.pickup_length` | `0.5` or `1`, default `1` | yes |  |
| `inserters[].source{type=belt}.pickup_layout` | one of `side-straight`, `side-entrance`, `side-exit`, `front-entrance`, `front-exit`, `over-hood-exit`, `bend-right-upstream` | no |  |
| `inserters[].source{type=belt}.pickup_supply` | any, see schema.ts | no |  |
| `inserters[].source{type=belt}.pickup_merge` | any, see schema.ts | no |  |
| `inserters[].source{type=belt}.pickup_capture` | one of 2 objects | no |  |
| `inserters[].source{type=belt}.pickup_capture{1}.status` | `supported` | yes |  |
| `inserters[].source{type=belt}.pickup_capture{1}.model` | `belt` | yes |  |
| `inserters[].source{type=belt}.pickup_capture{1}.model_version` | `1` or `2` or `3` | yes |  |
| `inserters[].source{type=belt}.pickup_capture{1}.entity_type` | one of `transport-belt`, `underground-belt` | yes |  |
| `inserters[].source{type=belt}.pickup_capture{1}.entity_name` | string | no |  |
| `inserters[].source{type=belt}.pickup_capture{1}.sidecar_version` | string | no |  |
| `inserters[].source{type=belt}.pickup_capture{2}.status` | one of `unsupported`, `unclassified` | yes |  |
| `inserters[].source{type=belt}.pickup_capture{2}.entity_type` | string | no |  |
| `inserters[].source{type=belt}.pickup_capture{2}.entity_name` | string | no |  |
| `inserters[].source{type=belt}.pickup_capture{2}.sidecar_version` | string | no |  |
| `inserters[].source{type=belt}.pickup_capture{2}.reason` | string | yes |  |
| `inserters[].source{type=belt}.drop` | object | no |  |
| `inserters[].source{type=belt}.drop.lane` | `1` or `2` | yes |  |
| `inserters[].source{type=belt}.drop.position` | number | yes |  |
| `inserters[].source{type=machine}.id` | integer > 0 | yes |  |
| `inserters[].source{type=chest}.id` | integer > 0 | yes |  |
| `inserters[].sink` | one of 3 objects, by `type`: `belt`, `machine`, `chest` | yes |  |
| `inserters[].sink{type=belt}.id` | integer > 0 | yes |  |
| `inserters[].sink{type=belt}.drop` | object | no |  |
| `inserters[].sink{type=belt}.drop.lane` | `1` or `2` | yes |  |
| `inserters[].sink{type=belt}.drop.position` | number | yes |  |
| `inserters[].sink{type=belt}.drop_capture` | object | no |  |
| `inserters[].sink{type=belt}.drop_capture.status` | `side-loaded` | yes |  |
| `inserters[].sink{type=belt}.drop_capture.tiles` | integer > 0 | yes |  |
| `inserters[].sink{type=belt}.drop_capture.sidecar_version` | string | no |  |
| `inserters[].sink{type=belt}.belt_direction` | integer 0 to 15 | no |  |
| `inserters[].sink{type=machine}.id` | integer > 0 | yes |  |
| `inserters[].sink{type=chest}.id` | integer > 0 | yes |  |
| `inserters[].prototype` | string | no |  |
| `inserters[].quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no |  |
| `inserters[].stack_size` | integer > 0 | no |  |
| `inserters[].filters` | array of string | no |  |
| `inserters[].filter_mode` | one of `whitelist`, `blacklist` | no |  |
| `inserters[].overrides` | object | no |  |
| `inserters[].overrides.animation` | object | no |  |
| `inserters[].overrides.animation.pickup_duration_ticks` | integer > 0 | no |  |
| `inserters[].overrides.enable_control` | one of 5 objects, by `mode`: `AUTO`, `ALWAYS`, `NEVER`, `CLOCKED`, `CONDITIONAL` | no |  |
| `inserters[].overrides.enable_control{mode=CLOCKED}.ranges` | array (at least 1) of objects | yes |  |
| `inserters[].overrides.enable_control{mode=CLOCKED}.ranges[].start` | integer ≥ 0 | yes |  |
| `inserters[].overrides.enable_control{mode=CLOCKED}.ranges[].end` | integer > 0 | yes |  |
| `inserters[].overrides.enable_control{mode=CLOCKED}.period_duration_ticks` | integer > 0 | no |  |
| `inserters[].overrides.enable_control{mode=CLOCKED}.decider_build_order` | integer ≥ 0 | no |  |
| `inserters[].overrides.enable_control{mode=CLOCKED}.latency_ticks` | integer ≥ 0 | no |  |
| `inserters[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes |  |
| `inserters[].overrides.enable_control{mode=CONDITIONAL}.latch` | object | no |  |
| `inserters[].overrides.enable_control{mode=CONDITIONAL}.latch.release` | the same as `drills.configs[].overrides.enable_control{mode=CONDITIONAL}.rule_set` | yes |  |
| `inserters[].position` | object | no |  |
| `inserters[].position.x` | number | yes |  |
| `inserters[].position.y` | number | yes |  |
| `inserters[].direction` | integer 0 to 15 | no |  |

## belts

| Field | Type | Required | Description |
|---|---|---|---|
| `belts` | array of one of 2 objects, by `strategy`: `normal`, `export` | yes |  |
| `belts[]{strategy=normal}.id` | integer > 0 | yes |  |
| `belts[]{strategy=normal}.type` | one of `transport-belt`, `fast-transport-belt`, `express-transport-belt`, `turbo-transport-belt` | yes |  |
| `belts[]{strategy=normal}.lanes` | array of exactly 1 or array of exactly 2 | yes |  |
| `belts[]{strategy=normal}.lanes[0]` | object | yes |  |
| `belts[]{strategy=normal}.lanes[0].ingredient` | string | yes |  |
| `belts[]{strategy=normal}.lanes[0].stack_size` | integer > 0 | yes |  |
| `belts[]{strategy=normal}.lanes[1]` | object | yes |  |
| `belts[]{strategy=normal}.lanes[1].ingredient` | string | yes |  |
| `belts[]{strategy=normal}.lanes[1].stack_size` | integer > 0 | yes |  |
| `belts[]{strategy=export}.id` | integer > 0 | yes |  |
| `belts[]{strategy=export}.type` | one of `transport-belt`, `fast-transport-belt`, `express-transport-belt`, `turbo-transport-belt` | yes |  |
| `belts[]{strategy=export}.lanes` | array of exactly 1 or array of exactly 2 | yes |  |
| `belts[]{strategy=export}.lanes[0]` | object | yes |  |
| `belts[]{strategy=export}.lanes[0].ingredient` | string | yes |  |
| `belts[]{strategy=export}.lanes[0].stack_size` | integer > 0 | yes |  |
| `belts[]{strategy=export}.lanes[0].consumption_per_second` | number > 0 | no |  |
| `belts[]{strategy=export}.lanes[1]` | object | yes |  |
| `belts[]{strategy=export}.lanes[1].ingredient` | string | yes |  |
| `belts[]{strategy=export}.lanes[1].stack_size` | integer > 0 | yes |  |
| `belts[]{strategy=export}.lanes[1].consumption_per_second` | number > 0 | no |  |

## chests

| Field | Type | Required | Description |
|---|---|---|---|
| `chests` | array of one of 6 objects, by `type`: `buffer-chest`, `infinity-chest`, `car`, `tank`, `cargo-wagon`, `rocket-silo` | no |  |
| `chests[]{type=buffer-chest}.id` | integer > 0 | yes |  |
| `chests[]{type=buffer-chest}.storage_size` | integer > 0 | yes |  |
| `chests[]{type=buffer-chest}.item_filter` | string | yes |  |
| `chests[]{type=buffer-chest}.prototype` | string | no |  |
| `chests[]{type=buffer-chest}.position` | object | no |  |
| `chests[]{type=buffer-chest}.position.x` | number | yes |  |
| `chests[]{type=buffer-chest}.position.y` | number | yes |  |
| `chests[]{type=infinity-chest}.id` | integer > 0 | yes |  |
| `chests[]{type=infinity-chest}.item_filter` | array of objects, default `[]` | yes |  |
| `chests[]{type=infinity-chest}.item_filter[].item_name` | string, not empty | yes |  |
| `chests[]{type=infinity-chest}.item_filter[].request_count` | integer ≥ 0 | yes |  |
| `chests[]{type=infinity-chest}.remove_unfiltered_items` | boolean | no |  |
| `chests[]{type=infinity-chest}.position` | object | no |  |
| `chests[]{type=infinity-chest}.position.x` | number | yes |  |
| `chests[]{type=infinity-chest}.position.y` | number | yes |  |
| `chests[]{type=car}.id` | integer > 0 | yes |  |
| `chests[]{type=car}.slot_filters` | array of one of 2 objects | no |  |
| `chests[]{type=car}.slot_filters[]{1}.slot` | integer > 0 | yes |  |
| `chests[]{type=car}.slot_filters[]{1}.item` | string, not empty | yes |  |
| `chests[]{type=car}.slot_filters[]{1}.blocked` | not allowed | no |  |
| `chests[]{type=car}.slot_filters[]{2}.slot` | integer > 0 | yes |  |
| `chests[]{type=car}.slot_filters[]{2}.blocked` | `true` | yes |  |
| `chests[]{type=car}.slot_filters[]{2}.item` | not allowed | no |  |
| `chests[]{type=car}.contents` | array of objects | no |  |
| `chests[]{type=car}.contents[].slot` | integer > 0 | yes |  |
| `chests[]{type=car}.contents[].item` | string, not empty | yes |  |
| `chests[]{type=car}.contents[].count` | integer > 0 | yes |  |
| `chests[]{type=car}.storage_size` | any, see schema.ts | no |  |
| `chests[]{type=car}.position` | object | no |  |
| `chests[]{type=car}.position.x` | number | yes |  |
| `chests[]{type=car}.position.y` | number | yes |  |
| `chests[]{type=tank}.id` | integer > 0 | yes |  |
| `chests[]{type=tank}.slot_filters` | array of one of 2 objects | no |  |
| `chests[]{type=tank}.slot_filters[]{1}.slot` | integer > 0 | yes |  |
| `chests[]{type=tank}.slot_filters[]{1}.item` | string, not empty | yes |  |
| `chests[]{type=tank}.slot_filters[]{1}.blocked` | not allowed | no |  |
| `chests[]{type=tank}.slot_filters[]{2}.slot` | integer > 0 | yes |  |
| `chests[]{type=tank}.slot_filters[]{2}.blocked` | `true` | yes |  |
| `chests[]{type=tank}.slot_filters[]{2}.item` | not allowed | no |  |
| `chests[]{type=tank}.contents` | array of objects | no |  |
| `chests[]{type=tank}.contents[].slot` | integer > 0 | yes |  |
| `chests[]{type=tank}.contents[].item` | string, not empty | yes |  |
| `chests[]{type=tank}.contents[].count` | integer > 0 | yes |  |
| `chests[]{type=tank}.storage_size` | any, see schema.ts | no |  |
| `chests[]{type=tank}.position` | object | no |  |
| `chests[]{type=tank}.position.x` | number | yes |  |
| `chests[]{type=tank}.position.y` | number | yes |  |
| `chests[]{type=cargo-wagon}.id` | integer > 0 | yes |  |
| `chests[]{type=cargo-wagon}.slot_filters` | array of one of 2 objects | no |  |
| `chests[]{type=cargo-wagon}.slot_filters[]{1}.slot` | integer > 0 | yes |  |
| `chests[]{type=cargo-wagon}.slot_filters[]{1}.item` | string, not empty | yes |  |
| `chests[]{type=cargo-wagon}.slot_filters[]{1}.blocked` | not allowed | no |  |
| `chests[]{type=cargo-wagon}.slot_filters[]{2}.slot` | integer > 0 | yes |  |
| `chests[]{type=cargo-wagon}.slot_filters[]{2}.blocked` | `true` | yes |  |
| `chests[]{type=cargo-wagon}.slot_filters[]{2}.item` | not allowed | no |  |
| `chests[]{type=cargo-wagon}.contents` | array of objects | no |  |
| `chests[]{type=cargo-wagon}.contents[].slot` | integer > 0 | yes |  |
| `chests[]{type=cargo-wagon}.contents[].item` | string, not empty | yes |  |
| `chests[]{type=cargo-wagon}.contents[].count` | integer > 0 | yes |  |
| `chests[]{type=cargo-wagon}.storage_size` | any, see schema.ts | no |  |
| `chests[]{type=cargo-wagon}.position` | object | no |  |
| `chests[]{type=cargo-wagon}.position.x` | number | yes |  |
| `chests[]{type=cargo-wagon}.position.y` | number | yes |  |
| `chests[]{type=cargo-wagon}.quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no |  |
| `chests[]{type=rocket-silo}.id` | integer > 0 | yes |  |
| `chests[]{type=rocket-silo}.recipe_quality` | one of `normal`, `uncommon`, `rare`, `epic`, `legendary` | no |  |
| `chests[]{type=rocket-silo}.crafting_speed` | number > 0 | no |  |
| `chests[]{type=rocket-silo}.productivity` | number ≥ 0 | no |  |
| `chests[]{type=rocket-silo}.contents` | array of objects | no |  |
| `chests[]{type=rocket-silo}.contents[].item` | string, not empty | yes |  |
| `chests[]{type=rocket-silo}.contents[].count` | integer > 0 | yes |  |
| `chests[]{type=rocket-silo}.storage_size` | any, see schema.ts | no |  |
| `chests[]{type=rocket-silo}.position` | object | no |  |
| `chests[]{type=rocket-silo}.position.x` | number | yes |  |
| `chests[]{type=rocket-silo}.position.y` | number | yes |  |

## overrides

| Field | Type | Required | Description |
|---|---|---|---|
| `overrides` | object | no |  |
| `overrides.lcm` | integer > 0 | no |  |
| `overrides.terminal_swing_count` | integer > 0 | no |  |
| `overrides.use_fractional_swings` | boolean | no |  |
| `overrides.backed_up_belts` | boolean | no |  |
| `overrides.search_for_fewer_wake_ups` | boolean | no |  |
| `overrides.check_start_dependence` | boolean | no |  |
| `overrides.loop_seed_items` | integer ≥ 0 | no |  |
| `overrides.disable_swing_backoff` | boolean | no |  |
| `overrides.derive_clock_windows` | boolean | no |  |
| `overrides.ignored_lcm_ingredients` | array of string | no |  |
