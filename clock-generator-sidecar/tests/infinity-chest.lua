-- Run from the repository root: npm exec --yes --package=fengari-node-cli -- fengari clock-generator-sidecar/tests/infinity-chest.lua
-- Exercise the real extraction/export modules, with only the Factorio entity API replaced.
package.preload['__clock-generator-sidecar__.scripts.types'] = function() return {} end
package.preload['__clock-generator-sidecar__.scripts.helpers'] = function() return dofile('clock-generator-sidecar/scripts/helpers.lua') end
package.preload['__clock-generator-sidecar__.scripts.suggested-target'] = function() return { find = function() return nil end } end
defines = { direction = { north = 0, east = 4, south = 8, west = 12 }, inventory = { chest = 1 } }
script = { active_mods = { ['clock-generator-sidecar'] = '0.8.0' } }
local extraction = dofile('clock-generator-sidecar/scripts/extraction.lua')
local export = dofile('clock-generator-sidecar/scripts/export.lua')
local function infinity(id, filters, remove)
    return { valid = true, type = 'infinity-container', name = 'infinity-chest', unit_number = id,
        prototype = {}, infinity_container_filters = filters, remove_unfiltered_items = remove,
        get_inventory = function() error('Infinity settings must not be inferred from current inventory') end }
end
local empty = infinity(10, {}, true)
local mixed = infinity(20, { { name = 'iron-plate', count = 200 }, { name = 'copper-plate', count = 0 } }, true)
local source = infinity(30, { { name = 'iron-plate', count = 100 } }, false)
local unconfigured = infinity(40, {}, false)
local result = extraction.extract_all_entities({ empty, mixed, source, unconfigured })
assert(#result.chests == 4, 'Empty infinity chests must remain in the selection')
local empty_id, mixed_id, source_id, unconfigured_id = result.chest_unit_number_to_id[10], result.chest_unit_number_to_id[20], result.chest_unit_number_to_id[30], result.chest_unit_number_to_id[40]
assert(result.chests[empty_id].remove_unfiltered_items == true)
assert(#result.chests[empty_id].item_filters == 0)
assert(result.chests[mixed_id].item_filters[1].item_name == 'copper-plate')
assert(result.chests[mixed_id].item_filters[1].request_count == 0)
assert(result.chests[mixed_id].item_filters[2].request_count == 200)
-- A route ending at the empty disposal chest must retain that endpoint in the export.
result.inserters = { { source = { type = 'chest', unit_number = 30 }, sink = { type = 'chest', unit_number = 10 }, stack_size = 4, filters = {} } }
local config = export.to_table(result)
assert(#config.chests == 4)
assert(config.chests[empty_id].remove_unfiltered_items == true)
assert(config.chests[empty_id].item_filter == nil, 'Absent filter arrays default to [] in the config')
assert(config.chests[source_id].remove_unfiltered_items == false)
assert(config.chests[source_id].item_filter[1].request_count == 100)
assert(config.chests[unconfigured_id].remove_unfiltered_items == false)
assert(config.inserters[1].sink.id == empty_id)
assert(config.inserters[1].source.id == source_id)
print('Infinity chest extraction and export checks passed')
