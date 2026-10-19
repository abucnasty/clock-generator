-- Seeded boundary calibration, not natural supply or throughput. Each four-tick case resets
-- transport stock only; all inserters stay disabled and their held items are never edited.
local entities, surface = ...
local sink = capture.find_one(entities, function(e) return e.type == "assembling-machine" end, "machine")
local input = capture.find_one(entities, function(e) return e.type == "inserter" and e.drop_target == sink end, "input")
local belt = assert(input.pickup_target)
local feed = assert(surface.find_entities_filtered{position = {x = belt.position.x, y = belt.position.y + 1}, type = "transport-belt"}[1])
local speed = belt.prototype.belt_speed * 256
assert(speed == options.speed, "calibration speed must match the actual prototype")
assert(belt.direction == defines.direction.east and belt.belt_shape == "straight")
for _, entity in pairs(entities) do
    if entity.type == "inserter" then entity.disabled_by_script = true end
end
local variants = {}
for _, outer in ipairs({false, true}) do
    for shift = 61, 128 do table.insert(variants, {shift = shift, outer = outer}) end
end
local function snapshot(tick)
    local sample = pickup.snapshot(input, tick)
    sample.feed = {lanes = pickup.lanes(feed)}
    return sample
end
local report = {speed = speed, cases = {}, samples = {}}
local current
local function begin(index)
    for _, entity in pairs(entities) do
        if entity.valid and (entity.type == "transport-belt" or entity.type == "loader") then
            for lane = 1, entity.get_max_transport_line_index() do entity.get_transport_line(lane).clear() end
        end
    end
    local variant = variants[index]
    local function seed(line, positions)
        for _, position in ipairs(positions) do
            assert(line.insert_at(position / 256, {name = "iron-plate", count = 4}, 4), "cannot seed calibration")
        end
    end
    seed(feed.get_transport_line(2), {0, 64, 128, 192})
    if variant.outer then seed(feed.get_transport_line(1), {0, 64, 128, 192}) end
    -- Native insertion materializes one pending movement step. Check actual positions below.
    seed(belt.get_transport_line(2), {variant.shift - 61 + speed, variant.shift + 3 + speed})
    current = {shift = variant.shift, outer = variant.outer, initial = snapshot(0), samples = {}}
    assert(#current.initial.lanes[2].stacks == 2)
    for lane, position in ipairs({variant.shift - 61, variant.shift + 3}) do
        assert(current.initial.lanes[2].stacks[lane].at == position / 256, "incorrect receiving seed")
    end
    for lane, positions in ipairs(current.initial.feed.lanes) do
        assert(#positions.stacks == (lane == 1 and not variant.outer and 0 or 4))
        for slot, stack in ipairs(positions.stacks) do assert(stack.at == (slot - 1) / 4) end
    end
    table.insert(report.cases, current)
end
begin(1)
capture.each_tick{
    first_tick = 1, last_tick = #variants * 4, report = report, output = "entry-sweep.json",
    sample = function(tick)
        local value = snapshot((tick - 1) % 4 + 1)
        table.insert(current.samples, value)
        return {tick = tick}
    end,
    after_tick = function(tick)
        if tick % 4 == 0 and tick < #variants * 4 then begin(tick / 4 + 1) end
    end
}
