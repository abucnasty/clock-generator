-- Entity Extraction for Clock Generator Sidecar
-- Functions for extracting data from Factorio entities (machines, drills,
-- inserters, belts).
-- The recorder mod loads this module too, so the sidecar requires its modules by their full path: a path without the
-- mod name may be looked up in the mod that is running, and a module required under two names is loaded twice.

require("__clock-generator-sidecar__.scripts.types")
local helpers = require("__clock-generator-sidecar__.scripts.helpers")
local pickup_supply = require("__clock-generator-sidecar__.scripts.pickup-supply")
local drop_merge = require("__clock-generator-sidecar__.scripts.drop-merge")

local debug = false

local extraction = {}

-- Individual Entity Extractors

---The entity types a drill's drop can go into that the export has a type for: crafting machines and chests
local DRILL_SINK_TYPES = {
    "assembling-machine", "furnace", "rocket-silo",
    "container", "logistic-container", "linked-container", "infinity-container", "car", "cargo-wagon",
}

---The one resource a drill can mine in its area, when the game has not told which it mines (`mining_target` is nil
---until the drill first mines, and a drill built or fast-replaced next to a full container may not mine for a long
---time); nil when its area holds none it can mine, or more than one kind
---@param entity LuaEntity
---@return string|nil
local function resource_under(entity)
    local prototype = entity.prototype
    local radius = prototype.get_mining_drill_radius(entity.quality)
    local categories = prototype.resource_categories or {}
    local at = entity.position
    local found = nil
    for _, resource in pairs(entity.surface.find_entities_filtered({
        area = { { at.x - radius, at.y - radius }, { at.x + radius, at.y + radius } },
        type = "resource",
    })) do
        if categories[resource.prototype.resource_category] then
            if found and found ~= resource.name then
                return nil
            end
            found = resource.name
        end
    end
    return found
end

---How far into the tile under a drill's drop position an entity's collision box has to reach for the drill to drop into
---it: 12/256 of a tile, on every side of the tile (11/256 gets nothing), for a car and a tank, the drill facing each way
---(Factorio 2.1.21)
local DROP_TILE_REACH = 12 / 256

---The machines and chests a drill drops into by the game's rule, when the game has not told (`drop_target` is nil until
---the drill first drops): the entities whose collision box reaches DROP_TILE_REACH into the tile under its drop position.
---Measured for a chest, a car and a tank at three orientations, a cargo wagon, a rocket silo and a furnace
---@param entity LuaEntity
---@return LuaEntity[]
local function drop_candidates(entity)
    local drop = entity.drop_position
    local x, y = math.floor(drop.x), math.floor(drop.y)
    local reach = DROP_TILE_REACH
    -- the search takes a box that touches the area's edge too: one that reaches exactly as far is found
    return entity.surface.find_entities_filtered({
        area = { { x + reach, y + reach }, { x + 1 - reach, y + 1 - reach } },
        type = DRILL_SINK_TYPES,
    })
end

---Extract data from a mining drill
---@param entity LuaEntity
---@return DrillData|nil
local function extract_mining_drill_data(entity)
    if not entity or not entity.valid then
        return nil
    end

    -- What the drill is mining; nil when the game has not told and its area does not (the export leaves it out)
    local mining_target = entity.mining_target
    local mined_item_name = mining_target and mining_target.name or resource_under(entity)

    -- the force's mining productivity research and the drill's productivity modules together: what its bonus bar uses
    local total_productivity = entity.productivity_bonus or 0

    -- Speed bonus from modules/beacons (this is what clock-generator expects)
    local speed_bonus = entity.speed_bonus or 0

    -- What the drill drops into: the game's drop_target once it has dropped, else the one machine or chest under its
    -- drop position (none, or more than one, leaves it unknown)
    local drop_target = entity.drop_target
    if not (drop_target and drop_target.valid) then
        local candidates = drop_candidates(entity)
        drop_target = #candidates == 1 and candidates[1] or nil
    end
    local drop_target_unit_number = nil
    local drop_target_name = nil
    if drop_target and drop_target.valid then
        drop_target_unit_number = drop_target.unit_number
        drop_target_name = drop_target.name
    end

    ---@type DrillData
    local data = {
        entity = entity,
        drill_type = entity.name,
        mined_item_name = mined_item_name,
        speed_bonus = speed_bonus,
        productivity = total_productivity * 100,
        drop_target_unit_number = drop_target_unit_number,
        drop_target_name = drop_target_name,
        position = entity.position,
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
        t == "linked-container" or t == "infinity-container" or
        t == "car" or t == "cargo-wagon" or t == "rocket-silo"
end

---The game's filters that block a slot: no item may go into it
local BLOCKING_FILTERS = { ["no-item"] = true, ["deconstruction-planner"] = true }

---The slots of an inventory: the filter of each filtered slot (blocked for the game's blocking filters) and the
---contents of each slot that holds something
---@param inventory LuaInventory
---@return ({slot: number, item: string}|{slot: number, blocked: true})[] filters, {slot: number, item: string, count: number}[] contents
local function slots_of(inventory)
    local filters, contents = {}, {}
    for slot = 1, #inventory do
        local filter = inventory.supports_filters() and inventory.get_filter(slot) or nil
        if filter then
            local name = type(filter) == "table" and filter.name or filter
            if BLOCKING_FILTERS[name] then
                table.insert(filters, { slot = slot, blocked = true })
            else
                table.insert(filters, { slot = slot, item = name })
            end
        end
        local stack = inventory[slot]
        if stack.valid_for_read then
            table.insert(contents, { slot = slot, item = stack.name, count = stack.count })
        end
    end
    return filters, contents
end

---A car, a tank, a cargo wagon or a rocket silo, taken as a chest
---@param entity LuaEntity
---@return table
local function extract_vehicle_or_silo_data(entity)
    if entity.type == "rocket-silo" then
        -- The silo's contents are not exported (owner, 2026-10-21): they are a snapshot of a running build, and a silo that
        -- starts full makes the inserters filling it take turns instead of inserting together; the build starts empty
        local contents = {}
        local recipe, recipe_quality = entity.get_recipe()
        -- As for machines: modules and beacons, plus the force's research productivity for the recipe, capped at 300%
        local productivity = entity.productivity_bonus or 0
        local force_recipe = recipe and entity.force and entity.force.recipes[recipe.name]
        if force_recipe then
            productivity = productivity + (force_recipe.productivity_bonus or 0)
        end
        return {
            chest_type = "rocket-silo",
            unit_number = entity.unit_number,
            position = { x = entity.position.x, y = entity.position.y },
            recipe_quality = recipe_quality and recipe_quality.name or "normal",
            crafting_speed = entity.crafting_speed,
            productivity = math.min(productivity, 3.0) * 100,
            contents = contents,
        }
    end
    local index = entity.type == "car" and defines.inventory.car_trunk or defines.inventory.cargo_wagon
    -- Its slot filters are part of the build; its contents are not exported (owner, 2026-10-21), as a silo's: they are a
    -- snapshot of a running build, so the build starts empty
    local filters = slots_of(entity.get_inventory(index))
    local contents = {}
    return {
        -- the car's and the tank's prototype names are their chest types
        chest_type = entity.type == "car" and entity.name or "cargo-wagon",
        unit_number = entity.unit_number,
        position = { x = entity.position.x, y = entity.position.y },
        quality = entity.quality and entity.quality.name or "normal",
        slot_filters = filters,
        contents = contents,
    }
end

---Extract data from a chest (buffer chest or infinity chest)
---@param entity LuaEntity
---@param inferred_item string|nil The item of an empty buffer chest, worked out from the inserters around it (infer_empty_chest_items)
---@return ChestData|nil
local function extract_chest_data(entity, inferred_item)
    if not entity or not entity.valid then
        return nil
    end

    if not is_chest_entity(entity) then
        return nil
    end

    if entity.type == "car" or entity.type == "cargo-wagon" or entity.type == "rocket-silo" then
        return extract_vehicle_or_silo_data(entity)
    end

    -- Infinity settings exist even when the inventory is empty (a disposal chest usually is).
    if entity.type == "infinity-container" then
        local filters = {}
        for _, filter in pairs(entity.infinity_container_filters or {}) do
            table.insert(filters, {
                item_name = filter.name,
                request_count = filter.count or 0
            })
        end
        table.sort(filters, function(a, b) return a.item_name < b.item_name end)
        return {
            chest_type = "infinity-chest",
            unit_number = entity.unit_number,
            position = { x = entity.position.x, y = entity.position.y },
            item_filters = filters,
            remove_unfiltered_items = entity.remove_unfiltered_items
        }
    else
        local inventory = entity.get_inventory(defines.inventory.chest)
        if not inventory then return nil end
        local contents = inventory.get_contents()
        local storage_size = inventory.supports_bar() and (inventory.get_bar() - 1) or #inventory
        -- A buffer chest has no filter in the game: its item is the first one it holds, else the one the inserters around
        -- it say (inferred_item); a chest that has neither is left out.
        local first_item = contents and contents[1]
        if not first_item and inferred_item then
            first_item = { name = inferred_item }
        end
        if not first_item then
            return nil
        end

        ---@type BufferChestData
        return {
            chest_type = "buffer-chest",
            unit_number = entity.unit_number,
            position = { x = entity.position.x, y = entity.position.y },
            name = entity.name,
            storage_size = storage_size,
            item_filter = first_item.name
        }
    end
end

---The items a recipe's products or ingredients name, fluids left out, as a set
---@param recipe_name string|nil
---@param field "products"|"ingredients"
---@return table<string, true>|nil nil when the recipe is unknown or names no item
local function recipe_items(recipe_name, field)
    local recipe = recipe_name and prototypes.recipe[recipe_name]
    if not recipe then
        return nil
    end
    local items = {}
    local any = false
    for _, entry in pairs(recipe[field]) do
        if entry.type == "item" then
            items[entry.name] = true
            any = true
        end
    end
    return any and items or nil
end

---The items a chest empty at export time can hold, from the inserters and drills around it. Each one that touches the
---chest must move the chest's item, so each gives a set of items the chest's item is in, and the chest's item is in all
---of them. An inserter's whitelist gives its set; without one, the items of what it takes from (into the chest) or puts
---into (out of it): a machine's recipe products or ingredients, the lanes of a belt, the item of another chest, once
---known. A drill that drops into the chest gives the item it mines. A blacklist, a machine without a recipe and a chest
---of no known item give no set. A chest with exactly one item left is resolved; the others are repeated over until none
---changes, so a chain of empty chests resolves from either end.
---@param result ExtractionResult The machines, drills, belts, inserters and the chests that hold something
---@param empty_chests LuaEntity[] The buffer chests that hold nothing
---@param known table<number, table<string, true>> A chest's unit number -> the items it holds or has filters for
---@return table<number, string> The chest's unit number -> its item, for each chest resolved
local function infer_empty_chest_items(result, empty_chests, known)
    local inferred = {}

    -- the items of the end of an inserter that is not the chest: nil when they are not known
    local function items_of_end(target, as_source)
        if not target or not target.unit_number then
            return nil
        end
        if target.type == "machine" then
            local machine = result.machines[result.unit_number_to_id[target.unit_number] or 0]
            return machine and recipe_items(machine.recipe, as_source and "products" or "ingredients") or nil
        elseif target.type == "belt" then
            local belt = result.belts[result.belt_unit_number_to_id[target.unit_number] or 0]
            if not belt then
                return nil
            end
            local items, any = {}, false
            for _, lane in ipairs(belt.lanes) do
                if lane.ingredient then
                    items[lane.ingredient] = true
                    any = true
                end
            end
            return any and items or nil
        elseif target.type == "chest" then
            return known[target.unit_number]
        end
        return nil
    end

    -- the set an inserter that touches the chest gives, nil when it gives none
    local function items_of_inserter(inserter, other_end, other_is_source)
        if inserter.filter_mode == "whitelist" and #inserter.filters > 0 then
            local items = {}
            for _, name in ipairs(inserter.filters) do
                items[name] = true
            end
            return items
        end
        return items_of_end(other_end, other_is_source)
    end

    local changed = true
    while changed do
        changed = false
        for _, chest in ipairs(empty_chests) do
            local unit_number = chest.unit_number
            if unit_number and not inferred[unit_number] then
                local candidates = nil -- nil: no set yet
                local function narrow(items)
                    if not items then
                        return
                    end
                    if not candidates then
                        candidates = {}
                        for name in pairs(items) do
                            candidates[name] = true
                        end
                    else
                        for name in pairs(candidates) do
                            if not items[name] then
                                candidates[name] = nil
                            end
                        end
                    end
                end
                for _, inserter in ipairs(result.inserters) do
                    if inserter.sink and inserter.sink.type == "chest" and inserter.sink.unit_number == unit_number then
                        narrow(items_of_inserter(inserter, inserter.source, true))
                    end
                    if inserter.source and inserter.source.type == "chest" and inserter.source.unit_number == unit_number then
                        narrow(items_of_inserter(inserter, inserter.sink, false))
                    end
                end
                for _, drill in ipairs(result.drills) do
                    if drill.drop_target_unit_number == unit_number and drill.mined_item_name then
                        narrow({ [drill.mined_item_name] = true })
                    end
                end
                if candidates then
                    local only, count = nil, 0
                    for name in pairs(candidates) do
                        only, count = name, count + 1
                    end
                    if count == 1 then
                        inferred[unit_number] = only
                        known[unit_number] = { [only] = true }
                        changed = true
                    end
                end
            end
        end
    end
    return inferred
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

    -- Get filters, only while they are switched on: an inserter whose filters are set but switched off moves whatever
    -- it is given, as one without filters does. Its mode says whether they name the items to move (a whitelist) or the
    -- items to leave (a blacklist).
    local filters = {}
    local filter_mode = nil
    local filter_slot_count = entity.filter_slot_count or 0
    if filter_slot_count > 0 and entity.use_filters then
        for i = 1, filter_slot_count do
            local filter = entity.get_filter(i)
            if filter and filter.name then
                table.insert(filters, filter.name)
            end
        end
        filter_mode = entity.inserter_filter_mode
    end

    -- Get source (pickup target)
    local source = nil
    local pickup_target = entity.pickup_target
    if pickup_target and pickup_target.valid then
        local target_type = helpers.get_target_type(pickup_target)
        if target_type then
            source = {
                type = target_type,
                unit_number = pickup_target.unit_number,
                name = pickup_target.name
            }
            if target_type == "belt" then
                source.entity_type = pickup_target.type
                source.near_lane = helpers.get_near_lane(entity, pickup_target)
                source.pickup_length = helpers.get_pickup_length(entity, pickup_target)
                source.pickup_layout = helpers.get_pickup_layout(entity, pickup_target)
                source.pickup_problem = helpers.get_pickup_problem(entity, pickup_target)
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
                unit_number = drop_target.unit_number,
                name = drop_target.name
            }
        end
    end

    ---@type InserterData
    local data = {
        entity = entity,
        inserter_type = entity.name,
        quality = entity.quality.name,
        position = entity.position,
        stack_size = stack_size,
        filters = filters,
        filter_mode = filter_mode,
        source = source,
        sink = sink
    }

    return data
end

---Whether a crafting machine's burner burns nutrients, as a biochamber does: read from its prototype, never its name
---@param entity LuaEntity
---@return boolean
local function burns_nutrients(entity)
    local burner = entity.prototype.burner_prototype
    return burner ~= nil and burner.fuel_categories["nutrients"] == true
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

    -- A machine burning nutrients (a biochamber): the energy consumption effect (modules/beacons) scales how fast.
    -- consumption_bonus is a fraction (0.5 = +50%), exported as a percentage like productivity. How the machine is
    -- simulated the Clock Generator works out from its prototype, which is exported.
    local energy_consumption_bonus = nil
    if burns_nutrients(entity) then
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
        entity = entity,
        name = entity.name,
        quality = entity.quality and entity.quality.name or "normal",
        recipe = recipe.name,
        recipe_quality = helpers.get_recipe_quality(entity),
        crafting_speed = entity.crafting_speed,
        productivity = total_productivity * 100,
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

    -- of the agriculture machines only those burning nutrients craft as the Clock Generator models; a captive biter
    -- spawner burns food
    if subgroup == "agriculture" and not burns_nutrients(entity) then
        return nil, nil
    end

    -- Labs share the production-machine subgroup but have no recipe: get_recipe raises an error on them
    if entity.type ~= "assembling-machine" and entity.type ~= "furnace" then
        return nil, nil
    end

    -- Handle crafting machines (assemblers, furnaces, etc.)
    return extract_crafting_machine_data(entity), "machine"
end

-- Main Extraction Orchestrator
--- - Extract data from all selected entities, separating machines, drills, inserters, and belts
---@param entities LuaEntity[]
---@param force LuaForce? The player's force; not read: each entity's bonuses, research included, are read from the entity
---@return ExtractionResult
function extraction.extract_all_entities(entities, force)
    local result = {
        machines = {},
        drills = {},
        inserters = {},
        belts = {},
        chests = {},
        unit_number_to_id = {},
        belt_unit_number_to_id = {},
        chest_unit_number_to_id = {}
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
    -- same items on the same lanes are then treated as one, as before. Two that carry them on opposite lanes are two
    -- belts: near_lane (1 left, 2 right) is read off the lanes of the belt an inserter stands by.
    local belt_id = 0
    local ingredient_signature_to_belt = {} -- Maps "ingredient1|ingredient2#lane 1 item|lane 2 item" to {belt_id, data}

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
        -- a belt with nothing on it is not described, as before: an inserter that takes from it or drops onto it is left
        -- out of the export (see resolve_target_id in export.lua)
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
            local signature = table.concat(ingredients, "|") .. "#" .. (lane_ingredient[1] or "") .. "|" .. (lane_ingredient[2] or "")
            local existing = ingredient_signature_to_belt[signature]
            local id
            if existing then
                id = existing.belt_id
            else
                belt_id = belt_id + 1
                id = belt_id
                ---@type BeltData
                local data = {
                    belt_type = helpers.belt_type_of_pieces(belt_pieces),
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
                -- A pickup tile that another belt side-loads onto is out of scope: the export marks it unsupported.
                -- Only a pickup without a pickup_problem (a bend, a splitter, an inline pickup) is checked, so those keep
                -- their reason.
                if data.source and data.source.type == "belt" and not data.source.pickup_problem then
                    data.source.supply_problem = pickup_supply.problem(entity.pickup_target)
                end
                -- A drop whose stream side-loads onto a belt that is fed from behind, within the selected belt pieces, is
                -- marked with the tiles to the merge.
                if data.sink and data.sink.type == "belt" and entity.drop_target then
                    data.sink.side_load_tiles = drop_merge.tiles(entity.drop_target, pieces)
                end
                table.insert(result.inserters, data)
            end
        end
    end

    -- Fifth pass: extract chests and build chest unit_number -> id mapping. A buffer chest that holds nothing at this
    -- instant has the item the inserters and drills around it say, if they say one.
    local known = {} -- chest unit_number -> set of the items it holds or filters for
    local empty_chests = {}
    for _, entity in pairs(entities) do
        if is_chest_entity(entity) and entity.unit_number then
            local data = extract_chest_data(entity)
            if data and data.chest_type == "buffer-chest" then
                known[entity.unit_number] = { [data.item_filter] = true }
            elseif data and data.chest_type == "infinity-chest" and #data.item_filters > 0 then
                known[entity.unit_number] = {}
                for _, filter in ipairs(data.item_filters) do
                    known[entity.unit_number][filter.item_name] = true
                end
            elseif not data and (entity.type == "container" or entity.type == "logistic-container") then
                table.insert(empty_chests, entity)
            end
        end
    end
    local inferred = infer_empty_chest_items(result, empty_chests, known)
    local chest_id = 0
    for _, entity in pairs(entities) do
        if is_chest_entity(entity) then
            local data = extract_chest_data(entity, entity.unit_number and inferred[entity.unit_number])
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
