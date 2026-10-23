-- Observe a clock on the owner's inserter build, three copies of it on ore lines that are drained (the lines run on past
-- the last copy into loaders and void chests): the owner's own clock or a generated one, found by its description. Output
-- is counted per clock period from the drops of the three inserter assemblers' output inserters, per copy; each line's
-- flows (what its feeders put on, its takers take off) are counted by belt row. The interventions are those of the
-- family (options.interventions): iron ore removed from every belt in the first, circuits in the third, and the output
-- loader nearest the assemblers' row removed and rebuilt in the second. They happen only after 64 untouched periods.
local entities, surface = ...
local assemblers = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "assembling-machine-3" and e.get_recipe() and e.get_recipe().name == options.product then table.insert(assemblers, e) end
end
assert(#assemblers == 3, "three assemblers making the product")
table.sort(assemblers, function(a, b) return a.position.x < b.position.x end)
local outputs = {}
for k, m in ipairs(assemblers) do
    for _, e in pairs(entities) do
        if e.valid and e.type == "inserter" and e.pickup_target == m and e.drop_target and e.drop_target.type == "transport-belt" then outputs[k] = e end
    end
    assert(outputs[k], "an output inserter for each assembler")
end
local force = outputs[1].force
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {researched = technology.researched, level = technology.level} end
    return helpers.table_to_json(result)
end
local before = research()
force.belt_stack_size_bonus = options.stackSize - 1
assert(force.belt_stack_size_bonus == options.stackSize - 1 and research() == before)
local row = assemblers[1].position.y
local loader, loader_index
for index, e in pairs(entities) do
    if e.valid and e.type == "loader" and (not loader or math.abs(e.position.y - row) < math.abs(loader.position.y - row)) then
        loader, loader_index = e, index
    end
end
local spec = {name = loader.name, position = loader.position, direction = loader.direction, force = loader.force, type = loader.loader_type}
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "the clock")
local flows = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.drop_target then
        local feeder = e.pickup_target.type == "infinity-container" and e.drop_target.type == "transport-belt"
        local taker = e.pickup_target.type == "transport-belt" and (e.drop_target.type == "furnace" or e.drop_target.type == "assembling-machine")
        if feeder or taker then
            local belt = feeder and e.drop_target or e.pickup_target
            table.insert(flows, {entity = e, key = (feeder and "feed" or "take") .. "@" .. math.floor(belt.position.y), held = 0})
        end
    end
end
local period = options.period
local interventions = assert(options.interventions)
local cuts = {"iron-ore", "electronic-circuit"}
local starts = game.tick + options.settle
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, initial = {
    speed = options.speed, reach = options.reach,
    stack_size = force.belt_stack_size_bonus + 1, loader = {x = loader.position.x, y = loader.position.y},
    crafting_speed = {assemblers[1].crafting_speed, assemblers[2].crafting_speed, assemblers[3].crafting_speed}}}
local function held(o) return o.held_stack.valid_for_read and o.held_stack.count or 0 end
local previous_clock, current = capture.clock_value(clock), nil
local previous_held = {held(outputs[1]), held(outputs[2]), held(outputs[3])}
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
        -- start_drop: what was dropped in the tick the period starts, which a recording that starts there cannot see
        current = {start = game.tick, items = 0, start_drop = 0, by_output = {0, 0, 0}, flows = {}}
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
    for k = 1, 3 do
        local count = held(outputs[k])
        if current and count < previous_held[k] then
            current.items = current.items + previous_held[k] - count
            if game.tick == current.start then current.start_drop = current.start_drop + previous_held[k] - count end
            current.by_output[k] = current.by_output[k] + previous_held[k] - count
        end
        previous_held[k] = count
    end
    for _, f in ipairs(flows) do
        if f.entity.valid then
            local count = held(f.entity)
            if current and count < f.held then current.flows[f.key] = (current.flows[f.key] or 0) + f.held - count end
            f.held = count
        end
    end
    previous_clock = value
    if tick >= interventions[1][1] * period and tick < interventions[1][2] * period then cut_item(cuts[1]) end
    if tick >= interventions[3][1] * period and tick < interventions[3][2] * period then cut_item(cuts[2]) end
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
