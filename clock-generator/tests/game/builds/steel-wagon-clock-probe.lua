-- Observe a generated clock on the owner's steel build, whose cargo wagon is a hub: a mining drill fills it with ore,
-- one furnace makes plates from the ore and puts them back, the other makes steel from the plates and puts it back, and
-- the steel is taken out of the wagon onto a belt that a loader empties into a disposal chest. Output is counted per clock
-- period from the drops of the inserters that take from the wagon onto the belt. The interventions: the first and the
-- third stop the drill (disabled by script) until the wagon has run dry of steel, the second blocks the output (the chest
-- the loader fills keeps what it gets and is filled with wooden chests, then emptied and set to remove again).
-- Interventions happen only after 64 untouched periods.
local entities, surface = ...
local wagon = capture.find_one(entities, function(entity) return entity.type == "cargo-wagon" end, "cargo wagon")
local drill = capture.find_one(entities, function(entity) return entity.type == "mining-drill" end, "mining drill")
local outputs, fills, takes = {}, {}, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        local pickup, drop = entity.pickup_target, entity.drop_target
        if pickup == wagon and drop and drop.type == "transport-belt" then table.insert(outputs, entity)
        elseif pickup == wagon then table.insert(takes, entity) end
        if drop == wagon then table.insert(fills, entity) end
    end
end
assert(#outputs == 1 and #fills == 2 and #takes == 2, "expected 1 output, 2 fill and 2 machine-feeding inserters on the wagon")
assert(drill.drop_target == wagon, "the drill drops into the wagon")
local sink = capture.find_one(entities, function(entity) return entity.type == "infinity-container" end, "sink")
assert(sink.remove_unfiltered_items, "a sink that removes")
local cargo = wagon.get_inventory(defines.inventory.cargo_wagon)
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
local function contents()
    local out = {}
    for _, content in pairs(cargo.get_contents()) do out[content.name] = (out[content.name] or 0) + content.count end
    return out
end
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, initial = {
    wagon = contents(), output_units = units(outputs), fill_units = units(fills), take_units = units(takes),
    drill_unit = drill.unit_number, wagon_unit = wagon.unit_number}}
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
-- the furnaces' output stopped by a full wagon slot: counted per period, ticks with the furnace at its output block
local furnaces = {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "furnace" then table.insert(furnaces, entity) end
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
        current = {start = game.tick, items = 0, wagon = contents(), output_full_ticks = {}}
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
    for index, inserter in ipairs(outputs) do
        local count = held(inserter)
        if current and count < previous_held[index] then current.items = current.items + previous_held[index] - count end
        previous_held[index] = count
    end
    if current then
        for _, furnace in ipairs(furnaces) do
            if furnace.status == defines.entity_status.full_output then
                current.output_full_ticks[furnace.unit_number] = (current.output_full_ticks[furnace.unit_number] or 0) + 1
            end
        end
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
