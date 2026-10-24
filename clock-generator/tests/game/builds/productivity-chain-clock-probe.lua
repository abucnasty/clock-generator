-- Observe a clock on the productivity module chain build (REAL_OWNER_PRODUCTIVITY_CHAIN), found by its description. Output is
-- counted per clock period from the drops of the output inserter of the machine making the product. The interventions are
-- (options.interventions, in periods of the clock): the coal removed from the belt in the first, the output loader removed and
-- rebuilt in the second, the foundries casting iron stopped in the third. They happen only after 64 untouched periods.
local entities, surface = ...
local machines = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "assembling-machine" and e.get_recipe() and e.get_recipe().name == options.product then table.insert(machines, e) end
end
assert(#machines == 1, "one machine making the product")
local outputs = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target == machines[1] and e.drop_target and (e.drop_target.type == "transport-belt" or e.drop_target.type == "underground-belt") then table.insert(outputs, e) end
end
assert(#outputs == 1, "one output inserter")
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
assert(#loaders == 1, "one output loader")
local foundries = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "foundry" and e.get_recipe() and e.get_recipe().name == "casting-iron" then table.insert(foundries, e) end
end
assert(#foundries == 2, "two foundries casting iron")
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "the clock")
local period = options.period
local interventions = assert(options.interventions)
local starts = game.tick + options.settle
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, initial = {
    speed = options.speed, reach = options.reach, stack_size_before = stack_before + 1, stack_size = force.belt_stack_size_bonus + 1}}
local function held(o) return o.held_stack.valid_for_read and o.held_stack.count or 0 end
local previous_clock, current = capture.clock_value(clock), nil
local previous_held = held(outputs[1])
local blocked, restored, iron_cut, iron_restored, coal_cut, coal_restored = false, false, false, false, false, false
local feeders = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.pickup_target.name == "infinity-chest" and e.drop_target
        and (e.drop_target.type == "transport-belt" or e.drop_target.type == "underground-belt") then table.insert(feeders, e) end
end
assert(#feeders == 1, "one inserter from the coal chest onto the belt")
local function cut_coal()
    feeders[1].disabled_by_script = true
    for _, e in pairs(entities) do
        if e.valid and (e.type == "transport-belt" or e.type == "underground-belt" or e.type == "splitter") then
            for lane = 1, e.get_max_transport_line_index() do
                for quality in pairs(prototypes.quality) do e.get_transport_line(lane).remove_item{name = "coal", quality = quality, count = 100000} end
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
    local count = held(outputs[1])
    if current and count < previous_held then
        current.items = current.items + previous_held - count
        if game.tick == current.start then current.start_drop = current.start_drop + previous_held - count end
    end
    previous_held = count
    previous_clock = value
    if tick >= interventions[1][1] * period and tick < interventions[1][2] * period then
        if not coal_cut then coal_cut = true; table.insert(report.events, {tick = tick, action = "cut-coal"}) end
        cut_coal()
    elseif coal_cut and tick >= interventions[1][2] * period and not coal_restored then
        feeders[1].disabled_by_script = false
        coal_restored = true
        table.insert(report.events, {tick = tick, action = "restore-coal"})
    end
    if tick >= interventions[3][1] * period and tick < interventions[3][2] * period then
        if not iron_cut then iron_cut = true; table.insert(report.events, {tick = tick, action = "stop-iron-foundries"}) end
        for _, f in ipairs(foundries) do f.disabled_by_script = true end
    elseif iron_cut and tick >= interventions[3][2] * period and not iron_restored then
        for _, f in ipairs(foundries) do f.disabled_by_script = false end
        iron_restored = true
        table.insert(report.events, {tick = tick, action = "start-iron-foundries"})
    end
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
