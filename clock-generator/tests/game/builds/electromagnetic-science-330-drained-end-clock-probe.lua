-- Run a clock on the drained-end scaffold of ELECTROMAGNETIC_SCIENCE_330 (one plant; its input line of accumulators and supercapacitors
-- runs past the plant into a loader and a void chest, so it moves) under the game tests' protocol (steady.lua), with no disturbance: steady
-- state and the baseline. What the belt-fed inserter picks up from is read at steady state and 20 ticks later (report.feed): the lanes'
-- stacks and their places, and where the belt line ends.
local entities, surface, _, settle = ...
local plants = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "assembling-machine" and e.get_recipe() and e.get_recipe().name == options.item then table.insert(plants, e) end
end
assert(#plants == 1, "one plant making the product")
local force = plants[1].force
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {researched = technology.researched, level = technology.level} end
    return helpers.table_to_json(result)
end
local before = research()
force.belt_stack_size_bonus = options.stackSize - 1
assert(force.belt_stack_size_bonus == options.stackSize - 1 and research() == before)
local pickups = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.pickup_target.type == "transport-belt" then table.insert(pickups, e.pickup_target) end
end
assert(#pickups == 1, "one inserter that takes from a belt")
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
        if nxt.type ~= "transport-belt" and nxt.type ~= "underground-belt" then return {closed = false, tiles = tiles, ends_in = nxt.name} end
        current = nxt
    end
    return {closed = false, tiles = 400, ends_in = "a line longer than 400 tiles"}
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
local report = {events = {}, initial = {speed = options.speed, reach = options.reach, stack_size = force.belt_stack_size_bonus + 1,
    crafting_speed = plants[1].crafting_speed}}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {},
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
