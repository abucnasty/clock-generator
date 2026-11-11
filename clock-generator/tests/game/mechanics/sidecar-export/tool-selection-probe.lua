-- The end of each lane as the Sidecar exports it from a selection made as its tool makes one: the entities of an area
-- of the player's force, kept to the entity types of the tool's filters, read from the tool's prototype for each
-- selection mode. Each build stands in its own area: a belt line of iron and copper plates that an inserter picks up
-- from, which ends in a loader into an infinity chest.
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")

local force = game.forces.player
local E, N = defines.direction.east, defines.direction.north
local LANE_ITEMS = { "iron-plate", "copper-plate" }

local function build(name, x, y, direction, endpoint)
    local entity = surface.create_entity{name = name, position = {x, y}, direction = direction, type = endpoint, force = force}
    return assert(entity, name .. " at " .. x .. "," .. y) and entity
end

local cases = {}
-- A line of four belts east from (x, y), an inserter that picks up from its second piece into a closed chest, and a
-- loader after the line that loads into an infinity chest; `voids`: the chest removes every item
local function line_into_loader(name, x, y, voids)
    local pieces = {}
    for i = 0, 3 do table.insert(pieces, build("turbo-transport-belt", x + i, y, E)) end
    local inserter = build("stack-inserter", x + 1, y + 1, N)
    local chest = build("wooden-chest", x + 1, y + 2)
    chest.get_inventory(defines.inventory.chest).insert({name = "iron-plate", count = 1})
    chest.get_inventory(defines.inventory.chest).set_bar(1)
    inserter.pickup_target = pieces[2]
    inserter.drop_target = chest
    local last = pieces[4].position
    local loader = build("turbo-loader", last.x + 1.5, last.y, E, "input")
    local sink = build("infinity-chest", last.x + 3, last.y)
    sink.remove_unfiltered_items = voids
    -- a loader built before its chest finds the chest when its connections are made again
    loader.update_connections()
    assert(loader.loader_container == sink, "the loader loads into the chest")
    table.insert(cases, {name = name, first = pieces[1], area = {{x - 1, y - 1}, {x + 7, y + 3}}})
end
line_into_loader("line-into-a-loader-into-a-chest-that-removes-everything", 260, 800, true)
line_into_loader("line-into-a-loader-into-a-chest-that-keeps-what-it-gets", 280, 800, false)

local MODES = { select = defines.selection_mode.select, alt_select = defines.selection_mode.alt_select }

local report = {samples = {}, cases = {}}

capture.each_tick({first_tick = options.ticks, last_tick = options.ticks, report = report, output = options.output,
    sample = function() return {} end,
    after_tick = function(elapsed)
        if elapsed < options.ticks then
            for _, c in ipairs(cases) do
                for lane = 1, 2 do c.first.get_transport_line(lane).insert_at_back({name = LANE_ITEMS[lane], count = 1}) end
            end
            return
        end
        for mode, selection_mode in pairs(MODES) do
            local types = {}
            for type in pairs(prototypes.item["clock-generator-sidecar"].get_entity_type_filters(selection_mode)) do
                table.insert(types, type)
            end
            for _, c in ipairs(cases) do
                local selected = surface.find_entities_filtered{area = c.area, force = force, type = types}
                local belts = export.to_table(extraction.extract_all_entities(selected, force)).belts
                local ends = {}
                for _, belt in ipairs(belts) do
                    for _, lane in ipairs(belt.lanes) do table.insert(ends, lane.lane_end and lane.lane_end.kind or "none") end
                end
                table.insert(report.cases, {name = c.name, mode = mode, belts = #belts, ends = ends})
            end
        end
    end})
