-- The host removes the ingredient drain. Filtering and destination clearing define this experiment.
local entities, surface = ...
local wanted = assert(options.item, "backed-up probe needs an item")
local plant = capture.find_one(entities, function(entity) return entity.name == "electromagnetic-plant" end, "plant")
local input = capture.find_one(entities, function(entity)
    if options.gated then return entity.type == "inserter"
        and entity.position.x == plant.position.x - 1.5 and entity.position.y == plant.position.y + 2.5 end
    return entity.type == "inserter" and entity.pickup_target and entity.pickup_target.valid
        and entity.drop_target and entity.drop_target.valid and entity.drop_target.name == "electromagnetic-plant"
end, "belt input inserter")
for index = 1, input.filter_slot_count do input.set_filter(index, nil) end
input.set_filter(1, wanted)
input.use_filters = true
input.inserter_filter_mode = "whitelist"
input.get_or_create_control_behavior().circuit_enable_disable = false
if options.gated then
    assert(not input.held_stack.valid_for_read, "staged input must start empty")
    local control = input.get_or_create_control_behavior()
    control.circuit_condition = {condition = {first_signal = {type = "virtual", name = "signal-Z"}, comparator = "<", constant = 0}}
    control.circuit_enable_disable = true
end
local belt = input.pickup_target or surface.find_entities_filtered{position = input.pickup_position,
    type = {"transport-belt", "underground-belt"}}[1]
local sink = plant
local report = {
    item = wanted, belt = belt.name, belt_speed = belt.prototype.belt_speed, stack_size = 16,
    endpoint = belt.type == "underground-belt" and belt.belt_to_ground_type or "straight", samples = {}
}
capture.each_tick{
    first_tick = options.gated and 1 or 101, last_tick = 1300, report = report, output = "backed-up-pickups.json",
    sample = function(tick) return pickup.snapshot(input, tick) end,
    after_tick = function(tick)
        if options.gated and tick == 64 then input.get_or_create_control_behavior().circuit_enable_disable = false end
        sink.get_inventory(defines.inventory.crafter_input).clear()
        sink.get_inventory(defines.inventory.crafter_output).clear()
    end
}
