-- The sidecar's export of a mining drill that has not mined or dropped yet. The game gives a drill no mining_target until
-- it first mines and no drop_target until it first drops, and a drill fast-replaced by one of another quality is a new
-- entity: next to a full container it may not mine for a long time.
--
-- 1. The steel wagon build (the harness's build), its wagon legendary: the normal drill is fast-replaced by a legendary
--    one with the wagon's ore slots full and the inserter that takes ore stopped. The sidecar's selection (its tool's
--    type filters over the build) is exported before the new drill's first tick and options.ticks later.
-- 2. On a surface of its own, one legendary drill a trial before its first tick, with a machine or chest placed against
--    its drop position: reaching into the tile under it, or not far enough (a box that only touches the tile's edge, or
--    reaches 11/256 of a tile into it; 12/256 is the game's reach). Each trial
--    is exported before the first tick and at the end, with what the game did: the drill's drop_target, the target's ore.
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")

local force = game.forces.player
local filters = {}
for name in pairs(prototypes.item["clock-generator-sidecar"].get_entity_type_filters(defines.selection_mode.select)) do
    table.insert(filters, name)
end

---What the selection tool hands the sidecar for a box, and the export of it, with the export's reference of each of
---targets (false for one not exported)
local function select_and_export(on, box, targets)
    local selected = on.find_entities_filtered({area = box, type = filters, force = force})
    local result = extraction.extract_all_entities(selected, force)
    local refs = {}
    for _, target in ipairs(targets or {}) do
        local machine = result.unit_number_to_id[target.unit_number]
        local chest = result.chest_unit_number_to_id[target.unit_number]
        table.insert(refs, machine and {type = "machine", id = machine} or chest and {type = "chest", id = chest} or false)
    end
    local left_out = {}
    for _, left in ipairs(export.left_out_drills(result)) do
        table.insert(left_out, {target_name = left.target_name or false, no_resource = left.no_resource})
    end
    return {counts = {machines = #result.machines, drills = #result.drills, inserters = #result.inserters,
        belts = #result.belts, chests = #result.chests}, export = export.to_table(result), left_out_drills = left_out,
        targets = refs}
end

local report = {samples = {}}

-- 1. The fast-replaced drill
local drill, wagon, ore_inserter
local index
for i, entity in pairs(entities) do
    if entity.valid and entity.type == "mining-drill" then drill, index = entity, i end
    if entity.valid and entity.type == "cargo-wagon" then wagon = entity end
end
for _, entity in pairs(entities) do
    if entity.valid and entity.type == "inserter" and entity.pickup_target == wagon and entity.get_filter(1)
        and entity.get_filter(1).name == "iron-ore" then
        ore_inserter = entity
    end
end
assert(drill and wagon and ore_inserter, "the steel wagon build has a drill, a wagon and an inserter taking ore")
local box = {{math.huge, math.huge}, {-math.huge, -math.huge}}
for _, entity in pairs(entities) do
    if entity.valid then
        local b = entity.bounding_box
        box[1][1], box[1][2] = math.min(box[1][1], b.left_top.x - 1), math.min(box[1][2], b.left_top.y - 1)
        box[2][1], box[2][2] = math.max(box[2][1], b.right_bottom.x + 1), math.max(box[2][2], b.right_bottom.y + 1)
    end
end
ore_inserter.disabled_by_script = true
wagon.insert({name = "iron-ore", count = 1000000})
report.before = select_and_export(surface, box, {wagon})
report.before.drill = {quality = drill.quality.name, speed_bonus = drill.speed_bonus, productivity_bonus = drill.productivity_bonus}
local replaced = surface.create_entity({name = drill.name, quality = "legendary", position = drill.position,
    direction = drill.direction, force = force, fast_replace = true, spill = false})
assert(replaced and not drill.valid, "the drill was fast-replaced")
-- the recorder records the build's entities after this chunk: the new drill in the old one's place
entities[index] = replaced
report.replaced = {quality = replaced.quality.name, mining_target = replaced.mining_target ~= nil,
    drop_target = replaced.drop_target ~= nil, at_build = select_and_export(surface, box, {wagon})}

-- 2. The drop rule, one trial a region on a lab-tile surface, powered by an energy interface
local lab = game.surfaces["sidecar-drill-drop"] or game.create_surface("sidecar-drill-drop", {width = 2000, height = 200})
lab.generate_with_lab_tiles = true
lab.request_to_generate_chunks({0, 0}, 1)
local trials = {}
local function region()
    local x = (#trials + 1) * 40
    lab.request_to_generate_chunks({x, 0}, 2)
    lab.force_generate_chunk_requests()
    local interface = lab.create_entity({name = "electric-energy-interface", position = {x - 8, 6}, force = force})
    interface.power_production = 1e9
    interface.electric_buffer_size = 1e10
    lab.create_entity({name = "substation", position = {x - 4, 6}, force = force})
    lab.create_entity({name = "substation", position = {x + 4, 6}, force = force})
    return x
end
---A legendary drill at (x + 0.5, 0.5) on iron ore (and copper ore on its left column when mixed), facing direction
local function drill_at(x, direction, mixed)
    for dx = -2, 2 do
        for dy = -2, 2 do
            lab.create_entity({name = (mixed and dx == -2) and "copper-ore" or "iron-ore", position = {x + 0.5 + dx, 0.5 + dy}, amount = 1000000})
        end
    end
    return lab.create_entity({name = "big-mining-drill", quality = "legendary", position = {x + 0.5, 0.5}, direction = direction, force = force})
end
---A trial: name, the target's prototype, its offset from the drop position and orientation; `hit` says whether the game
---is expected to fill it (the tile under the drop position overlaps its collision box)
local function trial(name, target_name, offset, hit, extra)
    extra = extra or {}
    local x = region()
    local placed = drill_at(x, extra.direction or defines.direction.north, extra.mixed)
    local drop = placed.drop_position
    local targets = {}
    if extra.edge then
        -- the target's box reaching k/256 into the drop tile from its side extra.edge
        local tx, ty = math.floor(drop.x), math.floor(drop.y)
        local box, o = prototypes.entity[target_name].collision_box, extra.reach / 256
        local at = ({left = {tx + o - box.right_bottom.x, ty + 0.5}, right = {tx + 1 - o - box.left_top.x, ty + 0.5},
            top = {tx + 0.5, ty + o - box.right_bottom.y}, bottom = {tx + 0.5, ty + 1 - o - box.left_top.y}})[extra.edge]
        local target = lab.create_entity({name = target_name, quality = "legendary", position = at, force = force})
        target.orientation = 0
        table.insert(targets, target)
    elseif target_name == "cargo-wagon" then
        local rail_x = 2 * math.floor((drop.x + offset.x) / 2) + 1
        for rail_y = -9, 9, 2 do
            lab.create_entity({name = "straight-rail", position = {rail_x, rail_y}, direction = defines.direction.north, force = force})
        end
        table.insert(targets, lab.create_entity({name = "cargo-wagon", quality = "legendary", position = {rail_x, drop.y + offset.y}, force = force}))
    else
        local target = lab.create_entity({name = target_name, quality = "legendary", position = {drop.x + offset.x, drop.y + offset.y}, force = force})
        if extra.orientation then target.orientation = extra.orientation end
        table.insert(targets, target)
    end
    if extra.also then
        table.insert(targets, lab.create_entity({name = extra.also, quality = "legendary", position = {drop.x, drop.y}, force = force}))
    end
    for _, target in ipairs(targets) do assert(target, name .. ": the target was built") end
    local area = {{x - 12, -12}, {x + 12, 12}}
    table.insert(trials, {name = name, hit = hit, drill = placed, targets = targets, area = area,
        at_build = select_and_export(lab, area, targets), mining_target_at_build = placed.mining_target ~= nil,
        drop_target_at_build = placed.drop_target ~= nil})
end

-- a chest: the tile under the drop position, and the tiles beyond and beside it
trial("chest", "steel-chest", {x = 0, y = 0}, true)
trial("chest-beyond", "steel-chest", {x = 0, y = -1}, false)
trial("chest-beside", "steel-chest", {x = 1, y = 0}, false)
-- a car north-south: its near end in the tile, its end 0.05 short of it; its side 0.1 into the tile, and touching it
trial("car", "car", {x = 0, y = -1.6}, true, {orientation = 0})
trial("car-beyond", "car", {x = 0, y = -1.7}, false, {orientation = 0})
trial("car-side", "car", {x = 1.1, y = -1}, true, {orientation = 0})
trial("car-side-touching", "car", {x = 1.2, y = -1}, false, {orientation = 0})
-- the reach: a car's box 12/256 into the tile gets the ore, 11/256 none, on each side, the drill facing each way
for _, facing in ipairs({{"north", defines.direction.north}, {"east", defines.direction.east}}) do
    for _, edge in ipairs({"left", "right", "top", "bottom"}) do
        trial("car-" .. facing[1] .. "-" .. edge .. "-12", "car", {x = 0, y = 0}, true, {direction = facing[2], edge = edge, reach = 12})
        trial("car-" .. facing[1] .. "-" .. edge .. "-11", "car", {x = 0, y = 0}, false, {direction = facing[2], edge = edge, reach = 11})
    end
end
-- a car east-west and diagonal: the diagonal's box reaches the tile though its unrotated box would not
trial("car-east", "car", {x = 0, y = -1.3}, true, {orientation = 0.25})
trial("car-east-beyond", "car", {x = 0, y = -1.4}, false, {orientation = 0.25})
trial("car-diagonal", "car", {x = 0, y = -1.8}, true, {orientation = 0.125})
trial("car-diagonal-beyond", "car", {x = 0, y = -1.9}, false, {orientation = 0.125})
-- a tank: its side 0.1 into the tile, and touching it
trial("tank-side", "tank", {x = 1.3, y = -1.3}, true, {orientation = 0})
trial("tank-side-touching", "tank", {x = 1.4, y = -1.3}, false, {orientation = 0})
-- a cargo wagon on a north-south line, the drill facing east: beside it, its end in the tile, and beyond its end
trial("wagon", "cargo-wagon", {x = 0.6, y = 0}, true, {direction = defines.direction.east})
trial("wagon-beside", "cargo-wagon", {x = 1.6, y = 0}, false, {direction = defines.direction.east})
trial("wagon-end", "cargo-wagon", {x = 0.6, y = 2.5}, true, {direction = defines.direction.east})
trial("wagon-beyond-end", "cargo-wagon", {x = 0.6, y = 3.5}, false, {direction = defines.direction.east})
-- a rocket silo and an electric furnace: the near edge in the tile, and a tile beyond
trial("silo", "rocket-silo", {x = 0, y = -4}, true)
trial("silo-beyond", "rocket-silo", {x = 0, y = -5}, false)
trial("furnace", "electric-furnace", {x = 0, y = -1}, true)
trial("furnace-beyond", "electric-furnace", {x = 0, y = -2}, false)
-- two resources under the drill: not known until it mines; two containers on the tile: not known until it drops
trial("mixed-ore", "steel-chest", {x = 0, y = 0}, true, {mixed = true})
trial("two-targets", "car", {x = 0, y = -1.6}, true, {orientation = 0, also = "steel-chest"})

capture.each_tick({first_tick = options.ticks, last_tick = options.ticks, report = report, output = options.output,
    sample = function() return {} end,
    after_tick = function(elapsed)
        if elapsed < options.ticks then return end
        report.replaced.mining_target_at_end = replaced.mining_target ~= nil
        report.replaced.drop_target_at_end = replaced.drop_target ~= nil
        report.replaced.status = replaced.status
        report.replaced.at_end = select_and_export(surface, box, {wagon})
        report.trials = {}
        for _, t in ipairs(trials) do
            local filled = {}
            for _, target in ipairs(t.targets) do
                table.insert(filled, target.get_item_count("iron-ore") + target.get_item_count("copper-ore"))
            end
            local drop = t.drill.drop_target
            local dropped_into = 0
            for i, target in ipairs(t.targets) do if drop == target then dropped_into = i end end
            table.insert(report.trials, {name = t.name, hit = t.hit, at_build = t.at_build,
                mining_target_at_build = t.mining_target_at_build, drop_target_at_build = t.drop_target_at_build,
                filled = filled, dropped_into = dropped_into, at_end = select_and_export(lab, t.area, t.targets)})
        end
    end})
