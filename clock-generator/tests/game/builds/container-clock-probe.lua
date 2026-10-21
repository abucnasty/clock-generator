-- Observe a generated clock through a car, a tank or a cargo wagon taken as a chest (its slot filters come with the
-- blueprint). Output is counted per clock period from the output inserter's drops into the disposal chest. The interventions: the first and the third cut a supply (the
-- infinity chest is set to hold none of its item: options.cuts names the item of each), the second blocks the output
-- (the disposal chest keeps what it gets and is filled with wooden chests, then emptied and set to remove again).
-- Interventions happen only after 64 untouched periods.
local entities, surface = ...
local machine = capture.find_one(entities, function(entity) return entity.type == "assembling-machine" end, "machine")
local container = capture.find_one(entities, function(entity)
    return entity.type == "car" or entity.type == "cargo-wagon"
end, "container")
local output = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.pickup_target == machine
end, "output inserter")
local disposal = output.drop_target
assert(disposal and disposal.type == "infinity-container" and disposal.remove_unfiltered_items, "the output drops into a disposal chest")
local supplies = {}
for _, entity in pairs(entities) do
    if entity.type == "infinity-container" and entity ~= disposal then
        local filter = entity.get_infinity_container_filter(1)
        supplies[filter.name] = {chest = entity, filter = filter}
    end
end
local inventory = container.get_inventory(container.type == "car" and defines.inventory.car_trunk or defines.inventory.cargo_wagon)
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local period = options.period
local interventions = assert(options.interventions)
local cuts = assert(options.cuts)
local starts = game.tick + options.settle
local filtered = 0
for slot = 1, #inventory do if inventory.get_filter(slot) then filtered = filtered + 1 end end
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, initial = {
    container = container.name, quality = container.quality.name, slots = #inventory, filtered_slots = filtered,
    crafting_speed = machine.crafting_speed}}
local function held() return output.held_stack.valid_for_read and output.held_stack.count or 0 end
local function set_supply(item, count)
    local supply = assert(supplies[item], "no supply of " .. item)
    supply.chest.set_infinity_container_filter(1, {name = item, count = count, mode = "exactly", index = 1})
end
local function block(on)
    local chest_inventory = disposal.get_inventory(defines.inventory.chest)
    if on then
        disposal.remove_unfiltered_items = false
        for slot = 1, #chest_inventory do chest_inventory[slot].set_stack({name = "wooden-chest", count = 50}) end
    else
        chest_inventory.clear()
        disposal.remove_unfiltered_items = true
    end
end
local previous_clock, previous_held, current = capture.clock_value(clock), held(), nil
local started, ended = {}, {}
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
    for index, intervention in ipairs(interventions) do
        if tick >= intervention[1] * period and not started[index] then
            started[index] = true
            if index == 2 then block(true) else set_supply(cuts[index == 1 and 1 or 2], 0) end
            table.insert(report.events, {tick = tick, action = index == 2 and "block-output" or "cut-supply"})
        end
        if tick >= intervention[2] * period and not ended[index] then
            ended[index] = true
            if index == 2 then block(false) else
                local item = cuts[index == 1 and 1 or 2]
                set_supply(item, supplies[item].filter.count)
            end
            table.insert(report.events, {tick = tick, action = index == 2 and "restore-output" or "restore-supply"})
        end
    end
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
