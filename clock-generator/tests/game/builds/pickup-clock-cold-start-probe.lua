-- Observe a clocked cold start without changing anything: the lane phase of the pickup tile at placement, the lattice
-- its stock keeps in every period, and the clock against the probe tick. The run is timed in game ticks (the game tests'
-- protocol): it lasts until the machine making the target has made `expected` over the trailing `window` ticks, no less than
-- one clock cycle earlier (steady state), then one more window, at most `ticks`; the recording is cut there too (settle.record_samples).
-- options: ticks, period, units (the belt tier's step in 1/32 tile a tick: 1 normal, 2 fast, 3 express, 4 turbo), window,
-- expected, recipes, item
local entities, surface, _, settle = ...
local machine = capture.find_one(entities, function(entity) return entity.type == "assembling-machine" end, "machine")
local box = machine.bounding_box
local input = capture.find_one(entities, function(entity)
    if entity.type ~= "inserter" then return false end
    local drop = entity.drop_position
    return drop.x >= box.left_top.x and drop.x <= box.right_bottom.x and drop.y >= box.left_top.y and drop.y <= box.right_bottom.y
end, "input")
local belt = capture.find_one(surface.find_entities_filtered{position = input.pickup_position, type = {"transport-belt", "underground-belt"}},
    function() return true end, "source belt")
local clock = capture.find_one(entities, function(entity)
    return entity.type == "decider-combinator" and string.sub(entity.combinator_description or "", 1, 9) == "Clock for"
end, "generated clock")
local step = math.floor(belt.prototype.belt_speed * 256 + 0.5)
assert(step == 8 * options.units, "belt step is " .. step .. ", expected " .. 8 * options.units)

-- positions in 1/256 tile; a stack on the lattice of a full lane stands at 8q + 64k
local function stock(line)
    local out = {}
    for _, d in pairs(line.get_detailed_contents()) do
        table.insert(out, {p = d.position * 256, count = d.stack.count, item = d.stack.name})
    end
    table.sort(out, function(a, b) return a.p < b.p end)
    return out
end
local function on_grid(p) return math.abs(p - math.floor(p + 0.5)) < 1e-6 and math.floor(p + 0.5) % 8 == 0 end

-- the phase q of each pickup line at placement: every stack at 8q + 64k, all of 4; -1 where the stock is not one lattice
local phases, initial = {}, {}
for lane = 1, 2 do
    local stacks = stock(belt.get_transport_line(lane))
    initial[lane] = stacks
    local q = nil
    for _, s in ipairs(stacks) do
        local here = on_grid(s.p) and s.count == 4 and (math.floor(s.p + 0.5) % 64) / 8 or -1
        if q == nil then q = here elseif q ~= here then q = -1 end
    end
    phases[lane] = q or -1
end

local report = {placement_tick = game.tick, step = step, phases = phases, initial = initial, periods = {}, clock_offsets = {}, samples = {}}
local offsets = {}
local finals = steady.final_machines(entities, options.recipes, options.item)
assert(#finals > 0, "no machine makes the target")
local function made()
    local total = 0
    for _, final in ipairs(finals) do total = total + final.entity.products_finished * final.worth end
    return total
end
local window, history, last_tick, last_at = options.window, {[0] = made()}, options.ticks, {}
local function observe(tick)
    -- the period of the model's frame the tick falls in (model held[i] is sample i + 4, and sample j is probe tick j + 1)
    local key = tostring(math.max(0, math.floor((tick - 5) / options.period)))
    local record = report.periods[key]
    if not record then
        record = {{off_lattice = 0, phases = {}}, {off_lattice = 0, phases = {}}}
        report.periods[key] = record
    end
    for lane = 1, 2 do
        for _, s in ipairs(stock(belt.get_transport_line(lane))) do
            if on_grid(s.p) then
                local q = tostring(((math.floor(s.p + 0.5) + step * tick) % 64) / 8)
                record[lane].phases[q] = true
            else
                record[lane].off_lattice = record[lane].off_lattice + 1
            end
        end
    end
    if tick % options.period < 64 then
        local offset = (capture.clock_value(clock) - (tick - 1)) % options.period
        if not offsets[offset] then
            offsets[offset] = true
            table.insert(report.clock_offsets, offset)
        end
    end
end
local started = game.tick
script.on_nth_tick(1, function()
    local tick = game.tick - started
    if tick < 1 then return end
    local ok, problem = pcall(function()
        observe(tick)
        history[tick] = made()
        -- steady state as steady.lua takes it: the trailing window at the target, and no lower than one clock cycle earlier
        local position = capture.clock_value(clock)
        local cycle_start = last_at[position]
        last_at[position] = tick
        local trailing = tick >= window and history[tick] - history[tick - window] or nil
        local settled = trailing ~= nil and cycle_start ~= nil and cycle_start >= window
            and trailing >= history[cycle_start] - history[cycle_start - window]
        if not report.steady and trailing ~= nil and trailing >= options.expected and settled then
            report.steady = tick
            -- the recording holds samples 0 .. tick + window - 1 (sample j is probe tick j + 1)
            last_tick = math.min(options.ticks, tick + window)
            report.samples_recorded = last_tick
            settle.record_samples(last_tick)
        end
        if tick >= last_tick then
            report.ticks = last_tick
            helpers.write_file("clock-cold-start.json", helpers.table_to_json(report), false)
        end
    end)
    if not ok or tick >= last_tick then script.on_nth_tick(1, nil) end
    if not ok then error(problem) end
end)
