-- Entity Extraction (copied from clock-generator-sidecar, with entity references kept for recording)
-- Functions for extracting data from Factorio entities (machines, drills,
-- inserters, belts).

require("scripts.types")
local helpers = require("scripts.helpers")

local debug = false

local extraction = {}

-- Individual Entity Extractors

---Extract data from a mining drill
---@param entity LuaEntity
---@return DrillData|nil
local function extract_mining_drill_data(entity)
    if not entity or not entity.valid then
        return nil
    end

    -- Get what the drill is mining
    local mining_target = entity.mining_target
    if not mining_target then
        return nil
    end

    local total_productivity = entity.productivity_bonus or 0

    -- Speed bonus from modules/beacons (this is what clock-generator expects)
    local speed_bonus = entity.speed_bonus or 0

    -- Get the drop target (the entity the drill is putting items into)
    local drop_target = entity.drop_target
    local drop_target_unit_number = nil
    if drop_target and drop_target.valid and drop_target.unit_number then
        drop_target_unit_number = drop_target.unit_number
    end

    ---@type DrillData
    local data = {
        drill_type = entity.name,
        mined_item_name = mining_target.name,
        speed_bonus = speed_bonus,
        productivity = total_productivity * 100,
        drop_target_unit_number = drop_target_unit_number,
    }

    return data
end

---Extract data from a transport belt
---@param entity LuaEntity
---@return BeltData|nil
local function extract_belt_data(entity)
    if not entity or not entity.valid then
        return nil
    end

    -- Only accept transport-belt entity type (covers all belt tiers)
    if entity.prototype.subgroup.name ~= "belt" then
        return nil
    end

    local default_belt_stack_size = helpers.get_default_belt_stack_size(entity.force)

    local lanes = {}

    -- Transport belts have 2 lines: 1 = right lane, 2 = left lane
    local max_lines = entity.get_max_transport_line_index()

    -- Extract lane 1 (right lane) first
    local transport_line_1 = entity.get_transport_line(1)
    local ingredient_1, stack_size_1 = helpers.get_lane_info(transport_line_1, default_belt_stack_size)

    -- Extract lane 2 (left lane)
    local transport_line_2 = max_lines >= 2 and entity.get_transport_line(2) or nil
    local ingredient_2, stack_size_2 = nil, nil
    if transport_line_2 then
        ingredient_2, stack_size_2 = helpers.get_lane_info(transport_line_2, default_belt_stack_size)
    end

    -- Skip belts with no items on either lane
    if not ingredient_1 and not ingredient_2 then
        return nil
    end

    -- If only lane 2 has items, use it as lane 1 (single lane belt)
    if not ingredient_1 and ingredient_2 then
        table.insert(lanes, {
            ingredient = ingredient_2,
            stack_size = stack_size_2
        })
    else
        -- Lane 1 has items - add it
        table.insert(lanes, {
            ingredient = ingredient_1,
            stack_size = stack_size_1
        })

        -- Add second lane (may be empty)
        table.insert(lanes, {
            ingredient = ingredient_2,
            stack_size = stack_size_2 or default_belt_stack_size
        })
    end

    ---@type BeltData
    local data = {
        belt_type = helpers.normalize_belt_type(entity.name),
        unit_number = entity.unit_number,
        lanes = lanes
    }

    return data
end

---Check if an entity is a chest type we care about
---@param entity LuaEntity
---@return boolean
local function is_chest_entity(entity)
    if not entity or not entity.valid then
        return false
    end
    local t = entity.type
    return t == "container" or t == "logistic-container" or
        t == "linked-container" or t == "infinity-container"
end

---Extract data from a chest (buffer chest or infinity chest)
---@param entity LuaEntity
---@return ChestData|nil
local function extract_chest_data(entity)
    if not entity or not entity.valid then
        return nil
    end

    if not is_chest_entity(entity) then
        return nil
    end

    -- Get the chest's inventory
    local inventory = entity.get_inventory(defines.inventory.chest)
    if not inventory then
        return nil
    end

    local contents = inventory.get_contents()
    if not contents or #contents == 0 then
        return nil -- Skip empty chests
    end

    local storage_size = #inventory -- Number of slots

    if (inventory.supports_bar()) then
        storage_size = inventory.get_bar() - 1
    end

    -- Check if this is an infinity chest (has infinity_container_filters)
    -- Infinity containers in Factorio have the infinity_container_filters property
    if entity.type == "infinity-container" then
        -- This is an infinity chest - extract filters
        local filters = {}
        for _, item_stack in pairs(contents) do
            table.insert(filters, {
                item_name = item_stack.name,
                request_count = item_stack.count
            })
        end

        if #filters == 0 then
            return nil
        end

        ---@type InfinityChestData
        return {
            chest_type = "infinity-chest",
            unit_number = entity.unit_number,
            item_filters = filters
        }
    else
        -- This is a buffer chest - use the first item as the filter
        -- Buffer chests only support a single item type
        local first_item = contents[1]
        if not first_item then
            return nil
        end

        ---@type BufferChestData
        return {
            chest_type = "buffer-chest",
            unit_number = entity.unit_number,
            storage_size = storage_size,
            item_filter = first_item.name
        }
    end
end

---Extract data from an inserter
---@param entity LuaEntity
---@return InserterData|nil
local function extract_inserter_data(entity)
    if not entity or not entity.valid then
        return nil
    end

    if entity.type ~= "inserter" then
        return nil
    end

    -- Get stack size (use inserter_stack_size_override if set, otherwise the current target pickup count)
    local stack_size = entity.inserter_stack_size_override
    if stack_size == 0 then
        -- No override, use the effective stack size
        stack_size = entity.inserter_target_pickup_count
    end

    -- Get filters
    local filters = {}
    local filter_slot_count = entity.filter_slot_count or 0
    for i = 1, filter_slot_count do
        local filter = entity.get_filter(i)
        if filter and filter.name then
            table.insert(filters, filter.name)
        end
    end

    -- Get source (pickup target)
    local source = nil
    local source_recipe_outputs = nil
    local source_belt_lanes = nil
    local pickup_target = entity.pickup_target
    if pickup_target and pickup_target.valid then
        local target_type = helpers.get_target_type(pickup_target)
        if target_type then
            source = {
                type = target_type,
                unit_number = pickup_target.unit_number
            }

            -- If source is a machine, get its recipe outputs for auto-configuration
            if target_type == "machine" then
                local recipe = helpers.get_recipe_or_previous(pickup_target)
                if recipe then
                    source_recipe_outputs = {}
                    for _, product in pairs(recipe.products) do
                        if product.type == "item" then
                            table.insert(source_recipe_outputs, product.name)
                        end
                    end
                end
                -- If source is a belt, get contents from each lane
            elseif target_type == "belt" then
                source_belt_lanes = {}
                local max_lines = pickup_target.get_max_transport_line_index()
                -- Check which lanes the inserter picks from
                local picks_left = entity.pickup_from_left_lane
                local picks_right = entity.pickup_from_right_lane

                local default_belt_stack_size = helpers.get_default_belt_stack_size(pickup_target.force)

                for i = 1, math.min(max_lines, 2) do
                    local is_right_lane = (i == 1)
                    local is_left_lane = (i == 2)

                    -- Only get contents for lanes the inserter actually picks from
                    if (is_right_lane and picks_right) or (is_left_lane and picks_left) then
                        local transport_line = pickup_target.get_transport_line(i)
                        local ingredient, _ = helpers.get_lane_info(transport_line, default_belt_stack_size)
                        if ingredient then
                            table.insert(source_belt_lanes, {
                                lane = i,
                                ingredient = ingredient
                            })
                        end
                    end
                end
            end
        end
    end

    -- Get sink (drop target)
    local sink = nil
    local drop_target = entity.drop_target
    if drop_target and drop_target.valid then
        local target_type = helpers.get_target_type(drop_target)
        if target_type then
            sink = {
                type = target_type,
                unit_number = drop_target.unit_number
            }
        end
    end

    ---@type InserterData
    local data = {
        entity = entity,
        inserter_type = entity.name,
        stack_size = stack_size,
        filters = filters,
        source = source,
        sink = sink,
        source_recipe_outputs = source_recipe_outputs,
        source_belt_lanes = source_belt_lanes
    }

    return data
end

---Extract crafting data from a single crafting machine entity
---@param entity LuaEntity
---@return MachineData|nil
local function extract_crafting_machine_data(entity)
    if not entity or not entity.valid then
        return nil
    end

    -- Get recipe (fallback to previous_recipe for furnaces that may not have an active recipe)
    local recipe = helpers.get_recipe_or_previous(entity)
    if not recipe then
        return nil
    end

    -- Determine type category
    local entity_type = "machine"
    if entity.type == "furnace" then
        entity_type = "furnace"
    end

    -- Get entity productivity from modules/beacons
    local entity_prod_bonus = entity.productivity_bonus or 0

    -- Get research productivity from the force's recipe
    local research_prod = 0
    if entity.force and recipe then
        local force_recipe = entity.force.recipes[recipe.name]
        if force_recipe then
            research_prod = force_recipe.productivity_bonus or 0
        end
    end

    -- Combine entity productivity (modules/beacons) with research productivity
    local total_productivity = entity_prod_bonus + research_prod

    -- Cap productivity at 300% (Factorio maximum)
    if total_productivity > 3.0 then
        total_productivity = 3.0
    end

    -- Extract data
    ---@type MachineData
    local data = {
        entity = entity,
        name = entity.name,
        recipe = recipe.name,
        crafting_speed = entity.crafting_speed,
        productivity = total_productivity * 100,
        type = entity_type
    }

    return data
end

---Extract crafting data from a single entity (dispatches to appropriate handler)
---@param entity LuaEntity
---@return MachineData|nil, string|nil category The extracted data and category ("machine" or "drill")
local function extract_machine_data(entity)
    if not entity or not entity.valid then
        return nil, nil
    end

    -- Handle mining drills separately
    if entity.type == "mining-drill" then
        return extract_mining_drill_data(entity), "drill"
    end

    -- Only handle entities with supported subgroups
    local supported_subgroups = {
        ["smelting-machine"] = true,
        ["production-machine"] = true,
        ["agriculture"] = true
    }

    if debug then
        helpers.print("Entity: " .. entity.name .. ", subgroup: " .. (entity.prototype.subgroup and entity.prototype.subgroup.name or "nil"))
    end

    local prototype = entity.prototype
    local subgroup = prototype and prototype.subgroup and prototype.subgroup.name
    if not supported_subgroups[subgroup] then
        return nil, nil
    end

    if subgroup == "agriculture" and entity.name ~= "biochamber" then
        return nil, nil
    end

    -- Handle crafting machines (assemblers, furnaces, etc.)
    return extract_crafting_machine_data(entity), "machine"
end

-- Main Extraction Orchestrator
--- - Extract data from all selected entities, separating machines, drills, inserters, and belts
---@param entities LuaEntity[]
---@param force LuaForce? The player's force (for researched bonuses)
---@return ExtractionResult
function extraction.extract_all_entities(entities, force)
    local mining_productivity_level = 1
    if force and force.technologies['mining-productivity-3'] then
        mining_productivity_level = force.technologies['mining-productivity-3'].level - 1
    end

    local result = {
        machines = {},
        drills = {},
        inserters = {},
        belts = {},
        chests = {},
        unit_number_to_id = {},
        belt_unit_number_to_id = {},
        chest_unit_number_to_id = {},
        mining_productivity_level = mining_productivity_level
    }

    -- First pass: extract machines and build unit_number -> id mapping
    local machine_id = 0
    for _, entity in pairs(entities) do
        if entity.type ~= "mining-drill" and entity.type ~= "inserter" and entity.type ~= "transport-belt" then
            local data, entity_category = extract_machine_data(entity)
            if data and entity_category == "machine" then
                machine_id = machine_id + 1
                table.insert(result.machines, data)
                -- Map the entity's unit_number to its assigned ID
                if entity.unit_number then
                    result.unit_number_to_id[entity.unit_number] = machine_id
                end
            end
        end
    end

    -- Second pass: extract belts and build belt unit_number -> id mapping
    -- Consolidate belts by their ingredient set (belts with same ingredients are treated as one)
    local belt_id = 0
    local ingredient_signature_to_belt = {} -- Maps "ingredient1|ingredient2" to {belt_id, data}

    for _, entity in pairs(entities) do
        local belt_data = extract_belt_data(entity)
        if belt_data then
            -- Create a signature based on the unique set of ingredients (sorted for consistency)
            local ingredient_set = {}
            for _, lane in ipairs(belt_data.lanes) do
                if lane.ingredient and lane.ingredient ~= "" then
                    ingredient_set[lane.ingredient] = true
                end
            end
            -- Convert set to sorted array
            local ingredients = {}
            for ingredient, _ in pairs(ingredient_set) do
                table.insert(ingredients, ingredient)
            end
            table.sort(ingredients)
            local signature = table.concat(ingredients, "|")

            local existing = ingredient_signature_to_belt[signature]
            if existing then
                -- Map this belt to the existing belt with same ingredients
                if entity.unit_number then
                    result.belt_unit_number_to_id[entity.unit_number] = existing.belt_id
                end
            else
                -- New unique belt line
                belt_id = belt_id + 1
                ingredient_signature_to_belt[signature] = {
                    belt_id = belt_id,
                    data = belt_data
                }
                table.insert(result.belts, belt_data)
                if entity.unit_number then
                    result.belt_unit_number_to_id[entity.unit_number] = belt_id
                end
            end
        end
    end

    -- Third pass: extract drills (now we have the unit_number mapping)
    for _, entity in pairs(entities) do
        if entity.type == "mining-drill" then
            local data = extract_mining_drill_data(entity)
            if data then
                table.insert(result.drills, data)
            end
        end
    end

    -- Fourth pass: extract inserters
    for _, entity in pairs(entities) do
        if entity.type == "inserter" then
            local data = extract_inserter_data(entity)
            if data then
                table.insert(result.inserters, data)
            end
        end
    end

    -- Fifth pass: extract chests and build chest unit_number -> id mapping
    local chest_id = 0
    for _, entity in pairs(entities) do
        if is_chest_entity(entity) then
            local data = extract_chest_data(entity)
            if data then
                chest_id = chest_id + 1
                table.insert(result.chests, data)
                if entity.unit_number then
                    result.chest_unit_number_to_id[entity.unit_number] = chest_id
                end
            end
        end
    end

    return result
end

return extraction
