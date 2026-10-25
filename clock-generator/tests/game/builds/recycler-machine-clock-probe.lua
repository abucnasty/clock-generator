-- The science cell on its generated output clock, then its supercapacitor plant stopped to expose the drill stop.
local entities = ...
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
local function held(e) return e.held_stack.valid_for_read and e.held_stack.count or 0 end
local previous = {held(takers[1]), held(takers[2])}
local started = game.tick
local baseline_start = options.settle_periods * options.period
local baseline_end = baseline_start + options.baseline_periods * options.period
local stop_end = baseline_end + options.probe_ticks
local input = target.get_inventory(defines.inventory.crafter_input)
local output = recycler.get_inventory(defines.inventory.crafter_output)
local report = {period = options.period, periods = {}, output = {0, 0}, target_max = 0, target_advanced = 0, red_max = 0}
local current = {0, 0}
script.on_nth_tick(1, function()
    local ok, problem = pcall(function()
        local elapsed = game.tick - started
        for i, e in ipairs(takers) do
            local now = held(e)
            if elapsed > baseline_start and elapsed <= baseline_end and now < previous[i] then
                local count = previous[i] - now
                report.output[i] = report.output[i] + count
                current[i] = current[i] + count
            end
            previous[i] = now
        end
        report.red_max = math.max(report.red_max, output.get_item_count("advanced-circuit"))
        if elapsed > baseline_start and elapsed <= baseline_end and (elapsed - baseline_start) % options.period == 0 then
            table.insert(report.periods, current)
            current = {0, 0}
        end
        if elapsed == baseline_end then
            target.disabled_by_script = true
            input.clear()
        end
        if elapsed > baseline_end then
            report.target_max = math.max(report.target_max, input.get_item_count("electronic-circuit"))
            report.target_advanced = math.max(report.target_advanced, input.get_item_count("advanced-circuit"))
        end
        if elapsed == stop_end then
            report.target_end = input.get_item_count("electronic-circuit")
            report.recycler_waiting = output.get_item_count("electronic-circuit")
            report.recycler_finished = recycler.products_finished
        end
        if elapsed == stop_end + options.wait_ticks then
            report.recycler_finished_after = recycler.products_finished
            helpers.write_file("recycler-machine.json", helpers.table_to_json(report), false)
            script.on_nth_tick(1, nil)
        end
    end)
    if not ok then
        report.error = problem
        helpers.write_file("recycler-machine.json", helpers.table_to_json(report), false)
        script.on_nth_tick(1, nil)
        error(problem)
    end
end)
