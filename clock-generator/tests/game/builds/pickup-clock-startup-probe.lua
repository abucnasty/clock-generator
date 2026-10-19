-- Observe the cold placement without changing stock, held items, machines or controls.
local entities, surface = ...
local machine = capture.find_one(entities, function(entity)
    return entity.type == "assembling-machine"
end, "machine")
local box = machine.bounding_box
local input = capture.find_one(entities, function(entity)
    if entity.type ~= "inserter" then return false end
    local drop = entity.drop_position
    return drop.x >= box.left_top.x and drop.x <= box.right_bottom.x
        and drop.y >= box.left_top.y and drop.y <= box.right_bottom.y
end, "input")
local belt = capture.find_one(surface.find_entities_filtered{
    position = input.pickup_position, type = {"transport-belt", "underground-belt"}
}, function() return true end, "source belt")
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local report = {starts = game.tick, initial_lanes = pickup.lanes(belt), samples = {}}
local collected = false
capture.each_tick{
    first_tick = 1, last_tick = options.ticks, report = report, output = "clock-startup.json",
    sample = function()
        local snapshot = {tick = game.tick, clock = capture.clock_value(clock)}
        if input.held_stack.valid_for_read then collected = true end
        if not collected then snapshot.lanes = pickup.lanes(belt) end
        return snapshot
    end
}
