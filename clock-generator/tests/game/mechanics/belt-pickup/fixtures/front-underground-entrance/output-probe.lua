-- Natural compact-cell operation: supplied ingredients craft circuits, and the output inserter deposits them.
-- No items are inserted into inventories/hands and no destination inventories are cleared.
local entities, surface = ...
local machine = capture.find_one(entities, function(e) return e.name == "assembling-machine-3" end, "compact assembler")
local input = capture.find_one(entities, function(e) return e.type == "inserter"
    and e.position.x == machine.position.x - 2 and e.position.y == machine.position.y end, "compact input")
local output = capture.find_one(entities, function(e) return e.type == "inserter"
    and e.position.x == machine.position.x + 1 and e.position.y == machine.position.y - 2 end, "compact output")
for _, inserter in ipairs{input, output} do
    inserter.get_or_create_control_behavior().circuit_enable_disable = false
    inserter.use_filters = false
end
local belt = assert(surface.find_entities_filtered{position = output.drop_position, type = "transport-belt"}[1])
assert(belt.direction == defines.direction.east and belt.prototype.belt_speed == options.speed)
local next_belt = assert(surface.find_entities_filtered{position = {belt.position.x + 1, belt.position.y}, type = "transport-belt"}[1])
assert(next_belt.direction == defines.direction.east and next_belt.prototype.belt_speed == options.speed)
local report = {machine = machine.name, recipe = machine.get_recipe().name, speed = belt.prototype.belt_speed,
    output_position = output.position, pickup_position = output.pickup_position, drop_position = output.drop_position, samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = 600, report = report, output = "compact-output.json",
    sample = function(tick)
        assert(output.pickup_target == machine, "compact output pickup must resolve to assembler")
        assert(output.drop_target == belt, "compact output drop must resolve to bridge belt")
        local held = output.held_stack
        return {tick = tick, products = machine.products_finished,
            held = held.valid_for_read and held.count or 0, held_item = held.valid_for_read and held.name or nil,
            drop_lanes = pickup.lanes(belt), downstream_lanes = pickup.lanes(next_belt)}
    end
}
