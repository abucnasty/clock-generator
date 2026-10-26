-- Observe the unchanged original scaffold under the same clock throughout every intervention.
-- It also keeps, for the per-branch accounting of the test: a branch map (terminal, buffer, drain and science machine per sorted
-- terminal) and every inserter's native position; per branch the science it holds and its machine's products_finished in every
-- stock reading; and one row per period boundary from the baseline start in report.series.
local all_entities = ...
local function run_probe(entities)
options.trials = options.trials or {}
local ITEM = "electromagnetic-science-pack"
local outputs, recyclers, science, capacitors, bends, disposal, inserters = {}, {}, {}, {}, {}, {}, {}
local feeds, feed_units, output_units, bend_units, red_units = {}, {}, {}, {}, {}
local science_units, capacitor_units, recycler_units, buffers = {}, {}, {}, {}
local report = {period = options.period, baseline = {}, trials = {}, events = {}, topology = {}, finished = false,
    maximum_hold_stock_drain = 64}
-- one row per period boundary from the baseline start (columns; pf, reserve, delivered hold 4 values a row, branch
-- order). stage and trial are those of the bin that closes at the boundary.
report.series = {tick = {}, stage = {}, trial = {}, total = {}, pf = {}, reserve = {}, delivered = {}}
local function keep_boundary(tick, bin_stage, bin_trial, stock, delivered)
    local s = report.series
    table.insert(s.tick, tick); table.insert(s.stage, bin_stage); table.insert(s.trial, bin_trial); table.insert(s.total, stock.total)
    for i = 1, 4 do
        table.insert(s.pf, stock.pf_by_branch[i]); table.insert(s.reserve, stock.reserve_by_branch[i]); table.insert(s.delivered, delivered[i])
    end
end
local function write() helpers.write_file("recycler-original.json", helpers.table_to_json(report), false) end
local function check(condition, message)
    if not condition then report.error = message; write(); error(message) end
end
local function held(e) return e.held_stack.valid_for_read and e.held_stack.count or 0 end
local function by_position(a, b)
    return a.position.x == b.position.x and a.position.y < b.position.y or a.position.x < b.position.x
end
for _, e in pairs(entities) do
    if e.valid then
        if e.name == "recycler" then table.insert(recyclers, e); recycler_units[e.unit_number] = true end
        if e.type == "assembling-machine" and e.get_recipe() then
            local recipe = e.get_recipe().name
            if recipe == ITEM then table.insert(science, e); science_units[e.unit_number] = true end
            if recipe == "supercapacitor" then table.insert(capacitors, e); capacitor_units[e.unit_number] = true end
        end
        if e.type == "loader" and e.loader_type == "input" then table.insert(disposal, e) end
        if e.type == "inserter" then
            table.insert(inserters, e)
            local source, sink = e.pickup_target, e.drop_target
            if source and sink and source.name == "steel-chest" and sink.type == "infinity-container" then
                table.insert(outputs, e); output_units[e.unit_number] = true
            end
            if source and source.type == "transport-belt" and source.belt_shape ~= "straight" then
                table.insert(bends, e); bend_units[e.unit_number] = true
            end
            if source and source.type == "infinity-container" and sink
                and (sink.type == "transport-belt" or sink.type == "underground-belt") then
                for _, filter in pairs(source.infinity_container_filters or {}) do
                    feeds[filter.name] = feeds[filter.name] or {}
                    table.insert(feeds[filter.name], e); feed_units[e.unit_number] = true
                end
            end
        end
    end
end
for _, group in ipairs({outputs, recyclers, science, capacitors, bends, inserters}) do table.sort(group, by_position) end
report.topology = {outputs = #outputs, science = #science, recyclers = #recyclers, capacitors = #capacitors,
    bends = {}, disposal = #disposal, recycler_targets = {}, red_outlets = {}}
check(#outputs == 4 and #science == 4 and #recyclers == 2 and #capacitors == 2 and #bends == 2 and #disposal == 1,
    "original two-cell topology")
local buffer_units, result_targets = {}, {}
for _, e in ipairs(outputs) do
    local buffer = e.pickup_target
    check(not buffer_units[buffer.unit_number], "one original steel buffer per terminal taker")
    buffer_units[buffer.unit_number] = true; table.insert(buffers, buffer)
end
-- branch i follows sorted terminal i: its buffer, the one arm dropping into that buffer from a science machine, and
-- that machine. The four branch machines are exactly the four science machines.
local branches, branch_machines = {}, {}
report.topology.branches = {}
local function at(e) return {unit = e.unit_number, position = e.position} end
for i, terminal in ipairs(outputs) do
    local buffer, drain = buffers[i], nil
    for _, e in ipairs(inserters) do
        if e.drop_target and e.drop_target.unit_number == buffer.unit_number and e.pickup_target
            and science_units[e.pickup_target.unit_number] then
            check(drain == nil, "exactly one science arm drops into each steel buffer"); drain = e
        end
    end
    check(drain ~= nil, "a science arm drops into each steel buffer")
    local machine = drain.pickup_target
    check(not branch_machines[machine.unit_number], "one steel buffer per science machine")
    branch_machines[machine.unit_number] = true
    branches[i] = {terminal = terminal, buffer = buffer, drain = drain, machine = machine}
    report.topology.branches[i] = {terminal = at(terminal), buffer = at(buffer), drain = at(drain), machine = at(machine)}
end
for unit in pairs(science_units) do check(branch_machines[unit], "every science machine is a branch machine") end
-- (record only) every inserter of the build with its native position, for the cold-start wiring audit
report.topology.arms = {}
for _, e in ipairs(inserters) do table.insert(report.topology.arms, at(e)) end
for _, recycler in ipairs(recyclers) do
    local ok, target = pcall(function() return recycler.drop_target end)
    if not (ok and target and target.valid) then
        target = nil
        -- Recycler drop_position is the scatter point for results (399.35, 7.70 here), not the receiving machine's
        -- center. The unchanged original scaffold places its receiving plant two tiles east and four north.
        local receiving_position = {x = recycler.position.x + 2, y = recycler.position.y - 4}
        for _, candidate in ipairs(recycler.surface.find_entities_filtered({position = receiving_position})) do
            if candidate.name == "electromagnetic-plant" then
                check(target == nil, "one plant at each original recycler result position"); target = candidate
            end
        end
    end
    -- During a staged cold start a recycler has not chosen its recipe yet, so a target electromagnetic plant
    -- may not appear in the recipe-derived capacitor set above. Its native drop target still identifies it.
    check(target and target.name == "electromagnetic-plant", "recycler results must enter an electromagnetic plant; found "
        .. tostring(target and target.name))
    capacitor_units[target.unit_number] = true
    check(not result_targets[target.unit_number], "one recycler per supercapacitor plant")
    result_targets[target.unit_number] = true
    table.insert(report.topology.recycler_targets, {recycler = recycler.unit_number, plant = target.unit_number,
        recycler_position = recycler.position, plant_position = target.position})
end
local red_sources = {}
for _, e in ipairs(inserters) do
    local source, sink = e.pickup_target, e.drop_target
    if source and recycler_units[source.unit_number] then
        check(not red_sources[source.unit_number], "one advanced-circuit taker per original recycler")
        red_sources[source.unit_number] = true
        local filter = e.get_filter(1)
        check(filter and filter.name == "advanced-circuit", "original recycler taker must filter advanced circuits")
        check(sink and sink.name == "turbo-transport-belt", "original advanced circuits must leave on their belt")
        red_units[e.unit_number] = true
        table.insert(report.topology.red_outlets, {unit = e.unit_number, position = e.position, recycler = source.unit_number,
            belt = sink.name, belt_position = sink.position, belt_direction = sink.direction})
    end
end
check(#report.topology.red_outlets == 2, "one original advanced-circuit taker per recycler")
for _, name in ipairs({"accumulator", "processing-unit", "battery", "holmium-plate", "superconductor"}) do
    check(feeds[name] and #feeds[name] > 0, "original source for " .. name)
end
for _, e in ipairs(bends) do
    local b = e.pickup_target
    check(e.drop_target and capacitor_units[e.drop_target.unit_number], "original bend must feed a supercapacitor plant")
    table.insert(report.topology.bends, {shape = b.belt_shape, direction = b.direction,
        lengths = {b.get_transport_line(1).line_length, b.get_transport_line(2).line_length}})
end
local function role(e)
    if output_units[e.unit_number] then return "science-output", true end
    if bend_units[e.unit_number] then return "bend-input", true end
    if red_units[e.unit_number] then return "advanced-circuit-taker", true end
    if feed_units[e.unit_number] then return "supply-feeder", false end
    local source, sink = e.pickup_target, e.drop_target
    if source and science_units[source.unit_number] then return "science-buffer-feeder", true end
    if sink and science_units[sink.unit_number] then return "science-input", true end
    if sink and capacitor_units[sink.unit_number] then return "supercapacitor-input", true end
    if sink and recycler_units[sink.unit_number] then return "recycler-input", true end
    return "internal", false
end
local function partial_hands()
    local result = {}
    for _, e in ipairs(inserters) do
        local count = held(e)
        if count > 0 and count < 16 then
            local name, relevant = role(e)
            table.insert(result, {unit = e.unit_number, position = e.position, role = name, relevant = relevant,
                count = count, item = e.held_stack.name,
                source = e.pickup_target and e.pickup_target.unit_number, sink = e.drop_target and e.drop_target.unit_number})
        end
    end
    return result
end
local function crafts()
    local n = 0
    for _, e in ipairs(science) do n = n + e.products_finished end
    return n
end
local function science_stock()
    local stock = {total = 0, buffers = {}, machine_outputs = {}, held = {}, products_finished = crafts()}
    for _, e in ipairs(buffers) do
        local count = e.get_inventory(defines.inventory.chest).get_item_count(ITEM)
        stock.total = stock.total + count; table.insert(stock.buffers, count)
    end
    for _, e in ipairs(science) do
        local count = e.get_inventory(defines.inventory.crafter_output).get_item_count(ITEM)
        stock.total = stock.total + count; table.insert(stock.machine_outputs, count)
    end
    for _, e in ipairs(inserters) do
        if e.held_stack.valid_for_read and e.held_stack.name == ITEM then
            local count = held(e)
            stock.total = stock.total + count; table.insert(stock.held, {unit = e.unit_number, count = count})
        end
    end
    -- per branch, the science it holds (buffer, machine output, drain and terminal hands) and its machine's counter
    stock.reserve_by_branch, stock.pf_by_branch = {}, {}
    for i, b in ipairs(branches) do
        local reserve = b.buffer.get_inventory(defines.inventory.chest).get_item_count(ITEM)
            + b.machine.get_inventory(defines.inventory.crafter_output).get_item_count(ITEM)
        for _, e in ipairs({b.drain, b.terminal}) do
            if e.held_stack.valid_for_read and e.held_stack.name == ITEM then reserve = reserve + held(e) end
        end
        stock.reserve_by_branch[i], stock.pf_by_branch[i] = reserve, b.machine.products_finished
    end
    return stock
end
local function red_stock()
    local counts = {}
    for _, e in ipairs(recyclers) do
        table.insert(counts, e.get_inventory(defines.inventory.crafter_output).get_item_count("advanced-circuit"))
    end
    return counts
end
local function recycler_crafts()
    local counts = {}
    for _, e in ipairs(recyclers) do table.insert(counts, e.products_finished) end
    return counts
end
local function recycler_full(e)
    return e.status == defines.entity_status.full_output or e.status == defines.entity_status.waiting_for_space_in_destination
end
local red_stack_size = prototypes.item["advanced-circuit"].stack_size
-- A cold staged recycler has not selected a recipe yet. Read the original cell's native recycling prototype.
-- In the recorded 2.1.21 API this result has amount 0 and extra_count_fraction 0.5: zero or one, not a zero batch.
local red_recipe = prototypes.recipe["processing-unit-recycling"]
check(red_recipe ~= nil, "native processing-unit recycling recipe")
local red_batch_max = 0
for _, product in ipairs(red_recipe.products or {}) do
    if product.type == "item" and product.name == "advanced-circuit" then
        local extra = (product.extra_count_fraction or 0) > 0 and 1 or 0
        red_batch_max = math.max(red_batch_max, math.ceil(math.max(product.amount or 0, product.amount_max or 0)) + extra)
        report.native_advanced_circuit_product = product
    end
end
check(red_batch_max > 0 and red_batch_max <= red_stack_size, "native advanced-circuit result batch")
local red_stop_min = red_stack_size - red_batch_max + 1
local started, previous, current = game.tick, {}, {0, 0, 0, 0}
for i, e in ipairs(outputs) do previous[i] = held(e) end
local stage, trial_index, stage_at = "settle", 0, 0
local quiet_ticks, craft_quiet_ticks, output_quiet_ticks, last_crafts = 0, 0, 0, crafts()
local consecutive, max_consecutive, hold = 0, 0, {}
local boundary_kept = nil
local last_boundary_stock = science_stock()
local function event(action, tick)
    table.insert(report.events, {tick = tick, phase = tick % options.period, action = action, trial = trial_index})
end
local function targets(trial)
    if trial.kind == "supply" then return assert(feeds[trial.item], "source " .. trial.item) end
    check(trial.kind == "output" and (trial.item == "advanced-circuit" or trial.item == ITEM), "known output loss")
    return trial.item == "advanced-circuit" and disposal or outputs
end
local function loss(on, tick)
    local trial = options.trials[trial_index]
    for _, entity in ipairs(targets(trial)) do
        entity.disabled_by_script = on
        check(entity.disabled_by_script == on, "loss flag must take effect on " .. entity.name)
    end
    event(on and "cut" or "restore", tick)
end
local function phase_offset(trial)
    local phase = trial.phase_offset
    if phase == nil then phase = options.phase_offset or 0 end
    check(phase >= 0 and phase < options.period and phase % 1 == 0, "cut phase must be a tick within the period")
    return phase
end
local function begin_trial(tick)
    trial_index = trial_index + 1
    if trial_index > #options.trials then
        report.finished, report.finished_tick = true, tick
        write(); script.on_nth_tick(1, nil); return
    end
    stage, stage_at, quiet_ticks, craft_quiet_ticks, output_quiet_ticks, last_crafts = "cut", tick, 0, 0, 0, crafts()
    local trial = options.trials[trial_index]
    report.trials[trial_index] = {kind = trial.kind, item = trial.item, cut_at = tick, cut_phase = tick % options.period,
        red_max = {0, 0}, recycler_full_ticks = {0, 0}, red_stack_size = red_stack_size,
        red_batch_max = red_batch_max, red_stop_min = red_stop_min, recovered = false,
        partial_hands_at_cut = partial_hands(), science_stock_at_cut = science_stock(), recovery_samples = {}}
    loss(true, tick); write()
end
local function advanced_loss(trial) return trial.kind == "output" and trial.item == "advanced-circuit" end
local function red_blocked(trial)
    for i = 1, #recyclers do
        if trial.red_max[i] < trial.red_stop_min or trial.recycler_full_ticks[i] == 0 then return false end
    end
    return true
end
local function red_cleared(trial, red)
    for i = 1, #recyclers do
        if red[i] > 16 or red[i] >= trial.red_max[i] then return false end
    end
    return true
end
script.on_nth_tick(1, function()
    local ok, problem = pcall(function()
        local tick, dropped = game.tick - started, 0
        for i, e in ipairs(outputs) do
            local now = held(e)
            if now < previous[i] then
                local amount = previous[i] - now
                current[i], dropped = current[i] + amount, dropped + amount
            end
            previous[i] = now
        end
        local now_crafts = crafts()
        craft_quiet_ticks = now_crafts == last_crafts and craft_quiet_ticks + 1 or 0
        output_quiet_ticks = dropped == 0 and output_quiet_ticks + 1 or 0
        quiet_ticks = now_crafts == last_crafts and dropped == 0 and quiet_ticks + 1 or 0
        last_crafts = now_crafts
        if stage == "cut" then
            local trial, red = report.trials[trial_index], red_stock()
            for i, e in ipairs(recyclers) do
                trial.red_max[i] = math.max(trial.red_max[i], red[i])
                if recycler_full(e) then trial.recycler_full_ticks[i] = trial.recycler_full_ticks[i] + 1 end
            end
            local blocked = not advanced_loss(trial) or red_blocked(trial)
            if tick - stage_at >= options.minimum_cut_ticks and quiet_ticks >= options.stopped_ticks and blocked then
                trial.stopped, trial.restore_at, trial.restore_phase = true, tick, tick % options.period
                trial.stopped_after_ticks = tick - stage_at - quiet_ticks
                trial.craft_quiet_ticks, trial.output_quiet_ticks, trial.joint_quiet_ticks = craft_quiet_ticks, output_quiet_ticks, quiet_ticks
                trial.partial_hands_at_restore = partial_hands()
                trial.science_stock_at_restore, trial.red_at_restore = science_stock(), red
                trial.recycler_crafts_at_restore = recycler_crafts()
                if advanced_loss(trial) then trial.advanced_disposal_blocked = true end
                loss(false, tick)
                stage, stage_at, consecutive, max_consecutive, hold = "recovery", tick, 0, 0, {}
                write()
            elseif tick - stage_at >= options.maximum_cut_ticks then
                error("loss did not stop crafting and final deliveries with required blocking evidence: " .. trial.kind .. " " .. trial.item)
            end
        end
        if tick % options.period == 0 then
            local stock, exact = science_stock(), true
            local bin_stage, bin_trial, bin_delivered = stage, trial_index, current
            for _, count in ipairs(current) do if count ~= 16 then exact = false end end
            if stage == "settle" and tick >= options.settle_ticks then
                stage, stage_at = "baseline", tick; report.baseline_stock_start = stock
            elseif stage == "baseline" then
                table.insert(report.baseline, current); report.baseline_stock_end = stock
                if #report.baseline >= options.baseline_periods then stage, stage_at = "between", tick end
            elseif stage == "recovery" then
                local trial = report.trials[trial_index]
                -- Exclude a bin that began before restoration, including the boundary of the restore tick itself.
                if tick - options.period < stage_at then
                    trial.skipped_partial_bins = (trial.skipped_partial_bins or 0) + 1
                else
                    local red = red_stock()
                    table.insert(trial.recovery_samples, {tick = tick, output = current, science_stock = stock.total,
                        products_finished = stock.products_finished, red = red, reserve_by_branch = stock.reserve_by_branch})
                    if advanced_loss(trial) and red_cleared(trial, red) then
                        trial.advanced_disposal_cleared = true
                        trial.first_red_cleared_tick = trial.first_red_cleared_tick or tick
                    end
                    consecutive = exact and consecutive + 1 or 0
                    max_consecutive = math.max(max_consecutive, consecutive); trial.max_exact_periods = max_consecutive
                    if exact then
                        table.insert(hold, {output = current, stock_start = last_boundary_stock})
                        if #hold > options.recovery_hold_periods then table.remove(hold, 1) end
                    else hold = {} end
                    if #hold == options.recovery_hold_periods then
                        local first_stock = hold[1].stock_start
                        local drift = stock.total - first_stock.total
                        local production = stock.products_finished - first_stock.products_finished
                        trial.last_candidate_stock_drift, trial.last_candidate_products_finished = drift, production
                        local disposal_ok = not advanced_loss(trial) or red_cleared(trial, red)
                        if drift >= -report.maximum_hold_stock_drain and production > 0 and disposal_ok then
                            trial.recovered, trial.recovery_periods, trial.hold_periods = true,
                                math.ceil((tick - stage_at) / options.period) - options.recovery_hold_periods, options.recovery_hold_periods
                            trial.last_periods = {}
                            for _, period in ipairs(hold) do table.insert(trial.last_periods, period.output) end
                            trial.hold_stock_start, trial.hold_stock_end, trial.hold_stock_drift = first_stock, stock, drift
                            trial.hold_products_finished = production
                            trial.red_at_recovery, trial.recycler_crafts_at_recovery = red, recycler_crafts()
                            trial.recovered_at = tick
                            stage, stage_at = "between", tick
                            keep_boundary(tick, bin_stage, bin_trial, stock, bin_delivered); boundary_kept = tick
                            write()
                        end
                    end
                end
            end
            if stage ~= "settle" and boundary_kept ~= tick then keep_boundary(tick, bin_stage, bin_trial, stock, bin_delivered) end
            last_boundary_stock, current = stock, {0, 0, 0, 0}
        end
        -- Count a successful last allowed bin before applying the recovery timeout.
        if stage == "recovery" and tick - stage_at >= options.maximum_recovery_ticks then
            error("clock did not recover with production and stock accounting: " .. report.trials[trial_index].item)
        end
        if stage == "between" then
            local next_trial = options.trials[trial_index + 1]
            if next_trial == nil then begin_trial(tick)
            elseif tick > stage_at and tick % options.period == phase_offset(next_trial) then begin_trial(tick) end
        end
        if tick >= options.last_tick and not report.finished then error("probe budget exhausted") end
    end)
    if not ok then
        report.error = problem
        report.failure = {tick = game.tick - started, stage = stage, trial = trial_index, science_stock = science_stock(),
            red = red_stock(), partial_hands = partial_hands(), craft_quiet_ticks = craft_quiet_ticks, output_quiet_ticks = output_quiet_ticks}
        write(); script.on_nth_tick(1, nil); error(problem)
    end
end)

end
-- Freshly revived inserters discover their pickup/drop targets on the following tick. Observe after that discovery;
-- the recorder still starts at placement, and the acceptance baseline follows the same fixed settle interval.
local delay = options.initialization_delay_ticks or 0
if delay > 0 then
    local started = game.tick
    script.on_nth_tick(1, function()
        if game.tick - started >= delay then
            script.on_nth_tick(1, nil)
            run_probe(all_entities)
        end
    end)
else run_probe(all_entities) end
