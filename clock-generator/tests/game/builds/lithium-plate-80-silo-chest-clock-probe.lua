-- Run a generated clock on the lithium plate build under the game tests' protocol (steady.lua). Its rocket silo is a chest
-- between the cryogenic plants that fill it and the furnaces that empty it. The disturbances: the first and the third cut the
-- holmium plates (both infinity chests are set to hold none) until the output falls, the second blocks the output (the chest
-- the loader fills keeps what it gets and is filled with wooden chests, then emptied and set to remove again).
local entities, surface, _, settle = ...
local silo = capture.find_one(entities, function(entity) return entity.type == "rocket-silo" end, "rocket silo")
local outputs, fills, empties = {}, {}, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        local pickup, drop = entity.pickup_target, entity.drop_target
        if pickup and pickup.type == "furnace" then table.insert(outputs, entity) end
        if drop == silo then table.insert(fills, entity) end
        if pickup == silo then table.insert(empties, entity) end
    end
end
assert(#outputs == 6 and #fills == 2 and #empties == 6, "expected 6 output, 2 fill and 6 empty inserters")
local sink, supplies = nil, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "infinity-container" then
        local filter = entity.get_infinity_container_filter(1)
        if filter then table.insert(supplies, {chest = entity, filter = filter})
        else assert(not sink, "expected one sink"); sink = entity end
    end
end
assert(sink and sink.remove_unfiltered_items and #supplies == 2, "two supply chests and a sink that removes")
local rocket = silo.get_inventory(defines.inventory.rocket_silo_rocket)
local function units(list)
    local out = {}
    for _, entity in ipairs(list) do table.insert(out, entity.unit_number) end
    table.sort(out)
    return out
end
local report = {events = {}, initial = {
    silo = silo.name, rocket_contents = rocket.get_contents(), fill_units = units(fills), empty_units = units(empties),
    output_units = units(outputs)}}
local function event(t, action) table.insert(report.events, {tick = t, action = action, silo = rocket.get_item_count()}) end
local function set_supplies(on)
    for _, supply in ipairs(supplies) do
        local filter = supply.filter
        -- "exactly" none empties the chest too; the blueprint's filter ("at-least" 100) is set again on release
        supply.chest.set_infinity_container_filter(1, on and {name = filter.name, count = filter.count, mode = filter.mode, index = 1}
            or {name = filter.name, count = 0, mode = "exactly", index = 1})
        -- the chest's plates go with the cut at once (owner, 2026-11-03)
        if not on then supply.chest.get_inventory(defines.inventory.chest).clear() end
    end
end
local function cut()
    return {
        kind = "cut holmium-plate",
        start = function(t) set_supplies(false) event(t, "cut-supply") end,
        release = function(t) set_supplies(true) event(t, "restore-supply") end,
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
    disturbances = {cut(), block, cut()},
    report = report, output = "clock-speed.json", settle = settle,
}
