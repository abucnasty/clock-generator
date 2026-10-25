local entities, surface, area = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")
local sidecar_helpers = require("__clock-generator-sidecar__.scripts.helpers")
local filters = {}
for name in pairs(prototypes.item["clock-generator-sidecar"].get_entity_type_filters(defines.selection_mode.select)) do
    table.insert(filters, name)
end
local selected = surface.find_entities_filtered({area = area, type = filters, force = game.forces.player})
local selected_units = {}
for _, entity in ipairs(selected) do selected_units[entity.unit_number] = true end
local candidate_types = {"assembling-machine", "furnace", "rocket-silo", "container", "logistic-container",
    "linked-container", "infinity-container", "car", "cargo-wagon"}
local function status_name(entity)
    for name, value in pairs(defines.entity_status) do if value == entity.status then return name end end
    return tostring(entity.status)
end
local function snapshot(state)
    local result = extraction.extract_all_entities(selected, game.forces.player)
    local config = export.to_table(result)
    local report = {state = state, selected_count = #selected, machines = config.machines, belts = config.belts, recyclers = {},
        advanced_takers = {}, left_out_advanced_takers = {}, target_inputs = {}}
    for _, entity in ipairs(selected) do
        if entity.valid and entity.name == "recycler" then
            local recipe = entity.get_recipe()
            local drop_target = entity.drop_target
            local machine_id = result.unit_number_to_id[entity.unit_number]
            local target_ref = machine_id and config.machines[machine_id].result_target
            local target = target_ref and result.machines[target_ref.id] and result.machines[target_ref.id].entity
            local candidates = {}
            local drop = entity.drop_position
            local x, y, reach = math.floor(drop.x), math.floor(drop.y), 12 / 256
            for _, candidate in ipairs(surface.find_entities_filtered({
                area = {{x + reach, y + reach}, {x + 1 - reach, y + 1 - reach}}, type = candidate_types,
            })) do
                if candidate.valid and selected_units[candidate.unit_number] then
                    table.insert(candidates, {unit_number = candidate.unit_number, name = candidate.name, type = candidate.type,
                        position = candidate.position})
                end
            end
            table.insert(report.recyclers, {unit_number = entity.unit_number, recipe = recipe and recipe.name or false,
                products_finished = entity.products_finished, status = entity.status, status_name = status_name(entity),
                drop_target = drop_target and {unit_number = drop_target.unit_number, name = drop_target.name, type = drop_target.type} or false,
                drop_position = drop, collision_candidates = candidates, result_target = target_ref or false,
                target_unit_number = target and target.unit_number or false, target_prototype = target and target.name or false,
                target_selected = target and selected_units[target.unit_number] or false,
                target_inventory = target and target.get_inventory(defines.inventory.crafter_input).get_contents() or false})
        end
    end
    local byproduct_units = {}
    for _, entity in ipairs(selected) do
        if entity.valid and entity.type == "inserter" then
            local filter = entity.get_filter(1)
            if filter and filter.name == "advanced-circuit" then
                byproduct_units[entity.unit_number] = true
                local source, sink = entity.pickup_target, entity.drop_target
                local line_contents = {}
                if sink and sink.valid and sink.get_transport_line then
                    for line = 1, sink.get_max_transport_line_index() do
                        table.insert(line_contents, sink.get_transport_line(line).get_contents())
                    end
                end
                table.insert(report.advanced_takers, {unit_number = entity.unit_number,
                    source = source and {unit_number = source.unit_number, name = source.name, type = source.type,
                        selected = selected_units[source.unit_number] or false} or false,
                    sink = sink and {unit_number = sink.unit_number, name = sink.name, type = sink.type,
                        selected = selected_units[sink.unit_number] or false, position = sink.position,
                        direction = sink.direction, belt_shape = sink.belt_shape, line_contents = line_contents} or false,
                    direction = entity.direction, position = entity.position, drop_position = entity.drop_position,
                    geometric_lane = sink and sidecar_helpers.get_near_lane(entity, sink) or false,
                    recipe_products = source and source.get_recipe and source.get_recipe() and
                        prototypes.recipe[source.get_recipe().name].products or {}})
            end
        end
    end
    local exported_units = {}
    for _, exported in ipairs(export.exported_inserters(result)) do
        exported_units[exported.inserter.entity.unit_number] = true
    end
    for _, taker in ipairs(report.advanced_takers) do taker.exported = exported_units[taker.unit_number] or false end
    for _, left in ipairs(export.left_out_inserters(result)) do
        if byproduct_units[left.inserter.entity.unit_number] then
            table.insert(report.left_out_advanced_takers, {unit_number = left.inserter.entity.unit_number,
                pickup = left.pickup, target_type = left.target and left.target.type or false,
                target_name = left.target and left.target.name or false})
        end
    end
    return report
end

local function write(report)
    helpers.write_file("recycler-sidecar-export.json", helpers.table_to_json(report), false)
end

if options.state == "idle-seeded" then
    local report = {samples = {}}
    capture.each_tick({first_tick = 21, last_tick = 21, report = report, output = "recycler-sidecar-export.json",
        sample = function() return {} end,
        after_tick = function(elapsed)
            if elapsed == 1 then
                for _, entity in ipairs(selected) do
                    if entity.valid and entity.name == "recycler" then entity.disabled_by_script = true end
                end
            elseif elapsed == 21 then report.snapshot = snapshot("idle-seeded") end
        end})
elseif options.state == "blocked" then
    local interventions = {}
    for _, entity in ipairs(selected) do
        if entity.valid and entity.name == "recycler" then
            local target = entity.drop_target
            assert(target and target.valid, "active recycler has a native drop target")
            target.disabled_by_script = true
            table.insert(interventions, {target_unit = target.unit_number, status_before_hold = status_name(entity)})
            for _, candidate in ipairs(selected) do
                if candidate.valid and candidate.type == "inserter" and candidate.drop_target == target then
                    candidate.disabled_by_script = true
                end
            end
        end
    end
    local report = {samples = {}}
    capture.each_tick({first_tick = 30, last_tick = 30, report = report, output = "recycler-sidecar-export.json",
        sample = function() return {} end,
        after_tick = function(elapsed)
            if elapsed == 30 then
                report.snapshot = snapshot("blocked")
                report.snapshot.interventions = interventions
            end
        end})
elseif options.state == "recently-emptied" then
    for _, entity in ipairs(selected) do
        if entity.valid and entity.name == "recycler" then
            entity.disabled_by_script = true
            entity.get_inventory(defines.inventory.crafter_output).clear()
            local target = entity.drop_target
            assert(target and target.valid, "recently active recycler retains its native drop target")
            target.get_inventory(defines.inventory.crafter_input).clear()
        end
    end
    write(snapshot("recently-emptied"))
else
    write(snapshot("active"))
end
