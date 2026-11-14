-- Run a clock on the inserter build under the game tests' protocol (steady.lua): three copies on ore lines that end as the build's
-- do (past the last copy the near lane of each stops, the far lane goes on to two furnaces of the build's belt foundry), with the
-- hand-made clock or a generated one; or the sample's one copy (options.assemblers = 1), whose ore lines and circuit belts end
-- closed. The disturbances: iron ore removed from every belt until the output falls, the loaders the product lines end in removed
-- until it falls and rebuilt, circuits removed from every belt until it falls.
local entities, surface, _, settle = ...
local assemblers = {}
for _, e in pairs(entities) do
    if e.valid and e.name == "assembling-machine-3" and e.get_recipe() and e.get_recipe().name == options.item then table.insert(assemblers, e) end
end
local copies = options.assemblers or 3
assert(#assemblers == copies, copies .. " assemblers making the product")
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
local cuts = {"iron-ore", "electronic-circuit"}
-- the belt tiles the belt-fed inserters pick up from, and what their lanes hold: read at steady state and 20 ticks later
local pickups = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.pickup_target.type == "transport-belt" then table.insert(pickups, e.pickup_target) end
end
table.sort(pickups, function(a, b) if a.position.y ~= b.position.y then return a.position.y < b.position.y end return a.position.x < b.position.x end)
-- where the belt line the tile belongs to ends: closed (its last tile has nothing after it) or in something (a loader, a chest)
local ahead = {[defines.direction.north] = {0, -1}, [defines.direction.east] = {1, 0}, [defines.direction.south] = {0, 1}, [defines.direction.west] = {-1, 0}}
-- the nearest underground exit in line with an entrance, ahead of it
local function exit_of(entrance)
    local v, found, found_at = ahead[entrance.direction], nil, nil
    for _, e in pairs(entities) do
        if e.valid and e.type == "underground-belt" and e.belt_to_ground_type == "output" and e.direction == entrance.direction then
            local dx, dy = e.position.x - entrance.position.x, e.position.y - entrance.position.y
            local along = dx * v[1] + dy * v[2]
            if along > 0 and math.abs(dx * v[2]) + math.abs(dy * v[1]) < 0.01 and (found_at == nil or along < found_at) then found, found_at = e, along end
        end
    end
    return found
end
local function line_end(belt)
    local current = belt
    for tiles = 0, 400 do
        local nxt
        if current.type == "underground-belt" and current.belt_to_ground_type == "input" then nxt = exit_of(current)
        else nxt = current.belt_neighbours.outputs[1] end
        if nxt == nil then return {closed = true, tiles = tiles} end
        if nxt.type ~= "transport-belt" and nxt.type ~= "underground-belt" then return {closed = false, tiles = tiles, ends_in = nxt.name}, nxt end
        current = nxt
    end
    return {closed = false, tiles = 400, ends_in = "a line longer than 400 tiles"}
end
-- the loaders the product lines end in (the belt line each output inserter drops onto, followed to its end), by their index in
-- the build's entities
local product_loaders = {}
for _, output in ipairs(outputs) do
    local _, last = line_end(output.drop_target)
    assert(last and last.type == "loader", "the product line of each assembler ends in a loader")
    for index, e in pairs(entities) do
        if e.valid and e.unit_number == last.unit_number and not product_loaders[index] then
            product_loaders[index] = {name = e.name, position = e.position, direction = e.direction, force = e.force, type = e.loader_type}
        end
    end
end
local function read_feed()
    local out = {}
    for k, belt in ipairs(pickups) do
        local lanes = {}
        for index, lane in ipairs(pickup.lanes(belt)) do
            local items, ids = {}, {}
            for _, stack in ipairs(lane.stacks) do
                items[stack.item] = (items[stack.item] or 0) + stack.count
                table.insert(ids, stack.id .. "@" .. string.format("%.4f", stack.at))
            end
            lanes[index] = {length = lane.length, items = items, stacks = #lane.stacks, ids = table.concat(ids, ",")}
        end
        out[k] = {x = belt.position.x, y = belt.position.y, lanes = lanes, line_end = line_end(belt)}
    end
    return out
end
local started = game.tick
local report = {events = {}, initial = {
    speed = options.speed, reach = options.reach,
    stack_size = force.belt_stack_size_bonus + 1, loaders = {},
    crafting_speed = {}}}
for k, m in ipairs(assemblers) do report.initial.crafting_speed[k] = m.crafting_speed end
for _, spec in pairs(product_loaders) do table.insert(report.initial.loaders, {x = spec.position.x, y = spec.position.y}) end
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
    start = function(t)
        for index in pairs(product_loaders) do entities[index].destroy() end
        event(t, "block-output")
    end,
    -- the recorder reads the build after the probe: each rebuilt loader takes the old one's place
    release = function(t)
        for index, spec in pairs(product_loaders) do entities[index] = assert(surface.create_entity(spec)) end
        event(t, "restore-output")
    end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {cut(cuts[1]), block, cut(cuts[2])},
    report = report, output = "clock-speed.json", settle = settle,
    each_tick = function()
        local steady_at = report.protocol.steady
        if not steady_at then return end
        local t = game.tick - started
        if not report.feed then report.feed = {at_steady = read_feed()} end
        if not report.feed.later and t >= steady_at + 21 then report.feed.later = read_feed() end
    end,
    done = function() report.initial.research_unchanged = research() == before end,
}
