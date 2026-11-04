-- Run a generated clock through a car, a tank or a cargo wagon taken as a chest (its slot filters come with the blueprint) under
-- the game tests' protocol (steady.lua). The disturbances: the first and the third cut a supply (the infinity chest is set to
-- hold none of its item: options.cuts names the item of each) and take the container's stock of it, until the output falls; the
-- second blocks the output (the disposal chest keeps what it gets and is filled with wooden chests, then emptied and set to
-- remove again).
local entities, surface, _, settle = ...
local machine = capture.find_one(entities, function(entity) return entity.type == "assembling-machine" end, "machine")
local container = capture.find_one(entities, function(entity)
    return entity.type == "car" or entity.type == "cargo-wagon"
end, "container")
local output = capture.find_one(entities, function(entity)
    return entity.type == "inserter" and entity.pickup_target == machine
end, "output inserter")
local disposal = output.drop_target
assert(disposal and disposal.type == "infinity-container" and disposal.remove_unfiltered_items, "the output drops into a disposal chest")
local supplies = {}
for _, entity in pairs(entities) do
    if entity.type == "infinity-container" and entity ~= disposal then
        local filter = entity.get_infinity_container_filter(1)
        supplies[filter.name] = {chest = entity, filter = filter}
    end
end
local inventory = container.get_inventory(container.type == "car" and defines.inventory.car_trunk or defines.inventory.cargo_wagon)
local cuts = assert(options.cuts)
local filtered = 0
for slot = 1, #inventory do if inventory.get_filter(slot) then filtered = filtered + 1 end end
local report = {events = {}, initial = {
    container = container.name, quality = container.quality.name, slots = #inventory, filtered_slots = filtered,
    crafting_speed = machine.crafting_speed}}
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end
local function set_supply(item, count)
    local supply = assert(supplies[item], "no supply of " .. item)
    supply.chest.set_infinity_container_filter(1, {name = item, count = count, mode = "exactly", index = 1})
end
local function cut(item)
    return {
        kind = "cut " .. item,
        -- the stock of the item in the container goes with the cut (owner, 2026-11-03), so the loss shows at once
        start = function(t)
            set_supply(item, 0)
            local removed = inventory.remove{name = item, count = 1000000}
            table.insert(report.events, {tick = t, action = "cut-supply", removed = removed})
        end,
        release = function(t) set_supply(item, supplies[item].filter.count) event(t, "restore-supply") end,
    }
end
local block = {
    kind = "block output",
    start = function(t)
        disposal.remove_unfiltered_items = false
        local chest_inventory = disposal.get_inventory(defines.inventory.chest)
        for slot = 1, #chest_inventory do chest_inventory[slot].set_stack({name = "wooden-chest", count = 50}) end
        event(t, "block-output")
    end,
    release = function(t)
        disposal.get_inventory(defines.inventory.chest).clear()
        disposal.remove_unfiltered_items = true
        event(t, "restore-output")
    end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {cut(cuts[1]), block, cut(cuts[2])},
    report = report, output = "clock-speed.json", settle = settle,
}
