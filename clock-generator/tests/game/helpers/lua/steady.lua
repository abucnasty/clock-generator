-- The game tests' protocol, timed in game ticks (never in clock periods): what the machines that make the target item
-- finish over the trailing minute decides every step.
--   steady state  the first tick the trailing `window` ticks (3,600) hold `expected` products or more (target rate x 60 s)
--   baseline      the `baseline` ticks after it (3,600 unless the family names a reason for more, at most 36,000). It holds
--                 when the trailing minute never falls below `expected` in it, or, where the output comes in bursts and it
--                 does, when the products from the steady-state tick to the last tick in the baseline at which the trailing
--                 minute reaches `expected` again from below make the target rate over those ticks: both ends at the same
--                 point of the build's cycle, so a minute that ends between two bursts does not count against the clock
--   disturbance   each one starts after the step before it and lasts until the trailing minute falls below the lowest
--                 trailing minute of the baseline (the loss is real, not a burst missing from the window); then it is released
--   recovery      the steady-state test met again, within `recover_bound` ticks of the release
-- The run ends when the last disturbance has recovered, or at the first step that fails, or at `cap` ticks; then the
-- harness's settle is ended so the recording starts. Ticks are counted from the tick the probe is installed in.
local M = {}

local function recipe_name(entity)
    local recipe = entity.get_recipe()
    if recipe then return recipe.name end
    if entity.type == "furnace" and entity.previous_recipe then
        local previous = entity.previous_recipe.name
        return type(previous) == "string" and previous or previous.name
    end
    return nil
end

local CRAFTERS = {["assembling-machine"] = true, ["furnace"] = true, ["rocket-silo"] = true}

--- The crafting machines of the build whose recipe is one of `recipes`, with what each finished product is worth in `item`
function M.final_machines(entities, recipes, item)
    local wanted = {}
    for _, name in ipairs(recipes) do wanted[name] = true end
    local finals = {}
    for _, entity in pairs(entities) do
        if entity.valid and CRAFTERS[entity.type] then
            local name = recipe_name(entity)
            if name and wanted[name] then
                local worth
                for _, product in ipairs(prototypes.recipe[name].products) do
                    if product.name == item then
                        local amount = product.amount or (product.amount_min + product.amount_max) / 2
                        worth = (worth or 0) + amount * (product.probability or 1)
                    end
                end
                assert(worth, "recipe " .. name .. " makes no " .. item)
                table.insert(finals, {entity = entity, worth = worth, unit_number = entity.unit_number, recipe = name})
            end
        end
    end
    return finals
end

--- spec: {finals, window, expected, baseline, cap, steady_bound, recover_bound, drop_bound, disturbances, report, output,
---        each_tick?, done?, settle?, count?}
--- disturbances: {kind, start(t), tick?(t), release(t)}, run one after the other
--- count: a function giving the cumulative products, in place of the finals' products_finished (a build judged by what it takes in)
function M.run(spec)
    local window, expected = spec.window or 3600, assert(spec.expected, "expected products per window")
    local baseline_ticks = spec.baseline or 3600
    assert(baseline_ticks >= 1 and baseline_ticks <= 36000, "a baseline is 1 to 36,000 ticks")
    local cap = spec.cap or 54000
    local steady_bound, recover_bound = spec.steady_bound or 36000, spec.recover_bound or 36000
    local drop_bound = spec.drop_bound or 36000
    local disturbances = spec.disturbances or {}
    local finals = spec.finals
    local count = spec.count
    if not count then
        assert(finals and #finals > 0, "no final machines")
        count = function()
            local total = 0
            for _, final in ipairs(finals) do total = total + final.entity.products_finished * final.worth end
            return total
        end
    end
    local protocol = {window = window, expected = expected, baseline_ticks = baseline_ticks, cap = cap, disturbances = {}, trace = {}}
    if finals then
        protocol.finals = {}
        for _, final in ipairs(finals) do table.insert(protocol.finals, {unit_number = final.unit_number, recipe = final.recipe, worth = final.worth}) end
    end
    spec.report.protocol = protocol
    local size = window + 1
    local history = {}
    local origin = count()
    history[0] = 0
    local function at(t) return history[t % size] end
    local phase, step = "steady", 0
    local steady, baseline, current, previous_trailing
    local started = game.tick
    local function write() helpers.write_file(spec.output, helpers.table_to_json(spec.report), false) end
    local function finish(result)
        protocol.result = result
        protocol.ended = game.tick - started
        phase = "done"
        script.on_nth_tick(1, nil)
        if spec.done then spec.done() end
        write()
        if spec.settle then spec.settle.finish() end
    end
    local function next_disturbance(t)
        step = step + 1
        local disturbance = disturbances[step]
        if not disturbance then return finish("holds") end
        current = {kind = disturbance.kind, start = t}
        table.insert(protocol.disturbances, current)
        disturbance.start(t)
        phase = "disturbed"
        write()
    end
    script.on_nth_tick(1, function()
        local t = game.tick - started
        local ok, problem = pcall(function()
            local cumulative = count() - origin
            history[t % size] = cumulative
            if spec.each_tick then spec.each_tick(t) end
            if phase == "disturbed" and disturbances[step].tick then disturbances[step].tick(t) end
            if t < window then return end
            local trailing = cumulative - at(t - window)
            if t % 60 == 0 then table.insert(protocol.trace, trailing) end
            local rising = previous_trailing ~= nil and previous_trailing < expected and trailing >= expected
            previous_trailing = trailing
            if t >= cap then return finish("over the cap of " .. cap .. " ticks") end
            if phase == "steady" then
                if trailing >= expected then
                    steady = t
                    protocol.steady = t
                    baseline = {start = t, ticks = baseline_ticks, from = cumulative, min = trailing, max = trailing, lapsed = false}
                    phase = "baseline"
                    write()
                elseif t >= steady_bound then
                    return finish("no steady state within " .. steady_bound .. " ticks")
                end
            elseif phase == "baseline" then
                if trailing < baseline.min then baseline.min = trailing end
                if trailing > baseline.max then baseline.max = trailing end
                if trailing < expected then baseline.lapsed = true end
                if rising then baseline.last_rise, baseline.rise_items = t, cumulative - baseline.from end
                if t >= steady + baseline_ticks then
                    local total = cumulative - baseline.from
                    local summary = {ticks = baseline_ticks, total = total, expected = expected * baseline_ticks / window,
                        min = baseline.min, max = baseline.max, held = not baseline.lapsed}
                    if baseline.lapsed and baseline.last_rise then
                        local ticks = baseline.last_rise - steady
                        summary.measured = {ticks = ticks, items = baseline.rise_items, expected = expected * ticks / window}
                        summary.meets = baseline.rise_items * window >= expected * ticks
                    else
                        summary.meets = not baseline.lapsed
                    end
                    protocol.baseline = summary
                    protocol.drop_below = baseline.min
                    next_disturbance(t)
                end
            elseif phase == "disturbed" then
                if trailing < protocol.drop_below then
                    current.drop = t
                    current.release = t
                    disturbances[step].release(t)
                    phase = "recovering"
                    write()
                elseif t - current.start >= drop_bound then
                    disturbances[step].release(t)
                    current.release = t
                    return finish("disturbance " .. step .. " (" .. current.kind .. ") did not reduce output within " .. drop_bound .. " ticks")
                end
            elseif phase == "recovering" then
                if trailing >= expected then
                    current.recovered = t
                    next_disturbance(t)
                elseif t - current.release >= recover_bound then
                    return finish("disturbance " .. step .. " (" .. current.kind .. ") did not recover within " .. recover_bound .. " ticks")
                end
            end
        end)
        if not ok then
            script.on_nth_tick(1, nil)
            protocol.error = tostring(problem)
            write()
            error(problem)
        end
    end)
    write()
end

return M
