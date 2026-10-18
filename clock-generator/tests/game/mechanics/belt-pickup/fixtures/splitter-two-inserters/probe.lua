-- Both original target inserters are gated during natural warm-up and released together.
-- No item seeding, held-stack editing or destination clearing; observe the operating machine.
local entities = ...
local right_mirrored = options.rightMirrored
if right_mirrored == nil then right_mirrored = true end
local sink = capture.find_one(entities, function(e) return e.name == "electromagnetic-plant" end, "plant")
local splitters, inputs, pieces = {}, {}, {}
for _, entity in pairs(entities) do
    if entity.type == "splitter" then table.insert(splitters, entity) end
    if entity.type == "inserter" and entity.drop_target == sink then table.insert(inputs, entity) end
    if entity.type == "transport-belt" or entity.type == "underground-belt" then table.insert(pieces, entity) end
end
local function left_first(a, b) return a.position.x < b.position.x end
table.sort(splitters, left_first)
table.sort(inputs, left_first)
table.sort(pieces, left_first)
assert(#splitters == 2 and #inputs == 2)
local metadata = {}
for index, input in ipairs(inputs) do
    local splitter = splitters[index]
    assert(input.pickup_target == splitter and input.drop_target == sink)
    assert(splitter.name == "turbo-splitter" and splitter.direction == defines.direction.east)
    local priority = options.outputPriorities and options.outputPriorities[index] or options.outputPriority or "right"
    assert(splitter.splitter_output_priority == priority and splitter.splitter_input_priority == "none")
    assert(not splitter.splitter_filter and not input.use_filters)
    assert(input.direction == (index == 1 and defines.direction.west or defines.direction.east))
    if index == 1 then assert(input.mirroring == (options.leftMirrored or false))
    else assert(input.mirroring == right_mirrored) end
    assert(input.pickup_position.x == splitter.position.x and input.pickup_position.y == splitter.position.y + 0.5)
    assert(not input.held_stack.valid_for_read, "targets must stay empty during gated warm-up")
    input.inserter_stack_size_override = 16
    metadata[index] = {
        target_unit = input.unit_number, splitter_unit = splitter.unit_number,
        input_position = input.position, pickup_position = input.pickup_position,
        inserter_direction = input.direction, mirrored = input.mirroring,
        splitter_position = splitter.position, splitter_direction = splitter.direction,
        input_priority = splitter.splitter_input_priority, output_priority = splitter.splitter_output_priority
    }
end
local inventory = sink.get_inventory(defines.inventory.crafter_input)
local output = sink.get_inventory(defines.inventory.crafter_output)
assert(inventory.is_empty() and output.is_empty() and sink.crafting_progress == 0)
local function snapshot(tick)
    local sample = {tick = tick, hands = {}, pieces = {}, inputs = inventory.get_contents(),
        output = output.get_contents(), crafting_progress = sink.crafting_progress, products_finished = sink.products_finished}
    for index, input in ipairs(inputs) do
        assert(input.pickup_target == splitters[index])
        sample.hands[index] = pickup.snapshot(input, tick, splitters[index].get_max_transport_line_index())
    end
    for index, piece in ipairs(pieces) do
        sample.pieces[index] = {name = piece.name, position = piece.position,
            lines = pickup.lanes(piece, piece.get_max_transport_line_index())}
    end
    return sample
end
local report = {initial = {version = script.active_mods.base, targets = metadata,
    recipe = sink.get_recipe().name, crafting_speed = sink.crafting_speed, machine_active = sink.active,
    state = snapshot(0)}, samples = {}}
for _, input in ipairs(inputs) do input.get_or_create_control_behavior().circuit_enable_disable = false end
capture.each_tick{first_tick = 1, last_tick = 120, report = report, output = "splitter-two-pickups.json", sample = snapshot}
