-- Run a generated clock on a belt-fed pickup fixture under the game tests' protocol (steady.lua): steady state, the baseline,
-- then the first ingredient cut, the output block and the second ingredient cut, each until it reduces output, then
-- released and recovered.
local entities, surface, _, settle = ...
local machine = capture.find_one(entities, function(entity)
    return entity.name == (options.machine_name or (options.family == "electromagnetic" and "electromagnetic-plant" or "assembling-machine-3"))
end, "machine")
local input = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.drop_target == machine
end, "input")
local belt = assert(input.pickup_target)
local reach = pickup.lanes(belt)[1].length
assert(reach == options.reach and belt.prototype.belt_speed == options.speed, "native pickup differs from config")
local report = {initial = {speed = belt.prototype.belt_speed, reach = reach}, events = {}}
if options.trace_ticks then report.pickups = {} end
local output = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.pickup_target == machine
end, "output inserter")
local loader, loader_spec, loader_index, disposal
if options.output_to_belt or options.family == "electromagnetic" then
    loader = capture.find_one(entities, function(entity)
        return entity.type == "loader" and entity.position.y < machine.position.y
    end, "output loader")
    for index, entity in pairs(entities) do if entity == loader then loader_index = index end end
    assert(loader_index)
    loader_spec = {name = loader.name, position = loader.position, direction = loader.direction,
        force = loader.force, type = loader.loader_type}
else
    disposal = assert(output.drop_target)
    assert(disposal.name == "infinity-chest")
end
local ingredients = options.ingredients or (options.family == "electromagnetic"
    and {"accumulator", "supercapacitor"} or {"iron-plate", "iron-plate"})
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end
-- the pickups, machine inventory and output of the first ticks after each release, where a trace is asked for
local tracing
local function trace(t)
    if not tracing or t >= tracing + options.trace_ticks then return end
    local snapshot = pickup.snapshot(input, t)
    local inventory = machine.get_inventory(defines.inventory.crafter_input)
    snapshot.machine = {inputs = {}, crafting_progress = machine.crafting_progress, bonus_progress = machine.bonus_progress}
    for _, ingredient in ipairs(ingredients) do snapshot.machine.inputs[ingredient] = inventory.get_item_count(ingredient) end
    snapshot.machine.output = machine.get_inventory(defines.inventory.crafter_output).get_item_count(options.item)
    table.insert(report.pickups, snapshot)
end
local function cut(item)
    return {
        kind = "cut " .. item,
        start = function(t) event(t, "cut " .. item) end,
        -- Clearing belt items every tick also keeps an underground's buffer from hiding the cut.
        tick = function()
            for _, entity in pairs(entities) do
                if entity.valid and (entity.type == "transport-belt" or entity.type == "underground-belt") then
                    for lane = 1, entity.get_max_transport_line_index() do
                        entity.get_transport_line(lane).remove_item{name = item, count = 100000}
                    end
                end
            end
        end,
        release = function(t) event(t, "restore " .. item) tracing = options.trace_ticks and t end,
    }
end
local block = {
    kind = "block output",
    start = function(t)
        if loader then loader.destroy()
        else
            disposal.remove_unfiltered_items = false
            disposal.insert{name = options.item, count = 1000000}
            assert(not disposal.can_insert{name = options.item, count = 1}, "output must really be blocked")
        end
        event(t, "block-output")
    end,
    release = function(t)
        if loader_spec then
            loader = assert(surface.create_entity(loader_spec))
            -- the recorder reads the build after the probe: replace its stale handle
            entities[loader_index] = loader
        else
            disposal.get_inventory(defines.inventory.chest).clear()
            disposal.remove_unfiltered_items = true
        end
        event(t, "restore-output")
        tracing = options.trace_ticks and t
    end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {cut(ingredients[1]), block, cut(ingredients[2])},
    report = report, output = "clock-speed.json", settle = settle, each_tick = options.trace_ticks and trace,
}
