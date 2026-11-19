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
--   block   one row a tick from 10 window cycles before the output block to 40 after its release. Columns are in report.series.block.columns:
--           tick, both furnaces' output stock, ore, crafting progress, productivity bar and products finished, the stack in the hand of each
--           output inserter, the clock's counter, then `lanes`: for each transport line of the output belt (report.series.block.lines, from the
--           drop tile furthest upstream to the loader, every line of each piece), the stacks on it as flat pairs of position and count
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
    -- the output block's rows: each furnace's output inserter, and the output belt's pieces from the drop tiles to the loader
    local putters, lines = {}, nil
    local block = {
        columns = {"t", "stock_1", "stock_2", "ore_1", "ore_2", "progress_1", "progress_2", "bonus_1", "bonus_2", "finished_1", "finished_2",
            "out_hand_1", "out_hand_2", "clock", "lanes"},
        rows = {},
    }
    report.series.block = block
    local block_ring, block_logged_until = {}, -1
    local function find_putters()
        for k, final in ipairs(finals) do
            for _, entity in pairs(entities) do
                if entity.valid and entity.type == "inserter" and entity.pickup_target == final.entity then putters[k] = entity end
            end
        end
    end
    local function walk(start)
        local list, seen, piece = {}, {}, start
        while piece and piece.valid and not seen[piece.unit_number] do
            seen[piece.unit_number] = true
            table.insert(list, piece)
            if piece.type == "loader" or piece.type == "loader-1x1" then break end
            if piece.type == "underground-belt" and piece.belt_to_ground_type == "input" then
                piece = piece.underground_belt_neighbour
            else
                local next_pieces = piece.belt_neighbours.outputs
                piece = next_pieces and next_pieces[1]
            end
        end
        return list
    end
    local function find_lines()
        local longest = {}
        for k = 1, 2 do
            local list = walk(putters[k].drop_target)
            if #list > #longest then longest = list end
        end
        lines = {}
        block.lines = {}
        block.putters = {}
        for k = 1, 2 do
            local ok, mirrored = pcall(function() return putters[k].mirroring end)
            block.putters[k] = {unit = putters[k].unit_number, drop_target = putters[k].drop_target.unit_number,
                drop_position = putters[k].drop_position, mirrored = ok and mirrored or nil}
        end
        for at, piece in ipairs(longest) do
            for index = 1, piece.get_max_transport_line_index() do
                local line = piece.get_transport_line(index)
                table.insert(lines, line)
                table.insert(block.lines, {piece = at, unit = piece.unit_number, name = piece.name, type = piece.type,
                    underground = piece.type == "underground-belt" and piece.belt_to_ground_type or nil,
                    position = piece.position, direction = piece.direction, belt_shape = piece.type == "transport-belt" and piece.belt_shape or nil,
                    index = index, length = line.line_length})
            end
        end
    end
    local sources = {}
    local source_index = defines.inventory.crafter_input or defines.inventory.furnace_source
    for k, final in ipairs(finals) do sources[k] = final.entity.get_inventory(source_index) end
    local function block_row(t, position)
        if #putters < 2 then putters = {} find_putters() if #putters ~= 2 then putters = {} end end
        if lines == nil and #putters == 2 and putters[1].drop_target and putters[2].drop_target then find_lines() end
        local lanes = {}
        for at, line in ipairs(lines or {}) do
            local flat = {}
            for _, item in ipairs(line.get_detailed_contents()) do
                table.insert(flat, item.position)
                table.insert(flat, item.stack.count)
            end
            lanes[at] = flat
        end
        local f1, f2 = finals[1].entity, finals[2].entity
        return {t, outputs[1].get_item_count(finals[1].item), outputs[2].get_item_count(finals[2].item),
            sources[1].get_item_count(), sources[2].get_item_count(), f1.crafting_progress, f2.crafting_progress,
            f1.bonus_progress, f2.bonus_progress, f1.products_finished, f2.products_finished, hand(putters[1]), hand(putters[2]), position, lanes}
    end
    spec.each_tick = function(t)
        if #takers < 2 then takers = {} find_takers() if #takers ~= 2 then takers = {} end end
        local position = capture.clock_value(clock)
        local row = {t, outputs[1].get_item_count(finals[1].item), outputs[2].get_item_count(finals[2].item), trunk.get_item_count(),
            drill.status, drill.disabled_by_script and 1 or 0, position,
            finals[1].entity.products_finished, finals[2].entity.products_finished, hand(takers[1]), hand(takers[2])}
        ring[t % ring_size] = row
        if t <= logged_until then table.insert(rows, row) end
        local brow = block_row(t, position)
        block_ring[t % ring_size] = brow
        if t <= block_logged_until then table.insert(block.rows, brow) end
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
            elseif event.action == "block-output" then
                if t > block_logged_until then
                    for earlier = math.max(0, event.tick - 10 * series_period), t do
                        local kept = block_ring[earlier % ring_size]
                        if kept and kept[1] == earlier then table.insert(block.rows, kept) end
                    end
                end
                block_logged_until = math.huge
            elseif event.action == "restore-output" then
                block_logged_until = event.tick + 40 * series_period
            end
        end
    end
    return original_run(spec)
end
