-- Test-only addition to the car probe (iron-plate-80-car-chest-clock-probe.lua), composed in before it when options.series is set
-- (CAR_SERIES=1, iron-plate-80-car-chest-clock-fixtures.ts). It READS and changes nothing in the game; the car probe and steady.lua are
-- as they were, so every recording made without the option keeps its key.
-- It keeps, in report.series (clock-speed.json):
--   rows    one row a tick from 10 window cycles before each drill stop to 40 after it (a ring of the last 10 window cycles is kept
--           until the first stop; the rows of two stops that overlap are one run of ticks). Columns are in report.series.columns:
--           tick (as steady.lua counts it), both furnaces' output stock, the ore in the car, the drill's entity status and whether it
--           is disabled by script, the clock's counter, both furnaces' products finished, and the stack in the hand of each inserter that
--           takes from the car
--   stops   the ticks the drill was stopped at
--   cycles  from steady state on, at every whole window cycle: tick, both furnaces' products finished, both furnaces' productivity bars
local entities = ...
local series_period = options.series.period
local original_run = steady.run
steady.run = function(spec)
    local car = capture.find_one(entities, function(entity) return entity.type == "car" end, "car")
    local drill = capture.find_one(entities, function(entity) return entity.type == "mining-drill" end, "mining drill")
    local trunk = car.get_inventory(defines.inventory.car_trunk)
    local report, clock, finals = spec.report, spec.clock, spec.finals
    assert(finals and #finals == 2, "the series keeps two final machines")
    local outputs = {}
    for k, final in ipairs(finals) do outputs[k] = final.entity.get_output_inventory() end
    -- the inserters of a staged start know their targets a tick after they are built: they are looked for until both are found
    local takers = {}
    local function find_takers()
        for _, entity in pairs(entities) do
            if entity.valid and entity.type == "inserter" and entity.pickup_target == car then table.insert(takers, entity) end
        end
        table.sort(takers, function(a, b) return a.unit_number < b.unit_number end)
    end
    local function hand(inserter)
        if inserter == nil then return -1 end
        local stack = inserter.held_stack
        return stack.valid_for_read and stack.count or 0
    end
    local ring_size = 10 * series_period + 2
    local ring, rows, stops, cycles = {}, {}, {}, {}
    local seen, logged_until, cycle_position = 0, -1, nil
    report.series = {
        period = series_period,
        columns = {"t", "stock_1", "stock_2", "car_ore", "drill_status", "drill_disabled_by_script", "clock", "finished_1", "finished_2", "hand_1", "hand_2"},
        stops = stops, rows = rows, cycles = cycles,
        cycle_columns = {"t", "finished_1", "finished_2", "bonus_1", "bonus_2"},
    }
    spec.each_tick = function(t)
        if #takers < 2 then takers = {} find_takers() if #takers ~= 2 then takers = {} end end
        local position = capture.clock_value(clock)
        local row = {t, outputs[1].get_item_count(finals[1].item), outputs[2].get_item_count(finals[2].item), trunk.get_item_count(),
            drill.status, drill.disabled_by_script and 1 or 0, position,
            finals[1].entity.products_finished, finals[2].entity.products_finished, hand(takers[1]), hand(takers[2])}
        ring[t % ring_size] = row
        if t <= logged_until then table.insert(rows, row) end
        local protocol = report.protocol
        if protocol and protocol.steady ~= nil then
            if cycle_position == nil then cycle_position = position end
            if position == cycle_position then
                table.insert(cycles, {t, finals[1].entity.products_finished, finals[2].entity.products_finished,
                    finals[1].entity.bonus_progress, finals[2].entity.bonus_progress})
            end
        end
        -- the probe records "stop-drill" in the tick it stops the drill, after this function ran in that tick
        local events = report.events
        while seen < #events do
            seen = seen + 1
            local event = events[seen]
            if event.action == "stop-drill" then
                table.insert(stops, event.tick)
                if t > logged_until then
                    for earlier = math.max(0, event.tick - 10 * series_period), t do
                        local kept = ring[earlier % ring_size]
                        if kept and kept[1] == earlier then table.insert(rows, kept) end
                    end
                end
                logged_until = event.tick + 40 * series_period
            end
        end
    end
    return original_run(spec)
end
