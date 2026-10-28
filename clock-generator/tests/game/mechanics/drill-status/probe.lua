-- Mining drills that stop, one scenario each, logged every tick: the status the game shows (entity.status), the mining bar,
-- and what has come out. A scenario: {name, entity, mode, ...}
--   mode "circuit"  a constant combinator on the drill's circuit condition (signal-A > 0) is switched by the probe: the drill
--                   is enabled while `windows` says so (a list of {from, to} tick pairs; enabled outside, from `to` on)
--   mode "script"   disabled_by_script, off and on at the same ticks
--   mode "chest-full" the drill drops into a steel chest the probe fills completely at tick `fill` and empties at tick `empty`
--   mode "chest-room" the chest starts with room for `room` ore: the drill fills it and is then blocked
--   mode "machine"  the drill drops into a furnace that cannot craft (no fuel): it stops at the drill's own limit
-- The drill is on its own ore (iron ore), the mining productivity research is put at 0, an electric drill is powered by
-- an energy interface and a burner drill is given coal.
local entities, surface = ...
local base
for _, entity in pairs(entities) do if entity.valid then base = entity.position end end
local force = game.forces["player"]
force.mining_drill_productivity_bonus = 0
local info = {scenarios = {}, status = {}}
for key, value in pairs(defines.entity_status) do info.status[tostring(value)] = key end

local ORE = "iron-ore"

local function clear(area)
    for _, other in pairs(surface.find_entities_filtered({area = area})) do
        if other.valid and other.type ~= "character" then other.destroy() end
    end
end

local function item_count(inventory, name) return inventory and inventory.get_item_count(name) or 0 end

local runs = {}
for index, spec in ipairs(options.scenarios) do
    local ox = math.floor(base.x) + 12 + ((index - 1) % 6) * 14
    local oy = math.floor(base.y) + 16 + math.floor((index - 1) / 6) * 14
    clear({{ox - 8, oy - 8}, {ox + 8, oy + 8}})
    local proto = prototypes.entity[spec.entity]
    local width = proto.collision_box.right_bottom.x - proto.collision_box.left_top.x
    local odd = math.floor(width + 0.5) % 2 == 1
    local px = odd and (ox + 0.5) or ox
    local py = odd and (oy + 0.5) or oy
    local reach = math.ceil(width / 2) + 1
    for dx = -reach, reach do for dy = -reach, reach do
        surface.create_entity({name = ORE, position = {px + dx, py + dy}, amount = 1000000})
    end end
    local run = {spec = spec, log = {}}
    run.entity = surface.create_entity({name = spec.entity, position = {px, py}, force = "player", direction = defines.direction.east})
    assert(run.entity, "could not build " .. spec.entity)
    local drill = run.entity
    if spec.entity == "burner-mining-drill" then
        drill.get_fuel_inventory().insert({name = "coal", count = 50})
    else
        local iface = surface.create_entity({name = "electric-energy-interface", position = {px, py + math.ceil(width / 2) + 2.5}, force = "player"})
        iface.electric_buffer_size = 1e10
        iface.power_production = 1e7
        iface.energy = 1e10
        surface.create_entity({name = "small-electric-pole", position = {px, py + math.ceil(width / 2) + 0.5}, force = "player"})
    end
    if spec.mode == "machine" then
        run.sink = surface.create_entity({name = "stone-furnace", position = {math.floor(drill.drop_position.x) + 1, math.floor(drill.drop_position.y) + 1}, force = "player"})
        run.sink_inventory = run.sink.get_inventory(defines.inventory.crafter_input)
    else
        run.chest = surface.create_entity({name = "steel-chest", position = drill.drop_position, force = "player"})
        run.chest_inventory = run.chest.get_inventory(defines.inventory.chest)
    end
    if spec.mode == "chest-room" then
        run.chest_inventory.insert({name = ORE, count = #run.chest_inventory * prototypes.item[ORE].stack_size - spec.room})
    end
    info.scenarios[index] = {name = spec.name, entity = spec.entity, mode = spec.mode, mining_speed = proto.mining_speed,
        drop = {x = drill.drop_position.x, y = drill.drop_position.y}, sink = run.chest and run.chest.name or run.sink.name,
        chest_slots = run.chest_inventory and #run.chest_inventory or nil}
    if spec.mode == "circuit" then
        local combinator = surface.create_entity({name = "constant-combinator", position = {px - width / 2 - 1.5, py - 1}, force = "player"})
        run.gate = combinator.get_or_create_control_behavior()
        local section = run.gate.get_section(1) or run.gate.add_section()
        section.set_slot(1, {value = {type = "virtual", name = "signal-A", quality = "normal"}, min = 1})
        local connector = drill.get_wire_connector(defines.wire_connector_id.circuit_red, true)
        local connected = connector ~= nil and combinator.get_wire_connector(defines.wire_connector_id.circuit_red, true).connect_to(connector)
        info.scenarios[index].wired = connected and true or false
        if connected then
            local behavior = drill.get_or_create_control_behavior()
            behavior.circuit_enable_disable = true
            behavior.circuit_condition = {first_signal = {type = "virtual", name = "signal-A"}, comparator = ">", constant = 0}
        end
    end
    runs[index] = run
end

--- whether the windows say the drill is enabled at tick t: off inside every {from, to}
local function wanted(spec, t)
    for _, window in ipairs(spec.windows or {}) do
        if t >= window[1] and t < window[2] then return false end
    end
    return true
end

local function count_out(run)
    if run.sink_inventory then return item_count(run.sink_inventory, ORE) end
    return item_count(run.chest_inventory, ORE)
end

local started = game.tick
script.on_nth_tick(1, function()
    local t = game.tick - started
    for _, run in ipairs(runs) do
        local spec, drill = run.spec, run.entity
        local on = wanted(spec, t)
        if spec.mode == "circuit" and run.gate then run.gate.enabled = on end
        if spec.mode == "script" then drill.disabled_by_script = not on end
        if spec.mode == "chest-full" then
            if t == spec.fill then
                local room = #run.chest_inventory * prototypes.item[ORE].stack_size - count_out(run)
                if room > 0 then run.chest_inventory.insert({name = ORE, count = room}) end
            elseif t == spec.empty then
                run.chest_inventory.remove({name = ORE, count = 100})
            end
        end
        table.insert(run.log, {t, drill.status or -1, math.floor(drill.mining_progress * 1e6 + 0.5) / 1e6, count_out(run), on and 1 or 0})
    end
    if t >= options.ticks then
        script.on_nth_tick(1, nil)
        local out = {info = info, columns = {"t", "status", "progress", "out", "enabled"}, runs = {}}
        for _, run in ipairs(runs) do out.runs[run.spec.name] = run.log end
        helpers.write_file("drill-status.json", helpers.table_to_json(out), false)
    end
end)
