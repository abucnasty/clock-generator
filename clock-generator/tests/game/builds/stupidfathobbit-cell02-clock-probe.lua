-- Observe a clock on the throttled scaffold of REAL_STUPIDFATHOBBIT_CELL02, found by its description. Output is counted per clock
-- period from the drops of the two processing unit output inserters (items) and of the two circuit export inserters (export).
-- The interventions are options.interventions, in periods of the clock: plastic bars removed from every belt in the first; in the
-- second the two processing unit loaders removed and rebuilt, and with them the belt tiles the throttle inserters take the circuits
-- from (the export belt then fills and the export inserters wait). Stopping the export alone does not reduce the output of
-- processing units, which take their circuits from the machines, so it has no intervention of its own. They happen only after 64
-- untouched periods.
local entities, surface = ...
local makers = {processing = {}, circuits = {}}
for _, e in pairs(entities) do
    if e.valid and e.type == "assembling-machine" and e.get_recipe() then
        if e.get_recipe().name == options.product then table.insert(makers.processing, e) end
        if e.get_recipe().name == "electronic-circuit" then table.insert(makers.circuits, e) end
    end
end
assert(#makers.processing == 2 and #makers.circuits == 2, "two machines making the product and two making circuits")
local function outputs_of(list)
    local result = {}
    for _, m in ipairs(list) do
        for _, e in pairs(entities) do
            if e.valid and e.type == "inserter" and e.pickup_target == m and e.drop_target and (e.drop_target.type == "transport-belt" or e.drop_target.type == "underground-belt") then table.insert(result, e) end
        end
    end
    return result
end
local outputs, exports = outputs_of(makers.processing), outputs_of(makers.circuits)
assert(#outputs == 2 and #exports == 2, "an output inserter and an export inserter for each machine")
-- the belt tiles the throttle inserters (belt to infinity chest) take from, removed and rebuilt to stop the export
local tiles, seen = {}, {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.pickup_target.type == "transport-belt" and e.drop_target and e.drop_target.type == "infinity-container" then
        local belt = e.pickup_target
        local key = belt.position.x .. "," .. belt.position.y
        if not seen[key] then
            seen[key] = true
            local index
            for i, other in pairs(entities) do if other == belt then index = i end end
            table.insert(tiles, {index = index, spec = {name = belt.name, position = belt.position, direction = belt.direction, force = belt.force}})
        end
    end
end
assert(#tiles > 0, "throttle inserters take from belt tiles")
local loaders = {}
for index, e in pairs(entities) do
    if e.valid and e.type == "loader" then
        table.insert(loaders, {index = index, spec = {name = e.name, position = e.position, direction = e.direction, force = e.force, type = e.loader_type}})
    end
end
assert(#loaders == 2, "two output loaders")
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "the clock")
local period = options.period
local interventions = assert(options.interventions)
local starts = game.tick + options.settle
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, tiles = #tiles,
    initial = {speed = options.speed, reach = options.reach}}
local function held(o) return o.held_stack.valid_for_read and o.held_stack.count or 0 end
local previous_clock, current = capture.clock_value(clock), nil
local previous_output, previous_export = {}, {}
for k = 1, #outputs do previous_output[k] = held(outputs[k]) end
for k = 1, #exports do previous_export[k] = held(exports[k]) end
local blocked, restored, stopped, resumed = false, false, false, false
local function cut_item(item)
    for _, e in pairs(entities) do
        if e.valid and (e.type == "transport-belt" or e.type == "underground-belt" or e.type == "splitter") then
            for lane = 1, e.get_max_transport_line_index() do
                for quality in pairs(prototypes.quality) do e.get_transport_line(lane).remove_item{name = item, quality = quality, count = 100000} end
            end
        end
    end
end
script.on_nth_tick(1, function()
    local tick = game.tick - starts
    local value = capture.clock_value(clock)
    if value < previous_clock and game.tick >= starts then
        if current then
            current["end"] = game.tick
            table.insert(report.periods, current)
        end
        current = {start = game.tick, items = 0, export = 0, start_drop = 0}
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
    for k = 1, #outputs do
        local count = held(outputs[k])
        if current and count < previous_output[k] then
            current.items = current.items + previous_output[k] - count
            if game.tick == current.start then current.start_drop = current.start_drop + previous_output[k] - count end
        end
        previous_output[k] = count
    end
    for k = 1, #exports do
        local count = held(exports[k])
        if current and count < previous_export[k] then current.export = current.export + previous_export[k] - count end
        previous_export[k] = count
    end
    previous_clock = value
    if tick >= interventions[1][1] * period and tick < interventions[1][2] * period then cut_item("plastic-bar") end
    if tick >= interventions[2][1] * period and not blocked then
        for _, l in ipairs(loaders) do entities[l.index].destroy() end
        blocked = true
        table.insert(report.events, {tick = tick, action = "block-output"})
    end
    if tick >= interventions[2][2] * period and not restored then
        for _, l in ipairs(loaders) do entities[l.index] = assert(surface.create_entity(l.spec)) end
        restored = true
        table.insert(report.events, {tick = tick, action = "restore-output"})
    end
    if tick >= interventions[2][1] * period and not stopped then
        for _, tile in ipairs(tiles) do entities[tile.index].destroy() end
        stopped = true
        table.insert(report.events, {tick = tick, action = "stop-export"})
    end
    if tick >= interventions[2][2] * period and not resumed then
        for _, tile in ipairs(tiles) do entities[tile.index] = assert(surface.create_entity(tile.spec)) end
        resumed = true
        table.insert(report.events, {tick = tick, action = "start-export"})
    end
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
