-- A decider combinator switches inserters on and off at ticks the probe chooses; every tick the probe logs the decider's
-- input and output, each inserter's circuit signal, its disabled flag, the status the game shows, its hand (count and
-- position) and what its source and sink hold. One scenario is one cell, built away from the others:
--   a constant combinator (signal A, switched by the probe) -> a decider (A > 0 gives E = 1) -> the scenario's
--   circuit-controlled inserters (enabled while E > 0).
-- A scenario: {name, kind, schedule = {{tick, on}, ...}, gate2 = {{tick, on}, ...}}
--   kind "chest"         source chest full of iron plates -> legendary stack inserter -> empty chest
--   kind "machine-room"  chest -> inserter -> assembling machine 3 (iron gear wheel) that starts with `gears` in its output
--                        and `plates` (default none) in its input; a second inserter (on its own decider, signal B, `gate2`)
--                        takes its gears into a chest
--   kind "machine-craft" chest -> inserter (always enabled, no circuit) -> assembling machine 3 that starts with plates at
--                        its insertion limit and crafts: the inserter waits for room, which the machine's next craft makes
--   kind "wake-take"     as machine-room, but the feeder is always enabled (no circuit) and only the taker is switched
--                        (`schedule`): the feeder waits asleep on the machine at its block until the taker takes the gears
--   kind "belt-empty"    an empty turbo belt -> inserter -> chest; the probe puts plates on the belt's first tile from tick
--                        `belt_from` on
--   kind "belt-backed"   the same belt, filled and backed up before the inserter is enabled
--   kind "pair"          two inserters on one decider, each from its own chest into its own chest
--   kind "pair-shared"   two inserters on one decider that take from one chest holding `shared` plates
-- `schedule`: the ticks the probe switches signal A on (true) or off (false); before the first entry it is `initial`.
local entities, surface = ...
local base
for _, entity in pairs(entities) do if entity.valid then base = entity.position end end
local info = {scenarios = {}, status = {}}
for key, value in pairs(defines.entity_status) do info.status[tostring(value)] = key end

local PLATE, GEAR = "iron-plate", "iron-gear-wheel"
local SIG_A = {type = "virtual", name = "signal-A"}
local SIG_B = {type = "virtual", name = "signal-B"}
local SIG_E = {type = "virtual", name = "signal-E"}
local W = defines.wire_connector_id

local function clear(area)
    for _, other in pairs(surface.find_entities_filtered({area = area})) do
        if other.valid and other.type ~= "character" then other.destroy() end
    end
end

local function make(name, position, extra)
    local spec = {name = name, position = position, force = "player"}
    for key, value in pairs(extra or {}) do spec[key] = value end
    local entity = surface.create_entity(spec)
    assert(entity, "could not build " .. name .. " at " .. position[1] .. "," .. position[2])
    return entity
end

local function power(cx, cy)
    local iface = make("electric-energy-interface", {cx + 5, cy + 4})
    iface.electric_buffer_size = 1e10
    iface.power_production = 1e8
    iface.energy = 1e10
    make("substation", {cx + 2, cy + 4})
end

--- A constant combinator with `signal` (switched by `gate.enabled`) into a decider whose output is E = 1 while signal > 0
local function control(x, y, signal)
    local constant = make("constant-combinator", {x, y})
    local gate = constant.get_or_create_control_behavior()
    local section = gate.get_section(1) or gate.add_section()
    section.set_slot(1, {value = {type = signal.type, name = signal.name, quality = "normal"}, min = 1})
    gate.enabled = false
    local decider = make("decider-combinator", {x + 2, y}, {direction = defines.direction.east})
    decider.get_or_create_control_behavior().parameters = {
        conditions = {{first_signal = signal, comparator = ">", constant = 0}},
        outputs = {{signal = SIG_E, copy_count_from_input = false, constant = 1}},
    }
    assert(constant.get_wire_connector(W.circuit_red, true).connect_to(decider.get_wire_connector(W.combinator_input_red, true)),
        "could not wire the constant combinator")
    return {gate = gate, decider = decider, signal = signal}
end

local function wire_inserter(ctl, inserter)
    assert(ctl.decider.get_wire_connector(W.combinator_output_red, true).connect_to(inserter.get_wire_connector(W.circuit_red, true)),
        "could not wire the inserter")
    local behavior = inserter.get_or_create_control_behavior()
    behavior.circuit_enable_disable = true
    behavior.circuit_condition = {first_signal = SIG_E, comparator = ">", constant = 0}
end

local function stack_inserter(position, direction)
    return make("stack-inserter", position, {quality = "legendary", direction = direction})
end

local function chest(position, count)
    local box = make("steel-chest", position)
    if count and count > 0 then box.get_inventory(defines.inventory.chest).insert({name = PLATE, count = count}) end
    return box
end

local function gear_machine(position)
    local machine = make("assembling-machine-3", position, {recipe = "iron-gear-wheel"})
    if not machine.get_recipe() then machine.set_recipe("iron-gear-wheel") end
    return machine
end

local runs = {}
for index, spec in ipairs(options.scenarios) do
    local cx = math.floor(base.x) + 14 + ((index - 1) % 6) * 16 + 0.5
    local cy = math.floor(base.y) + 16 + math.floor((index - 1) / 6) * 16 + 0.5
    clear({{cx - 8, cy - 8}, {cx + 8, cy + 8}})
    power(cx, cy)
    local run = {spec = spec, log = {}, hands = {}, watch = {}}
    local ctl = control(cx - 6, cy - 5, SIG_A)
    run.controls = {ctl}
    local kind = spec.kind
    if kind == "chest" then
        local source = chest({cx - 1, cy}, 4800)
        local inserter = stack_inserter({cx, cy}, defines.direction.west)
        local sink = chest({cx + 1, cy})
        wire_inserter(ctl, inserter)
        run.hands = {inserter}
        run.watch = {{entity = source, inventory = defines.inventory.chest, item = PLATE}, {entity = sink, inventory = defines.inventory.chest, item = PLATE}}
    elseif kind == "machine-room" or kind == "wake-take" then
        local source = chest({cx - 1, cy}, 4800)
        local feeder = stack_inserter({cx, cy}, defines.direction.west)
        local machine = gear_machine({cx + 2, cy})
        local taker = stack_inserter({cx + 4, cy}, defines.direction.west)
        local sink = chest({cx + 5, cy})
        machine.get_inventory(defines.inventory.crafter_output).insert({name = GEAR, count = spec.gears})
        if spec.plates then machine.get_inventory(defines.inventory.crafter_input).insert({name = PLATE, count = spec.plates}) end
        if kind == "machine-room" then
            wire_inserter(ctl, feeder)
            local ctl2 = control(cx - 6, cy - 3, SIG_B)
            wire_inserter(ctl2, taker)
            run.controls = {ctl, ctl2}
        else
            wire_inserter(ctl, taker)
        end
        run.hands = {feeder, taker}
        run.machine = machine
        run.watch = {{entity = machine, inventory = defines.inventory.crafter_input, item = PLATE},
            {entity = machine, inventory = defines.inventory.crafter_output, item = GEAR}}
    elseif kind == "machine-craft" then
        local source = chest({cx - 1, cy}, 4800)
        local feeder = stack_inserter({cx, cy}, defines.direction.west)
        local machine = gear_machine({cx + 2, cy})
        local taker = stack_inserter({cx + 4, cy}, defines.direction.west)
        chest({cx + 5, cy})
        machine.get_inventory(defines.inventory.crafter_input).insert({name = PLATE, count = spec.plates})
        run.hands = {feeder, taker}
        run.machine = machine
        run.watch = {{entity = machine, inventory = defines.inventory.crafter_input, item = PLATE},
            {entity = machine, inventory = defines.inventory.crafter_output, item = GEAR}}
    elseif kind == "belt-empty" or kind == "belt-backed" then
        run.belts = {}
        for dx = -6, -1 do table.insert(run.belts, make("turbo-transport-belt", {cx + dx, cy}, {direction = defines.direction.east})) end
        local inserter = stack_inserter({cx, cy}, defines.direction.west)
        local sink = chest({cx + 1, cy})
        wire_inserter(ctl, inserter)
        run.hands = {inserter}
        run.watch = {{entity = sink, inventory = defines.inventory.chest, item = PLATE}}
        run.end_tile = run.belts[#run.belts]
    elseif kind == "pair" then
        local s1 = chest({cx - 1, cy}, 4800)
        local i1 = stack_inserter({cx, cy}, defines.direction.west)
        chest({cx + 1, cy})
        local s2 = chest({cx - 1, cy + 2}, 4800)
        local i2 = stack_inserter({cx, cy + 2}, defines.direction.west)
        chest({cx + 1, cy + 2})
        wire_inserter(ctl, i1)
        wire_inserter(ctl, i2)
        run.hands = {i1, i2}
    elseif kind == "pair-shared" then
        local shared = chest({cx, cy}, spec.shared)
        local i1 = stack_inserter({cx - 1, cy}, defines.direction.east)
        chest({cx - 2, cy})
        local i2 = stack_inserter({cx + 1, cy}, defines.direction.west)
        chest({cx + 2, cy})
        wire_inserter(ctl, i1)
        wire_inserter(ctl, i2)
        run.hands = {i1, i2}
        run.watch = {{entity = shared, inventory = defines.inventory.chest, item = PLATE}}
    else
        error("unknown kind " .. tostring(kind))
    end
    local columns = {"t"}
    for c = 1, #run.controls do for _, name in ipairs({"gate", "din", "dout"}) do table.insert(columns, name .. c) end end
    for h = 1, #run.hands do for _, name in ipairs({"sig", "dis", "status", "held", "x", "y"}) do table.insert(columns, name .. h) end end
    for w = 1, #run.watch do table.insert(columns, "w" .. w) end
    if run.machine then for _, name in ipairs({"mstatus", "finished", "progress"}) do table.insert(columns, name) end end
    if run.end_tile then table.insert(columns, "end_tile") end
    local units = {}
    for _, h in ipairs(run.hands) do table.insert(units, h.unit_number) end
    info.scenarios[index] = {name = spec.name, kind = kind, columns = columns, units = units}
    runs[index] = run
end

local function signal_at(entity, connector, signal)
    local network = entity.get_circuit_network(connector)
    return network and network.get_signal(signal) or 0
end

--- the switch's state at tick t: the last schedule entry at or before t, else `initial`
local function wanted(schedule, initial, t)
    local on = initial
    for _, entry in ipairs(schedule or {}) do if t >= entry[1] then on = entry[2] end end
    return on
end

local function rounded(value) return math.floor(value * 10000 + 0.5) / 10000 end

local function belt_count(belt)
    local total = 0
    for line = 1, belt.get_max_transport_line_index() do total = total + belt.get_transport_line(line).get_item_count() end
    return total
end

local started = game.tick
script.on_nth_tick(1, function()
    local t = game.tick - started
    for _, run in ipairs(runs) do
        local spec = run.spec
        run.controls[1].gate.enabled = wanted(spec.schedule, spec.initial or false, t)
        if run.controls[2] then run.controls[2].gate.enabled = wanted(spec.gate2, spec.initial2 or false, t) end
        if run.belts then
            local feed = spec.kind == "belt-backed" and t < spec.fill_until or (spec.kind == "belt-empty" and t >= spec.belt_from and t < spec.belt_from + spec.belt_ticks)
            if feed then
                for line = 1, 2 do run.belts[1].get_transport_line(line).insert_at_back({name = PLATE, count = 4}, 4) end
            end
        end
        local row = {t}
        for _, ctl in ipairs(run.controls) do
            table.insert(row, ctl.gate.enabled and 1 or 0)
            table.insert(row, signal_at(ctl.decider, W.combinator_input_red, ctl.signal))
            table.insert(row, signal_at(ctl.decider, W.combinator_output_red, SIG_E))
        end
        for _, hand in ipairs(run.hands) do
            local held = hand.held_stack
            local position = hand.held_stack_position
            local behavior = hand.get_control_behavior()
            table.insert(row, signal_at(hand, W.circuit_red, SIG_E))
            table.insert(row, behavior and behavior.disabled and 1 or 0)
            table.insert(row, hand.status or -1)
            table.insert(row, held.valid_for_read and held.count or 0)
            table.insert(row, rounded(position.x))
            table.insert(row, rounded(position.y))
        end
        for _, watched in ipairs(run.watch) do
            table.insert(row, watched.entity.get_inventory(watched.inventory).get_item_count(watched.item))
        end
        if run.machine then
            table.insert(row, run.machine.status or -1)
            table.insert(row, run.machine.products_finished)
            table.insert(row, rounded(run.machine.crafting_progress))
        end
        if run.end_tile then table.insert(row, belt_count(run.end_tile)) end
        table.insert(run.log, row)
    end
    if t >= options.ticks then
        script.on_nth_tick(1, nil)
        local out = {info = info, runs = {}}
        for _, run in ipairs(runs) do out.runs[run.spec.name] = run.log end
        helpers.write_file("control-latency.json", helpers.table_to_json(out), false)
    end
end)
