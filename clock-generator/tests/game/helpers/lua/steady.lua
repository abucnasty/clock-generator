-- The game tests' protocol, timed in game ticks (never in clock periods). This helper RECORDS; it judges nothing. What it records
-- (protocol.series, for the whole run) is judged host-side by tests/game/helpers/run-judgement.js (net output over the baseline's
-- whole clock cycles, the output stock guard, holds), so a rule that only judges differently needs no new recording.
-- It steers the run by what the machines that make the target item finish over the trailing minute:
--   steady state  the first tick the trailing `window` ticks (3,600) hold `expected` products or more (target rate x 60 s) and
--                 the trailing window has stopped falling after the warm-up's overshoot (owner, 2026-11-03): it is no lower than
--                 it was a whole number of clock cycles earlier, as many as fit in the window (one where a cycle is longer),
--                 so the two windows compared stand at the same point of the clock and do not overlap by more than a cycle
--   baseline      the `baseline` ticks after it (3,600 unless the family names a reason for more, at most 36,000)
--   disturbance   each one starts after the step before it and lasts until the trailing minute falls below the lowest
--                 trailing minute of the baseline (the loss is real, not a burst missing from the window); then it is released
--   recovery      the steady-state test (both parts) met again, within `recover_bound` ticks of the release
-- The run ends when the last disturbance has recovered, or at the first step that fails, or at `cap` ticks; then the
-- harness's settle is ended so the recording starts. Ticks are counted from the tick the probe is installed in.
-- Recorded per final machine (products finished since the start, and the item in its output inventory: its output stock):
--   series.seconds  every 60 ticks, with the lowest total output stock of the ticks since the row before
--   series.cycles   from the steady-state tick on, every tick the clock stands where it stood then (whole clock cycles), with
--                   the lowest total output stock of the ticks since the row before
--   series.marks    at every step: steady state, the baseline's end, each disturbance's start, drop, release and recovery, the end
-- A build judged by a `count` (what it takes in) records that count and no stock.
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
                table.insert(finals, {entity = entity, worth = worth, unit_number = entity.unit_number, recipe = name, item = item})
            end
        end
    end
    return finals
end

--- The clock of the build: the decider the harness describes as "Clock for ..." (a generated clock, or one the build came with
--- that the harness names)
function M.clock(entities)
    return capture.find_one(entities, function(entity)
        return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
    end, "the clock")
end

--- spec: {finals, clock, window, expected, baseline, cap, steady_bound, recover_bound, drop_bound, disturbances, report, output,
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
    local clock = assert(spec.clock, "the clock the baseline's whole cycles are counted by")
    local count = spec.count
    local judged_by_count = count ~= nil
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
    -- what is recorded: per final machine its products since the start (p) and its output stock (s); a build judged by a count
    -- records the count alone (p = {count}) and no stock
    local series = {judged_by = judged_by_count and "count" or "finals", seconds = {}, cycles = {}, marks = {}}
    protocol.series = series
    spec.report.protocol = protocol
    local item_of = {}
    local finished_origin = {}
    if not judged_by_count then
        for k, final in ipairs(finals) do
            finished_origin[k] = final.entity.products_finished
            item_of[k] = assert(final.entity.get_output_inventory(), "a final machine with no output inventory")
        end
    end
    local origin = count()
    local function products()
        if judged_by_count then return {count() - origin} end
        local out = {}
        for k, final in ipairs(finals) do out[k] = final.entity.products_finished - finished_origin[k] end
        return out
    end
    local function stocks()
        if judged_by_count then return nil end
        local out = {}
        for k, final in ipairs(finals) do out[k] = item_of[k].get_item_count(final.item) end
        return out
    end
    local function total_stock()
        if judged_by_count then return nil end
        local total = 0
        for k, final in ipairs(finals) do total = total + item_of[k].get_item_count(final.item) end
        return total
    end
    -- the lowest total output stock since the last row of each series (nil for a build judged by a count)
    local low_second, low_cycle
    local function lower(low, value) if value == nil then return nil end if low == nil or value < low then return value end return low end
    local function mark(t, at) table.insert(series.marks, {t = t, at = at, p = products(), s = stocks()}) end
    local size = window + 1
    local history = {}
    -- the trailing window at each tick of the last `cycles` ticks, and the last tick the clock stood at each of its values: a
    -- clock cycle of at most `cycles` ticks is compared with itself
    local cycles = 36001
    local trailing_at, last_at = {}, {}
    history[0] = 0
    local function at(t) return history[t % size] end
    local phase, step = "steady", 0
    local steady, baseline, current, steady_position
    local started = game.tick
    local function write() helpers.write_file(spec.output, helpers.table_to_json(spec.report), false) end
    local function finish(result, t)
        protocol.result = result
        protocol.ended = game.tick - started
        mark(t or protocol.ended, "end")
        phase = "done"
        script.on_nth_tick(1, nil)
        if spec.done then spec.done() end
        write()
        if spec.settle then spec.settle.finish() end
    end
    local function next_disturbance(t)
        step = step + 1
        local disturbance = disturbances[step]
        if not disturbance then return finish("holds", t) end
        current = {kind = disturbance.kind, start = t}
        table.insert(protocol.disturbances, current)
        mark(t, "start " .. step)
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
            local stock = total_stock()
            low_second, low_cycle = lower(low_second, stock), lower(low_cycle, stock)
            if t % 60 == 0 then
                table.insert(series.seconds, {t = t, p = products(), s = stocks(), low = low_second})
                low_second = nil
            end
            local position = capture.clock_value(clock)
            local cycle_start = last_at[position]
            last_at[position] = t
            if steady_position ~= nil and position == steady_position then
                table.insert(series.cycles, {t = t, p = products(), s = stocks(), low = low_cycle})
                low_cycle = nil
            end
            if t < window then return end
            local trailing = cumulative - at(t - window)
            trailing_at[t % cycles] = trailing
            if t % 60 == 0 then table.insert(protocol.trace, trailing) end
            if t >= cap then return finish("over the cap of " .. cap .. " ticks", t) end
            local settled = false
            if cycle_start ~= nil then
                local cycle = t - cycle_start
                local back = cycle * math.max(1, math.floor(window / cycle))
                settled = t - back >= window and back < cycles and trailing >= trailing_at[(t - back) % cycles]
            end
            if phase == "steady" then
                if trailing >= expected and settled then
                    steady = t
                    protocol.steady = t
                    protocol.steady_against = cycle_start
                    baseline = {start = t, ticks = baseline_ticks, min = trailing, max = trailing}
                    steady_position = position
                    low_cycle = stock
                    table.insert(series.cycles, {t = t, p = products(), s = stocks(), low = low_cycle})
                    low_cycle = nil
                    mark(t, "steady")
                    phase = "baseline"
                    write()
                elseif t >= steady_bound then
                    return finish("no steady state within " .. steady_bound .. " ticks", t)
                end
            elseif phase == "baseline" then
                if trailing < baseline.min then baseline.min = trailing end
                if trailing > baseline.max then baseline.max = trailing end
                if t >= steady + baseline_ticks then
                    -- what the baseline's trailing window ranged over: the drop of each disturbance is measured against its lowest
                    protocol.baseline = {start = steady, ticks = baseline_ticks, min = baseline.min, max = baseline.max}
                    protocol.drop_below = baseline.min
                    mark(t, "baseline end")
                    next_disturbance(t)
                end
            elseif phase == "disturbed" then
                if trailing < protocol.drop_below then
                    current.drop = t
                    current.release = t
                    mark(t, "release " .. step)
                    disturbances[step].release(t)
                    phase = "recovering"
                    write()
                elseif t - current.start >= drop_bound then
                    disturbances[step].release(t)
                    current.release = t
                    return finish("disturbance " .. step .. " (" .. current.kind .. ") did not reduce output within " .. drop_bound .. " ticks", t)
                end
            elseif phase == "recovering" then
                if trailing >= expected and settled then
                    current.recovered = t
                    mark(t, "recovered " .. step)
                    next_disturbance(t)
                elseif t - current.release >= recover_bound then
                    return finish("disturbance " .. step .. " (" .. current.kind .. ") did not recover within " .. recover_bound .. " ticks", t)
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
