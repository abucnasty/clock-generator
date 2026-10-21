-- Observe a generated clock on the chest-fed blocked-output fixture. The force's belt stack size is set first (as the
-- belt-drop calibration of PR #251 does: only belt_stack_size_bonus changes, research is checked unchanged); output is
-- counted per clock period from the output inserter's drops; for each intervention the output loader is removed and
-- rebuilt at its release, so the belt fills from its end back to the drop. Interventions happen only after 64 untouched
-- periods.
local entities, surface = ...
local machine = capture.find_one(entities, function(entity) return entity.name == "assembling-machine-3" end, "machine")
local input = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.drop_target == machine
end, "input")
assert(input.pickup_target and input.pickup_target.type == "infinity-container", "the input takes from a chest")
local output = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.pickup_target == machine
end, "output inserter")
assert(output.drop_target and output.drop_target.type == "transport-belt", "the output drops onto a belt")
local force = output.force
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {researched = technology.researched, level = technology.level} end
    return helpers.table_to_json(result)
end
local before = research()
force.belt_stack_size_bonus = options.stackSize - 1
assert(force.belt_stack_size_bonus == options.stackSize - 1 and research() == before)
local loader = capture.find_one(entities, function(entity) return entity.type == "loader" end, "output loader")
local loader_index
for index, entity in pairs(entities) do if entity == loader then loader_index = index end end
local loader_spec = {name = loader.name, position = loader.position, direction = loader.direction,
    force = loader.force, type = loader.loader_type}
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local period = options.period
local interventions = assert(options.interventions)
local starts = game.tick + options.settle
local report = {starts = starts, interventions = interventions, events = {}, periods = {}, initial = {
    stack_size = force.belt_stack_size_bonus + 1, research_unchanged = true, crafting_speed = machine.crafting_speed,
    belt = output.drop_target.name, loader = loader.name}}
local function held() return output.held_stack.valid_for_read and output.held_stack.count or 0 end
local previous_clock, previous_held, current = capture.clock_value(clock), held(), nil
local blocked, restored = {}, {}
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
        if tick >= intervention[1] * period and not blocked[index] then
            loader.destroy()
            blocked[index] = true
            table.insert(report.events, {tick = tick, action = "block-output"})
        end
        if tick >= intervention[2] * period and not restored[index] then
            loader = assert(surface.create_entity(loader_spec))
            -- Recorder extraction happens after these interventions during settling. Replace its stale handle.
            entities[loader_index] = loader
            restored[index] = true
            table.insert(report.events, {tick = tick, action = "restore-output"})
        end
    end
    if tick >= options.lastPeriod * period then
        script.on_nth_tick(1, nil)
        report.initial.research_unchanged = research() == before
        helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
    end
end)
