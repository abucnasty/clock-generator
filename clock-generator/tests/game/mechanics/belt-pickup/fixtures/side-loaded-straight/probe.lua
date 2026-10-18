local entities, surface = ...
local sink = capture.find_one(entities, function(e) return e.name == "assembling-machine-3" end, "machine")
local input = capture.find_one(entities, function(e)
    return e.type == "inserter" and e.drop_target == sink
end, "input")
local belt = assert(input.pickup_target)
assert(belt.type == "transport-belt")
assert(belt.belt_shape == "straight", "pickup must remain a straight belt, not a bend")
assert(not input.held_stack.valid_for_read)
input.inserter_stack_size_override = 16
for slot = 1, input.filter_slot_count do input.set_filter(slot, nil) end
input.use_filters = false
local control = input.get_or_create_control_behavior()
local release_tick = options.releaseTick or 0
if release_tick == 0 then control.circuit_enable_disable = false end
local inventory = sink.get_inventory(defines.inventory.crafter_input)
inventory.clear()
sink.get_inventory(defines.inventory.crafter_output).clear()
assert(sink.crafting_progress == 0)
local feed = assert(surface.find_entities_filtered{position = {
    x = belt.position.x + (options.feedDx or (options.straightThrough and -1 or 0)),
    y = belt.position.y + (options.feedDy or (options.straightThrough and 0 or 1))}, type = "transport-belt"}[1])
local function feed_state()
    local lanes = {}
    for index = 1, 2 do
        local line = feed.get_transport_line(index)
        local stacks = {}
        for _, detailed in pairs(line.get_detailed_contents()) do
            table.insert(stacks, {at = detailed.position, count = detailed.stack.count, id = detailed.unique_id, item = detailed.stack.name})
        end
        lanes[index] = {count = line.get_item_count(), full = not line.can_insert_at_back(), length = line.line_length, stacks = stacks}
    end
    return {position = feed.position, lanes = lanes}
end
local report = {initial = {
    feed = feed_state(), inputs = inventory.get_contents(), output = sink.get_inventory(defines.inventory.crafter_output).get_contents(),
    input_position = input.position, belt_position = belt.position, belt_shape = belt.belt_shape,
    belt_direction = belt.direction, mirrored = input.mirroring, recipe = sink.get_recipe().name,
    crafting_speed = sink.crafting_speed, use_filters = input.use_filters
}, samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = options.lastTick or 30, report = report, output = "front-pickup.json",
    after_tick = function(tick) if tick == release_tick then control.circuit_enable_disable = false end end,
    sample = function(tick)
        local sample = pickup.snapshot(input, tick)
        sample.inputs = inventory.get_contents()
        sample.output = sink.get_inventory(defines.inventory.crafter_output).get_contents()
        sample.crafting_progress = sink.crafting_progress
        sample.feed = feed_state()
        return sample
    end
}
