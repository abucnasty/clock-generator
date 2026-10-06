-- Config Export (copied from clock-generator-sidecar, with exported_inserters/to_table for recording)
-- Converts extraction results to clock-generator compatible JSON format.

require("scripts.types")

local export = {}

-- Helper Functions

---Resolve a target reference to its ID using the unit_number mappings
---@param target InserterTargetRef|nil The target reference with type and unit_number
---@param result ExtractionResult The extraction result containing ID mappings
---@return table|nil config The resolved target config with type and id
local function resolve_target_id(target, result)
    if not target then
        return nil
    end
    
    local target_id = 1 -- Default fallback
    if target.unit_number then
        if target.type == "belt" then
            -- Look up belt ID
            local mapped_id = result.belt_unit_number_to_id[target.unit_number]
            if mapped_id then
                target_id = mapped_id
            end
        elseif target.type == "chest" then
            -- Look up chest ID
            local mapped_id = result.chest_unit_number_to_id[target.unit_number]
            if mapped_id then
                target_id = mapped_id
            end
        else
            -- Look up machine ID
            local mapped_id = result.unit_number_to_id[target.unit_number]
            if mapped_id then
                target_id = mapped_id
            end
        end
    end
    
    return {
        type = target.type,
        id = target_id
    }
end

-- Main Export Function

---Inserters that end up in the exported config, paired with their config id (index + 1 in export order)
---@param result ExtractionResult
---@return {id: number, inserter: InserterData, source: table, sink: table}[]
function export.exported_inserters(result)
    local exported = {}
    for _, inserter in ipairs(result.inserters) do
        local source_config = resolve_target_id(inserter.source, result)
        local sink_config = resolve_target_id(inserter.sink, result)
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

---Convert extraction result to a clock-generator compatible config table
---@param result ExtractionResult
---@return table
function export.to_table(result)
    local output = {
        machines = {},
        drills = {
            mining_productivity_level = result.mining_productivity_level,
            configs = {}
        },
        inserters = {},
        belts = {},
        chests = {}
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
    
    -- Format inserters for clock-generator
    for _, exported in ipairs(export.exported_inserters(result)) do
        local inserter = exported.inserter
        local inserter_export = {
            source = exported.source,
            sink = exported.sink,
            stack_size = inserter.stack_size
        }

        -- Determine filters - use explicit filters first, then infer from source
        local filters = {}
        if #inserter.filters > 0 then
            filters = inserter.filters
        elseif inserter.source_recipe_outputs and #inserter.source_recipe_outputs > 0 then
            -- Infer from source machine's recipe outputs
            filters = inserter.source_recipe_outputs
        elseif inserter.source_belt_lanes and #inserter.source_belt_lanes > 0 then
            -- Infer from source belt's lane contents
            for _, lane_data in ipairs(inserter.source_belt_lanes) do
                if lane_data.ingredient then
                    table.insert(filters, lane_data.ingredient)
                end
            end
        end

        -- Add filters if any exist (including inferred ones)
        if #filters > 0 then
            inserter_export.filters = filters
        end

        table.insert(output.inserters, inserter_export)
    end
    
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
                item_filter = filters
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
