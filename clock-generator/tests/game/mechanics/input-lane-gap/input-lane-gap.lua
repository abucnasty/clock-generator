-- A row of assemblers that take from one dead-end belt that chest feeders keep full, on one clock. Trials, one after the other
-- in one game: lock the clock, empty every belt, machine and hand, let the feeders run for options.phase ticks more, unlock
-- the clock and watch options.ticks. The phase is the ticks from the empty build to the unlock: 0 unlocks the clock the tick
-- after the clear. A trial records each machine's finished crafts every options.every ticks from the unlock (the first
-- recording is options.every ticks after it), the input inserters' hands (the tick since the unlock and the clock's value when
-- a hand was first full, its items, the belt's two lanes' item counts then) and the clock's value at the unlock.
-- options: trials = {{phase = n}, ...}, ticks (a trial), every, total (the ticks of all trials, from the first tick of the
-- script), output (the file).
local entities, surface, area = ...
local machines, inputs, belts = {}, {}, {}
local lock
for _, e in pairs(entities) do
    if e.valid then
        if e.type == "assembling-machine" then table.insert(machines, e) end
        if e.type == "inserter" then
            local drop = e.drop_target
            if drop and drop.valid and drop.type == "assembling-machine" then table.insert(inputs, e) end
        end
        if e.type == "constant-combinator" then
            for _, section in pairs(e.get_control_behavior().sections) do
                for _, filter in pairs(section.filters or {}) do
                    if filter.value and filter.value.name == "signal-lock" then lock = e.get_control_behavior() end
                end
            end
        end
        if e.type == "transport-belt" then table.insert(belts, e) end
    end
end
local counter = capture.find_one(entities, function(e)
    return e.type == "decider-combinator" and string.sub(e.combinator_description or "", 1, 9) == "Clock for"
end, "the clock")
assert(lock, "the clock has no lock")
-- the machines and their input inserters in order along the belt (it runs east)
table.sort(machines, function(a, b) return a.position.x < b.position.x end)
table.sort(inputs, function(a, b) return a.position.x < b.position.x end)
assert(#inputs == #machines, "one input inserter for each machine")

local function clear_all()
    for _, belt in ipairs(belts) do
        for line = 1, belt.get_max_transport_line_index() do belt.get_transport_line(line).clear() end
    end
    for _, machine in ipairs(machines) do
        machine.get_inventory(defines.inventory.crafter_input).clear()
        machine.get_inventory(defines.inventory.crafter_output).clear()
        machine.crafting_progress = 0
    end
    for _, e in pairs(entities) do
        if e.valid and e.type == "inserter" then e.held_stack.clear() end
    end
end

local report = {samples = {}, trials = {}, machines = #machines, ticks = options.ticks, every = options.every}
local current, index, unlock_at, end_at, base, hands = nil, 0, 0, 0, {}, {}

local function begin_trial(elapsed)
    index = index + 1
    local trial = options.trials[index]
    lock.enabled = true
    clear_all()
    unlock_at = elapsed + trial.phase + 1
    end_at = unlock_at + options.ticks
    current = {phase = trial.phase, clear_tick = elapsed, swings = {}, crafts = {}}
    for j = 1, #inputs do current.swings[j] = {}; hands[j] = {items = 0} end
    table.insert(report.trials, current)
end

capture.each_tick({first_tick = options.total, last_tick = options.total, report = report, output = options.output,
    sample = function() return {trials = index} end,
    after_tick = function(elapsed)
        if elapsed == 1 then begin_trial(elapsed) end
        if elapsed == unlock_at then
            lock.enabled = false
            current.clock_at_unlock = capture.clock_value(counter)
            for i, machine in ipairs(machines) do base[i] = machine.products_finished end
        end
        if elapsed > unlock_at then
            local since = elapsed - unlock_at
            local clock = capture.clock_value(counter)
            for j, inserter in ipairs(inputs) do
                local stack = inserter.held_stack
                local items = stack.valid_for_read and stack.count or 0
                local hand = hands[j]
                if items > 0 and hand.items == 0 then
                    local belt = inserter.pickup_target
                    hand.since, hand.clock, hand.most = since, clock, items
                    hand.lanes = {belt.get_transport_line(1).get_item_count(), belt.get_transport_line(2).get_item_count()}
                end
                if items > 0 then hand.most = math.max(hand.most, items) end
                if items == 0 and hand.items > 0 then
                    table.insert(current.swings[j], {hand.since, hand.clock, hand.most, hand.lanes[1], hand.lanes[2]})
                end
                hand.items = items
            end
            if since % options.every == 0 then
                local made = {}
                for i, machine in ipairs(machines) do made[i] = machine.products_finished - base[i] end
                table.insert(current.crafts, {since, made})
            end
        end
        if elapsed == end_at and index < #options.trials then begin_trial(elapsed) end
    end})
