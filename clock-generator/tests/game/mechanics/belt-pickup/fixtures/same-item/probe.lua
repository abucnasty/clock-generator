-- The host composer supplies capture/pickup helpers. Keep the experimental intervention visible here.
local entities = ...
local input = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.drop_target and entity.drop_target.valid
        and entity.drop_target.name == "assembling-machine-3" and entity.pickup_target and entity.pickup_target.valid
        and (entity.pickup_target.type == "transport-belt" or entity.pickup_target.type == "underground-belt")
end, "belt-fed assembler inserter")
local belt, sink = input.pickup_target, input.drop_target
local report = {
    belt = belt.name, endpoint = belt.type == "underground-belt" and belt.belt_to_ground_type or "straight",
    stack_size = input.inserter_stack_size_override, samples = {}
}
capture.each_tick{
    first_tick = 1, last_tick = 1200, report = report, output = "same-item-pickups.json",
    sample = function(tick) return pickup.snapshot(input, tick) end,
    after_tick = function()
        -- Remove destination blocking; this measures pickup mechanics, not normal production.
        sink.get_inventory(defines.inventory.crafter_input).clear()
        sink.get_inventory(defines.inventory.crafter_output).clear()
    end
}
