-- Observe a running generated clock. Interventions happen only after64 untouched periods.
local entities, surface = ...
local machine = capture.find_one(entities, function(entity)
    return entity.name == (options.family == "electromagnetic" and "electromagnetic-plant" or "assembling-machine-3")
end, "machine")
local input = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.drop_target == machine
end, "input")
local belt = assert(input.pickup_target)
local reach = pickup.lanes(belt)[1].length
assert(reach == options.reach and belt.prototype.belt_speed == options.speed, "native pickup differs from config")
local period = options.period
local starts = game.tick + options.settle
local report = {starts = starts, initial = {speed = belt.prototype.belt_speed, reach = reach}, events = {}, periods = {}}
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local function clock_value()
    for _, connector in ipairs({defines.wire_connector_id.combinator_output_green,
        defines.wire_connector_id.combinator_output_red, defines.wire_connector_id.combinator_input_green,
        defines.wire_connector_id.combinator_input_red}) do
        local network = clock.get_circuit_network(connector)
        if network then return network.get_signal{type = "virtual", name = "signal-clock"} end
    end
    error("generated clock has no readable network")
end
local output = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.pickup_target == machine
end, "output inserter")
local function held() return output.held_stack.valid_for_read and output.held_stack.count or 0 end
local previous_clock, previous_held, current = clock_value(), held(), nil
local loader, loader_spec, loader_index, disposal
if options.family == "electromagnetic" then
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
script.on_nth_tick(1, function()
    local tick = game.tick - starts
    local value, count = clock_value(), held()
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
    local item
    if tick >= 66 * period and tick < 68 * period then
        item = options.family == "electromagnetic" and "accumulator" or "iron-plate"
    elseif tick >= 104 * period and tick < 106 * period then
        item = options.family == "electromagnetic" and "supercapacitor" or "iron-plate"
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
    if tick >= 84 * period and not blocked then
        if loader then loader.destroy()
        else
            disposal.remove_unfiltered_items = false
            disposal.insert{name = "iron-gear-wheel", count = 1000000}
            assert(not disposal.can_insert{name = "iron-gear-wheel", count = 1}, "output must really be blocked")
        end
        blocked = true
        table.insert(report.events, {tick = tick, action = "block-output"})
    end
    if tick >= 88 * period and not restored then
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
