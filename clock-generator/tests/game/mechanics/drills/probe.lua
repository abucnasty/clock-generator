-- Mining drills at a low research level, set by script in the harness's copy of the save (never in the save itself).
-- On install the probe sets the research (options.research: "levels" researches mining productivity 1 and 2 and writes
-- options.level as mining productivity 3's level; "none" researches none of them), restores the inserter bonuses that
-- reset_technology_effects clears, and puts both of the drill's bars at 0. Every tick for options.ticks ticks it logs the
-- drill's bars and whether it is disabled, its sink's count of the mined item and the taker's hand. options.gate lists
-- ticks at which a constant combinator on the drill's circuit condition flips: the drill starts enabled.
local entities = ...
local surface = select(2, ...)
local drill, taker, sink
for _, entity in pairs(entities) do
    if entity.valid then
        if entity.type == "mining-drill" then drill = entity
        elseif entity.type == "inserter" then taker = entity
        elseif entity.type == "car" or entity.type == "assembling-machine" then sink = entity end
    end
end
local force = drill.force
local technologies = force.technologies
local kept = {}
for _, bonus in ipairs({"inserter_stack_size_bonus", "bulk_inserter_capacity_bonus", "belt_stack_size_bonus"}) do kept[bonus] = force[bonus] end
local researched = options.research ~= "none"
technologies["mining-productivity-1"].researched = researched
technologies["mining-productivity-2"].researched = researched
technologies["mining-productivity-3"].level = options.level
force.reset_technology_effects()
for bonus, value in pairs(kept) do force[bonus] = value end
drill.mining_progress = 0
drill.bonus_mining_progress = 0

local function count()
    local inventory = sink.type == "car" and sink.get_inventory(defines.inventory.car_trunk)
        or sink.get_inventory(defines.inventory.crafter_input)
    return inventory.get_item_count()
end
local report = {research = {bonus = force.mining_drill_productivity_bonus, mining_productivity_3_level = technologies["mining-productivity-3"].level},
    drill = {productivity_bonus = drill.productivity_bonus, speed_bonus = drill.speed_bonus}, log = {}}

local gate, flips, enabled = nil, {}, true
if options.gate then
    local combinator = surface.create_entity({name = "constant-combinator", position = {drill.position.x - 3.5, drill.position.y}, force = force})
    local behavior = combinator.get_or_create_control_behavior()
    local section = behavior.get_section(1) or behavior.add_section()
    section.set_slot(1, {value = {type = "virtual", name = "signal-A", quality = "normal"}, min = 1})
    behavior.enabled = true
    combinator.get_wire_connector(defines.wire_connector_id.circuit_red, true)
        .connect_to(drill.get_wire_connector(defines.wire_connector_id.circuit_red, true))
    local drill_behavior = drill.get_or_create_control_behavior()
    drill_behavior.circuit_enable_disable = true
    drill_behavior.circuit_condition = {first_signal = {type = "virtual", name = "signal-A"}, comparator = ">", constant = 0}
    gate = behavior
    for _, tick in ipairs(options.gate) do flips[tick] = true end
end

local started = game.tick
script.on_nth_tick(1, function()
    local tick = game.tick - started
    if gate and flips[tick] then enabled = not enabled; gate.enabled = enabled end
    -- the drill's status in a row is the one its next update reads
    local row = {t = tick, n = count(), p = drill.mining_progress, b = drill.bonus_mining_progress,
        d = drill.status == defines.entity_status.disabled_by_control_behavior}
    if taker then
        local hand = taker.held_stack
        row.h = hand.valid_for_read and hand.count or 0
    end
    table.insert(report.log, row)
    if tick >= options.ticks then
        script.on_nth_tick(1, nil)
        helpers.write_file("drills-probe.json", helpers.table_to_json(report), false)
    end
end)
