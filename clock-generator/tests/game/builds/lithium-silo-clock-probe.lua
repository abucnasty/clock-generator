-- Observe a generated clock on the lithium plate build, whose rocket silo is a chest between the cryogenic plants
-- that fill it and the furnaces that empty it. Output is counted per clock period from the drops of the inserters that
-- take from the furnaces. The interventions: the first and the third cut the holmium plates (both infinity chests are set
-- to hold none), the second blocks the output (the chest the loader fills keeps what it gets and is filled with wooden
-- chests, then emptied and set to remove again). Interventions happen only after 64 untouched periods.
local entities, surface = ...
local silo = capture.find_one(entities, function(entity) return entity.type == "rocket-silo" end, "rocket silo")
local outputs, fills, empties = {}, {}, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        local pickup, drop = entity.pickup_target, entity.drop_target
        if pickup and pickup.type == "furnace" then table.insert(outputs, entity) end
        if drop == silo then table.insert(fills, entity) end
        if pickup == silo then table.insert(empties, entity) end
    end
end
assert(#outputs == 6 and #fills == 2 and #empties == 6, "expected 6 output, 2 fill and 6 empty inserters")
local sink, supplies = nil, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "infinity-container" then
        local filter = entity.get_infinity_container_filter(1)
        if filter then table.insert(supplies, {chest = entity, filter = filter})
        else assert(not sink, "expected one sink"); sink = entity end
    end
end
assert(sink and sink.remove_unfiltered_items and #supplies == 2, "two supply chests and a sink that removes")
local rocket = silo.get_inventory(defines.inventory.rocket_silo_rocket)
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local period = options.period
local interventions = assert(options.interventions)
local starts = game.tick + options.settle
local function units(list)
    local out = {}
    for _, entity in ipairs(list) do table.insert(out, entity.unit_number) end
    table.sort(out)
    return out
end
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, initial = {
    silo = silo.name, rocket_contents = rocket.get_contents(), fill_units = units(fills), empty_units = units(empties),
    output_units = units(outputs)}}
local function held(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.count or 0 end
local function set_supplies(on)
    for _, supply in ipairs(supplies) do
        local filter = supply.filter
        -- "exactly" none empties the chest too; the blueprint's filter ("at-least" 100) is set again on release
        supply.chest.set_infinity_container_filter(1, on and {name = filter.name, count = filter.count, mode = filter.mode, index = 1}
            or {name = filter.name, count = 0, mode = "exactly", index = 1})
    end
end
local function block(on)
    local chest_inventory = sink.get_inventory(defines.inventory.chest)
    if on then
        sink.remove_unfiltered_items = false
        for slot = 1, #chest_inventory do chest_inventory[slot].set_stack({name = "wooden-chest", count = 50}) end
    else
        chest_inventory.clear()
        sink.remove_unfiltered_items = true
    end
end
local previous_clock, previous_held, current = capture.clock_value(clock), {}, nil
for index, inserter in ipairs(outputs) do previous_held[index] = held(inserter) end
local started, ended = {}, {}
script.on_nth_tick(1, function()
    local tick = game.tick - starts
    local value = capture.clock_value(clock)
    if value < previous_clock and game.tick >= starts then
        if current then
            current["end"] = game.tick
            table.insert(report.periods, current)
        end
        current = {start = game.tick, items = 0, silo = rocket.get_item_count()}
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
    for index, inserter in ipairs(outputs) do
        local count = held(inserter)
        if current and count < previous_held[index] then current.items = current.items + previous_held[index] - count end
        previous_held[index] = count
    end
    previous_clock = value
    for index, intervention in ipairs(interventions) do
        if tick >= intervention[1] * period and not started[index] then
            started[index] = true
            if index == 2 then block(true) else set_supplies(false) end
            table.insert(report.events, {tick = tick, action = index == 2 and "block-output" or "cut-supply"})
        end
        if tick >= intervention[2] * period and not ended[index] then
            ended[index] = true
            if index == 2 then block(false) else set_supplies(true) end
            table.insert(report.events, {tick = tick, action = index == 2 and "restore-output" or "restore-supply"})
        end
    end
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
