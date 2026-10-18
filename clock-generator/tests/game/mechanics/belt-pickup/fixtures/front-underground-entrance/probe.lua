-- User scaffold: eastbound entrance, input inserter east of it.
-- Staged startup fills both lanes before placing a fresh, empty input inserter.
local entities, surface = ...
local mirrored = options.mirrored
if mirrored == nil then mirrored = false end -- The supplied scaffold is unmirrored.
local sink = capture.find_one(entities, function(e) return e.name == "electromagnetic-plant" end, "plant")
local input = capture.find_one(entities, function(e)
    return e.type == "inserter" and math.abs(e.position.y - sink.position.y + 0.5) < 0.01
        and math.abs(e.position.x - sink.position.x + 2.5) < 0.01
end, "plant input")
local belt = assert(surface.find_entities_filtered{position = input.pickup_position, type = "underground-belt"}[1])
assert(belt.belt_to_ground_type == "input" and belt.direction == defines.direction.east)
assert(input.mirroring == mirrored and input.direction == defines.direction.west)
assert(input.position.x == belt.position.x + 1 and input.position.y == belt.position.y)
assert(not input.held_stack.valid_for_read, "staged input must start empty")
input.inserter_stack_size_override = 16
for slot = 1, input.filter_slot_count do input.set_filter(slot, nil) end
input.use_filters = false
input.get_or_create_control_behavior().circuit_enable_disable = false
local inventory = sink.get_inventory(defines.inventory.crafter_input)
inventory.clear()
sink.get_inventory(defines.inventory.crafter_output).clear()
assert(sink.crafting_progress == 0)
local report = {initial = {
    inputs = inventory.get_contents(), output = sink.get_inventory(defines.inventory.crafter_output).get_contents(),
    machine_active = sink.active, crafting_speed = sink.crafting_speed, recipe = sink.get_recipe().name,
    input_position = input.position, pickup_position = input.pickup_position, belt_position = belt.position,
    belt_direction = belt.direction, endpoint = belt.belt_to_ground_type, mirrored = input.mirroring,
    inserter_direction = input.direction, use_filters = input.use_filters
}, samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = 30, report = report, output = "front-pickup.json",
    sample = function(tick)
        -- A newly placed inserter resolves pickup_target on its first game tick.
        assert(input.pickup_target == belt, "unexpected pickup target")
        local sample = pickup.snapshot(input, tick)
        sample.inputs = inventory.get_contents()
        sample.output = sink.get_inventory(defines.inventory.crafter_output).get_contents()
        sample.crafting_progress = sink.crafting_progress
        return sample
    end
}
