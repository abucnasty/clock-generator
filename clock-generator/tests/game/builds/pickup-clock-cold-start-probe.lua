-- Observe a clocked cold start without changing anything: the lane phase of the pickup tile at placement, the lattice
-- its stock keeps in every period, and the clock against the probe tick.
-- options: ticks, period, units (the belt tier's step in 1/32 tile a tick: 1 normal, 2 fast, 3 express, 4 turbo)
local entities, surface = ...
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
capture.each_tick{first_tick = 1, last_tick = options.ticks, report = report, output = "clock-cold-start.json", sample = function(tick)
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
    return nil
end}
