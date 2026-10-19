-- User scaffold: eastbound entrance, input inserter east of it.
-- Staged startup fills both lanes before placing a fresh, empty input inserter.
local entities, surface = ...
local mirrored = options.mirrored
if mirrored == nil then mirrored = false end -- The supplied scaffold is unmirrored.
local sink = capture.find_one(entities, function(e) return e.name == (options.compact_destination and "assembling-machine-3" or "electromagnetic-plant") end, "plant")
local input = capture.find_one(entities, function(e)
    return e.type == "inserter" and math.abs(e.position.y - sink.position.y + (options.compact_destination and 0 or 0.5)) < 0.01
        and math.abs(e.position.x - sink.position.x + (options.compact_destination and 2 or 2.5)) < 0.01
end, "plant input")
local belt = assert(surface.find_entities_filtered{position = input.pickup_position, type = "underground-belt"}[1])
assert(belt.belt_to_ground_type == "input" and belt.direction == defines.direction.east)
assert(input.mirroring == mirrored and input.direction == defines.direction.west)
assert(input.position.x == belt.position.x + 1 and input.position.y == belt.position.y)
if options.require_pair then assert(belt.underground_belt_neighbour and belt.underground_belt_neighbour.valid, "pickup endpoint must be paired") end
if options.speed then assert(belt.prototype.belt_speed == options.speed, "unexpected pickup belt speed") end
assert(not input.held_stack.valid_for_read, "staged input must start empty")
input.inserter_stack_size_override = 16
for slot = 1, input.filter_slot_count do input.set_filter(slot, nil) end
input.use_filters = false
input.get_or_create_control_behavior().circuit_enable_disable = false
local release_delay = options.release_delay or 0
assert(release_delay >= 0 and release_delay <= 8)
local control = input.get_or_create_control_behavior()
control.circuit_condition = {condition = {first_signal = {type = "virtual", name = "signal-Z"}, comparator = "<", constant = 0}}
control.circuit_enable_disable = release_delay > 0
local inventory = sink.get_inventory(defines.inventory.crafter_input)
inventory.clear()
sink.get_inventory(defines.inventory.crafter_output).clear()
assert(sink.crafting_progress == 0)
local report = {initial = {
    inputs = inventory.get_contents(), output = sink.get_inventory(defines.inventory.crafter_output).get_contents(),
    machine_active = sink.active, crafting_speed = sink.crafting_speed, recipe = sink.get_recipe().name,
    input_position = input.position, pickup_position = input.pickup_position, belt_position = belt.position,
    belt_direction = belt.direction, endpoint = belt.belt_to_ground_type, mirrored = input.mirroring,
    belt_name = belt.name, belt_speed = belt.prototype.belt_speed, release_delay = release_delay,
    neighbour = belt.underground_belt_neighbour and {name = belt.underground_belt_neighbour.name, position = belt.underground_belt_neighbour.position} or nil,
    inserter_direction = input.direction, use_filters = input.use_filters
}, samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = 30, report = report, output = "front-pickup.json",
    sample = function(tick)
        -- A newly placed inserter resolves pickup_target on its first game tick.
        if input.pickup_target then assert(input.pickup_target == belt, "unexpected pickup target") end
        local held = input.held_stack
        local sample = {tick = tick, held = held.valid_for_read and held.count or 0,
            held_item = held.valid_for_read and held.name or nil, hand = input.held_stack_position,
            lanes = pickup.lanes(belt), enabled = not control.circuit_enable_disable, circuit_disabled = control.disabled, status = input.status}
        sample.transport_lines = pickup.lanes(belt, belt.get_max_transport_line_index())
        if belt.underground_belt_neighbour then sample.neighbour_lines = pickup.lanes(belt.underground_belt_neighbour, belt.underground_belt_neighbour.get_max_transport_line_index()) end
        sample.inputs = inventory.get_contents()
        sample.output = sink.get_inventory(defines.inventory.crafter_output).get_contents()
        sample.crafting_progress = sink.crafting_progress
        return sample
    end,
    after_tick = function(tick)
        -- Only the measured inserter is gated; source stock and feeders remain untouched.
        if release_delay > 0 and tick == release_delay then control.circuit_enable_disable = false end
    end
}
