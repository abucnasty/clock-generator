-- Containers as chests, compared with the simulator inserter by inserter. On install the probe puts a container's
-- starting contents in (options.car: {slot, item, count} per slot; options.silo: {rocket = {{item, count}}, input = ...})
-- and then logs, every tick for options.ticks ticks, each inserter's hand when it changes. At the end it writes the
-- hands, what each inserter holds, a container's slots and a silo's rocket inventory and input slots.
local entities = ...
local inserters, car, wagon, silo = {}, nil, nil, nil
for _, entity in pairs(entities) do
    if entity.type == "inserter" then table.insert(inserters, entity)
    elseif entity.type == "car" then car = entity
    elseif entity.type == "cargo-wagon" then wagon = entity
    elseif entity.type == "rocket-silo" then silo = entity end
end
-- the config lists its inserters west to east, then north to south
table.sort(inserters, function(a, b)
    if a.position.x ~= b.position.x then return a.position.x < b.position.x end
    return a.position.y < b.position.y
end)
if options.car then
    local trunk = car.get_inventory(defines.inventory.car_trunk)
    for _, content in ipairs(options.car) do trunk[content[1]].set_stack({name = content[2], count = content[3]}) end
end
if options.silo then
    local rocket = silo.get_inventory(defines.inventory.rocket_silo_rocket)
    for _, content in ipairs(options.silo.rocket or {}) do assert(rocket.insert({name = content[1], count = content[2]}) == content[2]) end
    local input = silo.get_inventory(defines.inventory.crafter_input)
    for _, content in ipairs(options.silo.input or {}) do assert(input.insert({name = content[1], count = content[2]}) == content[2]) end
end
local function hand(inserter)
    local stack = inserter.held_stack
    return stack.valid_for_read and (stack.name .. ":" .. stack.count) or ""
end
local function slots(inventory)
    local out = {}
    for slot = 1, #inventory do
        local stack = inventory[slot]
        out[slot] = stack.valid_for_read and (stack.name .. ":" .. stack.count) or ""
    end
    return out
end
local function contents(inventory)
    local out = {}
    for _, content in pairs(inventory.get_contents()) do out[content.name] = (out[content.name] or 0) + content.count end
    return out
end
local report = {hands = {}, ticks = options.ticks}
local last = {}
for index, inserter in ipairs(inserters) do report.hands[index] = {}; last[index] = hand(inserter) end
local started = game.tick
script.on_nth_tick(1, function()
    for index, inserter in ipairs(inserters) do
        local now = hand(inserter)
        if now ~= last[index] then
            table.insert(report.hands[index], {tick = game.tick - started, hand = now})
            last[index] = now
        end
    end
    if game.tick - started >= options.ticks then
        script.on_nth_tick(1, nil)
        report.held = {}
        report.status = {}
        for index, inserter in ipairs(inserters) do report.held[index] = hand(inserter) end
        local container = car or wagon
        if container then
            report.slots = slots(container.get_inventory(car and defines.inventory.car_trunk or defines.inventory.cargo_wagon))
        end
        if silo then
            report.rocket = contents(silo.get_inventory(defines.inventory.rocket_silo_rocket))
            report.rocket_slots = slots(silo.get_inventory(defines.inventory.rocket_silo_rocket))
            report.input = contents(silo.get_inventory(defines.inventory.crafter_input))
            report.rocket_parts = silo.rocket_parts
        end
        helpers.write_file("containers-probe.json", helpers.table_to_json(report), false)
    end
end)
