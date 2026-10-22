-- JSON Export for Clock Generator Sidecar
-- Converts extraction results to clock-generator compatible JSON format.

require("__clock-generator-sidecar__.scripts.types")
local suggested_target = require("__clock-generator-sidecar__.scripts.suggested-target")

local export = {}

-- Helper Functions

---Resolve a target reference to its ID using the unit_number mappings
---@param target InserterTargetRef|nil The target reference with type and unit_number
---@param result ExtractionResult The extraction result containing ID mappings
---@param is_sink boolean Whether the inserter drops into the target
---@param options ExportOptions|nil
---@return table|nil config The resolved target config with type and id, or nil when the inserter is left out
local function resolve_target_id(target, result, is_sink, options)
    if not target then
        return nil
    end
    
    local target_id = nil
    if target.unit_number then
        if target.type == "belt" then
            -- Look up belt ID
            target_id = result.belt_unit_number_to_id[target.unit_number]
        elseif target.type == "chest" then
            -- Look up chest ID
            target_id = result.chest_unit_number_to_id[target.unit_number]
        else
            -- Look up machine ID
            target_id = result.unit_number_to_id[target.unit_number]
        end
    end
    
    if not target_id then
        -- An end without an id (an empty belt or chest, a machine that is not exported such as a lab, anything outside
        -- the selection) leaves the inserter out: pointing it at belt, chest or machine 1 would name some other entity.
        -- Only the recorder keeps an inserter that drops onto an empty belt or into an empty chest: an output belt is
        -- often empty when a build is recorded, and a recording is matched to its config by the type of what an
        -- inserter drops into, never by its id (ExportOptions).
        if not (options and options.keep_unexported_sinks and is_sink and (target.type == "belt" or target.type == "chest")) then
            return nil
        end
        target_id = 1
    end
    
    local pickup_capture
    if not is_sink and target.type == "belt" then
        local problem = target.supply_problem or target.pickup_problem
        if not target.pickup_length or not target.pickup_layout or not target.entity_type then problem = problem or "unsupported" end
        pickup_capture = {
            status = problem and "unsupported" or "supported",
            entity_type = target.entity_type, entity_name = target.name,
            sidecar_version = script.active_mods["clock-generator-sidecar"], reason = problem,
            model = not problem and "belt" or nil,
            model_version = not problem and 2 or nil,
        }
    end
    return {
        type = target.type,
        id = target_id,
        -- Preferred pickup lane; determined by mirroring for a supported inline underground pickup.
        near_lane = target.near_lane,
        pickup_length = not is_sink and target.pickup_length or nil,
        pickup_layout = not is_sink and target.pickup_layout or nil,
        pickup_capture = pickup_capture
    }
end

-- Main Export Function

---@class ExportOptions
---@field keep_unexported_sinks boolean|nil For the recorder only: keep an inserter that drops onto a belt or into a chest that is not exported, pointing it at belt or chest 1. The sidecar never sets it.

---Inserters that end up in the exported config, paired with their config id (index + 1 in export order)
---@param result ExtractionResult
---@param options ExportOptions|nil
---@return {id: number, inserter: InserterData, source: table, sink: table}[]
function export.exported_inserters(result, options)
    local exported = {}
    for _, inserter in ipairs(result.inserters) do
        local source_config = resolve_target_id(inserter.source, result, false, options)
        local sink_config = resolve_target_id(inserter.sink, result, true, options)
        -- Only include inserter if both source and sink are known
        if source_config and sink_config then
            table.insert(exported, {
                id = #exported + 1,
                inserter = inserter,
                source = source_config,
                sink = sink_config
            })
        end
    end
    return exported
end

---Inserters that are left out of the exported config, each with the end it is left out for: the pickup when that has
---no id, else the drop. The target is nil when the sidecar has no type for what is at that end (the ground, a wagon).
---@param result ExtractionResult
---@param options ExportOptions|nil
---@return {inserter: InserterData, pickup: boolean, target: InserterTargetRef|nil}[]
function export.left_out_inserters(result, options)
    local left_out = {}
    for _, inserter in ipairs(result.inserters) do
        if not resolve_target_id(inserter.source, result, false, options) then
            table.insert(left_out, { inserter = inserter, pickup = true, target = inserter.source })
        elseif not resolve_target_id(inserter.sink, result, true, options) then
            table.insert(left_out, { inserter = inserter, pickup = false, target = inserter.sink })
        end
    end
    return left_out
end

---What a drill drops into, as the config's target: an exported machine, else an exported chest; nil when neither
---@param drill DrillData
---@param result ExtractionResult
---@return {type: "machine"|"chest", id: number}|nil
function export.drill_target(drill, result)
    local unit_number = drill.drop_target_unit_number
    if not unit_number then
        return nil
    end
    local machine_id = result.unit_number_to_id[unit_number]
    if machine_id then
        return { type = "machine", id = machine_id }
    end
    local chest_id = result.chest_unit_number_to_id[unit_number]
    if chest_id then
        return { type = "chest", id = chest_id }
    end
    return nil
end

---Drills that are left out of the exported config: the ones that drop into nothing the export has (the ground, or an
---entity that is not exported), each with the name of what it drops into, nil for the ground
---@param result ExtractionResult
---@return {drill: DrillData, target_name: string|nil}[]
function export.left_out_drills(result)
    local left_out = {}
    for _, drill in ipairs(result.drills) do
        if not export.drill_target(drill, result) then
            table.insert(left_out, { drill = drill, target_name = drill.drop_target_name })
        end
    end
    return left_out
end

---The product that leaves the selection and what its machines make of it per second at most, nil when there is none
---@param result ExtractionResult
---@return SuggestedTarget|nil
function export.suggested_target(result)
    return suggested_target.find(result.machines)
end

---Convert extraction result to a clock-generator compatible config table
---@param result ExtractionResult
---@param options ExportOptions|nil
---@return table
function export.to_table(result, options)
    local output = {
        -- lets the clock generator tell when the mod is too old to export everything it can use
        sidecar_version = script.active_mods["clock-generator-sidecar"],
        machines = {},
        drills = {
            configs = {}
        },
        inserters = {},
        belts = {},
        chests = {},
        -- nil, which leaves the key out, when the selection has no final product
        suggested_target = export.suggested_target(result)
    }
    
    -- Format machines for clock-generator
    for i, machine in ipairs(result.machines) do
        table.insert(output.machines, {
            id = i,
            recipe = machine.recipe,
            crafting_speed = machine.crafting_speed,
            productivity = machine.productivity,
            type = machine.type,
            energy_consumption_bonus = machine.energy_consumption_bonus,
            -- for labels only: the generator names the machine by its icon and keeps its qualities
            prototype = machine.name,
            quality = machine.quality,
            recipe_quality = machine.recipe_quality
        })
    end
    
    -- Format belts for clock-generator
    for i, belt in ipairs(result.belts) do
        local lanes = {}
        for _, lane in ipairs(belt.lanes) do
            table.insert(lanes, {
                ingredient = lane.ingredient or "",
                stack_size = lane.stack_size
            })
        end
        
        table.insert(output.belts, {
            id = i,
            type = belt.belt_type,
            lanes = lanes
        })
    end
    
    -- Format drills for clock-generator (different schema): a drill whose drop target is neither an exported machine
    -- nor an exported chest is left out (export.left_out_drills), as the clock generator needs what it drops into
    for _, drill in ipairs(result.drills) do
        local target = export.drill_target(drill, result)
        if target then
            table.insert(output.drills.configs, {
                id = #output.drills.configs + 1,
                type = drill.drill_type,
                mined_item_name = drill.mined_item_name,
                speed_bonus = drill.speed_bonus,
                productivity = drill.productivity,
                target = target
            })
        end
    end
    
    -- Capture diagnostics stay outside the simulator config and refer to exported inserter IDs.
    local pickup_warnings = {}
    -- Format inserters for clock-generator
    for _, exported in ipairs(export.exported_inserters(result, options)) do
        local inserter = exported.inserter
        local inserter_export = {
            source = exported.source,
            sink = exported.sink,
            -- The clock generator times the swing by the prototype and quality, and refuses a belt pickup by any
            -- inserter but the legendary stack inserter. Without them it would run every inserter as that one.
            prototype = inserter.inserter_type,
            quality = inserter.quality,
            stack_size = inserter.stack_size
        }

        -- Only the filters set on the inserter itself are exported. Which items it moves is worked out by the
        -- clock generator from what its source provides and its sink accepts; guessing it here produces filters
        -- the sink does not accept.
        if #inserter.filters > 0 then
            inserter_export.filters = inserter.filters
            -- The clock generator reads filters as the items to move and refuses a blacklist, which names the items
            -- to leave. A whitelist needs no mode.
            if inserter.filter_mode == "blacklist" then
                inserter_export.filter_mode = "blacklist"
            end
        end

        table.insert(output.inserters, inserter_export)
        if exported.source.type == "belt" and (not exported.source.pickup_length or inserter.source.supply_problem) then
            table.insert(pickup_warnings, { inserter_id = exported.id,
                reason = inserter.source.supply_problem or inserter.source.pickup_problem or "unsupported" })
        end
    end
    if #pickup_warnings > 0 then output.pickup_warnings = pickup_warnings end
    
    -- Format chests for clock-generator
    for i, chest in ipairs(result.chests) do
        if chest.chest_type == "infinity-chest" then
            -- Infinity chest format
            local filters = {}
            for _, filter in ipairs(chest.item_filters) do
                table.insert(filters, {
                    item_name = filter.item_name,
                    request_count = filter.request_count
                })
            end
            table.insert(output.chests, {
                type = "infinity-chest",
                id = i,
                -- Missing filters default to [] in the config; avoid ambiguous JSON for an empty Lua table.
                item_filter = #filters > 0 and filters or nil,
                remove_unfiltered_items = chest.remove_unfiltered_items == true
            })
        elseif chest.chest_type == "rocket-silo" then
            table.insert(output.chests, {
                type = "rocket-silo",
                id = i,
                recipe_quality = chest.recipe_quality,
                crafting_speed = chest.crafting_speed,
                productivity = chest.productivity,
                contents = #chest.contents > 0 and chest.contents or nil,
            })
        elseif chest.chest_type == "car" or chest.chest_type == "tank" or chest.chest_type == "cargo-wagon" then
            -- a car's or a tank's quality does not change its slots: only a wagon's is exported
            table.insert(output.chests, {
                type = chest.chest_type,
                id = i,
                quality = chest.chest_type == "cargo-wagon" and chest.quality or nil,
                slot_filters = #chest.slot_filters > 0 and chest.slot_filters or nil,
                contents = #chest.contents > 0 and chest.contents or nil,
            })
        else
            -- Buffer chest format
            table.insert(output.chests, {
                type = "buffer-chest",
                id = i,
                storage_size = chest.storage_size,
                item_filter = chest.item_filter,
                prototype = chest.name
            })
        end
    end

    return output
end

---Convert extraction result to clock-generator compatible JSON
---@param result ExtractionResult
---@return string
function export.to_json(result)
    return helpers.table_to_json(export.to_table(result))
end

return export
