-- A big mining drill dropping into a legendary steel chest, at a research level set by script in the harness's copy of
-- the save: mining productivity 1 and 2 researched and 3 at options.level, the inserter bonuses kept. Both bars at 0.
-- options.mode "fill": the chest starts empty and the drill always enabled. "gated": the chest starts full; every
-- options.period ticks the probe takes items out of it (options.takes, cycling; -1 is all it holds), and a constant
-- combinator on the drill's circuit condition enables it for options.windows ticks (cycling) from offset options.open.
-- Every tick it logs the chest's count, both bars, whether the drill is disabled, and what it took and the gate.
local entities, surface = ...
local drill, chest
for _, entity in pairs(entities) do
    if entity.valid then
        if entity.type == "mining-drill" then drill = entity
        elseif entity.type == "container" then chest = entity end
    end
end
local force = drill.force
local technologies = force.technologies
-- reset_technology_effects resets the inserter bonuses the save has too: they are put back
local kept = {}
for _, bonus in ipairs({"inserter_stack_size_bonus", "bulk_inserter_capacity_bonus", "belt_stack_size_bonus"}) do kept[bonus] = force[bonus] end
technologies["mining-productivity-1"].researched = true
technologies["mining-productivity-2"].researched = true
technologies["mining-productivity-3"].level = options.level
force.reset_technology_effects()
for bonus, value in pairs(kept) do force[bonus] = value end
drill.mining_progress = 0
drill.bonus_mining_progress = 0
local inventory = chest.get_inventory(defines.inventory.chest)
local item = "iron-ore"
local room = #inventory * prototypes.item[item].stack_size
if options.mode == "gated" then inventory.insert({name = item, count = room}) end
local info = {level = technologies["mining-productivity-3"].level, bonus = force.mining_drill_productivity_bonus,
    productivity_bonus = drill.productivity_bonus, speed_bonus = drill.speed_bonus, mining_speed = drill.prototype.mining_speed,
    slots = #inventory, room = room, start_count = inventory.get_item_count(item)}
local gate, enabled = nil, true
if options.mode == "gated" then
    local combinator = surface.create_entity({name = "constant-combinator", position = {drill.position.x - 3.5, drill.position.y}, force = force})
    gate = combinator.get_or_create_control_behavior()
    local section = gate.get_section(1) or gate.add_section()
    section.set_slot(1, {value = {type = "virtual", name = "signal-A", quality = "normal"}, min = 1})
    combinator.get_wire_connector(defines.wire_connector_id.circuit_red, true)
        .connect_to(drill.get_wire_connector(defines.wire_connector_id.circuit_red, true))
    local behavior = drill.get_or_create_control_behavior()
    behavior.circuit_enable_disable = true
    behavior.circuit_condition = {first_signal = {type = "virtual", name = "signal-A"}, comparator = ">", constant = 0}
    enabled = false
    gate.enabled = false
end
local log, started = {}, game.tick
script.on_nth_tick(1, function()
    local t = game.tick - started
    local row = {t = t, n = inventory.get_item_count(item), p = drill.mining_progress, b = drill.bonus_mining_progress}
    if gate and t >= 1 then
        local period = math.floor((t - 1) / options.period)
        local offset = (t - 1) % options.period
        if offset == 0 then
            local take = options.takes[(period % #options.takes) + 1]
            if take < 0 then take = row.n end
            take = math.min(take, row.n)
            if take > 0 then row.r = inventory.remove({name = item, count = take}) end
        end
        local length = options.windows[(period % #options.windows) + 1]
        local want = offset >= options.open and offset < options.open + length
        if want ~= enabled then enabled = want; gate.enabled = want end
        row.g = enabled and 1 or 0
    end
    row.d = drill.status == defines.entity_status.disabled_by_control_behavior
    table.insert(log, row)
    if t >= options.ticks then
        script.on_nth_tick(1, nil)
        helpers.write_file("chest-probe.json", helpers.table_to_json({info = info, log = log}), false)
    end
end)
