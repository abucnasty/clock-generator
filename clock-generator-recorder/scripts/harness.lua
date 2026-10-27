-- Recording harness
-- Builds a blueprint, seeds it and records it from script, for a headless game driven over RCON with no player.
-- The game is paused between the steps, so nothing moves while the caller decides how to wire a clock.

local recorder = require("scripts.recorder")

local harness = {}

local CLOCK_DESCRIPTION_PREFIX = "Clock for"
-- the tag the caller gives each schedule combinator of a generated clock: the config ids of the inserters it enables
local INSERTERS_TAG = "clock_generator_inserters"
local DRILLS_TAG = "clock_generator_drills"
local COMBINATOR_TYPES = {
    ["decider-combinator"] = true,
    ["arithmetic-combinator"] = true,
    ["selector-combinator"] = true,
    -- the lock switch of a generated clock, which is wired to it
    ["constant-combinator"] = true,
}
local BELT_TYPES = {
    ["transport-belt"] = true,
    ["underground-belt"] = true,
    ["splitter"] = true,
    ["loader"] = true,
    ["loader-1x1"] = true,
}
local ANYTHING_POSITIVE = {
    first_signal = { type = "virtual", name = "signal-anything" },
    comparator = ">",
    constant = 0,
}

---@param entity LuaEntity
---@return string
local function description_of(entity)
    local ok, description = pcall(function() return entity.combinator_description end)
    return ok and description or ""
end

---Entities connected to an entity by a red or green wire
---@param entity LuaEntity
---@return LuaEntity[]
local function wired_neighbours(entity)
    local neighbours = {}
    for _, connector in pairs(entity.get_wire_connectors(false)) do
        if connector.wire_type ~= defines.wire_type.copper then
            for _, connection in pairs(connector.connections) do
                table.insert(neighbours, connection.target.owner)
            end
        end
    end
    return neighbours
end

---Everything reachable over circuit wires from the starting entities, walking on only through entities that pass
---@param start LuaEntity[]
---@param passes fun(entity: LuaEntity): boolean
---@return table<uint, LuaEntity> by unit number, without the starting entities
local function reachable(start, passes)
    local seen, found, queue = {}, {}, {}
    for _, entity in pairs(start) do
        seen[entity.unit_number] = true
        table.insert(queue, entity)
    end
    while #queue > 0 do
        local entity = table.remove(queue)
        for _, neighbour in pairs(wired_neighbours(entity)) do
            if neighbour.valid and neighbour.unit_number and not seen[neighbour.unit_number] and passes(neighbour) then
                seen[neighbour.unit_number] = true
                found[neighbour.unit_number] = neighbour
                table.insert(queue, neighbour)
            end
        end
    end
    return found
end

---Put the modules and other items a blueprint asks for straight into the entity
---@param entity LuaEntity
---@param proxy LuaEntity item-request-proxy
local function fulfil_item_requests(entity, proxy)
    for _, plan in pairs(proxy.insert_plan) do
        local id = type(plan.id) == "table" and plan.id or { name = plan.id }
        for _, slot in pairs(plan.items.in_inventory or {}) do
            local inventory = entity.get_inventory(slot.inventory)
            if inventory then
                inventory[slot.stack + 1].set_stack({ name = id.name, quality = id.quality, count = slot.count or 1 })
            end
        end
    end
    proxy.destroy()
end

local CRAFTING_MACHINE_TYPES = { ["assembling-machine"] = true, ["furnace"] = true }
local DIRECTION_VECTORS = {
    [defines.direction.north] = { x = 0, y = -1 },
    [defines.direction.east] = { x = 1, y = 0 },
    [defines.direction.south] = { x = 0, y = 1 },
    [defines.direction.west] = { x = -1, y = 0 },
}

---The ends of an inserter ghost: where it picks up from and drops at (a long-handed inserter reaches two tiles)
---@param ghost LuaEntity
---@return MapPosition pickup, MapPosition drop
local function inserter_ends(ghost)
    local vector = DIRECTION_VECTORS[ghost.direction] or { x = 0, y = -1 }
    local reach = ghost.ghost_name == "long-handed-inserter" and 2 or 1
    local x, y = ghost.position.x, ghost.position.y
    return { x = x + vector.x * reach, y = y + vector.y * reach }, { x = x - vector.x * reach, y = y - vector.y * reach }
end

---@param box BoundingBox
---@param position MapPosition
---@return boolean
local function box_holds(box, position)
    return position.x > box.left_top.x and position.x < box.right_bottom.x and position.y > box.left_top.y and position.y < box.right_bottom.y
end

---The inserters of the cell among the ghosts of a blueprint: those with an end on a crafting machine of the blueprint. An inserter
---that only moves items between belts and chests (a scaffold's feeder) is the supply's, not the cell's.
---@param ghosts LuaEntity[]
---@return table<integer, boolean> by index in ghosts
local function cell_inserter_flags(ghosts)
    local boxes = {}
    for _, ghost in pairs(ghosts) do
        if ghost.valid and ghost.type == "entity-ghost" and CRAFTING_MACHINE_TYPES[ghost.ghost_type] then
            table.insert(boxes, ghost.bounding_box)
        end
    end
    local flags = {}
    for index, ghost in ipairs(ghosts) do
        if ghost.valid and ghost.type == "entity-ghost" and ghost.ghost_type == "inserter" then
            local pickup, drop = inserter_ends(ghost)
            for _, box in ipairs(boxes) do
                if box_holds(box, pickup) or box_holds(box, drop) then
                    flags[index] = true
                    break
                end
            end
        end
    end
    return flags
end

---The types of rolling stock, which the game builds only on rails
local ROLLING_STOCK_TYPES = { ["cargo-wagon"] = true, ["fluid-wagon"] = true, ["artillery-wagon"] = true, ["locomotive"] = true }

---Ore a tile is given under a drill: enough that no recording runs it out (a big drill at 50% drain takes 0.39 a tick)
local DRILL_ORE_PER_TILE = 1000000000

---The offset from the blueprint's positions to the world's, from the ghosts that a build of it made: the one that puts
---every ghost on an entity of the blueprint of the same name
---@param blueprint_entities BlueprintEntity[]
---@param ghosts LuaEntity[]
---@return MapPosition|nil
local function blueprint_offset(blueprint_entities, ghosts)
    local by_name = {}
    for _, entity in pairs(blueprint_entities) do
        by_name[entity.name] = by_name[entity.name] or {}
        table.insert(by_name[entity.name], entity.position)
    end
    local built = {}
    for _, ghost in pairs(ghosts) do
        if ghost.valid and ghost.type == "entity-ghost" then
            table.insert(built, ghost)
        end
    end
    if #built == 0 then
        return nil
    end
    local function on_blueprint(ghost, dx, dy)
        for _, at in pairs(by_name[ghost.ghost_name] or {}) do
            if math.abs(at.x + dx - ghost.position.x) < 0.01 and math.abs(at.y + dy - ghost.position.y) < 0.01 then
                return true
            end
        end
        return false
    end
    for _, at in pairs(by_name[built[1].ghost_name] or {}) do
        local dx, dy = built[1].position.x - at.x, built[1].position.y - at.y
        local all = true
        for _, ghost in ipairs(built) do
            if not on_blueprint(ghost, dx, dy) then
                all = false
                break
            end
        end
        if all then
            return { x = dx, y = dy }
        end
    end
    return nil
end

---Create the resource on every tile under each mining drill of the blueprint, which has to be on its ore to be built: a
---scaffold with a drill is built where the save may have none
---@param surface LuaSurface
---@param blueprint_entities BlueprintEntity[]
---@param offset MapPosition
---@param resource string
---@return LuaEntity[] ores
local function place_drill_ore(surface, blueprint_entities, offset, resource)
    local ores = {}
    for _, entity in pairs(blueprint_entities) do
        local prototype = prototypes.entity[entity.name]
        if prototype and prototype.type == "mining-drill" then
            local width, height = prototype.tile_width, prototype.tile_height
            local direction = entity.direction or 0
            if direction == defines.direction.east or direction == defines.direction.west then
                width, height = height, width
            end
            local left = math.floor(entity.position.x + offset.x - width / 2 + 0.5)
            local top = math.floor(entity.position.y + offset.y - height / 2 + 0.5)
            for x = left, left + width - 1 do
                for y = top, top + height - 1 do
                    local ore = surface.create_entity({ name = resource, position = { x + 0.5, y + 0.5 }, amount = DRILL_ORE_PER_TILE })
                    if not ore then
                        error("could not create " .. resource .. " under the " .. entity.name .. " at " .. x .. ", " .. y)
                    end
                    table.insert(ores, ore)
                end
            end
        end
    end
    return ores
end

---Build a blueprint string as real entities
---@param surface LuaSurface
---@param force LuaForce
---@param blueprint string
---@param position_for fun(half_width: number, half_height: number): MapPosition where the middle of the blueprint goes
---@param stage_cell_inserters boolean|nil leave the inserters of the cell (those with an end on a crafting machine) as ghosts, to be built later
---@param drill_resource string|nil the resource to create under every mining drill of the blueprint before it is built
---@return LuaEntity[] entities, string[] failed names of the entities that could not be built, table<uint, Tags> tags of the blueprint's entities by unit number, LuaEntity[] staged the ghosts left unbuilt, MapPosition position where the middle of the blueprint went, LuaEntity[] ores the ore put under the drills
local function build_blueprint(surface, force, blueprint, position_for, stage_cell_inserters, drill_resource)
    local inventory = game.create_inventory(1)
    local stack = inventory[1]
    if stack.import_stack(blueprint) < 0 or not stack.is_blueprint or not stack.is_blueprint_setup() then
        inventory.destroy()
        error("not a blueprint string with entities (a blueprint book is not supported)")
    end

    local left, top, right, bottom = math.huge, math.huge, -math.huge, -math.huge
    for _, entity in pairs(stack.get_blueprint_entities() or {}) do
        left, right = math.min(left, entity.position.x), math.max(right, entity.position.x)
        top, bottom = math.min(top, entity.position.y), math.max(bottom, entity.position.y)
    end
    local half_width, half_height = math.ceil((right - left) / 2) + 2, math.ceil((bottom - top) / 2) + 2
    local position = position_for(half_width, half_height)
    surface.request_to_generate_chunks(position, math.ceil(math.max(half_width, half_height) / 32) + 1)
    surface.force_generate_chunk_requests()

    local function build_ghosts()
        return stack.build_blueprint({
            surface = surface,
            force = force,
            position = position,
            build_mode = defines.build_mode.forced,
            skip_fog_of_war = false,
        })
    end
    local ghosts = build_ghosts()
    local ores = {}
    local blueprint_entities = stack.get_blueprint_entities() or {}
    local has_drill = false
    for _, entity in pairs(blueprint_entities) do
        local prototype = prototypes.entity[entity.name]
        has_drill = has_drill or (prototype ~= nil and prototype.type == "mining-drill")
    end
    if has_drill and drill_resource then
        -- a drill's ghost is not made without its ore: the ghosts of the rest tell where the blueprint went, the ore is
        -- put under each drill, and the blueprint is built again
        local resource = prototypes.entity[drill_resource]
        if not resource or resource.type ~= "resource" then
            inventory.destroy()
            error("drill_resource \"" .. tostring(drill_resource) .. "\" is not a resource")
        end
        local offset = blueprint_offset(blueprint_entities, ghosts)
        if not offset then
            inventory.destroy()
            error("could not tell where the blueprint was built, to put ore under its drills")
        end
        for _, ghost in pairs(ghosts) do
            if ghost.valid then
                ghost.destroy()
            end
        end
        ores = place_drill_ore(surface, blueprint_entities, offset, drill_resource)
        ghosts = build_ghosts()
    end
    inventory.destroy()

    local staged_flags = stage_cell_inserters and cell_inserter_flags(ghosts) or {}
    local entities, failed, tags, staged = {}, {}, {}, {}
    -- a wagon is only built on rails, which a blueprint may list after it: rolling stock is revived after everything else
    local order = {}
    for index, ghost in ipairs(ghosts) do
        if not (ghost.valid and ghost.type == "entity-ghost" and ROLLING_STOCK_TYPES[ghost.ghost_type]) then
            table.insert(order, index)
        end
    end
    for index, ghost in ipairs(ghosts) do
        if ghost.valid and ghost.type == "entity-ghost" and ROLLING_STOCK_TYPES[ghost.ghost_type] then
            table.insert(order, index)
        end
    end
    for _, index in ipairs(order) do
        local ghost = ghosts[index]
        if staged_flags[index] then
            table.insert(staged, ghost)
        elseif ghost.valid and ghost.type == "entity-ghost" then
            local name = ghost.ghost_name
            -- a ghost has the tags of its blueprint entity, which the entity it is revived as does not keep
            local ghost_tags = ghost.tags
            local _, entity, proxy = ghost.revive({ raise_revive = true })
            if entity then
                if proxy and proxy.valid then
                    fulfil_item_requests(entity, proxy)
                end
                table.insert(entities, entity)
                if ghost_tags and entity.unit_number then
                    tags[entity.unit_number] = ghost_tags
                end
            else
                table.insert(failed, name)
            end
        elseif ghost.valid and ghost.type == "tile-ghost" then
            ghost.revive()
        end
    end
    -- a drill with no ore under it gets no ghost, so it is in no list of what failed: name it
    local drills_built = 0
    for _, entity in pairs(entities) do
        if entity.type == "mining-drill" then
            drills_built = drills_built + 1
        end
    end
    for _, entity in pairs(blueprint_entities) do
        local prototype = prototypes.entity[entity.name]
        if prototype and prototype.type == "mining-drill" then
            if drills_built > 0 then
                drills_built = drills_built - 1
            else
                table.insert(failed, entity.name .. (drill_resource and "" or " (no ore under it: the build needs drill_resource)"))
            end
        end
    end
    return entities, failed, tags, staged, position, ores
end

---@param entities LuaEntity[]
---@return BoundingBox
local function bounding_box(entities)
    local left, top, right, bottom = math.huge, math.huge, -math.huge, -math.huge
    for _, entity in pairs(entities) do
        local box = entity.bounding_box
        left, top = math.min(left, box.left_top.x), math.min(top, box.left_top.y)
        right, bottom = math.max(right, box.right_bottom.x), math.max(bottom, box.right_bottom.y)
    end
    return { left_top = { x = left, y = top }, right_bottom = { x = right, y = bottom } }
end

---The clock a build came with: the combinator labelled by the blueprint generator and the combinators chained to it,
---and the inserters that read them
---@param entities LuaEntity[]
---@return LuaEntity[] combinators, table<uint, LuaEntity> inserters by unit number
local function find_clock_network(entities)
    local clocks = {}
    for _, entity in pairs(entities) do
        if entity.type == "decider-combinator"
            and string.sub(description_of(entity), 1, #CLOCK_DESCRIPTION_PREFIX) == CLOCK_DESCRIPTION_PREFIX then
            table.insert(clocks, entity)
        end
    end
    local combinators = {}
    for _, entity in pairs(clocks) do
        table.insert(combinators, entity)
    end
    for _, entity in pairs(reachable(clocks, function(it) return COMBINATOR_TYPES[it.type] == true end)) do
        table.insert(combinators, entity)
    end
    local inserters = {}
    for unit_number, entity in pairs(reachable(combinators, function(it) return not COMBINATOR_TYPES[it.type] end)) do
        if entity.type == "inserter" then
            inserters[unit_number] = entity
        end
    end
    return combinators, inserters
end

---@param inserter LuaEntity
local function run_without_circuit(inserter)
    local behavior = inserter.get_control_behavior()
    if behavior then
        behavior.circuit_enable_disable = false
    end
end

---Build the combinators of a generated clock below the build; they join the build's entities, so they are removed with it
---@param state table storage.harness
---@param blueprint string each schedule combinator tagged with the config ids of its inserters
---@return LuaEntity[] combinators, table<uint, Tags> tags of the combinators by unit number
local function build_clock(state, blueprint)
    local surface = game.surfaces[state.surface_index]
    local area = state.area
    local combinators, failed, tags = build_blueprint(surface, game.forces[state.force_name], blueprint, function(_, half_height)
        return {
            x = math.floor((area.left_top.x + area.right_bottom.x) / 2),
            y = math.ceil(area.right_bottom.y) + 2 + half_height,
        }
    end)
    if #failed > 0 then
        error("could not build the clock: " .. table.concat(failed, ", "))
    end
    for _, combinator in pairs(combinators) do
        table.insert(state.entities, combinator)
    end
    return combinators, tags
end

---The main counter of a generated clock (the decider described as "Clock for ...") and the value of the signal it counts on its own
---network now, as a probe reads it (capture.clock_value)
---@param combinators LuaEntity[]
---@return number counter, LuaEntity main, SignalID signal
local function clock_counter(combinators)
    local main
    for _, combinator in pairs(combinators) do
        if combinator.valid and combinator.type == "decider-combinator"
            and string.sub(description_of(combinator), 1, #CLOCK_DESCRIPTION_PREFIX) == CLOCK_DESCRIPTION_PREFIX then
            if main then
                error("the clock has more than one decider described as \"" .. CLOCK_DESCRIPTION_PREFIX .. " ...\"")
            end
            main = combinator
        end
    end
    if not main then
        error("the clock has no decider described as \"" .. CLOCK_DESCRIPTION_PREFIX .. " ...\"")
    end
    local conditions = main.get_control_behavior().parameters.conditions or {}
    local signal = conditions[1] and conditions[1].first_signal
    if not signal then
        error("the main counter of the clock counts no signal")
    end
    for _, connector in ipairs({ defines.wire_connector_id.combinator_output_green, defines.wire_connector_id.combinator_output_red,
        defines.wire_connector_id.combinator_input_green, defines.wire_connector_id.combinator_input_red }) do
        local network = main.get_circuit_network(connector)
        if network then
            return network.get_signal(signal), main, signal
        end
    end
    error("the main counter of the clock has no circuit network to read")
end

---Wire the schedule combinators of a clock already built (build_clock) to the inserters their tags name; nothing of the clock is
---built again or changed
---@param state table storage.harness
---@param combinators LuaEntity[]
---@param tags table<uint, Tags> tags of the combinators by unit number
---@param clock {inserters: table<string, uint|uint[]>, drills: table<string, uint|uint[]>|nil} inserters: config inserter id -> unit number, or a list of them where the build holds the config more than once
---@return table report
local function attach_clock(state, combinators, tags, clock)
    local by_unit_number = {}
    for _, entity in pairs(state.entities) do
        if entity.valid and entity.unit_number then
            by_unit_number[entity.unit_number] = entity
        end
    end

    -- a clocked drill is the build's one mining drill: the harness wires drills only in a build with one
    local drills = {}
    for _, entity in pairs(state.entities) do
        if entity.valid and entity.type == "mining-drill" then
            table.insert(drills, entity)
        end
    end

    local report = { wired = {}, wired_drills = {}, not_wired = {}, running_free = {} }
    local wired_units = {}
    for _, combinator in pairs(combinators) do
        local ids = tags[combinator.unit_number] and tags[combinator.unit_number][INSERTERS_TAG]
        local drill_ids = tags[combinator.unit_number] and tags[combinator.unit_number][DRILLS_TAG]
        if drill_ids then
            local output = combinator.get_wire_connector(defines.wire_connector_id.combinator_output_green, true)
            for _, id in ipairs(drill_ids) do
                -- drills matched to the config's by the caller (units by config id, a list where the build holds copies); a build with one mining drill needs no list
                local units = clock.drills and clock.drills[tostring(id)]
                if units == nil and #drills == 1 then
                    units = { drills[1].unit_number }
                elseif type(units) ~= "table" then
                    units = { units or -1 }
                end
                if #units == 0 or units[1] == -1 then
                    error("the clock enables drill " .. id .. ", which was not matched to a drill of the build (" .. #drills .. " mining drills)")
                end
                for _, unit_number in ipairs(units) do
                    local drill
                    for _, candidate in ipairs(drills) do
                        if candidate.unit_number == unit_number then drill = candidate end
                    end
                    if not drill then
                        error("the clock names drill " .. id .. ", whose unit " .. unit_number .. " is not a drill of the build")
                    end
                    output.connect_to(drill.get_wire_connector(defines.wire_connector_id.circuit_green, true), false, defines.wire_origin.player)
                    local behavior = drill.get_or_create_control_behavior()
                    -- a drill that reads its resources puts the ore under it on the wire, which "anything > 0" would read as on
                    behavior.circuit_read_resources = false
                    behavior.circuit_enable_disable = true
                    behavior.circuit_condition = ANYTHING_POSITIVE
                    table.insert(report.wired_drills, { drill = id, unit_number = drill.unit_number })
                end
            end
        elseif ids then
            local output = combinator.get_wire_connector(defines.wire_connector_id.combinator_output_green, true)
            for _, id in ipairs(ids) do
                -- a build that holds the config more than once has the unit numbers of its copies' inserters in a list
                local units = clock.inserters[tostring(id)]
                if type(units) ~= "table" then
                    units = { units or -1 }
                end
                if #units == 0 then
                    error("the clock names inserter " .. id .. ", which was not matched to an inserter of the build")
                end
                for _, unit_number in ipairs(units) do
                    local inserter = by_unit_number[unit_number]
                    if not inserter then
                        error("the clock names inserter " .. id .. ", which was not matched to an inserter of the build")
                    end
                    local input = inserter.get_wire_connector(defines.wire_connector_id.circuit_green, true)
                    output.connect_to(input, false, defines.wire_origin.player)
                    local behavior = inserter.get_or_create_control_behavior()
                    -- a condition left from the base's own clock (on a signal this clock never sends) would hold the inserter off for good
                    if not behavior.circuit_set_filters then
                        behavior.circuit_enable_disable = true
                        behavior.circuit_condition = ANYTHING_POSITIVE
                    end
                    wired_units[inserter.unit_number] = true
                    table.insert(report.wired, { inserter = id, unit_number = inserter.unit_number })
                end
            end
        else
            local description = description_of(combinator)
            if string.sub(description, 1, #CLOCK_DESCRIPTION_PREFIX) ~= CLOCK_DESCRIPTION_PREFIX then
                -- helpers of the clock (modulo, subtick) are wired inside the blueprint; anything else is listed for the caller
                table.insert(report.not_wired, string.match(description, "^[^\n]*") or "")
            end
        end
    end

    -- an inserter the removed clock held and the new one does not name would never be enabled again
    for unit_number, inserter in pairs(state.clocked_inserters or {}) do
        if inserter.valid and not wired_units[unit_number] then
            run_without_circuit(inserter)
            table.insert(report.running_free, unit_number)
        end
    end
    return report
end

---Build a generated clock and wire its schedule combinators to the inserters their tags name
---@param state table storage.harness
---@param clock {blueprint: string, inserters: table<string, uint|uint[]>, drills: table<string, uint|uint[]>|nil} blueprint: each schedule combinator tagged with the config ids of its inserters; inserters: config inserter id -> unit number, or a list of them where the build holds the config more than once
---@return table report
local function wire_clock(state, clock)
    local combinators, tags = build_clock(state, clock.blueprint)
    return attach_clock(state, combinators, tags, clock)
end

---@param entity LuaEntity
---@param target table|nil
---@return boolean
local function matches_target(entity, target)
    if not target then
        return true
    end
    if target.name and entity.name ~= target.name then return false end
    if target.type and entity.type ~= target.type then return false end
    if target.unit_number and entity.unit_number ~= target.unit_number then return false end
    if target.recipe then
        local ok, recipe = pcall(function() return entity.get_recipe() end)
        if not ok or not recipe or recipe.name ~= target.recipe then return false end
    end
    return true
end

---@param entity LuaEntity
---@param name string "input", "output", "fuel", "modules" or "chest"
---@return LuaInventory|nil
local function named_inventory(entity, name)
    if name == "fuel" then
        return entity.get_fuel_inventory()
    end
    local ids = {
        input = defines.inventory.crafter_input,
        output = defines.inventory.crafter_output,
        modules = defines.inventory.crafter_modules,
        chest = defines.inventory.chest,
    }
    if not ids[name] then
        error("unknown inventory \"" .. name .. "\": use input, output, fuel, modules or chest")
    end
    return entity.get_inventory(ids[name])
end

---Insert the items of one seed into every entity it targets
---@param entities LuaEntity[]
---@param seed {target: table?, item: string, count: number?, quality: string?, inventory: string?, spoil_percent: number?}
---@return table report
local function apply_seed(entities, seed)
    local items = { name = seed.item, count = seed.count or 1, quality = seed.quality, spoil_percent = seed.spoil_percent }
    local matched, inserted = 0, 0
    for _, entity in pairs(entities) do
        if entity.valid and matches_target(entity, seed.target) then
            if seed.inventory then
                local inventory = named_inventory(entity, seed.inventory)
                if inventory then
                    matched = matched + 1
                    inserted = inserted + inventory.insert(items)
                end
            elseif BELT_TYPES[entity.type] then
                -- count is per lane of each belt piece, stacked as high as the force's belts allow
                matched = matched + 1
                local stack_height = math.min(items.count, 1 + entity.force.belt_stack_size_bonus)
                for index = 1, entity.get_max_transport_line_index() do
                    if entity.get_transport_line(index).insert_at_back(items, stack_height) then
                        inserted = inserted + items.count
                    end
                end
            elseif entity.can_insert(items) then
                matched = matched + 1
                inserted = inserted + entity.insert(items)
            end
        end
    end
    if matched == 0 then
        error("seed of " .. seed.item .. " matched no entity that takes it: " .. helpers.table_to_json(seed.target or {}))
    end
    return { item = seed.item, entities = matched, inserted = inserted }
end

local BELT_PICKUP_TYPES = { "transport-belt", "underground-belt", "splitter", "loader", "loader-1x1", "linked-belt" }
-- a lane is full when no item fits at a quarter, a half and three quarters of its belt piece
local FULL_AT = { 0.25, 0.5, 0.75 }
local DEFAULT_SATURATION_TICKS = 30
local DEFAULT_SATURATION_CAP_TICKS = 10000

---Whether a lane carries items, or one of the lanes that feed it does: a lane no feeder ever puts anything on (the other side of a
---belt that carries one item) is not waited for, a lane the items have not reached yet is
---@param line LuaTransportLine
---@return boolean
local function lane_in_use(line)
    local pending, looked = { line }, 0
    while #pending > 0 and looked < 400 do
        local current = table.remove(pending)
        looked = looked + 1
        if current.get_item_count() > 0 then
            return true
        end
        for _, upstream in pairs(current.input_lines) do
            table.insert(pending, upstream)
        end
    end
    return false
end

---@param line LuaTransportLine
---@return boolean
local function lane_is_full(line)
    for _, at in ipairs(FULL_AT) do
        if line.can_insert_at(line.line_length * at) then
            return false
        end
    end
    return true
end

---The staged start's first stage: the lanes under the pickup of every belt-fed inserter of the cell, which have to be saturated
---before the inserters are built
---@param options {saturation_ticks: number?, cap_ticks: number?}
---@param ghosts LuaEntity[] the inserters of the cell, still ghosts
---@param origin MapPosition
---@return table
local function start_staged_fill(options, ghosts, origin, surface)
    local lanes, seen = {}, {}
    for _, ghost in ipairs(ghosts) do
        local pickup = inserter_ends(ghost)
        for _, belt in pairs(surface.find_entities_filtered({ position = pickup, type = BELT_PICKUP_TYPES })) do
            for index = 1, belt.get_max_transport_line_index() do
                local key = belt.unit_number .. ":" .. index
                if not seen[key] then
                    seen[key] = true
                    table.insert(lanes, { belt = belt, index = index, key = key, full_since = nil, in_use = false })
                end
            end
        end
    end
    return {
        phase = "filling",
        started_tick = game.tick,
        need_ticks = options.saturation_ticks or DEFAULT_SATURATION_TICKS,
        cap_ticks = options.cap_ticks or DEFAULT_SATURATION_CAP_TICKS,
        ghosts = ghosts,
        origin = origin,
        lanes = lanes,
        run = 0,
    }
end

---One tick of the first stage: every lane that carries items has to be full for need_ticks ticks in a row
---@param state table storage.harness
local function staged_tick(state)
    local staged = state.staged
    local all_full, any_in_use = true, false
    for _, lane in ipairs(staged.lanes) do
        local line = lane.belt.valid and lane.belt.get_transport_line(lane.index) or nil
        lane.in_use = line ~= nil and lane_in_use(line)
        if lane.in_use then
            any_in_use = true
            if lane_is_full(line) then
                lane.full_since = lane.full_since or game.tick
            else
                lane.full_since = nil
                all_full = false
            end
        else
            lane.full_since = nil
        end
    end
    staged.run = (all_full and (any_in_use or #staged.lanes == 0)) and staged.run + 1 or 0
    if staged.run >= staged.need_ticks then
        staged.phase = "saturated"
        staged.saturated_tick = game.tick
        staged.lane_log = {}
        for _, lane in ipairs(staged.lanes) do
            table.insert(staged.lane_log, { belt = lane.belt.unit_number, x = lane.belt.position.x, y = lane.belt.position.y, lane = lane.index, in_use = lane.in_use, full_since = lane.full_since })
        end
        state.ready = true
        game.tick_paused = true
    elseif game.tick - staged.started_tick >= staged.cap_ticks then
        staged.phase = "failed"
        staged.lane_log = {}
        for _, lane in ipairs(staged.lanes) do
            table.insert(staged.lane_log, { belt = lane.belt.valid and lane.belt.unit_number or nil, lane = lane.index, in_use = lane.in_use, full_since = lane.full_since })
        end
        staged.failed = "the lanes under the pickups were not full for " .. staged.need_ticks .. " ticks in a row within " .. staged.cap_ticks .. " ticks"
        game.tick_paused = true
    end
end

---Build the blueprint and pause the game, after the warm-up when one is asked for
---@param job {blueprint: string, surface: string?, force: string?, position: MapPosition?, clock: "keep"|"remove"|nil, free_warmup: boolean?, warmup_ticks: number?, speed: number?, drill_resource: string?} speed: the game's speed from here on; it stays what it is when absent. drill_resource: the ore put under every mining drill of the blueprint. free_warmup: with clock "remove", the inserters the removed clock held run free until the new clock is wired
---@return table report
function harness.build(job)
    local surface = game.surfaces[job.surface or "nauvis"]
    local force = game.forces[job.force or "player"]
    if not surface or not force then
        error("no surface \"" .. tostring(job.surface) .. "\" or force \"" .. tostring(job.force) .. "\"")
    end

    local entities, failed, _, staged_ghosts, origin, ores = build_blueprint(surface, force, job.blueprint, function(half_width)
        if job.position then
            return job.position
        end
        -- right of everything the force has built, so the save's own entities are not in the way
        local right = nil
        for _, entity in pairs(surface.find_entities_filtered({ force = force })) do
            right = math.max(right or -math.huge, entity.bounding_box.right_bottom.x)
        end
        return { x = right and (math.ceil(right) + 16 + half_width) or 0, y = 0 }
    end, job.staged ~= nil, job.drill_resource)
    if #entities == 0 then
        error("nothing of the blueprint could be built")
    end

    local state = {
        surface_index = surface.index,
        force_name = force.name,
        entities = entities,
        ready = false,
        origin = origin,
        -- the ore put under the drills, removed with the build
        ores = ores,
    }
    if job.staged then
        state.staged = start_staged_fill(job.staged, staged_ghosts, origin, surface)
    end

    local removed = 0
    if job.clock == "remove" then
        local combinators, inserters = find_clock_network(entities)
        local gone = {}
        for _, combinator in pairs(combinators) do
            gone[combinator.unit_number] = true
            combinator.destroy()
            removed = removed + 1
        end
        local kept = {}
        for _, entity in pairs(entities) do
            if entity.valid and not gone[entity.unit_number] then
                table.insert(kept, entity)
            end
        end
        state.entities = kept
        state.clocked_inserters = inserters
        if job.free_warmup then
            -- the build warms up as an unclocked one does: left without the clock they held, they would wait for a signal that
            -- never comes, and the machines they feed would have no recipe or ingredients when the build is matched
            for _, inserter in pairs(inserters) do
                run_without_circuit(inserter)
            end
        end
    end
    state.area = bounding_box(state.entities)

    storage.harness = state
    if job.speed then
        game.speed = job.speed
    end
    -- an inserter only knows what it picks from and drops into after its first tick, so the build runs at least one
    if not state.staged then
        state.pause_tick = game.tick + math.max(job.warmup_ticks or 0, 1)
    end
    game.tick_paused = false

    local clocked = 0
    for _ in pairs(state.clocked_inserters or {}) do
        clocked = clocked + 1
    end
    return {
        surface = surface.name,
        area = state.area,
        built = #entities,
        failed = failed,
        removed_clock_combinators = removed,
        clocked_inserters = clocked,
        tick = game.tick,
        origin = origin,
        staged = state.staged and { cell_inserters = #staged_ghosts, lanes = #state.staged.lanes } or nil,
    }
end

---Remove the build with the clock wired to it and the items it left on the ground, so the next one is built in its place
---@return table report
function harness.clear()
    local state = storage.harness
    if not state then
        return { removed = 0 }
    end
    recorder.finish("build removed")

    if state.staged then
        for _, ghost in ipairs(state.staged.ghosts) do
            if ghost.valid then
                ghost.destroy()
            end
        end
    end
    local built = {}
    for _, entity in pairs(state.entities) do
        if entity.valid then
            table.insert(built, entity)
        end
    end
    local removed = #built
    if removed > 0 then
        -- measured now, not taken from the state: the clock was built below the build after its area was
        local area = bounding_box(built)
        for _, entity in pairs(built) do
            entity.destroy()
        end
        local spilled = game.surfaces[state.surface_index].find_entities_filtered({
            area = {
                { area.left_top.x - 2, area.left_top.y - 2 },
                { area.right_bottom.x + 2, area.right_bottom.y + 2 },
            },
            type = "item-entity",
        })
        for _, item in pairs(spilled) do
            item.destroy()
        end
    end
    for _, ore in pairs(state.ores or {}) do
        if ore.valid then
            ore.destroy()
        end
    end
    storage.harness = nil
    return { removed = removed }
end

---@param entity LuaEntity|nil
---@return table|nil
local function end_of(entity)
    if not entity or not entity.valid then
        return nil
    end
    return { unit_number = entity.unit_number, type = entity.type, name = entity.name }
end

---Every inserter and loader of the build with the entities at its ends, whatever they are. A recording leaves out an
---inserter whose other end it has no type for (a heating tower, a wagon, the ground), and a loader is no inserter,
---but each moves items that no clock holds.
---@param entities LuaEntity[]
---@return table
local function movers(entities)
    local found = { inserters = {}, loaders = {} }
    for _, entity in pairs(entities) do
        if entity.valid and entity.type == "inserter" then
            table.insert(found.inserters, {
                unit_number = entity.unit_number,
                name = entity.name,
                position = { x = entity.position.x, y = entity.position.y },
                pickup = end_of(entity.pickup_target),
                drop = end_of(entity.drop_target),
            })
        elseif entity.valid and (entity.type == "loader" or entity.type == "loader-1x1") then
            local ok, container = pcall(function() return entity.loader_container end)
            table.insert(found.loaders, {
                unit_number = entity.unit_number,
                name = entity.name,
                loader_type = entity.loader_type,
                container = ok and end_of(container) or nil,
            })
        end
    end
    return found
end

---What a recording of the build would track: the exported config and the unit number of each inserter and machine, and
---the inserters the config leaves out, with why; and what the sidecar would give a player for the same entities.
---Next to it, for the caller's own checks and in no recording: every inserter and loader with what is at its ends.
---@return table
function harness.describe()
    local state = storage.harness
    if not state then
        error("no build: call harness_build first")
    end
    local described = recorder.describe(game.forces[state.force_name], state.entities)
    described.movers = movers(state.entities)
    return described
end

---@param state table
local function start_recording(state)
    state.record_tick = nil
    local started = recorder.start(game.forces[state.force_name], state.entities, nil, state.record_options)
    if not started then
        error("the recorder did not start: no machines or inserters in the build")
    end
end

---The staged start's second stage, in the one tick the game is paused in: builds the inserters of the cell one after the other in the
---order asked for, so the unit numbers (the order the game serves inserters that ask at the same time in) come out in that order
---@param state table storage.harness
---@param options {order: {x: number, y: number, config_id: number?, copy: number?}[]?, copies: number?} copies: the build holds the config this many times, so a config id names one inserter of each copy
---@return table report placed: every inserter built with its unit number; by_config: unit number by config id, a list of them in the order built when the build holds copies
local function place_staged(state, options)
    local staged = state.staged
    if staged.phase ~= "saturated" then
        error("the lanes under the pickups are not saturated: the cell's inserters are not built yet")
    end
    local function key(x, y)
        return string.format("%.2f,%.2f", x, y)
    end
    local ghost_at = {}
    for _, ghost in ipairs(staged.ghosts) do
        if ghost.valid then
            ghost_at[key(ghost.position.x - staged.origin.x, ghost.position.y - staged.origin.y)] = ghost
        end
    end
    -- Container-to-container takers are already built while the cell's machine inserters remain ghosts. They
    -- have no source items yet, but a generated output clock still needs their real unit numbers when it is wired.
    local existing_at = {}
    for _, entity in pairs(state.entities) do
        if entity.valid and entity.type == "inserter" then
            existing_at[key(entity.position.x - staged.origin.x, entity.position.y - staged.origin.y)] = entity
        end
    end
    local placed, by_config, preexisting = {}, {}, {}
    local function name_unit(config_id, unit_number)
        if options.copies then
            by_config[tostring(config_id)] = by_config[tostring(config_id)] or {}
            table.insert(by_config[tostring(config_id)], unit_number)
        else
            by_config[tostring(config_id)] = unit_number
        end
    end
    local function place(ghost, config_id, copy)
        local x, y = ghost.position.x - staged.origin.x, ghost.position.y - staged.origin.y
        local _, entity, proxy = ghost.revive({ raise_revive = true })
        if not entity then
            error("could not build the inserter staged at " .. key(x, y))
        end
        if proxy and proxy.valid then
            fulfil_item_requests(entity, proxy)
        end
        table.insert(state.entities, entity)
        table.insert(placed, { unit_number = entity.unit_number, name = entity.name, config_id = config_id, copy = copy, x = x, y = y, tick = game.tick })
        if config_id then
            name_unit(config_id, entity.unit_number)
        end
    end
    for _, item in ipairs(options.order or {}) do
        local at = key(item.x, item.y)
        local ghost = ghost_at[at]
        if ghost and ghost.valid then
            ghost_at[at] = nil
            place(ghost, item.config_id, item.copy)
        elseif item.config_id and existing_at[at] then
            local entity = existing_at[at]
            name_unit(item.config_id, entity.unit_number)
            table.insert(preexisting, {config_id = item.config_id, copy = item.copy, unit_number = entity.unit_number, x = item.x, y = item.y})
        elseif options.copies then
            -- a build of copies is wired by these lists: an inserter of the order that is neither a ghost nor built would leave a copy unclocked
            error("no inserter staged or built at " .. at .. " for config id " .. tostring(item.config_id) .. " of copy " .. tostring(item.copy))
        end
    end
    -- an inserter of the cell the order does not name follows, in the order of the blueprint
    for _, ghost in ipairs(staged.ghosts) do
        if ghost.valid then
            local at = key(ghost.position.x - staged.origin.x, ghost.position.y - staged.origin.y)
            if ghost_at[at] then
                ghost_at[at] = nil
                place(ghost, nil)
            end
        end
    end
    staged.phase = "placed"
    return { placed = placed, preexisting = preexisting, by_config = by_config, tick = game.tick }
end

---Put the same amount of an item a recipe makes and takes into every machine that makes and takes it: a loop of a machine on its own
---product (the pentapod egg) cannot start itself
---@param entities LuaEntity[]
---@param amount number
---@return table[] report
local function seed_self_ingredient_loops(entities, amount)
    local report = {}
    for _, entity in pairs(entities) do
        if entity.valid and (entity.type == "assembling-machine" or entity.type == "furnace") then
            local ok, recipe = pcall(function() return entity.get_recipe() end)
            if ok and recipe then
                local products = {}
                for _, product in pairs(recipe.products) do
                    if product.type == "item" then
                        products[product.name] = true
                    end
                end
                for _, ingredient in pairs(recipe.ingredients) do
                    if ingredient.type == "item" and products[ingredient.name] then
                        local inserted = entity.insert({ name = ingredient.name, count = amount })
                        table.insert(report, { unit_number = entity.unit_number, recipe = recipe.name, item = ingredient.name, inserted = inserted })
                    end
                end
            end
        end
    end
    return report
end

---What the crafting machines and chests of the build hold: in a staged start nothing of the cell has run, so its machines are empty
---@param state table storage.harness
---@return table[] stock
local function build_stock(state)
    local stock = {}
    for _, entity in pairs(state.entities) do
        if entity.valid and (CRAFTING_MACHINE_TYPES[entity.type] or entity.type == "container") then
            local row = { unit_number = entity.unit_number, name = entity.name, type = entity.type }
            if entity.type == "container" then
                row.chest = entity.get_inventory(defines.inventory.chest).get_item_count()
            else
                row.input = entity.get_inventory(defines.inventory.crafter_input).get_item_count()
                row.output = entity.get_inventory(defines.inventory.crafter_output).get_item_count()
            end
            table.insert(stock, row)
        end
    end
    return stock
end

---@param combinators LuaEntity[]
---@return uint[]
local function unit_numbers_of(combinators)
    local units = {}
    for _, combinator in pairs(combinators) do
        table.insert(units, combinator.valid and combinator.unit_number or -1)
    end
    return units
end

---A staged start that places its clock first: once the belts are saturated, the clock is built while the inserters of the cell are
---still ghosts, and the game stays paused. harness_advance then runs it alone, a tick at a time, and harness_start builds the
---inserters and wires them to this same clock.
---@param job {clock: {blueprint: string}}
---@return table report
function harness.place_clock(job)
    local state = storage.harness
    if not state or not state.staged or state.staged.phase ~= "saturated" or not state.ready then
        error("a clock is placed first only in a staged start whose belts are saturated, before its inserters are built")
    end
    if state.primed_clock then
        error("the clock of this build is placed already")
    end
    local combinators, tags = build_clock(state, job.clock.blueprint)
    local counter, main, signal = clock_counter(combinators)
    state.primed_clock = { combinators = combinators, tags = tags, main = main, signal = signal, placed_tick = game.tick }
    local ghosts = 0
    for _, ghost in ipairs(state.staged.ghosts) do
        if ghost.valid then ghosts = ghosts + 1 end
    end
    return { tick = game.tick, counter = counter, signal = signal, main_unit = main.unit_number,
        combinators = unit_numbers_of(combinators), cell_ghosts = ghosts, stock = build_stock(state) }
end

---Run the game for some ticks and pause it again, in a staged start whose clock was placed first and whose inserters are not built
---@param job {ticks: number?}
---@return table report
function harness.advance(job)
    local state = storage.harness
    if not state or not state.primed_clock or not state.ready or state.staged.phase ~= "saturated" then
        error("the game is advanced only in a staged start whose clock was placed first, before its inserters are built")
    end
    local ticks = job.ticks or 1
    if ticks < 1 or ticks % 1 ~= 0 then
        error("advance by a whole number of ticks above 0, not " .. tostring(ticks))
    end
    state.ready = false
    state.pause_tick = game.tick + ticks
    game.tick_paused = false
    return { tick = game.tick, pause_tick = state.pause_tick }
end

---Wire a clock, seed the build, start recording and let the game run
---@param job {clock: table?, unclocked: boolean?, seed: table[]?, lua: string?, settle_ticks: number?, record: {ticks: number?, periods: number?}?}
---@return table report
function harness.start(job)
    local state = storage.harness
    if not state or not state.ready then
        error("the build is not ready: call harness_build and wait for the warm-up")
    end
    local report = { seeds = {} }

    local primed = state.primed_clock
    if primed and not (job.clock and job.clock.primed) then
        error("the clock of this build is placed already: start it with clock.primed")
    end
    if job.clock and job.clock.primed and not primed then
        error("clock.primed needs a clock placed first (harness_place_clock)")
    end
    local attach
    if primed then
        -- read in the tick the inserters are built in and wired, before anything of the cell exists
        local counter = clock_counter(primed.combinators)
        local ghosts = 0
        for _, ghost in ipairs(state.staged.ghosts) do
            if ghost.valid then ghosts = ghosts + 1 end
        end
        attach = { tick = game.tick, placed_tick = primed.placed_tick, counter = counter, signal = primed.signal,
            main_unit = primed.main.valid and primed.main.unit_number or nil, combinators = unit_numbers_of(primed.combinators),
            cell_ghosts = ghosts, stock = build_stock(state) }
    end

    if state.staged then
        local staged_options = job.staged or {}
        report.staged = place_staged(state, staged_options)
        if job.clock then
            job.clock.inserters = report.staged.by_config
        end
        if attach then
            report.staged.clock_attach = attach
        end
    end

    if primed then
        report.clock = attach_clock(state, primed.combinators, primed.tags, job.clock)
    elseif job.clock then
        report.clock = wire_clock(state, job.clock)
    elseif job.unclocked then
        for _, inserter in pairs(state.clocked_inserters or {}) do
            if inserter.valid then
                run_without_circuit(inserter)
            end
        end
    end

    if state.staged then
        report.loop_seeds = seed_self_ingredient_loops(state.entities, (job.staged or {}).loop_seed or 200)
    end

    for _, seed in ipairs(job.seed or {}) do
        table.insert(report.seeds, apply_seed(state.entities, seed))
    end

    if job.lua then
        local chunk, problem = load(job.lua, "=harness lua", "t")
        if not chunk then
            error(problem)
        end
        chunk(state.entities, game.surfaces[state.surface_index], state.area)
    end

    local record = job.record or {}
    state.record_options = {
        -- with a clock: whole periods until the ticks are covered; without: exactly the ticks
        periods = record.periods or 1,
        minimum_ticks = record.ticks or 0,
        ticks_without_clock = record.ticks or 600,
        -- a staged start records from the tick its inserters and clock are placed in, not from the clock's next wrap
        ignore_clock = job.unclocked or state.staged ~= nil,
    }
    state.ready = false
    if (job.settle_ticks or 0) > 0 or state.staged then
        -- the build runs on its new clock and seeds for a while first, so its start-up is not in the recording. The inserters built
        -- in a staged start know what they pick up from and drop into after their first tick, which the recording needs
        state.record_tick = game.tick + math.max(job.settle_ticks or 0, 1)
    else
        start_recording(state)
    end
    report.recording = recorder.status()
    report.tick = state.record_tick or game.tick
    game.tick_paused = false
    return report
end

---@return table
function harness.status()
    local state = storage.harness
    local status = recorder.status()
    status.tick = game.tick
    status.paused = game.tick_paused
    status.ready = state ~= nil and state.ready
    status.settling = state ~= nil and state.record_tick ~= nil
    if state ~= nil and state.staged ~= nil then
        local staged = state.staged
        status.staged = { phase = staged.phase, started_tick = staged.started_tick, saturated_tick = staged.saturated_tick, failed = staged.failed, lanes = staged.lane_log, run = staged.run }
    end
    if state ~= nil and state.primed_clock ~= nil then
        status.clock = { placed_tick = state.primed_clock.placed_tick, counter = clock_counter(state.primed_clock.combinators) }
    end
    return status
end

---@return boolean
function harness.is_waiting()
    local state = storage.harness
    return state ~= nil and (state.pause_tick ~= nil or state.record_tick ~= nil or (state.staged ~= nil and state.staged.phase == "filling"))
end

---Per-tick handler during the warm-up, which pauses the game once it is over, and while a build settles before it is recorded
function harness.on_tick()
    local state = storage.harness
    if state and state.staged and state.staged.phase == "filling" then
        staged_tick(state)
    end
    if state and state.pause_tick and game.tick >= state.pause_tick then
        state.pause_tick = nil
        state.ready = true
        game.tick_paused = true
    end
    if state and state.record_tick and game.tick >= state.record_tick then
        start_recording(state)
    end
end

return harness
