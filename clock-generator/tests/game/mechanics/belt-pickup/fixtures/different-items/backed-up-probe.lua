-- The fixture's ingredient drain is removed before placement. Isolate one item and clear the destination each tick.
local entities = ...
local wanted = "__ITEM__"
local input
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" and entity.pickup_target and entity.pickup_target.valid
        and entity.drop_target and entity.drop_target.valid and entity.drop_target.name == "electromagnetic-plant" then
        input = entity
    end
end
assert(input, "missing belt input inserter")
for index = 1, input.filter_slot_count do input.set_filter(index, nil) end
input.set_filter(1, wanted)
input.use_filters = true
input.inserter_filter_mode = "whitelist"
input.get_or_create_control_behavior().circuit_enable_disable = false
local belt, sink = input.pickup_target, input.drop_target
local report = {
    item = wanted,
    endpoint = belt.type == "underground-belt" and belt.belt_to_ground_type or "straight",
    samples = {}
}
local starts = game.tick
script.on_nth_tick(1, function()
    local tick = game.tick - starts
    if tick > 100 and tick <= 1300 then
        local held = input.held_stack
        local sample = {tick = tick, held = held.valid_for_read and held.count or 0,
            held_item = held.valid_for_read and held.name or nil, lanes = {}}
        for index = 1, 2 do
            local line = belt.get_transport_line(index)
            local lane = {length = line.line_length, stacks = {}}
            for _, detailed in pairs(line.get_detailed_contents()) do
                table.insert(lane.stacks, {at = detailed.position, count = detailed.stack.count,
                    item = detailed.stack.name, id = detailed.unique_id})
            end
            table.insert(sample.lanes, lane)
        end
        table.insert(report.samples, sample)
    end
    sink.get_inventory(defines.inventory.crafter_input).clear()
    sink.get_inventory(defines.inventory.crafter_output).clear()
    if tick == 1300 then
        helpers.write_file("backed-up-pickups.json", helpers.table_to_json(report), false)
        script.on_nth_tick(1, nil)
    end
end)
