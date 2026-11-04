-- The science cell of #100 (one recycler placing electronic circuits directly into its supercapacitor plant) on its generated
-- clock, under the game tests' protocol (steady.lua). The clock sets the rate through the two takers that empty the science
-- buffer chests into infinity chests (the plants empty freely into them), so what the run counts is what the takers drop.
-- The disturbance: the supercapacitor plant stopped (disabled by script; nothing is taken out of it) until the output falls,
-- then released. Watched through the whole run: the plant's electronic circuits never over the mining drill's stop, no advanced
-- circuits in it, the advanced circuits in the recycler's output. After the protocol has held, the plant is stopped once more for
-- `options.probe_ticks` with its input emptied at the start (the recycler fills it to the drill stop and waits with a batch it
-- cannot place), then `options.wait_ticks` more (the recycler finishes nothing): a mechanism the disturbance above is too short
-- to expose, as it ends when the output falls.
local entities, surface, _, settle = ...
local recycler = capture.find_one(entities, function(e) return e.name == "recycler" end, "recycler")
local target = capture.find_one(entities, function(e)
    local recipe = (e.type == "assembling-machine" or e.type == "furnace") and e.get_recipe()
    return recipe and recipe.name == "supercapacitor"
end, "supercapacitor plant")
local takers = {}
for _, e in pairs(entities) do
    if e.valid and e.type == "inserter" and e.pickup_target and e.pickup_target.name == "steel-chest"
        and e.drop_target and e.drop_target.type == "infinity-container" then table.insert(takers, e) end
end
assert(#takers == 2, "two science output takers")
local clock = steady.clock(entities)
local input = target.get_inventory(defines.inventory.crafter_input)
local output = recycler.get_inventory(defines.inventory.crafter_output)
local function held(e) return e.held_stack.valid_for_read and e.held_stack.count or 0 end

-- what the takers dropped, by taker; counted once a tick, whoever asks first
local previous, delivered, counted = {held(takers[1]), held(takers[2])}, {0, 0}, nil
local function count()
    if counted ~= game.tick then
        counted = game.tick
        for i, e in ipairs(takers) do
            local now = held(e)
            if now < previous[i] then delivered[i] = delivered[i] + previous[i] - now end
            previous[i] = now
        end
    end
    return delivered[1] + delivered[2]
end

local report = {period = options.period, target_max = 0, target_advanced = 0, red_max = 0, events = {}}
local function event(t, action) table.insert(report.events, {tick = t, action = action, target = input.get_item_count("electronic-circuit")}) end
local function write() helpers.write_file("recycler-machine.json", helpers.table_to_json(report), false) end

-- each taker's drops from the steady-state tick to the last tick of the baseline at which the clock stands where it stood then
-- (the baseline's whole clock cycles, as steady.lua counts them)
local previous_snapshot, previous_position, start_snapshot, start_position, cycle_snapshot
local function observe(t)
    local protocol = report.protocol
    local snapshot, position = {tick = t, delivered = {delivered[1], delivered[2]}}, capture.clock_value(clock)
    if protocol.steady and not start_snapshot and t == protocol.steady + 1 then
        start_snapshot, start_position = previous_snapshot, previous_position
    end
    if start_snapshot and not protocol.baseline and position == start_position then cycle_snapshot = snapshot end
    if protocol.baseline and not report.baseline_cycles then
        local cycles = {ticks = 0, delivered = {0, 0}}
        if cycle_snapshot then
            cycles.ticks = cycle_snapshot.tick - start_snapshot.tick
            for i = 1, 2 do cycles.delivered[i] = cycle_snapshot.delivered[i] - start_snapshot.delivered[i] end
        end
        report.baseline_cycles = cycles
    end
    previous_snapshot, previous_position = snapshot, position
    report.target_max = math.max(report.target_max, input.get_item_count("electronic-circuit"))
    report.target_advanced = math.max(report.target_advanced, input.get_item_count("advanced-circuit"))
    report.red_max = math.max(report.red_max, output.get_item_count("advanced-circuit"))
end

local stop = {
    kind = "stop supercapacitor plant",
    start = function(t) target.disabled_by_script = true event(t, "stop-plant") end,
    release = function(t) target.disabled_by_script = false event(t, "start-plant") end,
}

local function post_run()
    local began = game.tick
    target.disabled_by_script = true
    input.clear()
    report.stopped = {target_max = 0, target_advanced = 0}
    script.on_nth_tick(1, function()
        local ok, problem = pcall(function()
            local elapsed = game.tick - began
            report.stopped.target_max = math.max(report.stopped.target_max, input.get_item_count("electronic-circuit"))
            report.stopped.target_advanced = math.max(report.stopped.target_advanced, input.get_item_count("advanced-circuit"))
            report.red_max = math.max(report.red_max, output.get_item_count("advanced-circuit"))
            if elapsed == options.probe_ticks then
                report.stopped.target_end = input.get_item_count("electronic-circuit")
                report.stopped.recycler_waiting = output.get_item_count("electronic-circuit")
                report.stopped.recycler_finished = recycler.products_finished
            end
            if elapsed == options.probe_ticks + options.wait_ticks then
                report.stopped.recycler_finished_after = recycler.products_finished
                report.stopped.ticks = elapsed
                target.disabled_by_script = false
                script.on_nth_tick(1, nil)
                write()
                settle.finish()
            end
        end)
        if not ok then
            report.error = tostring(problem)
            script.on_nth_tick(1, nil)
            write()
            error(problem)
        end
    end)
end

steady.run{
    count = count, clock = clock,
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = {stop},
    each_tick = observe,
    report = report, output = "recycler-machine.json",
    -- the settle is ended after the stopped plant has been watched, not when the protocol ends
    done = function()
        if report.protocol.result == "holds" then post_run() else write() settle.finish() end
    end,
}
