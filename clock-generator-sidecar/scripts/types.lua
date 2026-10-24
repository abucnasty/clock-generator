---@class MachineData
---@field entity LuaEntity
---@field name string Machine entity name
---@field quality string The machine's quality name
---@field recipe string Recipe name (for machines/furnaces)
---@field recipe_quality string|nil The quality name of its recipe, nil when it has none
---@field crafting_speed number Effective crafting speed with bonuses (for machines/furnaces)
---@field productivity number Productivity bonus as percentage (0-100+)
---@field energy_consumption_bonus number|nil Energy consumption effect as a percentage (machines burning nutrients only)
---@field result_target_unit_number number|nil The unit_number of the container a machine that places its results itself (a recycler) puts them into

---@class DrillData
---@field entity LuaEntity The drill itself
---@field drill_type string The specific drill type (e.g., "electric-mining-drill")
---@field mined_item_name string|nil The resource being mined; nil when the drill has not mined yet and its area holds none or more than one kind
---@field speed_bonus number The speed bonus from modules/beacons
---@field productivity number Mining productivity as a percentage: the force's research and the drill's modules together
---@field drop_target_unit_number number|nil The unit_number of the entity the drill drops to: the game's drop_target, else the one machine or chest under its drop position
---@field drop_target_name string|nil The prototype name of the entity the drill drops to
---@field position MapPosition|nil Where the drill stands

---@class BeltLaneData
---@field ingredient string|nil The item on this lane (nil if empty or mixed)
---@field stack_size number The belt stack size

---@class BeltData
---@field belt_type string The belt type (e.g., "transport-belt", "express-transport-belt")
---@field unit_number number The unit number of the belt entity
---@field lanes BeltLaneData[] Data for each lane (1 = left, 2 = right, as get_transport_line numbers them)

---@class InserterTargetRef
---@field type "machine"|"belt"|"chest" The target type
---@field unit_number number The unit number of the target entity
---@field name string The target entity's name
---@field near_lane 1|2|nil Preferred pickup lane: nearest beside a belt, mirroring-selected downstream of an underground endpoint
---@field entity_type string|nil Native pickup entity type, preserved in capture provenance
---@field pickup_length number|nil Exposed pickup line length in tiles
---@field pickup_layout string|nil Physical side/front approach and endpoint
---@field supply_problem "side-loaded"|nil Why the supply is out of scope: another belt side-loads onto the pickup tile
---@field pickup_problem string|nil Why the pickup geometry was omitted
---@field side_load_tiles number|nil For a drop onto a belt: the tiles to the belt its stream side-loads onto, where that is fed from behind
---@field belt_direction number|nil For a drop onto a belt: the way the belt runs at the drop tile (defines.direction)

---@class InfinityFilterData
---@field item_name string The item name
---@field request_count number The quantity of items

---@class BufferChestData
---@field chest_type "buffer-chest" The chest type discriminator
---@field unit_number number The unit number of the chest entity
---@field name string The chest's prototype name (steel-chest, ...)
---@field position {x: number, y: number} Where the chest stands
---@field storage_size number Number of inventory slots
---@field item_filter string The single item type this chest holds

---@class InfinityChestData
---@field chest_type "infinity-chest" The chest type discriminator
---@field unit_number number The unit number of the chest entity
---@field position {x: number, y: number} Where the chest stands
---@field item_filters InfinityFilterData[] The configured infinity filters, not current inventory
---@field remove_unfiltered_items boolean Whether unfiltered incoming items are removed

---@alias ChestData BufferChestData|InfinityChestData

---@class InserterData
---@field entity LuaEntity
---@field inserter_type string The inserter entity name
---@field quality string The inserter's quality name
---@field position MapPosition Where the inserter stands
---@field stack_size number The inserter stack size
---@field filters string[] Item filters the inserter uses: none while its filters are switched off
---@field filter_mode "whitelist"|"blacklist"|nil How the inserter reads its filters, nil while they are switched off
---@field source InserterTargetRef|nil The pickup target
---@field sink InserterTargetRef|nil The drop target

---@class SuggestedTarget
---@field recipe string The item name of the main product that leaves the selection (not necessarily the recipe's name)
---@field items_per_second number What the selected machines of that recipe make of it together at their maximum
---@field copies number Always 1

---@class PlayerData
---@field machines MachineData[] Extracted machine data
---@field gui LuaGuiElement? Reference to the GUI frame
---@field extraction_result ExtractionResult? Cached extraction result

---@class ExtractionResult
---@field machines MachineData[]
---@field drills DrillData[]
---@field inserters InserterData[]
---@field belts BeltData[]
---@field chests ChestData[]
---@field unit_number_to_id table<number, number> Maps entity unit_number to machine ID
---@field belt_unit_number_to_id table<number, number> Maps belt unit_number to belt ID
---@field chest_unit_number_to_id table<number, number> Maps chest unit_number to chest ID

return {}
