-- Run a clock on the grenade build (one copy, or seven on one belt) under the game tests' protocol (steady.lua): the build's own
-- clock or a generated one. The disturbances: the foundries stopped and their waiting plates taken until the output falls, the output
-- loader removed until it falls and rebuilt, the drills stopped until it falls (the coal stops). The ticks each output inserter
-- waits for room on the belt are counted over the baseline.
local entities, surface, _, settle = ...
local assemblers = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "assembling-machine-3" and e.get_recipe() and e.get_recipe().name == options.item then table.insert(assemblers, e) end
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
local foundries, drills = {}, {}
for _, e in pairs(entities) do
    if e.valid and e.name == "foundry" then table.insert(foundries, e) end
    if e.valid and e.type == "mining-drill" then table.insert(drills, e) end
end
local report = {events = {}, outputs = count, baseline_waits = {}, initial = {
    stack_size = force.belt_stack_size_bonus + 1, loader = {x = loader.position.x, y = loader.position.y},
    foundries = #foundries, drills = #drills, assemblers = #assemblers,
    output_positions = {}, crafting_speed = {assemblers[1].crafting_speed, foundries[1].crafting_speed}}}
for k = 1, count do report.initial.output_positions[k] = {outputs[k].position.x, outputs[k].position.y} report.baseline_waits[k] = 0 end
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end
-- a stopped producer's made and undelivered output goes with the cut (owner, 2026-11-03): the foundries' plates waiting in
-- their output; the drills drop straight into the assemblers and hold nothing
local function stop(list, kind, stopped, started)
    return {
        kind = kind,
        start = function(t)
            local removed = 0
            for _, e in ipairs(list) do
                e.disabled_by_script = true
                if e.type ~= "mining-drill" then removed = removed + e.get_inventory(defines.inventory.crafter_output).remove{name = "iron-plate", count = 1000000} end
            end
            table.insert(report.events, {tick = t, action = stopped, removed = removed})
        end,
        release = function(t) for _, e in ipairs(list) do e.disabled_by_script = false end event(t, started) end,
    }
end
local block = {
    kind = "block output",
    start = function(t) entities[loader_index].destroy() event(t, "block-output") end,
    -- the recorder reads the build after the probe: the rebuilt loader takes the old one's place
    release = function(t) entities[loader_index] = assert(surface.create_entity(spec)) event(t, "restore-output") end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {stop(foundries, "stop foundries", "stop-foundries", "start-foundries"), block,
        stop(drills, "stop drills", "stop-drills", "start-drills")},
    report = report, output = "clock-speed.json", settle = settle,
    each_tick = function()
        local protocol = report.protocol
        if not protocol.steady or protocol.baseline then return end
        for k = 1, count do
            if outputs[k].held_stack.valid_for_read and outputs[k].status == defines.entity_status.waiting_for_space_in_destination then
                report.baseline_waits[k] = report.baseline_waits[k] + 1
            end
        end
    end,
    done = function() report.initial.research_unchanged = research() == before end,
}
