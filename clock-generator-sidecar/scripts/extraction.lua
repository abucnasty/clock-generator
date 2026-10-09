-- Entity Extraction for Clock Generator Sidecar
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
    local pickup_target = entity.pickup_target
    if pickup_target and pickup_target.valid then
        local target_type = helpers.get_target_type(pickup_target)
        if target_type then
            source = {
                type = target_type,
                unit_number = pickup_target.unit_number
            }

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
        inserter_type = entity.name,
        stack_size = stack_size,
        filters = filters,
        source = source,
        sink = sink
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
    elseif entity.name == "biochamber" then
        entity_type = "biochamber"
    end

    -- Biochambers burn nutrients; the energy consumption effect (modules/beacons) scales how fast.
    -- consumption_bonus is a fraction (0.5 = +50%), exported as a percentage like productivity.
    local energy_consumption_bonus = nil
    if entity_type == "biochamber" then
        energy_consumption_bonus = (entity.consumption_bonus or 0) * 100
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
        name = entity.name,
        recipe = recipe.name,
        crafting_speed = entity.crafting_speed,
        productivity = total_productivity * 100,
        type = entity_type,
        energy_consumption_bonus = energy_consumption_bonus
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

    -- Second pass: belts. Pieces joined to each other, through undergrounds and splitters as well, are one belt
    -- whatever lies on each piece at this instant: a lane that has run dry under one inserter still belongs to the
    -- belt it is part of, and a piece that is empty is still the belt its inserter drops on. Belts that carry the
    -- same items are then treated as one, as before.
    local belt_id = 0
    local ingredient_signature_to_belt = {} -- Maps "ingredient1|ingredient2" to {belt_id, data}

    local pieces = {} -- unit_number -> belt piece
    local parent = {} -- union-find over unit numbers
    for _, entity in pairs(entities) do
        if entity.valid and entity.unit_number and entity.prototype.subgroup and entity.prototype.subgroup.name == "belt" then
            pieces[entity.unit_number] = entity
            parent[entity.unit_number] = entity.unit_number
        end
    end
    local function find(unit_number)
        while parent[unit_number] ~= unit_number do
            parent[unit_number] = parent[parent[unit_number]]
            unit_number = parent[unit_number]
        end
        return unit_number
    end
    local function join(a, b)
        local root_a, root_b = find(a), find(b)
        if root_a ~= root_b then
            parent[root_a] = root_b
        end
    end
    local function join_with(unit_number, other)
        local ok, valid = pcall(function() return other.valid and other.unit_number end)
        if ok and valid and parent[valid] then
            join(unit_number, valid)
        end
    end
    -- the other end of an underground belt: the nearest one of its kind that faces the same way, within reach
    local direction_offsets = {
        [defines.direction.north] = { 0, -1 },
        [defines.direction.east] = { 1, 0 },
        [defines.direction.south] = { 0, 1 },
        [defines.direction.west] = { -1, 0 },
    }
    local function underground_partner(entity)
        if entity.belt_to_ground_type ~= "input" then
            return nil
        end
        local offset = direction_offsets[entity.direction]
        if not offset then
            return nil
        end
        local reach = entity.prototype.max_underground_distance or 0
        for distance = 1, reach + 1 do
            local x = entity.position.x + offset[1] * distance
            local y = entity.position.y + offset[2] * distance
            for _, other in pairs(pieces) do
                if other.type == "underground-belt" and other.name == entity.name and other.belt_to_ground_type == "output"
                    and other.direction == entity.direction
                    and math.abs(other.position.x - x) < 0.01 and math.abs(other.position.y - y) < 0.01 then
                    return other
                end
            end
        end
        return nil
    end
    for unit_number, entity in pairs(pieces) do
        local ok, neighbours = pcall(function() return entity.belt_neighbours end)
        if ok and type(neighbours) == "table" then
            for _, list in pairs(neighbours) do
                for _, other in pairs(list) do
                    join_with(unit_number, other)
                end
            end
        end
        if entity.type == "underground-belt" then
            join_with(unit_number, underground_partner(entity))
        elseif entity.type == "linked-belt" then
            local ok_other, other = pcall(function() return entity.linked_belt_neighbour end)
            if ok_other then
                join_with(unit_number, other)
            end
        end
    end

    -- the pieces of each belt, in a fixed order so the lanes read the same every time
    local unit_numbers = {}
    for unit_number in pairs(pieces) do
        table.insert(unit_numbers, unit_number)
    end
    table.sort(unit_numbers)
    local belts_pieces = {} -- root unit_number -> ordered list of pieces
    local roots = {}
    for _, unit_number in ipairs(unit_numbers) do
        local root = find(unit_number)
        if not belts_pieces[root] then
            belts_pieces[root] = {}
            table.insert(roots, root)
        end
        table.insert(belts_pieces[root], pieces[unit_number])
    end

    for _, root in ipairs(roots) do
        local belt_pieces = belts_pieces[root]
        local default_belt_stack_size = helpers.get_default_belt_stack_size(belt_pieces[1].force)
        -- lanes 1 and 2 as the first piece that carries something on them says; every line counts for the items
        local lane_ingredient = { nil, nil }
        local lane_stack_size = { default_belt_stack_size, default_belt_stack_size }
        local ingredient_set = {}
        for _, piece in ipairs(belt_pieces) do
            local max_lines = piece.get_max_transport_line_index()
            for line_index = 1, max_lines do
                local ingredient, stack_size = helpers.get_lane_info(piece.get_transport_line(line_index), default_belt_stack_size)
                if ingredient then
                    ingredient_set[ingredient] = true
                    local lane = (line_index % 2 == 1) and 1 or 2
                    if piece.type == "transport-belt" or piece.type == "underground-belt" then
                        if not lane_ingredient[lane] then
                            lane_ingredient[lane] = ingredient
                        end
                        lane_stack_size[lane] = math.max(lane_stack_size[lane], stack_size)
                    end
                end
            end
        end

        local ingredients = {}
        for ingredient, _ in pairs(ingredient_set) do
            table.insert(ingredients, ingredient)
        end
        table.sort(ingredients)
        -- a belt with nothing on it is not described, as before; its inserters are matched by their other end
        if #ingredients > 0 then
            local lanes = {}
            if not lane_ingredient[1] and not lane_ingredient[2] then
                -- items only on the lines of a splitter or loader: one lane per item
                for _, ingredient in ipairs(ingredients) do
                    table.insert(lanes, { ingredient = ingredient, stack_size = default_belt_stack_size })
                end
            elseif not lane_ingredient[1] then
                table.insert(lanes, { ingredient = lane_ingredient[2], stack_size = lane_stack_size[2] })
            else
                table.insert(lanes, { ingredient = lane_ingredient[1], stack_size = lane_stack_size[1] })
                table.insert(lanes, { ingredient = lane_ingredient[2], stack_size = lane_stack_size[2] })
            end
            local signature = table.concat(ingredients, "|")
            local existing = ingredient_signature_to_belt[signature]
            local id
            if existing then
                id = existing.belt_id
            else
                belt_id = belt_id + 1
                id = belt_id
                ---@type BeltData
                local data = {
                    belt_type = helpers.normalize_belt_type(belt_pieces[1].name),
                    unit_number = belt_pieces[1].unit_number,
                    lanes = lanes
                }
                ingredient_signature_to_belt[signature] = { belt_id = id, data = data }
                table.insert(result.belts, data)
            end
            for _, piece in ipairs(belt_pieces) do
                result.belt_unit_number_to_id[piece.unit_number] = id
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
