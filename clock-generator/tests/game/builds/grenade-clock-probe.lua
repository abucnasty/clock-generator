-- Observe a clock on the owner's grenade build (one copy, or seven on one belt): the build's own clock or a generated one, found by
-- its description. Output is counted per clock period from the drops of the output inserters of the assemblers making the
-- product, and per output; the ticks an output inserter waits for room on the belt are counted too. Interventions
-- (options.interventions, in periods of the clock): the foundries stopped in the first (the iron plates stop), the output
-- loader removed and rebuilt in the second, the drills stopped in the third (the coal stops). Only after 64 untouched periods.
-- options.trace: periods whose every tick is logged for the output inserters (changes of the hand).
local entities, surface = ...
local assemblers = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "assembling-machine-3" and e.get_recipe() and e.get_recipe().name == options.product then table.insert(assemblers, e) end
end
table.sort(assemblers, function(a, b) if a.position.x ~= b.position.x then return a.position.x < b.position.x end return a.position.y < b.position.y end)
local outputs = {}
for k, m in ipairs(assemblers) do
    for _, e in pairs(entities) do
        if e.valid and e.type == "inserter" and e.pickup_target == m and e.drop_target and e.drop_target.type == "transport-belt" then outputs[k] = e end
    end
    assert(outputs[k], "an output inserter for each assembler")
end
local count = #outputs
local force = outputs[1].force
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {researched = technology.researched, level = technology.level} end
    return helpers.table_to_json(result)
end
local before = research()
force.belt_stack_size_bonus = options.stackSize - 1
assert(force.belt_stack_size_bonus == options.stackSize - 1 and research() == before)
local loader, loader_index
for index, e in pairs(entities) do
    if e.valid and e.type == "loader" then
        assert(not loader, "one output loader")
        loader, loader_index = e, index
    end
end
local spec = {name = loader.name, position = loader.position, direction = loader.direction, force = loader.force, type = loader.loader_type}
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "the clock")
local foundries, drills = {}, {}
for _, e in pairs(entities) do
    if e.valid and e.name == "foundry" then table.insert(foundries, e) end
    if e.valid and e.type == "mining-drill" then table.insert(drills, e) end
end
local period = options.period
local interventions = assert(options.interventions)
local starts = game.tick + options.settle
local traced = {}
for _, p in ipairs(options.trace_periods or {}) do traced[p] = true end
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, trace = {}, outputs = count, initial = {
    stack_size = force.belt_stack_size_bonus + 1, loader = {x = loader.position.x, y = loader.position.y},
    foundries = #foundries, drills = #drills, assemblers = #assemblers,
    output_positions = {}, crafting_speed = {assemblers[1].crafting_speed, foundries[1].crafting_speed}}}
for k = 1, count do report.initial.output_positions[k] = {outputs[k].position.x, outputs[k].position.y} end
local function held(o) return o.held_stack.valid_for_read and o.held_stack.count or 0 end
local previous_clock, current, period_index = capture.clock_value(clock), nil, 0
local previous_held = {}
for k = 1, count do previous_held[k] = held(outputs[k]) end
local blocked, restored, iron_cut, coal_cut = false, false, false, false
local function zeros() local z = {} for k = 1, count do z[k] = 0 end return z end
script.on_nth_tick(1, function()
    local tick = game.tick - starts
    local value = capture.clock_value(clock)
    if value < previous_clock and game.tick >= starts then
        if current then
            current["end"] = game.tick
            table.insert(report.periods, current)
        end
        period_index = period_index + 1
        current = {start = game.tick, items = 0, start_drop = 0, by_output = zeros(), waits = zeros()}
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
    for k = 1, count do
        local n = held(outputs[k])
        if current and n < previous_held[k] then
            current.items = current.items + previous_held[k] - n
            if game.tick == current.start then current.start_drop = current.start_drop + previous_held[k] - n end
            current.by_output[k] = current.by_output[k] + previous_held[k] - n
        end
        if current and n > 0 and outputs[k].status == defines.entity_status.waiting_for_space_in_destination then
            current.waits[k] = current.waits[k] + 1
        end
        if current and traced[period_index] and n ~= previous_held[k] then
            table.insert(report.trace, {period = period_index, tick = game.tick - current.start, output = k, held = n, clock = value})
        end
        previous_held[k] = n
    end
    previous_clock = value
    if current and traced[period_index] and game.tick - current.start == 60 and not report.belt then
        report.belt = {}
        for _, e in pairs(entities) do
            if e.valid and e.type == "transport-belt" then
                table.insert(report.belt, {x = e.position.x, y = e.position.y, d = e.direction, lines = {e.get_transport_line(1).get_item_count(), e.get_transport_line(2).get_item_count()}})
            end
        end
    end
    if tick >= interventions[1][1] * period and tick < interventions[1][2] * period then
        if not iron_cut then iron_cut = true; table.insert(report.events, {tick = tick, action = "stop-foundries"}) end
        for _, f in ipairs(foundries) do f.disabled_by_script = true end
    elseif iron_cut and tick >= interventions[1][2] * period and not report.iron_restored then
        for _, f in ipairs(foundries) do f.disabled_by_script = false end
        report.iron_restored = true
        table.insert(report.events, {tick = tick, action = "start-foundries"})
    end
    if tick >= interventions[3][1] * period and tick < interventions[3][2] * period then
        if not coal_cut then coal_cut = true; table.insert(report.events, {tick = tick, action = "stop-drills"}) end
        for _, d in ipairs(drills) do d.disabled_by_script = true end
    elseif coal_cut and tick >= interventions[3][2] * period and not report.coal_restored then
        for _, d in ipairs(drills) do d.disabled_by_script = false end
        report.coal_restored = true
        table.insert(report.events, {tick = tick, action = "start-drills"})
    end
    if tick >= interventions[2][1] * period and not blocked then
        entities[loader_index].destroy(); blocked = true
        table.insert(report.events, {tick = tick, action = "block-output"})
    end
    if tick >= interventions[2][2] * period and not restored then
        entities[loader_index] = assert(surface.create_entity(spec)); restored = true
        table.insert(report.events, {tick = tick, action = "restore-output"})
    end
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        report.initial.research_unchanged = research() == before
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
