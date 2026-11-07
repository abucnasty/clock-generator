-- Run a generated clock on the ore voider's recycler cell under the game tests' protocol (steady.lua): four inserters bring
-- iron ore in from infinity chests, the recycler places what it gives back into a car, two inserters bring that back. The
-- recycler makes nothing that counts (it destroys ore), so the run counts what it takes in: the ore the four feed inserters
-- drop into it, cumulative (a drop is a feed inserter's hand getting smaller). The disturbances: the ore supply cut (the infinity
-- chests stop and are emptied), then the output blocked (the two inserters out of the car disabled by script and the car filled
-- to its capacity with ore, so that the recycler cannot place what it gives back and stops with a stack of it waiting; released
-- by taking out what was put in and enabling the inserters). While the output is blocked the probe also watches whether the
-- feed inserters still bring ore into the recycler with a stack of its result waiting (its input emptied once it stops).
-- Counted over the baseline's ticks (the tick after the steady state to the last tick of the baseline): the recycler's crafts
-- (products_finished), the ore it places into the car (what the car gains plus what the two take out of it in the tick), what
-- the two drop back into it, the car's highest count, the ticks the recycler shows full output or waiting for space, its
-- statuses, what waits in its output after a tick while the car has room, and the wake-up stand-in (ore placed into the car
-- while a car inserter waits at it).
local entities, surface, _, settle = ...
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
local ORE = "iron-ore"
local status_name = {}
for name, value in pairs(defines.entity_status) do status_name[value] = name end
local chest_filters = {}
for index, chest in ipairs(chests) do chest_filters[index] = chest.infinity_container_filters end

local report = {events = {}, initial = {window_cycle_ticks = options.window_cycle_ticks, capacity = #trunk * prototypes.item[ORE].stack_size,
    car_contents = trunk.get_item_count(ORE)},
    baseline = {ticks = 0, crafts = 0, placed = 0, taken = 0, car_max = 0, source_max = 0, full_ticks = 0,
        recycler_status = {}, result_after_tick = {}, wake = {alarms = {0, 0}, woken = {0, 0}, waiting_ticks = {0, 0}, enabled_ticks = {0, 0}}}}
local function event(t, action, extra)
    local entry = {tick = t, action = action, car = trunk.get_item_count(ORE)}
    for key, value in pairs(extra or {}) do entry[key] = value end
    table.insert(report.events, entry)
end
-- the recycler stops with a stack of its result waiting as "waiting for space in destination" (recorded on the benchmark's saves)
local function stuck() return recycler.status == defines.entity_status.full_output
    or recycler.status == defines.entity_status.waiting_for_space_in_destination end
local function held(inserter) return inserter.held_stack.valid_for_read and inserter.held_stack.count or 0 end
local function tally(map, key) map[key] = (map[key] or 0) + 1 end
local function supply(on)
    for index, chest in ipairs(chests) do
        if on then chest.infinity_container_filters = chest_filters[index]
        else
            chest.infinity_container_filters = {}
            chest.get_inventory(defines.inventory.chest).clear()
        end
    end
end

-- the ore the four drop into the recycler, cumulative: steady.lua asks for it once a tick
local feed_held = {}
for index, inserter in ipairs(feeds) do feed_held[index] = held(inserter) end
local fresh_total, fresh_tick = 0, 0
local function count()
    local before = fresh_total
    for index, inserter in ipairs(feeds) do
        local now = held(inserter)
        if now < feed_held[index] then fresh_total = fresh_total + feed_held[index] - now end
        feed_held[index] = now
    end
    fresh_tick = fresh_total - before
    return fresh_total
end

local previous_car, previous_finished = trunk.get_item_count(ORE), recycler.products_finished
local previous_taker, previous_taker_status = {}, {}
for index, inserter in ipairs(takers) do previous_taker[index] = held(inserter); previous_taker_status[index] = inserter.status end
local function each_tick(t)
    local car_now = trunk.get_item_count(ORE)
    local picked, taken = 0, 0
    for index, inserter in ipairs(takers) do
        local now = held(inserter)
        if now > previous_taker[index] then picked = picked + now - previous_taker[index] end
        if now < previous_taker[index] then taken = taken + previous_taker[index] - now end
        previous_taker[index] = now
    end
    local placed_now = car_now - previous_car + picked
    local finished = recycler.products_finished
    local from = report.protocol.steady
    if from and t > from and t <= from + options.baseline then
        local b = report.baseline
        b.ticks = b.ticks + 1
        b.crafts = b.crafts + finished - previous_finished
        b.placed = b.placed + placed_now
        b.taken = b.taken + taken
        if car_now > b.car_max then b.car_max = car_now end
        local in_source = source.get_item_count(ORE)
        if in_source > b.source_max then b.source_max = in_source end
        if stuck() then b.full_ticks = b.full_ticks + 1 end
        tally(b.recycler_status, status_name[recycler.status] or tostring(recycler.status))
        -- placing before crafting leaves what a tick's crafts gave in the output until the next tick
        if car_now < report.initial.capacity - 100 then tally(b.result_after_tick, tostring(result.get_item_count(ORE))) end
        -- the car's inserters, woken by what is placed into the car while they wait at it
        for index, inserter in ipairs(takers) do
            local before = status_name[previous_taker_status[index]] or ""
            local waited = before == "waiting_for_source_items" or before == "waiting_for_more_items"
            if inserter.status ~= defines.entity_status.disabled_by_control_behavior then b.wake.enabled_ticks[index] = b.wake.enabled_ticks[index] + 1 end
            if waited then
                b.wake.waiting_ticks[index] = b.wake.waiting_ticks[index] + 1
                if placed_now > 0 then
                    b.wake.alarms[index] = b.wake.alarms[index] + 1
                    if inserter.status == defines.entity_status.working then b.wake.woken[index] = b.wake.woken[index] + 1 end
                end
            end
        end
    end
    for index, inserter in ipairs(takers) do previous_taker_status[index] = inserter.status end
    previous_car, previous_finished = car_now, finished
end

local cut = {
    kind = "cut ore",
    start = function(t) supply(false) event(t, "cut-supply") end,
    release = function(t) supply(true) event(t, "restore-supply") end,
}
local blocked
local block = {
    kind = "block output",
    start = function(t)
        for _, taker in ipairs(takers) do taker.disabled_by_script = true end
        local inserted = trunk.insert{name = ORE, count = report.initial.capacity}
        assert(not trunk.can_insert{name = ORE, count = 1}, "the car must really be full")
        blocked = {started = t, filled = inserted, watched = 0}
        report.blocked_input = blocked
        event(t, "fill-car", {inserted = inserted})
    end,
    -- once the recycler stops with a stack of its result waiting, its input is emptied and the probe counts the ore the feeds
    -- still bring in, until the output has fallen and the block is released
    tick = function(t)
        local waiting = result.get_item_count(ORE)
        if not blocked.stopped then
            if stuck() and waiting >= 50 then
                blocked.stopped = t
                blocked.result_waiting = waiting
                blocked.source_before = source.get_item_count(ORE)
                source.clear()
                blocked.source_max = 0
                blocked.fresh_after = 0
                event(t, "empty-recycler-input")
            end
        else
            blocked.source_max = math.max(blocked.source_max, source.get_item_count(ORE))
            blocked.fresh_after = blocked.fresh_after + fresh_tick
            blocked.watched = t - blocked.stopped
            blocked.status = status_name[recycler.status]
            blocked.result_waiting_end = waiting
        end
    end,
    release = function(t)
        if not blocked.stopped then
            blocked.status = status_name[recycler.status]
            blocked.result_waiting = result.get_item_count(ORE)
        end
        trunk.remove{name = ORE, count = blocked.filled}
        for _, taker in ipairs(takers) do taker.disabled_by_script = false end
        event(t, "restore-output")
    end,
}
steady.run{
    count = count, clock = steady.clock(entities), each_tick = each_tick,
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {cut, block},
    report = report, output = "ore-voider.json", settle = settle,
}
