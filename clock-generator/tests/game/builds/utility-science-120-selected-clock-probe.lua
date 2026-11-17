-- Run the selected clock on the scaffold of UTILITY_SCIENCE_120 from the staged start under the game tests' protocol
-- (helpers/lua/steady.lua): steady state, a long baseline, then one disturbance, the loss the generator's trial says breaks the
-- clock: low density structure stops arriving. As the trial cuts it, no belt and no infinity chest has the item: the chests that
-- hold it lose their filter and their stock, and the item is taken off every belt in every tick; hands and machines keep theirs.
-- The loss lasts until the output falls below the baseline's lowest minute, then the filters are given back and the run waits for
-- the output to come back. A staged start has no settle: the recording is cut where the run ends (settle.record_samples).
-- options: window, expected, baseline, cap, recover_bound, recipes, item, ticks
local entities, _, _, settle = ...
local ITEM = "low-density-structure"
local chests = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "infinity-container" then
        local filter = e.get_infinity_container_filter(1)
        if filter and filter.name == ITEM then table.insert(chests, {entity = e, filter = filter}) end
    end
end
assert(#chests == 2, "two infinity chests hold " .. ITEM)
local report = {events = {}, chests = #chests}
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end
local function take_off_belts()
    for _, e in pairs(entities) do
        if e.valid and (e.type == "transport-belt" or e.type == "underground-belt" or e.type == "splitter" or e.type == "loader") then
            for lane = 1, e.get_max_transport_line_index() do
                for quality in pairs(prototypes.quality) do e.get_transport_line(lane).remove_item{name = ITEM, quality = quality, count = 100000} end
            end
        end
    end
end
local finals = steady.final_machines(entities, options.recipes, options.item)
local cutting, cut_at, last_made, last_change = false, nil, nil, 0
local function restore(t)
    for _, c in ipairs(chests) do c.entity.set_infinity_container_filter(1, c.filter) end
    cutting = false
    event(t, "restore " .. ITEM)
end
-- As the trial has it, the loss lasts until the build has stopped (no craft finished for a whole window cycle) and ends at the place
-- in the window cycle it was cut at. steady.lua releases at the first drop of the output, which here only marks the drop.
local cut = {
    kind = "cut low-density-structure",
    start = function(t)
        for _, c in ipairs(chests) do
            c.entity.set_infinity_container_filter(1, nil)
            for quality in pairs(prototypes.quality) do c.entity.remove_item{name = ITEM, quality = quality, count = 100000} end
        end
        cutting, cut_at, last_change = true, t, t
        event(t, "cut " .. ITEM)
    end,
    release = function(t) event(t, "output fell below the baseline's lowest minute") end,
}
local began = game.tick
steady.run{
    finals = finals, clock = steady.clock(entities),
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    recover_bound = options.recover_bound, disturbances = {cut},
    report = report, output = "clock-speed.json",
    each_tick = function(t)
        if not cutting then return end
        take_off_belts()
        local made = 0
        for _, final in ipairs(finals) do made = made + final.entity.products_finished end
        if made ~= last_made then last_made, last_change = made, t end
        if t - last_change >= options.period and (t - cut_at) % options.period == 0 then restore(t) end
    end,
    -- the recording holds samples 0 .. ended; the run ends in this tick
    done = function() settle.record_samples(math.min(options.ticks, game.tick - began + 1)) end,
}
