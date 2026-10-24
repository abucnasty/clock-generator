-- Observe a generated clock on the ore voider's recycler cell: four inserters bring iron ore in from infinity chests, the
-- recycler places what it gives back into a car, two inserters bring that back. Counted per clock period: the ore the four
-- drop into the recycler (what the target counts), its crafts (products_finished), the ore it places into the car (what
-- the car gains plus what the two take out of it in the tick), the car's lowest and highest count, and the ticks the
-- recycler shows full output. After the settle and the baseline: the ore supply cut (the infinity chests stop and are
-- emptied) for `cut_periods`, then ore put into the car as a backlog, then the two checks of what was assumed: what waits in
-- the recycler's output after each tick while the car has room (placing before crafting), and whether the inserters still
-- bring ore into it while a stack of its result waits (the car full, the takers disabled by script, its ore taken out).
local entities, surface = ...
local recycler = capture.find_one(entities, function(entity) return entity.name == "recycler" end, "recycler")
local car = capture.find_one(entities, function(entity) return entity.type == "car" end, "car")
local feeds, takers, chests = {}, {}, {}
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" then
        if entity.pickup_target == car then table.insert(takers, entity)
        elseif entity.drop_target == recycler then table.insert(feeds, entity) end
    end
    if entity.valid and entity.type == "infinity-container" then table.insert(chests, entity) end
end
assert(#feeds == 4 and #takers == 2 and #chests == 4, "expected 4 feed inserters, 2 car inserters and 4 infinity chests")
local trunk = car.get_inventory(defines.inventory.car_trunk)
local source = recycler.get_inventory(defines.inventory.crafter_input)
local result = recycler.get_inventory(defines.inventory.crafter_output)
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local ORE = "iron-ore"
local period = options.period
local status_name = {}
for name, value in pairs(defines.entity_status) do status_name[value] = name end
local chest_filters = {}
for index, chest in ipairs(chests) do chest_filters[index] = chest.infinity_container_filters end

local phase_at = {}
local starts = game.tick + options.settle_periods * period
local cut_at = options.baseline_periods
local release_at = cut_at + options.cut_periods
local backlog_at = release_at + options.after_cut_periods
local probe_at = backlog_at + options.backlog_periods
local report = {starts = starts, period = period, phases = {baseline = 0, cut = cut_at, release = release_at, backlog = backlog_at,
    probe = probe_at}, backlog = options.backlog, periods = {}, events = {},
    capacity = #trunk * prototypes.item[ORE].stack_size,
    wake = {alarms = {0, 0}, woken = {0, 0}, waiting_ticks = {0, 0}, enabled_ticks = {0, 0}},
    result_after_tick = {}, recycler_status = {}}
-- the recycler stops with a stack of its result waiting as "waiting for space in destination" (recorded on the benchmark's saves)
local function stuck() return recycler.status == defines.entity_status.full_output
    or recycler.status == defines.entity_status.waiting_for_space_in_destination end
local function held(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.count or 0 end
local function count(map, key) map[key] = (map[key] or 0) + 1 end
local function supply(on)
    for index, chest in ipairs(chests) do
        if on then chest.infinity_container_filters = chest_filters[index]
        else
            chest.infinity_container_filters = {}
            chest.get_inventory(defines.inventory.chest).clear()
        end
    end
end
local previous_clock = capture.clock_value(clock)
local previous_feed, previous_taker, previous_taker_status = {}, {}, {}
for index, inserter in ipairs(feeds) do previous_feed[index] = held(inserter) end
for index, inserter in ipairs(takers) do previous_taker[index] = held(inserter); previous_taker_status[index] = inserter.status end
local previous_car, previous_finished = trunk.get_item_count(ORE), recycler.products_finished
local current, period_index = nil, -1
local probe = nil
local function write() helpers.write_file("ore-voider.json", helpers.table_to_json(report), false) end
script.on_nth_tick(1, function()
    local ok, problem = pcall(function()
        local value = capture.clock_value(clock)
        if value < previous_clock and game.tick >= starts then
            if current then
                current["end"] = game.tick
                table.insert(report.periods, current)
            end
            period_index = period_index + 1
            current = {start = game.tick, fresh = 0, crafts = 0, placed = 0, taken = 0, car = trunk.get_item_count(ORE),
                car_min = trunk.get_item_count(ORE), car_max = 0, source_max = 0, full_ticks = 0}
            if period_index == cut_at then supply(false); table.insert(report.events, {tick = game.tick, action = "cut-supply"}) end
            if period_index == release_at then supply(true); table.insert(report.events, {tick = game.tick, action = "restore-supply"}) end
            if period_index == backlog_at then
                local inserted = trunk.insert({name = ORE, count = options.backlog})
                table.insert(report.events, {tick = game.tick, action = "backlog", inserted = inserted})
            end
            if period_index == probe_at then
                for _, taker in ipairs(takers) do taker.disabled_by_script = true end
                local inserted = trunk.insert({name = ORE, count = report.capacity})
                probe = {started = game.tick, filled = inserted}
                table.insert(report.events, {tick = game.tick, action = "fill-car", inserted = inserted})
            end
            if period_index % 100 == 0 then write() end
        end
        previous_clock = value
        -- what the four drop into the recycler, and what the two take out of the car and drop into it
        local fresh, picked, taken = 0, 0, 0
        for index, inserter in ipairs(feeds) do
            local now = held(inserter)
            if now < previous_feed[index] then fresh = fresh + previous_feed[index] - now end
            previous_feed[index] = now
        end
        local car_now = trunk.get_item_count(ORE)
        local placed_now = 0
        for index, inserter in ipairs(takers) do
            local now = held(inserter)
            if now > previous_taker[index] then picked = picked + now - previous_taker[index] end
            if now < previous_taker[index] then taken = taken + previous_taker[index] - now end
            previous_taker[index] = now
        end
        placed_now = car_now - previous_car + picked
        local finished = recycler.products_finished
        if current then
            current.fresh = current.fresh + fresh
            current.taken = current.taken + taken
            current.placed = current.placed + placed_now
            current.crafts = current.crafts + finished - previous_finished
            if car_now < current.car_min then current.car_min = car_now end
            if car_now > current.car_max then current.car_max = car_now end
            local in_source = source.get_item_count(ORE)
            if in_source > current.source_max then current.source_max = in_source end
            if stuck() then current.full_ticks = current.full_ticks + 1 end
            if period_index >= 0 and period_index < cut_at then
                count(report.recycler_status, status_name[recycler.status] or tostring(recycler.status))
                -- placing before crafting leaves what a tick's crafts gave in the output until the next tick
                if car_now < report.capacity - 100 then count(report.result_after_tick, tostring(result.get_item_count(ORE))) end
                -- the car's inserters, woken by what is placed into the car while they wait at it
                for index, inserter in ipairs(takers) do
                    local before = status_name[previous_taker_status[index]] or ""
                    local waited = before == "waiting_for_source_items" or before == "waiting_for_more_items"
                    if inserter.status ~= defines.entity_status.disabled_by_control_behavior then
                        report.wake.enabled_ticks[index] = report.wake.enabled_ticks[index] + 1
                    end
                    if waited then
                        report.wake.waiting_ticks[index] = report.wake.waiting_ticks[index] + 1
                        if placed_now > 0 then
                            report.wake.alarms[index] = report.wake.alarms[index] + 1
                            if inserter.status == defines.entity_status.working then report.wake.woken[index] = report.wake.woken[index] + 1 end
                        end
                    end
                end
            end
        end
        -- a trace of the first `trace_periods` of the baseline, tick by tick
        if current and period_index >= 0 and period_index < (options.trace_periods or 0) then
            report.trace = report.trace or {}
            local row = {t = game.tick - starts, c = value, src = source.get_item_count(ORE), res = result.get_item_count(ORE),
                car = car_now, rs = status_name[recycler.status], f = {}, k = {}}
            for index, inserter in ipairs(feeds) do row.f[index] = {held(inserter), status_name[inserter.status], inserter.unit_number} end
            for index, inserter in ipairs(takers) do row.k[index] = {held(inserter), status_name[inserter.status], inserter.unit_number} end
            table.insert(report.trace, row)
        end
        for index, inserter in ipairs(takers) do previous_taker_status[index] = inserter.status end
        previous_car, previous_finished = car_now, finished
        if probe then
            local waiting = result.get_item_count(ORE)
            if not probe.stopped and stuck() and waiting >= 50 then
                probe.stopped = game.tick
                probe.result_waiting = waiting
                probe.source_before = source.get_item_count(ORE)
                source.clear()
                probe.source_max = 0
                probe.fresh_after = 0
                table.insert(report.events, {tick = game.tick, action = "empty-recycler-input"})
            elseif probe.stopped then
                probe.source_max = math.max(probe.source_max, source.get_item_count(ORE))
                probe.fresh_after = probe.fresh_after + fresh
                probe.status = status_name[recycler.status]
                probe.result_waiting_end = waiting
                if game.tick >= probe.stopped + options.probe_ticks then
                    report.blocked_input = probe
                    write()
                    script.on_nth_tick(1, nil)
                end
            elseif game.tick >= probe.started + options.probe_ticks then
                probe.status = status_name[recycler.status]
                probe.result_waiting = waiting
                report.blocked_input = probe
                write()
                script.on_nth_tick(1, nil)
            end
        end
    end)
    if not ok then
        report.error = problem
        write()
        script.on_nth_tick(1, nil)
        error(problem)
    end
end)
