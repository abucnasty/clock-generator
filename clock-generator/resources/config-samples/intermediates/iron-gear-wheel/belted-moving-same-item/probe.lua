-- Called by the recording harness with (entities, surface, area), after the belts have warmed up.
-- Measure reachable stacks on both lanes without the destination's ingredient limit or output blocking the hand.
local entities = ...
local input
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" and entity.drop_target
        and entity.drop_target.valid and entity.drop_target.name == "assembling-machine-3"
        and entity.pickup_target and entity.pickup_target.valid
        and (entity.pickup_target.type == "transport-belt" or entity.pickup_target.type == "underground-belt") then
        assert(not input, "expected one belt-fed assembler inserter")
        input = entity
    end
end
assert(input, "no belt-fed assembler inserter")
local belt, sink = input.pickup_target, input.drop_target
local started = game.tick
local report = {
    belt = belt.name, endpoint = belt.type == "underground-belt" and belt.belt_to_ground_type or "straight",
    stack_size = input.inserter_stack_size_override, samples = {}
}
script.on_nth_tick(1, function()
    local elapsed = game.tick - started
    if elapsed < 1 then return end
    local held = input.held_stack
    local sample = {
        tick = elapsed, held = held.valid_for_read and held.count or 0,
        hand = input.held_stack_position, lanes = {}
    }
    for index = 1, 2 do
        local line, stacks = belt.get_transport_line(index), {}
        for _, item in pairs(line.get_detailed_contents()) do
            table.insert(stacks, { at = item.position, count = item.stack.count, item = item.stack.name, id = item.unique_id })
        end
        sample.lanes[index] = { length = line.line_length, stacks = stacks }
    end
    table.insert(report.samples, sample)
    sink.get_inventory(defines.inventory.crafter_input).clear()
    sink.get_inventory(defines.inventory.crafter_output).clear()
    if elapsed == 1200 then
        helpers.write_file("same-item-pickups.json", helpers.table_to_json(report), false)
        script.on_nth_tick(1, nil)
    end
end)
