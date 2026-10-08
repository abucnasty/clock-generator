-- Recording harness
-- Builds a blueprint, seeds it and records it from script, for a headless game driven over RCON with no player.
-- The game is paused between the steps, so nothing moves while the caller decides how to wire a clock.

local recorder = require("scripts.recorder")

local harness = {}

local CLOCK_DESCRIPTION_PREFIX = "Clock for"
local COMBINATOR_TYPES = {
    ["decider-combinator"] = true,
    ["arithmetic-combinator"] = true,
    ["selector-combinator"] = true,
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

---Build a blueprint string as real entities
---@param surface LuaSurface
---@param force LuaForce
---@param blueprint string
---@param position_for fun(half_width: number, half_height: number): MapPosition where the middle of the blueprint goes
---@return LuaEntity[] entities, string[] failed names of the entities that could not be built
local function build_blueprint(surface, force, blueprint, position_for)
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

    local ghosts = stack.build_blueprint({
        surface = surface,
        force = force,
        position = position,
        build_mode = defines.build_mode.forced,
        skip_fog_of_war = false,
    })
    inventory.destroy()

    local entities, failed = {}, {}
    for _, ghost in pairs(ghosts) do
        if ghost.valid and ghost.type == "entity-ghost" then
            local name = ghost.ghost_name
            local _, entity, proxy = ghost.revive({ raise_revive = true })
            if entity then
                if proxy and proxy.valid then
                    fulfil_item_requests(entity, proxy)
                end
                table.insert(entities, entity)
            else
                table.insert(failed, name)
            end
        elseif ghost.valid and ghost.type == "tile-ghost" then
            ghost.revive()
        end
    end
    return entities, failed
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

---Wire the schedule combinators of a generated clock to the inserters their descriptions name
---@param state table storage.harness
---@param clock {blueprint: string, inserters: table<string, uint>} inserters: config inserter id -> unit number
---@return table report
local function wire_clock(state, clock)
    local surface = game.surfaces[state.surface_index]
    local area = state.area
    local combinators, failed = build_blueprint(surface, game.forces[state.force_name], clock.blueprint, function(_, half_height)
        return {
            x = math.floor((area.left_top.x + area.right_bottom.x) / 2),
            y = math.ceil(area.right_bottom.y) + 2 + half_height,
        }
    end)
    if #failed > 0 then
        error("could not build the clock: " .. table.concat(failed, ", "))
    end

    local by_unit_number = {}
    for _, entity in pairs(state.entities) do
        if entity.valid and entity.unit_number then
            by_unit_number[entity.unit_number] = entity
        end
    end

    local report = { wired = {}, not_wired = {}, running_free = {} }
    local wired_units = {}
    for _, combinator in pairs(combinators) do
        table.insert(state.entities, combinator)
        local description = description_of(combinator)
        local ids = string.match(description, "^Inserters? ([%d, ]+) for")
        if ids then
            local output = combinator.get_wire_connector(defines.wire_connector_id.combinator_output_green, true)
            for id in string.gmatch(ids, "%d+") do
                local inserter = by_unit_number[clock.inserters[id] or -1]
                if not inserter then
                    error("the clock names inserter " .. id .. ", which was not matched to an inserter of the build")
                end
                local input = inserter.get_wire_connector(defines.wire_connector_id.circuit_green, true)
                output.connect_to(input, false, defines.wire_origin.player)
                local behavior = inserter.get_or_create_control_behavior()
                if not behavior.circuit_enable_disable and not behavior.circuit_set_filters then
                    behavior.circuit_enable_disable = true
                    behavior.circuit_condition = ANYTHING_POSITIVE
                end
                wired_units[inserter.unit_number] = true
                table.insert(report.wired, { inserter = tonumber(id), unit_number = inserter.unit_number })
            end
        elseif string.sub(description, 1, #CLOCK_DESCRIPTION_PREFIX) ~= CLOCK_DESCRIPTION_PREFIX then
            -- helpers of the clock (modulo, subtick) are wired inside the blueprint; anything else is listed for the caller
            table.insert(report.not_wired, string.match(description, "^[^\n]*") or "")
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

---Build the blueprint and pause the game, after the warm-up when one is asked for
---@param job {blueprint: string, surface: string?, force: string?, position: MapPosition?, clock: "keep"|"remove"|nil, warmup_ticks: number?, speed: number?}
---@return table report
function harness.build(job)
    local surface = game.surfaces[job.surface or "nauvis"]
    local force = game.forces[job.force or "player"]
    if not surface or not force then
        error("no surface \"" .. tostring(job.surface) .. "\" or force \"" .. tostring(job.force) .. "\"")
    end

    local entities, failed = build_blueprint(surface, force, job.blueprint, function(half_width)
        if job.position then
            return job.position
        end
        -- right of everything the force has built, so the save's own entities are not in the way
        local right = nil
        for _, entity in pairs(surface.find_entities_filtered({ force = force })) do
            right = math.max(right or -math.huge, entity.bounding_box.right_bottom.x)
        end
        return { x = right and (math.ceil(right) + 16 + half_width) or 0, y = 0 }
    end)
    if #entities == 0 then
        error("nothing of the blueprint could be built")
    end

    local state = {
        surface_index = surface.index,
        force_name = force.name,
        entities = entities,
        ready = false,
    }

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
    end
    state.area = bounding_box(state.entities)

    storage.harness = state
    game.speed = job.speed or 1
    -- an inserter only knows what it picks from and drops into after its first tick, so the build runs at least one
    state.pause_tick = game.tick + math.max(job.warmup_ticks or 0, 1)
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
    }
end

---What a recording of the build would track: the exported config and the unit number of each inserter and machine
---@return table
function harness.describe()
    local state = storage.harness
    if not state then
        error("no build: call harness_build first")
    end
    return recorder.describe(game.forces[state.force_name], state.entities)
end

---Wire a clock, seed the build, start recording and let the game run
---@param job {clock: table?, unclocked: boolean?, seed: table[]?, lua: string?, record: {ticks: number?, periods: number?}?}
---@return table report
function harness.start(job)
    local state = storage.harness
    if not state or not state.ready then
        error("the build is not ready: call harness_build and wait for the warm-up")
    end
    local report = { seeds = {} }

    if job.clock then
        report.clock = wire_clock(state, job.clock)
    elseif job.unclocked then
        for _, inserter in pairs(state.clocked_inserters or {}) do
            if inserter.valid then
                run_without_circuit(inserter)
            end
        end
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
    local started = recorder.start(game.forces[state.force_name], state.entities, nil, {
        -- with a clock: whole periods until the ticks are covered; without: exactly the ticks
        periods = record.periods or 1,
        minimum_ticks = record.ticks or 0,
        ticks_without_clock = record.ticks or 600,
        ignore_clock = job.unclocked,
    })
    if not started then
        error("the recorder did not start: no machines or inserters in the build")
    end
    report.recording = recorder.status()
    report.tick = game.tick
    state.ready = false
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
    return status
end

---@return boolean
function harness.is_waiting()
    return storage.harness ~= nil and storage.harness.pause_tick ~= nil
end

---Per-tick handler during the warm-up: pauses the game once it is over
function harness.on_tick()
    local state = storage.harness
    if state and state.pause_tick and game.tick >= state.pause_tick then
        state.pause_tick = nil
        state.ready = true
        game.tick_paused = true
    end
end

return harness
