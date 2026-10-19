-- Stage destination demand once, then leave the operating machine and inserter untouched.
local entities = ...
local sink = capture.find_one(entities, function(e) return e.name == "electromagnetic-plant" end, "plant")
local input = capture.find_one(entities, function(e) return e.type == "inserter"
    and e.position.x == sink.position.x - 1.5 and e.position.y == sink.position.y + 2.5 end, "input")
assert(not input.held_stack.valid_for_read)
input.use_filters = false
local inventory = sink.get_inventory(defines.inventory.crafter_input)
inventory.clear()
inventory.insert{name = options.nearItem, count = options.nearCount}
assert(inventory.get_item_count(options.nearItem) == options.nearCount)
assert(sink.crafting_progress == 0)
local control = input.get_or_create_control_behavior()
control.circuit_condition = {condition = {first_signal = {type = "virtual", name = "signal-Z"}, comparator = "<", constant = 0}}
control.circuit_enable_disable = true
local report = {initial = {near_item = options.nearItem, near_count = options.nearCount,
    crafting_speed = sink.crafting_speed}, samples = {}}
capture.each_tick{first_tick = 1, last_tick = 100, report = report, output = "ingredient-demand.json",
    sample = function(tick)
        local sample = pickup.snapshot(input, tick)
        sample.inputs = inventory.get_contents()
        sample.crafting_progress = sink.crafting_progress
        return sample
    end,
    after_tick = function(tick) if tick == 64 then control.circuit_enable_disable = false end end}
