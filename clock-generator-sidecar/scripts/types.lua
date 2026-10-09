---@class MachineData
---@field name string Machine entity name
---@field recipe string Recipe name (for machines/furnaces)
---@field crafting_speed number Effective crafting speed with bonuses (for machines/furnaces)
---@field productivity number Productivity bonus as percentage (0-100+)
---@field type "machine"|"furnace"|"biochamber"|"mining-drill" Entity type category
---@field energy_consumption_bonus number|nil Energy consumption effect as a percentage (biochambers only)

---@class DrillData
---@field drill_type string The specific drill type (e.g., "electric-mining-drill")
---@field mined_item_name string The resource being mined
---@field speed_bonus number The speed bonus from modules/beacons
---@field productivity number Productivity bonus as percentage (for display only)
---@field drop_target_unit_number number|nil The unit_number of the entity the drill drops to

---@class BeltLaneData
---@field ingredient string|nil The item on this lane (nil if empty or mixed)
---@field stack_size number The belt stack size

---@class BeltData
---@field belt_type string The belt type (e.g., "transport-belt", "express-transport-belt")
---@field unit_number number The unit number of the belt entity
---@field lanes BeltLaneData[] Data for each lane (1 = right, 2 = left)

---@class InserterTargetRef
---@field type "machine"|"belt"|"chest" The target type
---@field unit_number number The unit number of the target entity

---@class InfinityFilterData
---@field item_name string The item name
---@field request_count number The quantity of items

---@class BufferChestData
---@field chest_type "buffer-chest" The chest type discriminator
---@field unit_number number The unit number of the chest entity
---@field storage_size number Number of inventory slots
---@field item_filter string The single item type this chest holds

---@class InfinityChestData
---@field chest_type "infinity-chest" The chest type discriminator
---@field unit_number number The unit number of the chest entity
---@field item_filters InfinityFilterData[] The items and quantities in this chest

---@alias ChestData BufferChestData|InfinityChestData

---@class InserterData
---@field inserter_type string The inserter entity name
---@field stack_size number The inserter stack size
---@field filters string[] Item filters set on the inserter
---@field source InserterTargetRef|nil The pickup target
---@field sink InserterTargetRef|nil The drop target

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
---@field mining_productivity_level number The researched mining productivity level

return {}
