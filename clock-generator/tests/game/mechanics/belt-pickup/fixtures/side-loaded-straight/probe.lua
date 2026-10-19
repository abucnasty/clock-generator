local entities, surface = ...
local sink = capture.find_one(entities, function(e) return e.name == "assembling-machine-3" end, "machine")
local input = capture.find_one(entities, function(e)
    return e.type == "inserter" and e.drop_target == sink
end, "input")
local belt = assert(input.pickup_target)
assert(belt.type == "transport-belt")
assert(belt.belt_shape == "straight", "pickup must remain a straight belt, not a bend")
assert(not input.held_stack.valid_for_read)
input.inserter_stack_size_override = 16
for slot = 1, input.filter_slot_count do input.set_filter(slot, nil) end
input.use_filters = false
local control = input.get_or_create_control_behavior()
local release_tick = options.releaseTick or 0
local pause_tick, resume_tick = options.pauseTick, options.resumeTick
if pause_tick or resume_tick then
    assert(pause_tick and resume_tick and pause_tick > release_tick and resume_tick > pause_tick,
        "pause needs ordered release, pause and resume ticks")
end
local block_outlet_tick, release_outlet_tick = options.blockOutletTick, options.releaseOutletTick
local drain, drain_spec
if block_outlet_tick or release_outlet_tick then
    assert(block_outlet_tick and release_outlet_tick and block_outlet_tick > release_tick
        and release_outlet_tick > block_outlet_tick, "outlet needs ordered block and release ticks")
    drain = capture.find_one(entities, function(e) return e.type == "loader" and e.loader_type == "input" end, "drain")
    drain_spec = {name = drain.name, position = drain.position, direction = drain.direction,
        force = drain.force, type = drain.loader_type}
end
if release_tick == 0 then control.circuit_enable_disable = false end
local inventory = sink.get_inventory(defines.inventory.crafter_input)
inventory.clear()
sink.get_inventory(defines.inventory.crafter_output).clear()
assert(sink.crafting_progress == 0)
local feed = assert(surface.find_entities_filtered{position = {
    x = belt.position.x + (options.feedDx or (options.straightThrough and -1 or 0)),
    y = belt.position.y + (options.feedDy or (options.straightThrough and 0 or 1))}, type = "transport-belt"}[1])
local function feed_state()
    local lanes = pickup.lanes(feed)
    for index, lane in ipairs(lanes) do
        local line = feed.get_transport_line(index)
        lane.count = line.get_item_count()
        lane.full = not line.can_insert_at_back()
    end
    return {position = feed.position, lanes = lanes}
end
local report = {initial = {
    destination_cleared_each_tick = options.clearDestination == true,
    pause_tick = pause_tick, resume_tick = resume_tick,
    block_outlet_tick = block_outlet_tick, release_outlet_tick = release_outlet_tick,
    feed = feed_state(), inputs = inventory.get_contents(), output = sink.get_inventory(defines.inventory.crafter_output).get_contents(),
    input_position = input.position, belt_position = belt.position, belt_shape = belt.belt_shape,
    belt_speed = belt.prototype.belt_speed, belt_direction = belt.direction, mirrored = input.mirroring, recipe = sink.get_recipe().name,
    crafting_speed = sink.crafting_speed, use_filters = input.use_filters
}, samples = {}}
capture.each_tick{
    first_tick = 1, last_tick = options.lastTick or 30, report = report, output = "front-pickup.json",
    after_tick = function(tick)
        if tick == release_tick then control.circuit_enable_disable = false end
        if tick == pause_tick then
            control.circuit_enable_disable = true
        end
        if tick == resume_tick then control.circuit_enable_disable = false end
        if tick == block_outlet_tick then drain.destroy() end
        if tick == release_outlet_tick then drain = assert(surface.create_entity(drain_spec)) end
        if options.clearDestination then
            inventory.clear()
            sink.get_inventory(defines.inventory.crafter_output).clear()
        end
    end,
    sample = function(tick)
        local sample = pickup.snapshot(input, tick)
        sample.input_enabled = not control.circuit_enable_disable
        if block_outlet_tick then sample.outlet_open = drain.valid end
        sample.inputs = inventory.get_contents()
        sample.output = sink.get_inventory(defines.inventory.crafter_output).get_contents()
        sample.crafting_progress = sink.crafting_progress
        sample.feed = feed_state()
        if options.observeDownstream then
            assert(belt.direction == defines.direction.east, "downstream observation is eastbound only")
            local count = options.downstreamTiles or 1
            sample.downstream = {{length = count, stacks = {}}, {length = count, stacks = {}}}
            for distance = 1, count do
                local next_belt = assert(surface.find_entities_filtered{position = {
                    x = belt.position.x + distance, y = belt.position.y}, type = "transport-belt"}[1])
                for index, lane in ipairs(pickup.lanes(next_belt)) do
                    for _, stack in pairs(lane.stacks) do
                        stack.at = stack.at - (distance - 1)
                        table.insert(sample.downstream[index].stacks, stack)
                    end
                end
            end
        end
        return sample
    end
}
