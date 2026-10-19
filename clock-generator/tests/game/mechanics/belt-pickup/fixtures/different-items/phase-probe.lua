-- Release-phase control: keep both lanes supplied and alter only the target's gate release tick.
-- The shared snapshots observe native transport stock and hand position; no held items or belt stock are edited.
local entities, surface = ...
local plant = capture.find_one(entities, function(e) return e.name == "electromagnetic-plant" end, "plant")
local input = capture.find_one(entities, function(e) return e.type == "inserter"
    and e.position.x == plant.position.x - 1.5 and e.position.y == plant.position.y + 2.5 end, "phase target")
assert(not input.held_stack.valid_for_read, "staged target must start empty")
input.inserter_stack_size_override = 16
for slot = 1, input.filter_slot_count do input.set_filter(slot, nil) end
input.set_filter(1, assert(options.item))
input.use_filters = true
input.inserter_filter_mode = "whitelist"
local control = input.get_or_create_control_behavior()
control.circuit_condition = {condition = {first_signal = {type = "virtual", name = "signal-Z"}, comparator = "<", constant = 0}}
control.circuit_enable_disable = true
local belt = input.pickup_target or surface.find_entities_filtered{position = input.pickup_position,
    type = {"transport-belt", "underground-belt"}}[1]
assert(belt and belt.prototype.belt_speed == options.speed)
for _, entity in pairs(entities) do
    if entity.type == "transport-belt" or entity.type == "underground-belt" or entity.type == "loader" then
        assert(entity.name == options.beltPrefix .. entity.type, "mixed transport speed")
    end
end
local report = {version = script.active_mods.base, item = options.item, belt = belt.name,
    belt_speed = belt.prototype.belt_speed, stack_size = 16, gate_tick = options.gateTick,
    endpoint = belt.type == "underground-belt" and belt.belt_to_ground_type or "straight", samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = options.lastTick, report = report, output = "ordinary-phase.json",
    sample = function(tick)
        local sample = pickup.snapshot(input, tick)
        sample.enabled = not control.circuit_enable_disable
        sample.circuit_disabled = control.disabled
        return sample
    end,
    after_tick = function(tick)
        if tick == 64 then
            for _, entity in pairs(entities) do
                if entity.type == "underground-belt" and entity.position.y == belt.position.y then
                    assert(entity.underground_belt_neighbour and entity.underground_belt_neighbour.valid,
                        "unpaired underground after staged registration: " .. helpers.table_to_json(entity.position))
                end
            end
        end
        if tick == options.gateTick then control.circuit_enable_disable = false end
        plant.get_inventory(defines.inventory.crafter_input).clear()
        plant.get_inventory(defines.inventory.crafter_output).clear()
    end
}
