-- Observe a clock on Thaeln's cell 09 build (REAL_THAELN_CELL09), found by its description. Output is counted per clock
-- period from the drops of the output inserters of the eight assemblers making the product. The interventions are those of
-- the family (options.interventions, in periods of the clock): coal removed from every belt in the first, the two output
-- loaders removed and rebuilt in the second, processing units removed in the third. They happen only after 64 untouched periods.
local entities, surface = ...
local assemblers = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "assembling-machine-3" and e.get_recipe() and e.get_recipe().name == options.product then table.insert(assemblers, e) end
end
assert(#assemblers == 8, "eight assemblers making the product")
local outputs = {}
for _, m in ipairs(assemblers) do
    for _, e in pairs(entities) do
        if e.valid and e.type == "inserter" and e.pickup_target == m and e.drop_target and (e.drop_target.type == "transport-belt" or e.drop_target.type == "underground-belt") then table.insert(outputs, e) end
    end
end
assert(#outputs == 8, "an output inserter for each assembler")
local force = outputs[1].force
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {researched = technology.researched, level = technology.level} end
    return helpers.table_to_json(result)
end
local before = research()
local stack_before = force.belt_stack_size_bonus
force.belt_stack_size_bonus = options.stackSize - 1
assert(force.belt_stack_size_bonus == options.stackSize - 1 and research() == before)
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
local cuts = {"coal", "processing-unit"}
local starts = game.tick + options.settle
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, initial = {
    speed = options.speed, reach = options.reach, stack_size_before = stack_before + 1, stack_size = force.belt_stack_size_bonus + 1}}
local function held(o) return o.held_stack.valid_for_read and o.held_stack.count or 0 end
local previous_clock, current = capture.clock_value(clock), nil
local previous_held = {}
for k = 1, #outputs do previous_held[k] = held(outputs[k]) end
local blocked, restored = false, false
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
        current = {start = game.tick, items = 0, start_drop = 0}
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
    for k = 1, #outputs do
        local count = held(outputs[k])
        if current and count < previous_held[k] then
            current.items = current.items + previous_held[k] - count
            if game.tick == current.start then current.start_drop = current.start_drop + previous_held[k] - count end
        end
        previous_held[k] = count
    end
    previous_clock = value
    if tick >= interventions[1][1] * period and tick < interventions[1][2] * period then cut_item(cuts[1]) end
    if tick >= interventions[3][1] * period and tick < interventions[3][2] * period then cut_item(cuts[2]) end
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
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        report.initial.research_unchanged = research() == before
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
