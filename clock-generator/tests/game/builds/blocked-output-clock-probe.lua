-- Run a generated clock on the chest-fed blocked-output fixture under the game tests' protocol (steady.lua). The force's belt
-- stack size is set first (as the belt-drop calibration of PR #251 does: only belt_stack_size_bonus changes, research is
-- checked unchanged). The one disturbance is the output: the loader is removed until the output falls and rebuilt at the
-- release, so the belt fills from its end back to the drop.
local entities, surface, _, settle = ...
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
local report = {events = {}, initial = {
    stack_size = force.belt_stack_size_bonus + 1, research_unchanged = true, crafting_speed = machine.crafting_speed,
    belt = output.drop_target.name, loader = loader.name}}
local block = {
    kind = "block output",
    start = function(t)
        loader.destroy()
        table.insert(report.events, {tick = t, action = "block-output"})
    end,
    release = function(t)
        loader = assert(surface.create_entity(loader_spec))
        -- the recorder reads the build after the probe: replace its stale handle
        entities[loader_index] = loader
        table.insert(report.events, {tick = t, action = "restore-output"})
    end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {block}, report = report, output = "clock-speed.json", settle = settle,
    done = function() report.initial.research_unchanged = research() == before end,
}
