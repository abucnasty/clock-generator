-- Observe a generated clock on the iron plate build, whose car is a chest between the mining drill that fills it
-- and the two furnaces that empty it. Output is counted per clock period from the drops of the inserters that take from
-- the furnaces. The interventions: the first and the third stop the drill (it is disabled by script) until the car has run
-- dry, the second blocks the output (the chest the loader fills keeps what it gets and is filled with wooden chests,
-- then emptied and set to remove again). Interventions happen only after 64 untouched periods.
local entities, surface = ...
local car = capture.find_one(entities, function(entity) return entity.type == "car" end, "car")
local drill = capture.find_one(entities, function(entity) return entity.type == "mining-drill" end, "mining drill")
local outputs, takers = {}, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        local pickup = entity.pickup_target
        if pickup and pickup.type == "furnace" then table.insert(outputs, entity) end
        if pickup == car then table.insert(takers, entity) end
    end
end
assert(#outputs == 2 and #takers == 2, "expected 2 output and 2 car inserters")
assert(drill.drop_target == car, "the drill drops into the car")
local sink = capture.find_one(entities, function(entity) return entity.type == "infinity-container" end, "sink")
assert(sink.remove_unfiltered_items, "a sink that removes")
local trunk = car.get_inventory(defines.inventory.car_trunk)
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
    car_contents = trunk.get_item_count(), taker_units = units(takers), output_units = units(outputs),
    drill_unit = drill.unit_number, car_unit = car.unit_number}}
local function held(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.count or 0 end
local function set_drill(on) drill.disabled_by_script = not on end
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
        current = {start = game.tick, items = 0, car = trunk.get_item_count()}
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
            if index == 2 then block(true) else set_drill(false) end
            table.insert(report.events, {tick = tick, action = index == 2 and "block-output" or "stop-drill"})
        end
        if tick >= intervention[2] * period and not ended[index] then
            ended[index] = true
            if index == 2 then block(false) else set_drill(true) end
            table.insert(report.events, {tick = tick, action = index == 2 and "restore-output" or "start-drill"})
        end
    end
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
