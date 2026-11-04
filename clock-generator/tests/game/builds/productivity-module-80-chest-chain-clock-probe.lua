-- Run a clock on the productivity module chain build (PRODUCTIVITY_MODULE_80_CHEST_CHAIN) under the game tests' protocol (steady.lua).
-- The disturbances: the coal cut (the inserter that puts it on the belt switched off and the belt emptied) until the output
-- falls, the output loader removed until it falls and rebuilt, the foundries casting iron stopped until it falls.
local entities, surface, _, settle = ...
local machines = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "assembling-machine" and e.get_recipe() and e.get_recipe().name == options.item then table.insert(machines, e) end
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
local feeders = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.pickup_target.name == "infinity-chest" and e.drop_target
        and (e.drop_target.type == "transport-belt" or e.drop_target.type == "underground-belt") then table.insert(feeders, e) end
end
assert(#feeders == 1, "one inserter from the coal chest onto the belt")
local report = {events = {}, initial = {
    speed = options.speed, reach = options.reach, stack_size_before = stack_before + 1, stack_size = force.belt_stack_size_bonus + 1}}
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end
local coal = {
    kind = "cut coal",
    start = function(t) feeders[1].disabled_by_script = true event(t, "cut-coal") end,
    tick = function()
        for _, e in pairs(entities) do
            if e.valid and (e.type == "transport-belt" or e.type == "underground-belt" or e.type == "splitter") then
                for lane = 1, e.get_max_transport_line_index() do
                    for quality in pairs(prototypes.quality) do e.get_transport_line(lane).remove_item{name = "coal", quality = quality, count = 100000} end
                end
            end
        end
    end,
    release = function(t) feeders[1].disabled_by_script = false event(t, "restore-coal") end,
}
local block = {
    kind = "block output",
    start = function(t) for _, l in ipairs(loaders) do entities[l.index].destroy() end event(t, "block-output") end,
    -- the recorder reads the build after the probe: the rebuilt loader takes the old one's place
    release = function(t) for _, l in ipairs(loaders) do entities[l.index] = assert(surface.create_entity(l.spec)) end event(t, "restore-output") end,
}
local iron = {
    kind = "stop iron foundries",
    -- the stopped foundries' made and undelivered plates go with the cut (owner, 2026-11-03)
    start = function(t)
        local removed = 0
        for _, f in ipairs(foundries) do
            f.disabled_by_script = true
            removed = removed + f.get_inventory(defines.inventory.crafter_output).remove{name = "iron-plate", count = 1000000}
        end
        table.insert(report.events, {tick = t, action = "stop-iron-foundries", removed = removed})
    end,
    release = function(t) for _, f in ipairs(foundries) do f.disabled_by_script = false end event(t, "start-iron-foundries") end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {coal, block, iron},
    report = report, output = "clock-speed.json", settle = settle,
    done = function() report.initial.research_unchanged = research() == before end,
}
