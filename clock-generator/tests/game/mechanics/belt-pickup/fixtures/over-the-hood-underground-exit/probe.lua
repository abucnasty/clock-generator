-- First-hand control: gate only the measured input; never seed/mutate belt or held stock.
local entities, surface = ...
local compact = options.compact
local machine = capture.find_one(entities, function(e) return e.name == (compact and "assembling-machine-3" or "electromagnetic-plant") end, "destination")
local input = capture.find_one(entities, function(e) return e.type == "inserter"
    and e.position.x == machine.position.x + (compact and 2 or 2.5)
    and e.position.y == machine.position.y - (compact and 0 or 0.5) end, "over-the-hood input")
local belt = assert(surface.find_entities_filtered{position = input.pickup_position, type = "underground-belt"}[1])
assert(belt.belt_to_ground_type == "output" and belt.direction == defines.direction.east)
assert(input.direction == defines.direction.east and input.mirroring == options.mirrored)
assert(input.position.x == belt.position.x - 1 and input.position.y == belt.position.y)
assert(belt.prototype.belt_speed == options.speed and belt.name == options.prefix .. "underground-belt")
assert(input.quality.name == "legendary" and machine.quality.name == "legendary")
assert(not input.held_stack.valid_for_read, "staged input must start empty")
input.inserter_stack_size_override = 16
input.use_filters = false
for slot = 1, input.filter_slot_count do input.set_filter(slot, nil) end
local control = input.get_or_create_control_behavior()
control.circuit_condition = {condition = {first_signal = {type = "virtual", name = "signal-Z"}, comparator = "<", constant = 0}}
control.circuit_enable_disable = true
local inventory = machine.get_inventory(defines.inventory.crafter_input)
local output_inventory = machine.get_inventory(defines.inventory.crafter_output)
inventory.clear()
output_inventory.clear()
local ingredient_drains = 0
for _, entity in pairs(entities) do
    if entity.type == "transport-belt" or entity.type == "underground-belt" or entity.type == "loader" then
        assert(entity.name == options.prefix .. entity.type, "mixed transport tiers")
    end
    if entity.type == "loader" and entity.position.y == belt.position.y and entity.loader_type == "input" then
        ingredient_drains = ingredient_drains + 1
    end
end
assert(ingredient_drains == (options.backed and 0 or 1), "ingredient drain mismatch")
local output
if compact then
    output = capture.find_one(entities, function(e) return e.type == "inserter"
        and e.position.x == machine.position.x + 1 and e.position.y == machine.position.y - 2 end, "compact product output")
end
local function identity(entity)
    return entity and {name = entity.name, type = entity.type, position = entity.position, direction = entity.direction,
        endpoint = entity.type == "underground-belt" and entity.belt_to_ground_type or nil} or nil
end
local report = {version = script.active_mods.base, input = identity(input), mirrored = input.mirroring,
    quality = input.quality.name, hand_capacity = input.inserter_stack_size_override,
    belt = identity(belt), speed = belt.prototype.belt_speed, recipe = machine.get_recipe().name,
    machine = identity(machine), machine_quality = machine.quality.name, crafting_speed = machine.crafting_speed, backed = options.backed,
    ingredient_drains = ingredient_drains, samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = 128, report = report, output = "over-the-hood-exit.json",
    sample = function(tick)
        assert(input.pickup_target == belt and input.drop_target == machine, "unexpected input targets")
        if output then
            assert(output.pickup_target == machine, "compact output must pick up from assembler")
            assert(output.drop_target and output.drop_target.valid and output.drop_target.type == "transport-belt",
                "compact output must drop on product belt")
        end
        local held = input.held_stack
        return {tick = tick, held = held.valid_for_read and held.count or 0,
            held_item = held.valid_for_read and held.name or nil, hand = input.held_stack_position,
            enabled = not control.circuit_enable_disable, circuit_disabled = control.disabled,
            lines = pickup.lanes(belt, belt.get_max_transport_line_index()),
            neighbour_lines = belt.underground_belt_neighbour and pickup.lanes(belt.underground_belt_neighbour, belt.underground_belt_neighbour.get_max_transport_line_index()) or nil,
            inputs = inventory.get_contents(), output = output_inventory.get_contents(), crafting_progress = machine.crafting_progress}
    end,
    after_tick = function(tick)
        if tick == 64 then
            local pairs = {}
            for _, entity in ipairs(entities) do
                if entity.type == "underground-belt" and entity.position.y == belt.position.y then
                    local partner = assert(entity.underground_belt_neighbour, "unpaired ingredient endpoint")
                    assert(partner.valid and partner.prototype.belt_speed == options.speed)
                    table.insert(pairs, {position = entity.position, endpoint = entity.belt_to_ground_type, partner = partner.position})
                end
            end
            report.ingredient_pairs = pairs
            report.neighbour = identity(assert(belt.underground_belt_neighbour))
            control.circuit_enable_disable = false
        end
    end
}
