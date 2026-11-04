-- Run a generated clock on the steel build under the game tests' protocol (steady.lua). Its cargo wagon is a hub: a mining drill
-- fills it with ore, one furnace makes plates from the ore and puts them back, the other makes steel from the plates and puts it
-- back, and the steel is taken out of the wagon onto a belt that a loader empties into a disposal chest. The disturbances: the
-- first and the third stop the drill (disabled by script) until the wagon has run dry of steel and the output falls, the second
-- blocks the output (the chest the loader fills keeps what it gets and is filled with wooden chests, then emptied and set to
-- remove again). The ticks each furnace stood at its output block (a full wagon slot) are counted over the run.
local entities, surface, _, settle = ...
local wagon = capture.find_one(entities, function(entity) return entity.type == "cargo-wagon" end, "cargo wagon")
local drill = capture.find_one(entities, function(entity) return entity.type == "mining-drill" end, "mining drill")
local outputs, fills, takes = {}, {}, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        local pickup, drop = entity.pickup_target, entity.drop_target
        if pickup == wagon and drop and drop.type == "transport-belt" then table.insert(outputs, entity)
        elseif pickup == wagon then table.insert(takes, entity) end
        if drop == wagon then table.insert(fills, entity) end
    end
end
assert(#outputs == 1 and #fills == 2 and #takes == 2, "expected 1 output, 2 fill and 2 machine-feeding inserters on the wagon")
assert(drill.drop_target == wagon, "the drill drops into the wagon")
local sink = capture.find_one(entities, function(entity) return entity.type == "infinity-container" end, "sink")
assert(sink.remove_unfiltered_items, "a sink that removes")
local cargo = wagon.get_inventory(defines.inventory.cargo_wagon)
local function units(list)
    local out = {}
    for _, entity in ipairs(list) do table.insert(out, entity.unit_number) end
    table.sort(out)
    return out
end
local function contents()
    local out = {}
    for _, content in pairs(cargo.get_contents()) do out[content.name] = (out[content.name] or 0) + content.count end
    return out
end
local report = {events = {}, output_full_ticks = {}, initial = {
    wagon = contents(), output_units = units(outputs), fill_units = units(fills), take_units = units(takes),
    drill_unit = drill.unit_number, wagon_unit = wagon.unit_number}}
local function event(t, action) table.insert(report.events, {tick = t, action = action, wagon = contents()}) end
local furnaces = {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "furnace" then table.insert(furnaces, entity) end
end
local function stop_drill()
    return {
        kind = "stop drill",
        start = function(t) drill.disabled_by_script = true event(t, "stop-drill") end,
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
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {stop_drill(), block, stop_drill()},
    report = report, output = "clock-speed.json", settle = settle,
    each_tick = function()
        for _, furnace in ipairs(furnaces) do
            if furnace.status == defines.entity_status.full_output then
                local key = tostring(furnace.unit_number)
                report.output_full_ticks[key] = (report.output_full_ticks[key] or 0) + 1
            end
        end
    end,
}
