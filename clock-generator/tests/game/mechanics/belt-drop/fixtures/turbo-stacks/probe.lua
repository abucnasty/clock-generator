-- Two natural full hands from a seeded chest (15 items at stack size 3, otherwise 16). Never edit the hand. Optional occupied-output controls seed transport stock once.
local entities = ...
local input = capture.find_one(entities, function(e) return e.type == "inserter" end, "drop inserter")
local source, sink = input.pickup_target, capture.find_one(entities, function(e)
    return e.type == "container" and e ~= input.pickup_target
end, "receiving chest")
assert(source and source.type == "infinity-container" and input.drop_target.type == "transport-belt")
assert(input.direction == defines.direction.north and input.quality.name == "legendary")
assert(not input.held_stack.valid_for_read)
local force = input.force
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {researched = technology.researched, level = technology.level} end
    return helpers.table_to_json(result)
end
local before = research()
force.belt_stack_size_bonus = options.stackSize - 1
assert(force.belt_stack_size_bonus == options.stackSize - 1 and research() == before)
input.inserter_stack_size_override = 16
assert(source.get_inventory(defines.inventory.chest).is_empty() and sink.get_inventory(defines.inventory.chest).is_empty())
assert(source.insert{name = "iron-plate", count = 32} == 32)
local pieces = {}
for _, entity in pairs(entities) do
    if entity.type == "transport-belt" or entity.type == "loader" then table.insert(pieces, entity) end
end
table.sort(pieces, function(a,b) return a.position.x < b.position.x end)
assert(#pieces == 4)
local function snapshot(tick)
    local sample = {tick = tick, held = input.held_stack.valid_for_read and input.held_stack.count or 0,
        source = source.get_item_count("iron-plate"), sink = sink.get_item_count("iron-plate"),
        seeded_sink = options.seedPosition and sink.get_item_count("copper-plate") or nil, pieces = {}}
    for index, piece in ipairs(pieces) do
        sample.pieces[index] = {name = piece.name, lines = pickup.lanes(piece, piece.get_max_transport_line_index())}
    end
    return sample
end
for _, piece in ipairs(pieces) do
    assert(piece.name == (options.beltPrefix or "turbo-") .. (piece.type == "loader" and "loader" or "transport-belt"))
end
local ticks = options.ticks or 120
local report = {initial = {version = script.active_mods.base, stack_size = force.belt_stack_size_bonus + 1,
    hand_capacity = input.inserter_stack_size_override, research_unchanged = research() == before, state = snapshot(0)}, samples = {}}
input.get_or_create_control_behavior().circuit_enable_disable = false
capture.each_tick{first_tick = 1, last_tick = ticks, report = report, output = "belt-drop-stacks.json", sample = snapshot,
    after_tick = function(tick)
        if tick == 5 and options.seedPosition then
            assert(input.held_stack.valid_for_read and input.held_stack.count == 16, "seed before the first natural drop")
            assert(input.drop_target == pieces[1], "seed the receiving tile")
            assert(pieces[1].get_transport_line(2).insert_at(options.seedPosition / 256,
                {name = "copper-plate", count = options.stackSize}, options.stackSize), "could not seed occupied output")
            -- Retain actual post-insertion stock; a requested coordinate is not proof of native phase.
            report.seed = {tick = tick, requested_position = options.seedPosition, state = snapshot(tick)}
        end
        if tick == ticks then assert(research() == before) end
    end}
