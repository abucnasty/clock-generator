-- Run a generated clock on the iron plate build, whose car is a chest between the mining drill that fills it and the two
-- furnaces that empty it, under the game tests' protocol (steady.lua). The disturbances: the first and the third stop the
-- drill (it is disabled by script) and take the car's ore, until the output falls, the second blocks the output (the chest
-- the loader fills keeps what it gets and is filled with wooden chests, then emptied and set to remove again).
local entities, surface, _, settle = ...
local car = capture.find_one(entities, function(entity) return entity.type == "car" end, "car")
local drill = capture.find_one(entities, function(entity) return entity.type == "mining-drill" end, "mining drill")
local outputs, takers = {}, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        local pickup = entity.pickup_target
        if pickup and pickup.type == "furnace" then table.insert(outputs, entity) end
        if pickup == car then table.insert(takers, entity) end
    end
end
-- the inserters of a staged start (options.staged) are built in the tick the probe runs in and know their targets a tick later: they are counted by the host
assert(options.staged or (#outputs == 2 and #takers == 2), "expected 2 output and 2 car inserters")
assert(drill.drop_target == car, "the drill drops into the car")
local sink = capture.find_one(entities, function(entity) return entity.type == "infinity-container" end, "sink")
assert(sink.remove_unfiltered_items, "a sink that removes")
local trunk = car.get_inventory(defines.inventory.car_trunk)
local function units(list)
    local out = {}
    for _, entity in ipairs(list) do table.insert(out, entity.unit_number) end
    table.sort(out)
    return out
end
local report = {events = {}, initial = {
    car_contents = trunk.get_item_count(), taker_units = units(takers), output_units = units(outputs),
    drill_unit = drill.unit_number, car_unit = car.unit_number}}
local function event(t, action) table.insert(report.events, {tick = t, action = action, car = trunk.get_item_count()}) end
local function stop_drill()
    return {
        kind = "stop drill",
        -- the ore in the car goes with the cut (abucnasty, 2026-11-03), so the loss shows at once
        start = function(t)
            drill.disabled_by_script = true
            local removed = trunk.remove{name = "iron-ore", count = 1000000}
            table.insert(report.events, {tick = t, action = "stop-drill", removed = removed})
        end,
        release = function(t) drill.disabled_by_script = false event(t, "start-drill") end,
    }
end
local block = {
    kind = "block output",
    start = function(t)
        sink.remove_unfiltered_items = false
        local chest_inventory = sink.get_inventory(defines.inventory.chest)
        for slot = 1, #chest_inventory do chest_inventory[slot].set_stack({name = "wooden-chest", count = 50}) end
        event(t, "block-output")
    end,
    release = function(t)
        sink.get_inventory(defines.inventory.chest).clear()
        sink.remove_unfiltered_items = true
        event(t, "restore-output")
    end,
}
-- A staged start (options.staged): its furnaces have no recipe yet, so the run is counted from the first tick the final machines have
-- one (steady.after_finals)
local function run(finals, waited)
    report.started_after = waited
    steady.run{
        finals = finals, clock = steady.clock(entities),
        window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
        disturbances = {stop_drill(), block, stop_drill()},
        tail = options.tail,
        report = report, output = "clock-speed.json", settle = settle,
    }
end
if options.staged then steady.after_finals(entities, options, run)
else run(steady.final_machines(entities, options.recipes, options.item), 0) end
