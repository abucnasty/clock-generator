-- The original scaffold of #100 (two cells, 96 science a second) on its generated clock, under the game tests' protocol
-- (steady.lua). The clock sets the rate through the arms that drop the science into the infinity chests, the terminals (four
-- takers that empty the steel buffers, or, in the scaffold without buffer chests, the four drains of the science plants), so
-- what the run counts is what the terminals drop. A warm run has the disturbances below, one each; a cold (staged) run has
-- none, and its recording is cut at the end of the baseline (settle.record_samples).
--   cut <item>   the feeder inserters of the item switched off and, in that tick, every item of it taken from the belt lanes
--                and the supply chests upstream (machine inventories and inserter hands stay as they are)
--   block output the four terminals switched off
--   block advanced-circuit disposal  the loader that disposes of the advanced circuits switched off (the recyclers fill, stop,
--                and the plants starve)
-- Kept for the test: a branch map (terminal, buffer, drain and science machine per sorted terminal), every inserter's native
-- position, and the closure of each branch's science over the baseline's whole clock cycles (from the steady-state tick to the
-- last baseline tick at which the clock stands where it stood then): what its machine made, what its terminal dropped, and the
-- change of what the branch holds (buffer, machine output, hands of its drain and terminal).
-- The same probe observes the scaffold without buffer chests, where each science plant's drain drops into an infinity chest and
-- is the terminal: a branch is "exact" when its drain drops into a buffer, "rate" into a sink that never blocks.
local all_entities, _, _, settle = ...
local placed_at = game.tick
local function run_probe(entities)
local ITEM = "electromagnetic-science-pack"
-- what each branch carries a period, and how far a branch whose drain never blocks may fall behind it
local SHARE, HAND = options.share_per_period or 16, options.hand or 16
local outputs, recyclers, science, capacitors, bends, disposal, inserters = {}, {}, {}, {}, {}, {}, {}
local feeds, feed_units, output_units, bend_units, red_units = {}, {}, {}, {}, {}
local science_units, capacitor_units, recycler_units, buffers = {}, {}, {}, {}
local report = {period = options.period, topology = {}, events = {}, evidence = {}}
local function write() helpers.write_file("electromagnetic-science-240-recycler-belt-fed-clock.json", helpers.table_to_json(report), false) end
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
-- the terminal outputs: every arm that drops into an infinity chest, from a buffer (a container) or straight from a
-- science machine (no buffer)
for _, e in ipairs(inserters) do
    local source, sink = e.pickup_target, e.drop_target
    if source and sink and sink.type == "infinity-container"
        and (source.type == "container" or science_units[source.unit_number]) then
        table.insert(outputs, e); output_units[e.unit_number] = true
    end
end
for _, group in ipairs({outputs, recyclers, science, capacitors, bends, inserters}) do table.sort(group, by_position) end
report.topology = {outputs = #outputs, science = #science, recyclers = #recyclers, capacitors = #capacitors,
    bends = {}, disposal = #disposal, recycler_targets = {}, red_outlets = {}}
check(#outputs == 4 and #science == 4 and #recyclers == 2 and #capacitors == 2 and #bends == 2 and #disposal == 1,
    "original two-cell topology")
local buffer_units, result_targets = {}, {}
-- buffers[i] is the buffer terminal i takes from, false where it takes straight from its science machine
for _, e in ipairs(outputs) do
    local source = e.pickup_target
    if science_units[source.unit_number] then table.insert(buffers, false)
    else
        check(not buffer_units[source.unit_number], "one original steel buffer per terminal taker")
        buffer_units[source.unit_number] = true; table.insert(buffers, source)
    end
end
-- branch i follows sorted terminal i: its buffer, the one arm dropping into that buffer from a science machine, and
-- that machine; without a buffer the terminal is that arm. The four branch machines are exactly the four science machines.
-- Its gate follows the sink of its drain: "exact" into a buffer, "rate" into a sink that never blocks.
local branches, branch_machines = {}, {}
report.topology.branches = {}
local function at(e) return {unit = e.unit_number, position = e.position} end
for i, terminal in ipairs(outputs) do
    local buffer, drain = buffers[i], nil
    if buffer then
        for _, e in ipairs(inserters) do
            if e.drop_target and e.drop_target.unit_number == buffer.unit_number and e.pickup_target
                and science_units[e.pickup_target.unit_number] then
                check(drain == nil, "exactly one science arm drops into each steel buffer"); drain = e
            end
        end
        check(drain ~= nil, "a science arm drops into each steel buffer")
    else drain = terminal end
    local machine = drain.pickup_target
    check(not branch_machines[machine.unit_number], "one steel buffer per science machine")
    branch_machines[machine.unit_number] = true
    local gate = drain.drop_target.type == "infinity-container" and "rate" or "exact"
    branches[i] = {terminal = terminal, buffer = buffer or nil, drain = drain, machine = machine, gate = gate}
    report.topology.branches[i] = {terminal = at(terminal), buffer = buffer and at(buffer) or nil, drain = at(drain),
        machine = at(machine), gate = gate}
end
report.share_per_period, report.hand = SHARE, HAND
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

local function red_stock()
    local counts = {}
    for _, e in ipairs(recyclers) do
        table.insert(counts, e.get_inventory(defines.inventory.crafter_output).get_item_count("advanced-circuit"))
    end
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
report.red_stack_size, report.red_batch_max, report.red_stop_min = red_stack_size, red_batch_max, red_stop_min

-- what the terminals dropped, by branch; counted once a tick, whoever asks first
local previous, delivered, counted = {}, {0, 0, 0, 0}, nil
for i, e in ipairs(outputs) do previous[i] = held(e) end
local function count()
    if counted ~= game.tick then
        counted = game.tick
        for i, e in ipairs(outputs) do
            local now = held(e)
            if now < previous[i] then delivered[i] = delivered[i] + previous[i] - now end
            previous[i] = now
        end
    end
    return delivered[1] + delivered[2] + delivered[3] + delivered[4]
end
-- per branch: its machine's counter (crafts and productivity payouts, a pack each), what it holds, what its terminal dropped
local function branch_snapshot(t)
    local pf, reserve = {}, {}
    for i, b in ipairs(branches) do
        local stock = (b.buffer and b.buffer.get_inventory(defines.inventory.chest).get_item_count(ITEM) or 0)
            + b.machine.get_inventory(defines.inventory.crafter_output).get_item_count(ITEM)
        for _, e in ipairs(b.drain == b.terminal and {b.drain} or {b.drain, b.terminal}) do
            if e.held_stack.valid_for_read and e.held_stack.name == ITEM then stock = stock + held(e) end
        end
        pf[i], reserve[i] = b.machine.products_finished, stock
    end
    return {tick = t, pf = pf, reserve = reserve, delivered = {delivered[1], delivered[2], delivered[3], delivered[4]}}
end

-- the belts, to take an item from their lanes
local belts, qualities = {}, {}
for _, e in pairs(entities) do
    if e.valid and (e.type == "transport-belt" or e.type == "underground-belt" or e.type == "splitter") then table.insert(belts, e) end
end
for name in pairs(prototypes.quality) do table.insert(qualities, name) end
local function event(t, action, extra)
    local row = {tick = t, action = action}
    for key, value in pairs(extra or {}) do row[key] = value end
    table.insert(report.events, row)
end
local function disable(list, on)
    for _, entity in ipairs(list) do
        entity.disabled_by_script = on
        check(entity.disabled_by_script == on, "loss flag must take effect on " .. entity.name)
    end
end
local function cut(item)
    return {
        kind = "cut " .. item,
        start = function(t)
            disable(feeds[item], true)
            -- everything upstream of the clocked machines goes: the belt lanes and the supply chests
            local from_belts, from_chests, seen = 0, 0, {}
            for _, e in ipairs(belts) do
                if e.valid then
                    for lane = 1, e.get_max_transport_line_index() do
                        for _, quality in ipairs(qualities) do
                            from_belts = from_belts + e.get_transport_line(lane).remove_item{name = item, quality = quality, count = 1000000}
                        end
                    end
                end
            end
            for _, feeder in ipairs(feeds[item]) do
                local chest = feeder.pickup_target
                if chest and chest.valid and not seen[chest.unit_number] then
                    seen[chest.unit_number] = true
                    local inventory = chest.get_inventory(defines.inventory.chest)
                    for _, quality in ipairs(qualities) do
                        from_chests = from_chests + inventory.remove{name = item, quality = quality, count = 1000000}
                    end
                end
            end
            event(t, "cut " .. item, {from_belts = from_belts, from_chests = from_chests})
        end,
        release = function(t) disable(feeds[item], false) event(t, "restore " .. item) end,
    }
end
local block_output = {
    kind = "block output",
    start = function(t) disable(outputs, true) event(t, "block-output") end,
    release = function(t) disable(outputs, false) event(t, "restore-output") end,
}
-- the red disposal blocked: the evidence that a recycler stopped on its advanced circuits is kept, as it is that stop that
-- starves the plants and lets the output fall
local evidence = {red_max = {0, 0}, recycler_full_ticks = {0, 0}, red_stop_min = red_stop_min, red_batch_max = red_batch_max}
report.evidence = evidence
local red_blocked = false
local block_red = {
    kind = "block advanced-circuit disposal",
    start = function(t) disable(disposal, true) red_blocked = true event(t, "block-disposal") end,
    release = function(t)
        disable(disposal, false)
        red_blocked = false
        evidence.red_at_release = red_stock()
        event(t, "restore-disposal")
    end,
}

-- the branches' drops, products and holdings from the steady-state tick to the last tick of the baseline at which the clock stands
-- where it stood then (the baseline's whole clock cycles, as steady.lua counts them)
local clock = steady.clock(entities)
local previous_snapshot, previous_position, start_snapshot, start_position, cycle_snapshot
local function observe(t)
    local protocol = report.protocol
    local snapshot, position = branch_snapshot(t), capture.clock_value(clock)
    if protocol.steady and not start_snapshot and t == protocol.steady + 1 then
        start_snapshot, start_position = previous_snapshot, previous_position
    end
    if start_snapshot and not protocol.baseline and position == start_position then cycle_snapshot = snapshot end
    if protocol.baseline and not report.baseline_ledger then
        local ledger = {ticks = 0, branches = {}}
        if cycle_snapshot then
            ledger.ticks = cycle_snapshot.tick - start_snapshot.tick
            for i = 1, #branches do
                local dropped = cycle_snapshot.delivered[i] - start_snapshot.delivered[i]
                local made = cycle_snapshot.pf[i] - start_snapshot.pf[i]
                local change = cycle_snapshot.reserve[i] - start_snapshot.reserve[i]
                ledger.branches[i] = {gate = branches[i].gate, delivered = dropped, made = made, reserve_start = start_snapshot.reserve[i],
                    reserve_end = cycle_snapshot.reserve[i], reserve_delta = change, residual = made - dropped - change}
            end
        end
        report.baseline_ledger = ledger
    end
    previous_snapshot, previous_position = snapshot, position
    if red_blocked then
        local red = red_stock()
        for i, e in ipairs(recyclers) do
            evidence.red_max[i] = math.max(evidence.red_max[i], red[i])
            if recycler_full(e) then evidence.recycler_full_ticks[i] = evidence.recycler_full_ticks[i] + 1 end
        end
    end
end

local disturbances = {}
if not options.cold then
    disturbances = {cut("accumulator"), cut("processing-unit"), cut("battery"), cut("holmium-plate"), cut("superconductor"),
        block_output, block_red}
end
steady.run{
    count = count, clock = clock,
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    disturbances = disturbances,
    each_tick = observe,
    report = report, output = "electromagnetic-science-240-recycler-belt-fed-clock.json", settle = settle,
    done = function()
        -- a run with no disturbance ends in the tick its baseline does, before the next observation: close the ledger here
        if not report.baseline_ledger then observe(report.protocol.ended) end
        report.red_at_end = red_stock()
        -- a staged start records from the placement: the recording ends with the run (sample j is the tick after j + 1 ticks)
        if options.cold then settle.record_samples(game.tick - placed_at) end
    end,
}

end
-- Freshly revived inserters discover their pickup/drop targets on the following tick. Observe after that discovery;
-- the recorder still starts at placement, and the protocol's ticks count from the first tick observed.
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
