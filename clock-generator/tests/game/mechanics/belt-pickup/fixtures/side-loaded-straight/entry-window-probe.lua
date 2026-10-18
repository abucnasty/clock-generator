-- Calibration only: explicitly seed transport-line positions, then observe native transfers.
-- Unlike probe.lua's naturally supplied runs, this does not measure repeated-hand throughput.
local entities, surface = ...
local sink = capture.find_one(entities, function(e) return e.name == "assembling-machine-3" end, "machine")
local input = capture.find_one(entities, function(e) return e.type == "inserter" and e.drop_target == sink end, "input")
local belt = assert(input.pickup_target)
assert(belt.name == "turbo-transport-belt" and belt.belt_shape == "straight")
assert(belt.direction == defines.direction.east)
assert(not input.held_stack.valid_for_read)
local feed = assert(surface.find_entities_filtered{position = {
    x = belt.position.x, y = belt.position.y + 1}, type = "transport-belt"}[1])
local shift = assert(options.shift, "specify the integer entry shift to test")
assert(shift >= 89 and shift <= 96 and shift % 1 == 0)

-- Stop withdrawals and natural refill; do not change any inserter's held stack.
for _, entity in pairs(entities) do
    if entity.type == "inserter" then entity.disabled_by_script = true end
    if entity.type == "transport-belt" or entity.type == "loader" then
        for index = 1, entity.get_max_transport_line_index() do entity.get_transport_line(index).clear() end
    end
end
local item = {name = "iron-plate", count = 4}
local function seed(line, positions)
    for _, position in ipairs(positions) do
        assert(line.insert_at(position / 256, item, 4), "failed to seed the requested belt position")
    end
end
seed(feed.get_transport_line(2), {0, 64, 128, 192})
if options.outerStream ~= false then seed(feed.get_transport_line(1), {0, 64, 128, 192}) end
-- Seed receiving stock last, after operations on the connected incoming lines.
-- In this setup native insertion advances receiving items by one turbo step before observation.
-- Compensate by 32 units, then assert the observed positions rather than trusting insertion coordinates.
-- Inner entry 67 collides successively with these two stacks, proposing 67 + shift.
seed(belt.get_transport_line(2), {shift - 61 + 32, shift + 3 + 32})
local function snapshot(tick)
    local sample = pickup.snapshot(input, tick)
    sample.feed = {lanes = pickup.lanes(feed)}
    return sample
end
local report = {initial = snapshot(0), samples = {}}
assert(#report.initial.lanes[2].stacks == 2, "receiving seed must contain exactly two stacks")
for index, position in ipairs({shift - 61, shift + 3}) do
    assert(report.initial.lanes[2].stacks[index].at == position / 256, "receiving seed moved before observation")
end
report.initial.seeded_positions = true
report.initial.requested_shift = shift
report.initial.outer_stream = options.outerStream ~= false
report.initial.receiving_insertion_offset = 32
capture.each_tick{
    first_tick = 1, last_tick = 4, report = report, output = "entry-window.json",
    sample = snapshot
}
