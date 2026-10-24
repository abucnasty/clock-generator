-- Observe a generated clock on the scrap silo: a stack inserter brings scrap into a recycler, the recycler places its
-- results into a rocket silo, filter stack inserters take them out of the silo into infinity chests. Counted per clock
-- period: the scrap dropped into the recycler (what the target counts), its rolls (products_finished: crafts and
-- productivity payouts), what it placed into the silo and what the takers dropped, by item, the silo's weight at each
-- taker's window opening and at its highest, the ticks the recycler waited with a result in its output or stopped, and
-- the results placed while a taker waited at the silo enabled (the wake-up stand-in of PROPOSAL-E3 round 2). After the
-- settle and the baseline, the trials of `options.trials`, one after another: takers disabled by script for whole periods
-- (their windows missed; switched between windows, 60 ticks before a period ends), or the scrap supply cut.
local entities, surface = ...
local recycler = capture.find_one(entities, function(entity) return entity.name == "recycler" end, "recycler")
local silo = capture.find_one(entities, function(entity) return entity.type == "rocket-silo" end, "rocket silo")
local feed, takers, scrap_chest = nil, {}, nil
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        if entity.pickup_target == silo then table.insert(takers, entity)
        elseif entity.drop_target == recycler then feed = entity; scrap_chest = entity.pickup_target end
    end
end
assert(feed and scrap_chest and #takers > 0, "expected a feed inserter from a chest and takers at the silo")
local rocket = silo.get_inventory(defines.inventory.rocket_silo_rocket)
local output = recycler.get_inventory(defines.inventory.crafter_output)
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local period = options.period
local status_name = {}
for name, value in pairs(defines.entity_status) do status_name[value] = name end
local scrap_filters = scrap_chest.infinity_container_filters

-- the results, by the takers' filters, and which takers take each
local items, weight, taker_items = {}, {}, {}
for index, taker in ipairs(takers) do
    taker_items[index] = {}
    for slot = 1, taker.filter_slot_count do
        local filter = taker.get_filter(slot)
        if filter then
            table.insert(taker_items[index], filter.name)
            if not weight[filter.name] then
                table.insert(items, filter.name)
                weight[filter.name] = prototypes.item[filter.name].weight
            end
        end
    end
end

local starts = game.tick + options.settle_periods * period
local trials_at = options.baseline_periods
local report = {starts = starts, period = period, baseline_periods = options.baseline_periods, items = items, weight = weight,
    takers = {}, periods = {}, events = {}}
for index, taker in ipairs(takers) do
    report.takers[index] = {unit = taker.unit_number, items = taker_items[index], hand = taker.inserter_target_pickup_count,
        alarm_ticks = 0, alarm_results = 0, woken = 0, waiting_ticks = 0, enabled_ticks = 0, openings = 0, held_at_open = {}}
end
-- the trials in periods from the end of the baseline: each {kind = "skip", takers_of = {items} or "all", periods, after}
-- or {kind = "cut", periods, after}
local schedule, at = {}, trials_at
for _, trial in ipairs(options.trials) do
    table.insert(schedule, {trial = trial, from = at, to = at + trial.periods})
    at = at + trial.periods + trial.after
end
report.ends_at = at

local function held(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.count or 0 end
local function held_name(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.name or nil end
local function silo_weight()
    local total = 0
    for _, item in ipairs(items) do total = total + rocket.get_item_count(item) * weight[item] end
    return total
end
local function takes(index, wanted)
    if wanted == "all" then return true end
    for _, mine in ipairs(taker_items[index]) do for _, item in ipairs(wanted) do if mine == item then return true end end end
    return false
end
local function stuck() return recycler.status == defines.entity_status.full_output
    or recycler.status == defines.entity_status.waiting_for_space_in_destination end
local function write() helpers.write_file("scrap-silo.json", helpers.table_to_json(report), false) end

local heaviest = 0
for _, item in ipairs(items) do if weight[item] > heaviest then heaviest = weight[item] end end
local previous_clock = capture.clock_value(clock)
local previous_feed, previous_held, previous_name, previous_status = held(feed), {}, {}, {}
for index, taker in ipairs(takers) do
    previous_held[index] = held(taker); previous_name[index] = held_name(taker); previous_status[index] = taker.status
end
local previous_count = {}
for _, item in ipairs(items) do previous_count[item] = rocket.get_item_count(item) end
local previous_finished = recycler.products_finished
local current, period_index = nil, -1
script.on_nth_tick(1, function()
    local ok, problem = pcall(function()
        local value = capture.clock_value(clock)
        if value < previous_clock and game.tick >= starts then
            if current and period_index >= 0 then
                current["end"] = game.tick
                table.insert(report.periods, current)
            end
            period_index = period_index + 1
            current = {start = game.tick, fresh = 0, rolls = 0, placed = {}, taken = {}, weight_max = 0, open_weight_max = 0,
                stuck_ticks = 0, waiting_ticks = 0, full_openings = 0}
            for _, item in ipairs(items) do current.placed[item] = 0; current.taken[item] = 0 end
            if period_index % 20 == 0 then write() end
            if period_index >= report.ends_at then
                write()
                script.on_nth_tick(1, nil)
                return
            end
        end
        -- the trials switch 60 ticks before a period ends, when every taker is between its windows
        if period_index >= 0 and value == period - 60 then
            local next_period = period_index + 1
            for _, entry in ipairs(schedule) do
                local trial = entry.trial
                if next_period == entry.from or next_period == entry.to then
                    local on = next_period == entry.to
                    if trial.kind == "skip" then
                        for index, taker in ipairs(takers) do
                            if takes(index, trial.takers_of) then taker.disabled_by_script = not on end
                        end
                    elseif trial.kind == "cut" then
                        if on then scrap_chest.infinity_container_filters = scrap_filters
                        else
                            scrap_chest.infinity_container_filters = {}
                            scrap_chest.get_inventory(defines.inventory.chest).clear()
                        end
                    end
                    table.insert(report.events, {tick = game.tick, period = next_period, action = (on and "end " or "start ") .. trial.kind})
                end
            end
        end
        previous_clock = value
        -- every count moves each tick, and is kept from the first period on
        local counting = current ~= nil
        current = current or {placed = {}, taken = {}, fresh = 0, rolls = 0, weight_max = 0, open_weight_max = 0, stuck_ticks = 0,
            waiting_ticks = 0, full_openings = 0}
        local now_feed = held(feed)
        if now_feed < previous_feed then current.fresh = current.fresh + previous_feed - now_feed end
        previous_feed = now_feed
        local picked = {}
        for index, taker in ipairs(takers) do
            local now, name = held(taker), held_name(taker)
            if name == previous_name[index] and now > previous_held[index] then
                picked[name] = (picked[name] or 0) + now - previous_held[index]
            elseif name ~= previous_name[index] and name then
                picked[name] = (picked[name] or 0) + now
            end
            if counting and previous_name[index] and (now < previous_held[index] or name ~= previous_name[index]) then
                local dropped = name == previous_name[index] and previous_held[index] - now or previous_held[index]
                current.taken[previous_name[index]] = (current.taken[previous_name[index]] or 0) + dropped
            end
            previous_held[index] = now; previous_name[index] = name
        end
        local placed_now = 0
        for _, item in ipairs(items) do
            local count = rocket.get_item_count(item)
            local placed = count - previous_count[item] + (picked[item] or 0)
            current.placed[item] = (current.placed[item] or 0) + placed
            placed_now = placed_now + placed
            previous_count[item] = count
        end
        local finished = recycler.products_finished
        current.rolls = current.rolls + finished - previous_finished
        previous_finished = finished
        local w = silo_weight()
        if w > current.weight_max then current.weight_max = w end
        if stuck() then current.stuck_ticks = current.stuck_ticks + 1 end
        if not output.is_empty() then current.waiting_ticks = current.waiting_ticks + 1 end
        local in_baseline = period_index >= 0 and period_index < trials_at
        for index, taker in ipairs(takers) do
            local stats = report.takers[index]
            local disabled = taker.status == defines.entity_status.disabled_by_control_behavior
            local was_disabled = previous_status[index] == defines.entity_status.disabled_by_control_behavior
            if was_disabled and not disabled then
                -- a window opens: what the silo weighs (full: no room for the heaviest result), and what the taker holds from the window before
                if w > current.open_weight_max then current.open_weight_max = w end
                if w > options.lift - heaviest then current.full_openings = current.full_openings + 1 end
                if in_baseline then
                    stats.openings = stats.openings + 1
                    local h = tostring(held(taker))
                    stats.held_at_open[h] = (stats.held_at_open[h] or 0) + 1
                end
            end
            if in_baseline then
                local before = status_name[previous_status[index]] or ""
                local waited = before == "waiting_for_source_items" or before == "waiting_for_more_items"
                if not disabled then stats.enabled_ticks = stats.enabled_ticks + 1 end
                if waited then
                    stats.waiting_ticks = stats.waiting_ticks + 1
                    if placed_now > 0 then
                        stats.alarm_ticks = stats.alarm_ticks + 1
                        stats.alarm_results = stats.alarm_results + placed_now
                        if taker.status == defines.entity_status.working then stats.woken = stats.woken + 1 end
                    end
                end
            end
            previous_status[index] = taker.status
        end
    end)
    if not ok then
        report.error = problem
        write()
        script.on_nth_tick(1, nil)
        error(problem)
    end
end)
