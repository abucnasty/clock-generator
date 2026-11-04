-- Run a clock on the throttled scaffold of REAL_STUPIDFATHOBBIT_CELL02 under the game tests' protocol (steady.lua). The
-- disturbances: plastic bars removed from every belt until the output falls; then the two processing unit loaders removed, and
-- with them the belt tiles the throttle inserters take the circuits from (the export belt then fills and the export inserters
-- wait), until the output falls, and rebuilt. Stopping the export alone does not reduce the output of processing units, which
-- take their circuits from the machines, so it has no disturbance of its own. What the circuit export inserters move is
-- counted over the baseline.
-- the belt tiles the throttle inserters (belt to infinity chest) take from, removed and rebuilt to stop the export
local entities, surface, _, settle = ...
local makers = {processing = {}, circuits = {}}
for _, e in pairs(entities) do
    if e.valid and e.type == "assembling-machine" and e.get_recipe() then
        if e.get_recipe().name == options.item then table.insert(makers.processing, e) end
        if e.get_recipe().name == "electronic-circuit" then table.insert(makers.circuits, e) end
    end
end
assert(#makers.processing == 2 and #makers.circuits == 2, "two machines making the product and two making circuits")
local function outputs_of(list)
    local result = {}
    for _, m in ipairs(list) do
        for _, e in pairs(entities) do
            if e.valid and e.type == "inserter" and e.pickup_target == m and e.drop_target and (e.drop_target.type == "transport-belt" or e.drop_target.type == "underground-belt") then table.insert(result, e) end
        end
    end
    return result
end
local outputs, exports = outputs_of(makers.processing), outputs_of(makers.circuits)
assert(#outputs == 2 and #exports == 2, "an output inserter and an export inserter for each machine")
-- the belt tiles the throttle inserters (belt to infinity chest) take from, removed and rebuilt to stop the export
local tiles, seen = {}, {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.pickup_target.type == "transport-belt" and e.drop_target and e.drop_target.type == "infinity-container" then
        local belt = e.pickup_target
        local key = belt.position.x .. "," .. belt.position.y
        if not seen[key] then
            seen[key] = true
            local index
            for i, other in pairs(entities) do if other == belt then index = i end end
            table.insert(tiles, {index = index, spec = {name = belt.name, position = belt.position, direction = belt.direction, force = belt.force}})
        end
    end
end
assert(#tiles > 0, "throttle inserters take from belt tiles")
local loaders = {}
for index, e in pairs(entities) do
    if e.valid and e.type == "loader" then
        table.insert(loaders, {index = index, spec = {name = e.name, position = e.position, direction = e.direction, force = e.force, type = e.loader_type}})
    end
end
assert(#loaders == 2, "two output loaders")
local report = {events = {}, tiles = #tiles, baseline_export = 0, initial = {speed = options.speed, reach = options.reach}}
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end
local function held(o) return o.held_stack.valid_for_read and o.held_stack.count or 0 end
local previous_export = {}
for k = 1, #exports do previous_export[k] = held(exports[k]) end
local plastic = {
    kind = "cut plastic-bar",
    start = function(t) event(t, "cut plastic-bar") end,
    tick = function()
        for _, e in pairs(entities) do
            if e.valid and (e.type == "transport-belt" or e.type == "underground-belt" or e.type == "splitter") then
                for lane = 1, e.get_max_transport_line_index() do
                    for quality in pairs(prototypes.quality) do e.get_transport_line(lane).remove_item{name = "plastic-bar", quality = quality, count = 100000} end
                end
            end
        end
    end,
    release = function(t) event(t, "restore plastic-bar") end,
}
local block = {
    kind = "block output and export",
    start = function(t)
        for _, l in ipairs(loaders) do entities[l.index].destroy() end
        for _, tile in ipairs(tiles) do entities[tile.index].destroy() end
        event(t, "block-output")
    end,
    -- the recorder reads the build after the probe: the rebuilt loaders and tiles take the old ones' places
    release = function(t)
        for _, l in ipairs(loaders) do entities[l.index] = assert(surface.create_entity(l.spec)) end
        for _, tile in ipairs(tiles) do entities[tile.index] = assert(surface.create_entity(tile.spec)) end
        event(t, "restore-output")
    end,
}
steady.run{
    finals = steady.final_machines(entities, options.recipes, options.item), clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {plastic, block},
    report = report, output = "clock-speed.json", settle = settle,
    each_tick = function()
        local protocol = report.protocol
        local counting = protocol.steady and not protocol.baseline
        for k = 1, #exports do
            local count = held(exports[k])
            if counting and count < previous_export[k] then report.baseline_export = report.baseline_export + previous_export[k] - count end
            previous_export[k] = count
        end
    end,
}
