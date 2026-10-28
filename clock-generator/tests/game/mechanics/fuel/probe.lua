-- Burner machines and drills, one scenario per entity: options.scenarios lists them, and the probe builds each on its own
-- spot beside the build (the idle assembler the recorder needs), then logs every tick for options.ticks ticks what the
-- game holds of the burner: the energy buffer (burner.heat, entity.energy), the burning item's remaining energy
-- (burner.remaining_burning_fuel), the fuel slot, the craft or mining progress, the status and the output.
-- A scenario: {name, entity, fuel, count, remaining_mj, mode, ...}
--   mode "idle"   nothing to work on
--   mode "work"   supplied for the whole run (ingredients topped up, output taken away)
--   mode "runout" as work with `count` fuel items and `remaining_mj` burning; options below add the fuel back
--   mode "passive" is left alone: a furnace at `at_drop_of` (the number of an earlier drill scenario) stands where that
--                 drill drops, and the drill has no chest (`no_chest`)
--   mode "feed"   an inserter from a chest of `fuel` into the machine's fuel slot (power from a pole's interface)
--   gap: the tick at which the probe stops giving work and gap_end the tick it resumes. gap_mode "ingredients" takes the
--   ingredients away, "output" fills the output so the machine is blocked (a drill's chest is filled), "disabled" sets
--   the entity inactive. refuel: ticks at which `refuel_count` fuel items are inserted. productivity: false puts the
--   force's mining drill productivity at 0 (the save's research makes a drill mine many items a tick).
local entities, surface = ...
local base
for _, entity in pairs(entities) do if entity.valid then base = entity.position end end

local PREP = {ore = "iron-ore", plate = "iron-plate"}

local function clear(area)
    for _, other in pairs(surface.find_entities_filtered({area = area})) do
        if other.valid and other.type ~= "character" then other.destroy() end
    end
end

local rows, runs = {}, {}
local info = {scenarios = {}, status = {}}
local first_force = game.forces["player"]
for key, value in pairs(options.force or {}) do first_force[key] = value end
info.force = {inserter_stack_size_bonus = first_force.inserter_stack_size_bonus,
    bulk_inserter_capacity_bonus = first_force.bulk_inserter_capacity_bonus}
if options.scenarios[1] and options.productivity == false then first_force.mining_drill_productivity_bonus = 0 end
for key, value in pairs(defines.entity_status) do info.status[tostring(value)] = key end

--- a value to a step: the game's sums carry noise far below what any check reads, and the log is kept
local function round(value, scale) return math.floor(value * scale + 0.5) / scale end
local energy_gap = 0

local function item_count(inventory, name) return inventory and inventory.get_item_count(name) or 0 end

local function build(spec, index, runs)
    local ex = base.x + 10 + (index % 10) * 9
    local ey = base.y + 14 + math.floor(index / 10) * 12
    local proto = prototypes.entity[spec.entity]
    local width = proto.collision_box.right_bottom.x - proto.collision_box.left_top.x
    local odd = math.floor(width + 0.5) % 2 == 1
    local ox = odd and (math.floor(ex) + 0.5) or math.floor(ex)
    local oy = odd and (math.floor(ey) + 0.5) or math.floor(ey)
    if spec.at_drop_of then
        -- stands where the drill of an earlier scenario drops: a furnace whose box holds the drop position
        local drop = runs[spec.at_drop_of].entity.drop_position
        ox, oy = math.floor(drop.x) + 1, math.floor(drop.y) + 1
    else
        clear({{ox - 6, oy - 6}, {ox + 6, oy + 6}})
    end
    local run = {spec = spec, ox = ox, oy = oy}
    if spec.entity == "burner-mining-drill" then
        for dx = -3, 3 do for dy = -3, 3 do
            surface.create_entity({name = PREP.ore, position = {ox + dx, oy + dy}, amount = 1000000})
        end end
    end
    local direction = spec.entity == "burner-mining-drill" and defines.direction.east or defines.direction.north
    local entity = surface.create_entity({name = spec.entity, position = {ox, oy}, force = "player", direction = direction,
        recipe = spec.recipe})
    run.entity = entity
    assert(entity, "could not build " .. spec.entity)
    if spec.recipe and entity.type == "assembling-machine" and not entity.get_recipe() then entity.set_recipe(spec.recipe) end
    if spec.entity == "burner-mining-drill" and not spec.no_chest then
        run.chest = surface.create_entity({name = "steel-chest", position = entity.drop_position, force = "player"})
    end
    if spec.mode == "feed" or spec.mode == "feed-idle" then
        local half = width / 2
        run.source = surface.create_entity({name = "steel-chest", position = {ox - half - 1.5, oy}, force = "player"})
        run.source.get_inventory(defines.inventory.chest).insert({name = spec.fuel, count = spec.supply or 500})
        run.inserter = surface.create_entity({name = spec.inserter or "inserter", position = {ox - half - 0.5, oy}, force = "player", direction = defines.direction.west})
        run.pole = surface.create_entity({name = "electric-energy-interface", position = {ox - half - 0.5, oy + 3}, force = "player"})
        run.pole.electric_buffer_size = 1e10
        run.pole.power_production = 1e7
        run.pole.energy = 1e10
        local pole = surface.create_entity({name = "small-electric-pole", position = {ox - half - 0.5, oy + 1}, force = "player"})
        run.pole_entity = pole
    end
    local burner = entity.burner
    if spec.fuel and (spec.count or 0) > 0 then entity.get_fuel_inventory().insert({name = spec.fuel, count = spec.count}) end
    if spec.fuel and spec.remaining_mj and spec.remaining_mj > 0 then
        burner.currently_burning = spec.fuel
        burner.remaining_burning_fuel = spec.remaining_mj * 1e6
    end
    if spec.heat_j then burner.heat = spec.heat_j end
    return run
end

local function output_inventory(run)
    local entity = run.entity
    if entity.type == "mining-drill" then return run.chest and run.chest.get_inventory(defines.inventory.chest) or nil end
    return entity.get_inventory(defines.inventory.crafter_output)
end

local function input_inventory(run)
    return run.entity.get_inventory(defines.inventory.crafter_input)
end

--- keeps a machine supplied with what it works on; `blocked` leaves its output alone, `starved` gives no ingredients
local function supply(run, starved, blocked)
    local spec, entity = run.spec, run.entity
    if entity.type == "mining-drill" then
        if not blocked and run.chest then
            local chest = run.chest.get_inventory(defines.inventory.chest)
            local ore = item_count(chest, PREP.ore)
            if ore >= 1000 then chest.remove({name = PREP.ore, count = ore}); run.taken = (run.taken or 0) + ore end
        end
        return
    end
    if not starved then
        local input = input_inventory(run)
        if entity.type == "furnace" then
            if item_count(input, PREP.ore) < 20 then input.insert({name = PREP.ore, count = 30}) end
        elseif spec.recipe == "bioflux" then
            if item_count(input, "yumako-mash") < 60 then input.insert({name = "yumako-mash", count = 60}) end
            if item_count(input, "jelly") < 60 then input.insert({name = "jelly", count = 60}) end
        end
    end
    if not blocked then
        local output = output_inventory(run)
        for _, content in pairs(output.get_contents()) do
            if content.count >= 40 then output.remove({name = content.name, count = content.count}); run.taken = (run.taken or 0) + content.count end
        end
    end
end

--- what the machine's gap does on its first tick
local function enter_gap(run)
    local spec, entity = run.spec, run.entity
    if spec.gap_mode == "ingredients" then
        local input = input_inventory(run)
        if input then input.clear() end
    elseif spec.gap_mode == "output" then
        local output = output_inventory(run)
        local item = entity.type == "mining-drill" and PREP.ore or (entity.type == "furnace" and PREP.plate or "biter-egg")
        if spec.entity == "biochamber" then item = "bioflux" end
        output.insert({name = item, count = 100000})
    elseif spec.gap_mode == "disabled" then
        entity.disabled_by_script = true
    end
end

local function leave_gap(run)
    local spec, entity = run.spec, run.entity
    if spec.gap_mode == "output" then output_inventory(run).clear() end
    if spec.gap_mode == "disabled" then entity.disabled_by_script = false end
end

local function progress(entity)
    if entity.type == "mining-drill" then return entity.mining_progress, entity.bonus_mining_progress end
    return entity.crafting_progress, entity.bonus_progress or 0
end

local function output_count(run)
    local total = run.taken or 0
    local output = output_inventory(run)
    if output then for _, content in pairs(output.get_contents()) do total = total + content.count end end
    return total
end

for index, spec in ipairs(options.scenarios) do
    local run = build(spec, index - 1, runs)
    run.log = {}
    runs[index] = run
    local entity = run.entity
    info.scenarios[index] = {name = spec.name, entity = spec.entity, unit = entity.unit_number, heat_capacity = entity.burner.heat_capacity,
        energy_usage = entity.prototype.get_max_energy_usage(),
        fuel_value = spec.fuel and prototypes.item[spec.fuel].fuel_value or 0,
        stack_size = spec.fuel and prototypes.item[spec.fuel].stack_size or 0,
        crafting_speed = entity.type ~= "mining-drill" and entity.crafting_speed or nil,
        mining_speed = entity.type == "mining-drill" and entity.prototype.mining_speed or nil,
        fuel_slots = #entity.get_fuel_inventory(), effectivity = entity.prototype.burner_prototype.effectivity,
        position = {x = run.ox, y = run.oy}}
    local inventories = {}
    for i = 1, entity.get_max_inventory_index() do
        local inventory = entity.get_inventory(i)
        if inventory then inventories[tostring(i)] = {size = #inventory, name = inventory.name or ""} end
    end
    info.scenarios[index].inventories = inventories
    if run.inserter then
        info.scenarios[index].inserter = {pickup = run.inserter.pickup_target and run.inserter.pickup_target.name or "none",
            drop = run.inserter.drop_target and run.inserter.drop_target.name or "none"}
    end
end

local started = game.tick
script.on_nth_tick(1, function()
    local t = game.tick - started
    for index, run in ipairs(runs) do
        local spec, entity = run.spec, run.entity
        local in_gap = spec.gap and t >= spec.gap and t < (spec.gap_end or math.huge)
        if in_gap and not run.in_gap then run.in_gap = true; enter_gap(run) end
        if run.in_gap and not in_gap then run.in_gap = false; leave_gap(run) end
        if spec.mode ~= "idle" and spec.mode ~= "feed-idle" and spec.mode ~= "passive" then
            supply(run, in_gap and spec.gap_mode == "ingredients", in_gap and spec.gap_mode == "output")
        end
        if spec.refuel and spec.refuel[tostring(t)] then
            entity.get_fuel_inventory().insert({name = spec.fuel, count = spec.refuel_count or 1})
        end
        local burner = entity.burner
        energy_gap = math.max(energy_gap, math.abs(entity.energy - burner.heat))
        local prog, bonus = progress(entity)
        local burning = burner.currently_burning
        table.insert(run.log, {
            t, round(burner.heat, 1e3), round(burner.remaining_burning_fuel, 1e3), item_count(entity.get_fuel_inventory(), spec.fuel or "coal"),
            burning and burning.name.name or "", round(prog, 1e9), round(bonus, 1e9), entity.status or -1, output_count(run),
            (entity.type ~= "mining-drill" and entity.products_finished or 0), run.inserter and run.inserter.status or -1,
            run.inserter and (run.inserter.held_stack.valid_for_read and run.inserter.held_stack.count or 0) or 0,
        })
        if spec.mode == "idle" or spec.mode == "feed-idle" then
            -- ingredients are not given; a feed-idle machine only gets fuel from its inserter
        end
    end
    if t >= options.ticks then
        script.on_nth_tick(1, nil)
        info.energy_gap = energy_gap
        local out = {info = info, columns = {"t", "heat", "remaining", "fuel_count", "burning", "progress", "bonus", "status", "output", "finished", "inserter_status", "hand"}, runs = {}}
        for index, run in ipairs(runs) do
            out.runs[run.spec.name] = run.log
            -- items lying on the ground around a machine at the end: where products go that do not fit
            local ground = {}
            for _, item in pairs(surface.find_entities_filtered({type = "item-entity", position = run.entity.position, radius = 6})) do
                ground[item.stack.name] = (ground[item.stack.name] or 0) + item.stack.count
            end
            info.scenarios[index].ground_items = ground
        end
        helpers.write_file("fuel-probe.json", helpers.table_to_json(out), false)
    end
end)
