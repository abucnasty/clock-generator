-- Run a clock on the utility science 480 build build (UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN) under the game tests' protocol (steady.lua). The disturbances: coal
-- removed from every belt until the output falls, the two output loaders removed until it falls and rebuilt, processing units
-- removed from every belt until it falls.
local entities, surface, _, settle = ...
local assemblers = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "assembling-machine-3" and e.get_recipe() and e.get_recipe().name == options.item then table.insert(assemblers, e) end
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
local cuts = {"coal", "processing-unit"}
local report = {events = {}, initial = {
    speed = options.speed, reach = options.reach, stack_size_before = stack_before + 1, stack_size = force.belt_stack_size_bonus + 1}}
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end
local function cut(item)
    return {
        kind = "cut " .. item,
        start = function(t) event(t, "cut " .. item) end,
        tick = function()
            for _, e in pairs(entities) do
                if e.valid and (e.type == "transport-belt" or e.type == "underground-belt" or e.type == "splitter") then
                    for lane = 1, e.get_max_transport_line_index() do
                        for quality in pairs(prototypes.quality) do e.get_transport_line(lane).remove_item{name = item, quality = quality, count = 100000} end
                    end
                end
            end
        end,
        release = function(t) event(t, "restore " .. item) end,
    }
end
local block = {
    kind = "block output",
    start = function(t) for _, l in ipairs(loaders) do entities[l.index].destroy() end event(t, "block-output") end,
    -- the recorder reads the build after the probe: the rebuilt loaders take the old ones' places
    release = function(t) for _, l in ipairs(loaders) do entities[l.index] = assert(surface.create_entity(l.spec)) end event(t, "restore-output") end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {cut(cuts[1]), block, cut(cuts[2])},
    report = report, output = "clock-speed.json", settle = settle,
    done = function() report.initial.research_unchanged = research() == before end,
}
