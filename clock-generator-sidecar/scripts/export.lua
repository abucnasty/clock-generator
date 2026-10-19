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
---@return table|nil config The resolved target config with type and id, or nil when the inserter is left out
local function resolve_target_id(target, result, is_sink)
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
        -- An output belt or chest is often empty when selected, so it is not exported and has no id. The inserter that
        -- drops into it is kept, pointing at the first belt or chest: it is the build's output, and a recording is
        -- matched to its config by the type of what an inserter drops into, not by its id. Any other end without an id
        -- (an empty belt or chest to take from, a machine that is not exported such as a lab) leaves the inserter out.
        if not (is_sink and (target.type == "belt" or target.type == "chest")) then
            return nil
        end
        target_id = 1
    end
    
    local pickup_capture
    if not is_sink and target.type == "belt" then
        local problem = target.supply_problem or target.pickup_problem
        if not target.pickup_length or not target.entity_type then problem = problem or "unsupported" end
        pickup_capture = {
            status = problem and "unsupported" or "supported",
            entity_type = target.entity_type, entity_name = target.name,
            sidecar_version = script.active_mods["clock-generator-sidecar"], reason = problem,
            model = not problem and (target.pickup_merge and "turbo-two-stream" or "belt") or nil,
            model_version = not problem and 1 or nil,
        }
    end
    return {
        type = target.type,
        id = target_id,
        -- Preferred pickup lane; determined by mirroring for a supported inline underground pickup.
        near_lane = target.near_lane,
        pickup_length = not is_sink and target.pickup_length or nil,
        pickup_supply = not is_sink and target.pickup_supply or nil,
        pickup_merge = not is_sink and target.pickup_merge or nil,
        pickup_capture = pickup_capture
    }
end

-- Main Export Function

---Inserters that end up in the exported config, paired with their config id (index + 1 in export order)
---@param result ExtractionResult
---@return {id: number, inserter: InserterData, source: table, sink: table}[]
function export.exported_inserters(result)
    local exported = {}
    for _, inserter in ipairs(result.inserters) do
        local source_config = resolve_target_id(inserter.source, result, false)
        local sink_config = resolve_target_id(inserter.sink, result, true)
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
---@return {inserter: InserterData, pickup: boolean, target: InserterTargetRef|nil}[]
function export.left_out_inserters(result)
    local left_out = {}
    for _, inserter in ipairs(result.inserters) do
        if not resolve_target_id(inserter.source, result, false) then
            table.insert(left_out, { inserter = inserter, pickup = true, target = inserter.source })
        elseif not resolve_target_id(inserter.sink, result, true) then
            table.insert(left_out, { inserter = inserter, pickup = false, target = inserter.sink })
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
---@return table
function export.to_table(result)
    local output = {
        -- lets the clock generator tell when the mod is too old to export everything it can use
        sidecar_version = script.active_mods["clock-generator-sidecar"],
        machines = {},
        drills = {
            mining_productivity_level = result.mining_productivity_level,
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
            energy_consumption_bonus = machine.energy_consumption_bonus
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
    
    -- Format drills for clock-generator (different schema)
    for i, drill in ipairs(result.drills) do
        -- Look up the target machine ID from the unit_number mapping
        local target_machine_id = 1 -- Default fallback (must be >0)
        if drill.drop_target_unit_number then
            local mapped_id = result.unit_number_to_id[drill.drop_target_unit_number]
            if mapped_id then
                target_machine_id = mapped_id
            end
        end
        
        table.insert(output.drills.configs, {
            id = i,
            type = drill.drill_type,
            mined_item_name = drill.mined_item_name,
            speed_bonus = drill.speed_bonus,
            target = {
                type = "machine",
                id = target_machine_id
            }
        })
    end
    
    -- Capture diagnostics stay outside the simulator config and refer to exported inserter IDs.
    local pickup_warnings = {}
    -- Format inserters for clock-generator
    for _, exported in ipairs(export.exported_inserters(result)) do
        local inserter = exported.inserter
        local inserter_export = {
            source = exported.source,
            sink = exported.sink,
            stack_size = inserter.stack_size
        }

        -- Only the filters set on the inserter itself are exported. Which items it moves is worked out by the
        -- clock generator from what its source provides and its sink accepts; guessing it here produces filters
        -- the sink does not accept.
        if #inserter.filters > 0 then
            inserter_export.filters = inserter.filters
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
        else
            -- Buffer chest format
            table.insert(output.chests, {
                type = "buffer-chest",
                id = i,
                storage_size = chest.storage_size,
                item_filter = chest.item_filter
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
