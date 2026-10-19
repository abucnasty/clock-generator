-- Observe a running generated clock. Interventions happen only after64 untouched periods.
local entities, surface = ...
local machine = capture.find_one(entities, function(entity)
    return entity.name == (options.machine_name or (options.family == "electromagnetic" and "electromagnetic-plant" or "assembling-machine-3"))
end, "machine")
local input = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.drop_target == machine
end, "input")
local belt = assert(input.pickup_target)
local reach = pickup.lanes(belt)[1].length
assert(reach == options.reach and belt.prototype.belt_speed == options.speed, "native pickup differs from config")
local period = options.period
local interventions = options.interventions or {{66, 68, 84}, {84, 88, 104}, {104, 106, 132}}
local starts = game.tick + options.settle
local report = {starts = starts, initial = {speed = belt.prototype.belt_speed, reach = reach}, events = {}, periods = {}}
if options.interventions then report.interventions = options.interventions end
if options.trace_periods then report.pickups = {} end
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local output = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.pickup_target == machine
end, "output inserter")
local function held() return output.held_stack.valid_for_read and output.held_stack.count or 0 end
local previous_clock, previous_held, current = capture.clock_value(clock), held(), nil
local loader, loader_spec, loader_index, disposal
if options.output_to_belt or options.family == "electromagnetic" then
    loader = capture.find_one(entities, function(entity)
        return entity.type == "loader" and entity.position.y < machine.position.y
    end, "output loader")
    for index, entity in pairs(entities) do if entity == loader then loader_index = index end end
    assert(loader_index)
    loader_spec = {name = loader.name, position = loader.position, direction = loader.direction,
        force = loader.force, type = loader.loader_type}
else
    disposal = assert(output.drop_target)
    assert(disposal.name == "infinity-chest")
end
local blocked, restored = false, false
local ingredients = options.ingredients or (options.family == "electromagnetic"
    and {"accumulator", "supercapacitor"} or {"iron-plate", "iron-plate"})
script.on_nth_tick(1, function()
    local tick = game.tick - starts
    local value, count = capture.clock_value(clock), held()
    if value < previous_clock and game.tick >= starts then
        if current then
            current["end"] = game.tick
            table.insert(report.periods, current)
        end
        current = {start = game.tick, items = 0}
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
    if current and count < previous_held then current.items = current.items + previous_held - count end
    previous_clock, previous_held = value, count
    for _, first in ipairs(options.trace_periods or {}) do
        if tick >= first * period and tick < first * period + (options.trace_ticks or 64) then
            local snapshot = pickup.snapshot(input, tick)
            snapshot.clock = value
            local inventory = machine.get_inventory(defines.inventory.crafter_input)
            snapshot.machine = {inputs = {}, crafting_progress = machine.crafting_progress, bonus_progress = machine.bonus_progress}
            for _, ingredient in ipairs(ingredients) do snapshot.machine.inputs[ingredient] = inventory.get_item_count(ingredient) end
            if options.product then
                snapshot.machine.output = machine.get_inventory(defines.inventory.crafter_output).get_item_count(options.product)
            end
            table.insert(report.pickups, snapshot)
            break
        end
    end
    local item
    if tick >= interventions[1][1] * period and tick < interventions[1][2] * period then
        item = ingredients[1]
    elseif tick >= interventions[3][1] * period and tick < interventions[3][2] * period then
        item = ingredients[2]
    end
    if item then
        for _, entity in pairs(entities) do
            if entity.valid and (entity.type == "transport-belt" or entity.type == "underground-belt") then
                for lane = 1, entity.get_max_transport_line_index() do
                    entity.get_transport_line(lane).remove_item{name = item, count = 100000}
                end
            end
        end
    end
    if tick >= interventions[2][1] * period and not blocked then
        if loader then loader.destroy()
        else
            disposal.remove_unfiltered_items = false
            disposal.insert{name = "iron-gear-wheel", count = 1000000}
            assert(not disposal.can_insert{name = "iron-gear-wheel", count = 1}, "output must really be blocked")
        end
        blocked = true
        table.insert(report.events, {tick = tick, action = "block-output"})
    end
    if tick >= interventions[2][2] * period and not restored then
        if loader_spec then
            loader = assert(surface.create_entity(loader_spec))
            -- Recorder extraction happens after these interventions during settling. Replace its stale handle.
            entities[loader_index] = loader
        else
            disposal.get_inventory(defines.inventory.chest).clear()
            disposal.remove_unfiltered_items = true
        end
        restored = true
        table.insert(report.events, {tick = tick, action = "restore-output"})
    end
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
