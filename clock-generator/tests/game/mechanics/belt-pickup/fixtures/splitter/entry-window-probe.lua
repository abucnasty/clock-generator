-- Archived research probe adapted from 7a1b4e2e7798a481ff1d76dae2a03f40c5164d8a; observation and initial seeding only.
-- Not a throughput measurement or a supported splitter model.
local entities = ...
local splitter = capture.find_one(entities, function(e) return e.type == "splitter" end, "splitter")
assert(splitter.name == (options.beltPrefix or "turbo-") .. "splitter" and splitter.direction == defines.direction.east)
assert(splitter.splitter_output_priority == "right")
for _, entity in pairs(entities) do
    if entity.type == "inserter" then entity.disabled_by_script = true end
    if entity.type == "transport-belt" or entity.type == "underground-belt"
        or entity.type == "splitter" or entity.type == "loader" then
        for index = 1, entity.get_max_transport_line_index() do entity.get_transport_line(index).clear() end
    end
end
local step = math.floor(splitter.prototype.belt_speed * 256 + 0.5)
assert(step == options.step)
for _, entity in pairs(entities) do
    if entity.type == "underground-belt" then assert(entity.underground_belt_neighbour and entity.underground_belt_neighbour.valid) end
    if entity.type == "transport-belt" or entity.type == "underground-belt" or entity.type == "splitter" or entity.type == "loader" then
        assert(entity.name == options.beltPrefix .. entity.type)
    end
end
local item = {name = "iron-plate", count = 4}
-- Native insertion materializes one pending native belt step. Compensate and assert actual starting positions.
local function seed_input()
    assert(splitter.get_transport_line(1).insert_at((options.head + step) / 256, item, 4), "could not seed input head")
    for index = 1, options.followers or 0 do
        assert(splitter.get_transport_line(1).insert_at((options.head + index * (options.distance or 64) + step) / 256, item, 4), "could not seed input follower")
    end
end
if not options.inputLast and not options.fromUpstream then seed_input() end
if options.tail then
    if options.front then
        assert(splitter.get_transport_line(7).insert_at((options.front + step) / 256, item, 4), "could not seed output front")
    end
    assert(splitter.get_transport_line(7).insert_at((options.tail + step) / 256, item, 4), "could not seed preferred output")
end
if options.inputLast and not options.fromUpstream then seed_input() end
if options.otherFull then
    for _, position in ipairs({step, 64 + step}) do
        assert(splitter.get_transport_line(8).insert_at(position / 256, {name = "copper-cable", count = 4}, 4), "could not seed other lane")
    end
end
local upstream = capture.find_one(entities, function(e)
    return e.type == "transport-belt" and e.position.x == splitter.position.x - 1
end, "upstream belt")
if options.fromUpstream or options.incoming then
    local phase = options.incoming or ((options.head + 13) % step)
    assert(upstream.get_transport_line(1).insert_at((phase + step) / 256, item, 4), "could not seed upstream head")
end
local function snapshot(tick) return {tick = tick, lines = pickup.lanes(splitter, 8),
    upstream = pickup.lanes(upstream)} end
local report = {initial = snapshot(0), samples = {}}
report.initial.seeded_positions = true
report.initial.requested_head = options.head
capture.each_tick{
    first_tick = 1, last_tick = (options.fromUpstream or options.followers or options.incoming) and 40 or 8,
    report = report, output = "splitter-entry-window.json", sample = snapshot
}
