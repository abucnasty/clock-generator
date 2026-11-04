-- Run a clock on the inserter build under the game tests' protocol (steady.lua): three copies on ore lines that are drained (the
-- lines run on past the last copy into loaders and void chests), with the hand-made clock or a generated one. The disturbances:
-- iron ore removed from every belt until the output falls, the output loader nearest the assemblers' row removed until it
-- falls and rebuilt, circuits removed from every belt until it falls.
local entities, surface, _, settle = ...
local assemblers = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "assembling-machine-3" and e.get_recipe() and e.get_recipe().name == options.item then table.insert(assemblers, e) end
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
local cuts = {"iron-ore", "electronic-circuit"}
local report = {events = {}, initial = {
    speed = options.speed, reach = options.reach,
    stack_size = force.belt_stack_size_bonus + 1, loader = {x = loader.position.x, y = loader.position.y},
    crafting_speed = {assemblers[1].crafting_speed, assemblers[2].crafting_speed, assemblers[3].crafting_speed}}}
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
    start = function(t) entities[loader_index].destroy() event(t, "block-output") end,
    -- the recorder reads the build after the probe: the rebuilt loader takes the old one's place
    release = function(t) entities[loader_index] = assert(surface.create_entity(spec)) event(t, "restore-output") end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {cut(cuts[1]), block, cut(cuts[2])},
    report = report, output = "clock-speed.json", settle = settle,
    done = function() report.initial.research_unchanged = research() == before end,
}
