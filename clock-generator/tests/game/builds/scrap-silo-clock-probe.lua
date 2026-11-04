-- Run a generated clock on the scrap silo under the game tests' protocol (steady.lua): a stack inserter brings scrap into a
-- recycler, the recycler places its results into a rocket silo, filter stack inserters take them out of the silo into
-- infinity chests. The target counts the scrap destroyed (the config's `counts: "destroyed"`), so the run counts what the feed
-- inserter drops into the recycler, cumulative (the feed's hand getting smaller). The disturbances: the scrap supply cut (the
-- infinity chest stops and is emptied); then the output blocked (every taker disabled by script and the silo filled with
-- results, the heaviest first, until none fits, so the recycler cannot place what it gives and stops; released by taking out
-- what was put in and enabling the takers).
-- Counted over the baseline's ticks (the tick after the steady state to the last tick of the baseline): the recycler's rolls
-- (products_finished: crafts and productivity payouts), what it placed into the silo and what the takers dropped, by item, the
-- silo's weight at each taker's window opening and at its highest, the ticks the recycler waited with a result in its output
-- or stopped, and the results placed while a taker waited at the silo enabled (the wake-up stand-in).
local entities, surface, _, settle = ...
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
local status_name = {}
for name, value in pairs(defines.entity_status) do status_name[value] = name end
local scrap_filters = scrap_chest.infinity_container_filters

-- the results, by the takers' filters
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

local report = {items = items, weight = weight, events = {}, takers = {}, baseline = {ticks = 0, fresh = 0, rolls = 0, placed = {}, taken = {},
    weight_max = 0, open_weight_max = 0, stuck_ticks = 0, waiting_ticks = 0, full_openings = 0}}
for _, item in ipairs(items) do report.baseline.placed[item] = 0; report.baseline.taken[item] = 0 end
for index, taker in ipairs(takers) do
    report.takers[index] = {unit = taker.unit_number, items = taker_items[index], hand = taker.inserter_target_pickup_count,
        alarm_ticks = 0, alarm_results = 0, woken = 0, waiting_ticks = 0, enabled_ticks = 0, openings = 0, held_at_open = {}}
end

local function event(t, action, extra)
    local entry = {tick = t, action = action}
    for key, value in pairs(extra or {}) do entry[key] = value end
    table.insert(report.events, entry)
end
local function held(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.count or 0 end
local function held_name(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.name or nil end
local function silo_weight()
    local total = 0
    for _, item in ipairs(items) do total = total + rocket.get_item_count(item) * weight[item] end
    return total
end
local function stuck() return recycler.status == defines.entity_status.full_output
    or recycler.status == defines.entity_status.waiting_for_space_in_destination end

local heaviest = 0
for _, item in ipairs(items) do if weight[item] > heaviest then heaviest = weight[item] end end
local by_weight = {}
for _, item in ipairs(items) do table.insert(by_weight, item) end
table.sort(by_weight, function(a, b) return weight[a] > weight[b] end)

-- the scrap the feed drops into the recycler, cumulative: steady.lua asks for it once a tick
local previous_feed, fresh_total, fresh_tick = held(feed), 0, 0
local function count()
    local now = held(feed)
    fresh_tick = 0
    if now < previous_feed then fresh_tick = previous_feed - now end
    fresh_total = fresh_total + fresh_tick
    previous_feed = now
    return fresh_total
end

local previous_held, previous_name, previous_status = {}, {}, {}
for index, taker in ipairs(takers) do
    previous_held[index] = held(taker); previous_name[index] = held_name(taker); previous_status[index] = taker.status
end
local previous_count = {}
for _, item in ipairs(items) do previous_count[item] = rocket.get_item_count(item) end
local previous_finished = recycler.products_finished
local function each_tick(t)
    local picked, dropped = {}, {}
    for index, taker in ipairs(takers) do
        local now, name = held(taker), held_name(taker)
        if name == previous_name[index] and now > previous_held[index] then
            picked[name] = (picked[name] or 0) + now - previous_held[index]
        elseif name ~= previous_name[index] and name then
            picked[name] = (picked[name] or 0) + now
        end
        if previous_name[index] and (now < previous_held[index] or name ~= previous_name[index]) then
            local gone = name == previous_name[index] and previous_held[index] - now or previous_held[index]
            dropped[previous_name[index]] = (dropped[previous_name[index]] or 0) + gone
        end
        previous_held[index] = now; previous_name[index] = name
    end
    local placed, placed_now = {}, 0
    for _, item in ipairs(items) do
        local now = rocket.get_item_count(item)
        placed[item] = now - previous_count[item] + (picked[item] or 0)
        placed_now = placed_now + placed[item]
        previous_count[item] = now
    end
    local finished = recycler.products_finished
    local w = silo_weight()
    local from = report.protocol.steady
    local in_baseline = from and t > from and t <= from + options.baseline
    local b = report.baseline
    if in_baseline then
        b.ticks = b.ticks + 1
        b.fresh = b.fresh + fresh_tick
        b.rolls = b.rolls + finished - previous_finished
        for _, item in ipairs(items) do
            b.placed[item] = b.placed[item] + placed[item]
            b.taken[item] = b.taken[item] + (dropped[item] or 0)
        end
        if w > b.weight_max then b.weight_max = w end
        if stuck() then b.stuck_ticks = b.stuck_ticks + 1 end
        if not output.is_empty() then b.waiting_ticks = b.waiting_ticks + 1 end
    end
    previous_finished = finished
    for index, taker in ipairs(takers) do
        local stats = report.takers[index]
        local disabled = taker.status == defines.entity_status.disabled_by_control_behavior
        local was_disabled = previous_status[index] == defines.entity_status.disabled_by_control_behavior
        if in_baseline then
            if was_disabled and not disabled then
                -- a window opens: what the silo weighs (full: no room for the heaviest result), and what the taker holds from the window before
                if w > b.open_weight_max then b.open_weight_max = w end
                if w > options.lift - heaviest then b.full_openings = b.full_openings + 1 end
                stats.openings = stats.openings + 1
                local h = tostring(held(taker))
                stats.held_at_open[h] = (stats.held_at_open[h] or 0) + 1
            end
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
end

local cut = {
    kind = "cut scrap",
    start = function(t)
        scrap_chest.infinity_container_filters = {}
        scrap_chest.get_inventory(defines.inventory.chest).clear()
        event(t, "cut-supply")
    end,
    release = function(t)
        scrap_chest.infinity_container_filters = scrap_filters
        event(t, "restore-supply")
    end,
}
local filled = {}
local block = {
    kind = "block output",
    start = function(t)
        for _, taker in ipairs(takers) do taker.disabled_by_script = true end
        -- results, the heaviest first, until the game refuses every one of them: the recycler cannot place what it gives
        for _, item in ipairs(by_weight) do
            local room = math.max(0, math.floor((options.lift - silo_weight()) / weight[item]))
            local inserted = room > 0 and rocket.insert{name = item, count = room} or 0
            for _ = 1, 8 do
                if not rocket.can_insert{name = item, count = 1} then break end
                inserted = inserted + rocket.insert{name = item, count = 1}
            end
            filled[item] = inserted
        end
        for _, item in ipairs(items) do
            assert(not rocket.can_insert{name = item, count = 1}, "the silo must refuse every result: " .. item)
        end
        event(t, "fill-silo", {weight = silo_weight()})
    end,
    tick = function(t)
        if not report.blocked_at and stuck() then
            report.blocked_at = t
            event(t, "recycler-stopped")
        end
    end,
    release = function(t)
        for item, inserted in pairs(filled) do
            if inserted > 0 then rocket.remove{name = item, count = inserted} end
        end
        for _, taker in ipairs(takers) do taker.disabled_by_script = false end
        event(t, "restore-output", {weight = silo_weight()})
    end,
}
steady.run{
    count = count, clock = steady.clock(entities), each_tick = each_tick,
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {cut, block},
    report = report, output = "scrap-silo.json", settle = settle,
}
