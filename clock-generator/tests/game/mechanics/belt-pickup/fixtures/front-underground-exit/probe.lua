-- Northbound exit, input inserter north of it; the host selects the expected mirroring.
-- Staged startup fills both lanes before placing a fresh, empty input inserter.
local entities, surface = ...
local mirrored = options.mirrored
if mirrored == nil then mirrored = true end -- The base scaffold is mirrored.
local sink = capture.find_one(entities, function(e) return e.name == (options.compact_destination and "assembling-machine-3" or "electromagnetic-plant") end, "plant")
local input = capture.find_one(entities, function(e)
    return e.type == "inserter" and math.abs(e.position.y - sink.position.y - 2.5) < 0.01
        and math.abs(e.position.x - sink.position.x + 1.5) < 0.01
end, "plant input")
local belt = assert(surface.find_entities_filtered{position = input.pickup_position, type = "underground-belt"}[1])
assert(belt.belt_to_ground_type == "output" and belt.direction == defines.direction.north)
assert(input.mirroring == mirrored and input.direction == defines.direction.south)
assert(input.position.x == belt.position.x and input.position.y == belt.position.y - 1)
if options.require_pair then assert(belt.underground_belt_neighbour and belt.underground_belt_neighbour.valid, "pickup endpoint must be paired") end
if options.speed then assert(belt.prototype.belt_speed == options.speed, "unexpected pickup belt speed") end
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
    belt_name = belt.name, belt_speed = belt.prototype.belt_speed,
    neighbour = belt.underground_belt_neighbour and {name = belt.underground_belt_neighbour.name, position = belt.underground_belt_neighbour.position} or nil,
    inserter_direction = input.direction, use_filters = input.use_filters
}, samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = 30, report = report, output = "front-pickup.json",
    sample = function(tick)
        -- A newly placed inserter resolves pickup_target on its first game tick.
        assert(input.pickup_target == belt, "unexpected pickup target")
        local sample = pickup.snapshot(input, tick)
        sample.transport_lines = pickup.lanes(belt, belt.get_max_transport_line_index())
        if belt.underground_belt_neighbour then sample.neighbour_lines = pickup.lanes(belt.underground_belt_neighbour, belt.underground_belt_neighbour.get_max_transport_line_index()) end
        sample.inputs = inventory.get_contents()
        sample.output = sink.get_inventory(defines.inventory.crafter_output).get_contents()
        sample.crafting_progress = sink.crafting_progress
        return sample
    end
}
