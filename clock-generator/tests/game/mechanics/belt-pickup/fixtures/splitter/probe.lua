-- Supplied layout with explicit ingredient/mirroring controls; only the target is gated during warm-up.
-- Observe first-hand collection and operating continuation without seeding, held-stack edits or destination clearing.
local entities = ...
local sink = capture.find_one(entities, function(e) return e.name == "electromagnetic-plant" end, "plant")
local splitter = capture.find_one(entities, function(e) return e.type == "splitter" end, "splitter")
local input = capture.find_one(entities, function(e)
    return e.type == "inserter" and e.pickup_target == splitter
end, "direct splitter pickup")
local upstream = capture.find_one(entities, function(e)
    return e.type == "transport-belt" and e.position.x == splitter.position.x - 1
        and e.position.y == splitter.position.y - 0.5
end, "upstream belt")
local downstream = capture.find_one(entities, function(e)
    return e.type == "underground-belt" and e.belt_to_ground_type == "input"
end, "drained north output")
assert(splitter.splitter_output_priority == (options.outputPriority or "right"))
assert(splitter.name == "turbo-splitter" and splitter.direction == defines.direction.east)
assert(input.direction == defines.direction.west and input.mirroring == (options.mirrored or false))
assert(input.pickup_position.x == splitter.position.x and input.pickup_position.y == splitter.position.y + 0.5)
assert(not input.held_stack.valid_for_read, "target must remain gated and empty during warm-up")
assert(not input.use_filters)
input.inserter_stack_size_override = 16
local inventory = sink.get_inventory(defines.inventory.crafter_input)
local output = sink.get_inventory(defines.inventory.crafter_output)
assert(inventory.is_empty() and output.is_empty() and sink.crafting_progress == 0,
    "machine must stay empty during gated warm-up: " .. helpers.table_to_json({inputs = inventory.get_contents(),
        output = output.get_contents(), progress = sink.crafting_progress}))
local drain = {}
for _, entity in pairs(entities) do
    if entity.type == "loader" and entity.loader_type == "input" then table.insert(drain, entity) end
end
assert(#drain == (options.blockedDrain and 0 or 1))
local function lines() return pickup.lanes(splitter, splitter.get_max_transport_line_index()) end
local report = {initial = {
    drain_present = #drain > 0, version = script.active_mods.base, splitter_name = splitter.name, splitter_position = splitter.position,
    splitter_direction = splitter.direction, input_priority = splitter.splitter_input_priority,
    output_priority = splitter.splitter_output_priority, filter = splitter.splitter_filter,
    input_position = input.position, pickup_position = input.pickup_position,
    inserter_direction = input.direction, mirrored = input.mirroring,
    recipe = sink.get_recipe().name, crafting_speed = sink.crafting_speed, machine_active = sink.active,
    use_filters = input.use_filters, lines = lines(), upstream = pickup.lanes(upstream), downstream = pickup.lanes(downstream)
}, samples = {}}
input.get_or_create_control_behavior().circuit_enable_disable = false
capture.each_tick{
    first_tick = 1, last_tick = 60, report = report, output = "splitter-pickup.json",
    sample = function(tick)
        assert(input.pickup_target == splitter)
        return {
            tick = tick, held = input.held_stack.valid_for_read and input.held_stack.count or 0,
            held_item = input.held_stack.valid_for_read and input.held_stack.name or nil,
            hand = input.held_stack_position, lines = lines(),
            upstream = pickup.lanes(upstream), downstream = pickup.lanes(downstream),
            inputs = inventory.get_contents(), output = output.get_contents(), crafting_progress = sink.crafting_progress
        }
    end
}
