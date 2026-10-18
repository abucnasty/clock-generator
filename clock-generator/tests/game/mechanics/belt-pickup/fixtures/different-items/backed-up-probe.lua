-- The host removes the ingredient drain. Filtering and destination clearing define this experiment.
local entities = ...
local wanted = assert(options.item, "backed-up probe needs an item")
local input = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.pickup_target and entity.pickup_target.valid
        and entity.drop_target and entity.drop_target.valid and entity.drop_target.name == "electromagnetic-plant"
end, "belt input inserter")
for index = 1, input.filter_slot_count do input.set_filter(index, nil) end
input.set_filter(1, wanted)
input.use_filters = true
input.inserter_filter_mode = "whitelist"
input.get_or_create_control_behavior().circuit_enable_disable = false
local belt, sink = input.pickup_target, input.drop_target
local report = {
    item = wanted, endpoint = belt.type == "underground-belt" and belt.belt_to_ground_type or "straight", samples = {}
}
capture.each_tick{
    first_tick = 101, last_tick = 1300, report = report, output = "backed-up-pickups.json",
    sample = function(tick) return pickup.snapshot(input, tick) end,
    after_tick = function()
        sink.get_inventory(defines.inventory.crafter_input).clear()
        sink.get_inventory(defines.inventory.crafter_output).clear()
    end
}
