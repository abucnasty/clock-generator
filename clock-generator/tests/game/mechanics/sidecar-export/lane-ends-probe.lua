-- The end of each lane and the way the items move, as the Sidecar exports them for a belt an inserter picks up from.
-- Small builds on their own ground, each a belt line that runs on from the piece an inserter picks up from. Iron plates
-- are put on lane 1 (left) and copper plates on lane 2 (right) of the line's first piece every tick for options.ticks ticks.
-- In the builds that side-load into an underground piece of another belt, what reaches the other belt shows which lane
-- the hood blocks in the game. At the end every build is exported as the Sidecar's selection of its entities.
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")

local force = game.forces.player
local N, E, S, W = defines.direction.north, defines.direction.east, defines.direction.south, defines.direction.west
local LANE_ITEMS = { "iron-plate", "copper-plate" }

local function build(name, x, y, direction, endpoint)
    local entity = surface.create_entity{name = name, position = {x, y}, direction = direction, type = endpoint, force = force}
    return assert(entity, name .. " at " .. x .. "," .. y) and entity
end
local function line(x, y, direction, count)
    local dx = direction == E and 1 or direction == W and -1 or 0
    local dy = direction == S and 1 or direction == N and -1 or 0
    local pieces = {}
    for i = 0, count - 1 do table.insert(pieces, build("turbo-transport-belt", x + dx * i, y + dy * i, direction)) end
    return pieces
end
local function feed(piece)
    for lane = 1, 2 do piece.get_transport_line(lane).insert_at_back({name = LANE_ITEMS[lane], count = 1}) end
end

-- An inserter beside a piece that picks up from it into a chest behind it. The chest holds an iron plate and is closed,
-- so the inserter takes at most one hand: the lanes stay as they are fed.
local function picker(piece, dx, dy)
    local px, py = piece.position.x, piece.position.y
    local inserter = build("stack-inserter", px + dx, py + dy, dx == 1 and W or dx == -1 and E or dy == 1 and N or S)
    local chest = build("wooden-chest", px + 2 * dx, py + 2 * dy)
    local inventory = chest.get_inventory(defines.inventory.chest)
    inventory.insert({name = "iron-plate", count = 1})
    inventory.set_bar(1)
    inserter.pickup_target = piece
    inserter.drop_target = chest
    assert(inserter.pickup_target == piece and inserter.drop_target == chest, "the inserter picks up from its piece")
    return {inserter, chest}
end
local function join(...)
    local all = {}
    for _, list in ipairs{...} do for _, entity in ipairs(list) do table.insert(all, entity) end end
    return all
end

local cases = {}
-- `selection`: the entities the Sidecar is given; `first`: the piece fed every tick; `other`: the pieces of the belt the
-- line side-loads into, whose items are read at the end
local function case(name, selection, first, other)
    table.insert(cases, {name = name, selection = selection, first = first, other = other})
end

-- one build every 30 tiles in x, so none touches another
local X, Y = 200, 600
local function origin() X = X + 30; return X, Y end

do local x, y = origin()  -- a line that ends: nothing after its last piece
    local a = line(x, y, E, 5)
    case("dead-end", join(a, picker(a[2], 0, 1)), a[1])
end
do local x, y = origin()  -- a line that runs on past the pieces selected
    local a = line(x, y, E, 8)
    case("runs-past-the-selection", join({a[1], a[2], a[3], a[4], a[5]}, picker(a[2], 0, 1)), a[1])
end
do local x, y = origin()  -- a line into a loader that loads into an infinity chest that removes every item
    local a = line(x, y, E, 4)
    local last = a[4].position
    local loader = build("turbo-loader", last.x + 1.5, last.y, E, "input")
    local chest = build("infinity-chest", last.x + 3, last.y)
    chest.remove_unfiltered_items = true
    -- a loader built before its chest finds the chest when its connections are made again
    loader.update_connections()
    assert(loader.loader_container == chest, "the loader loads into the chest")
    assert(a[4].belt_neighbours.outputs[1] == loader, "the line runs into the loader")
    case("runs-on-into-a-loader-that-takes-everything", join(a, {loader, chest}, picker(a[2], 0, 1)), a[1])
end
do local x, y = origin()  -- the same into a chest that fills up
    local a = line(x, y, E, 4)
    local last = a[4].position
    local loader = build("turbo-loader", last.x + 1.5, last.y, E, "input")
    local chest = build("steel-chest", last.x + 3, last.y)
    -- a loader built before its chest finds the chest when its connections are made again
    loader.update_connections()
    assert(loader.loader_container == chest, "the loader loads into the chest")
    case("runs-on-into-a-loader-that-fills-a-chest", join(a, {loader, chest}, picker(a[2], 0, 1)), a[1])
end
do local x, y = origin()  -- a line into an underground entrance that has no exit
    local a = line(x, y, E, 3)
    local entrance = build("turbo-underground-belt", x + 3, y, E, "input")
    case("entrance-without-exit", join(a, {entrance}, picker(a[2], 0, 1)), a[1])
end
-- A line that runs south or north side-loads into an underground piece of a belt that runs east. The other belt has
-- nothing behind it, so what it carries comes from the line only.
do local x, y = origin()  -- into an entrance from the north
    local a = line(x, y - 4, S, 4)
    local entrance = build("turbo-underground-belt", x, y, E, "input")
    local exit = build("turbo-underground-belt", x + 3, y, E, "output")
    local after = line(x + 4, y, E, 3)
    local other = join({entrance, exit}, after)
    case("side-load-into-an-entrance-from-the-north", join(a, other, picker(a[1], 1, 0)), a[1], other)
end
do local x, y = origin()  -- into an entrance from the south
    local a = line(x, y + 4, N, 4)
    local entrance = build("turbo-underground-belt", x, y, E, "input")
    local exit = build("turbo-underground-belt", x + 3, y, E, "output")
    local after = line(x + 4, y, E, 3)
    local other = join({entrance, exit}, after)
    case("side-load-into-an-entrance-from-the-south", join(a, other, picker(a[1], 1, 0)), a[1], other)
end
do local x, y = origin()  -- into an exit that has no entrance, from the north (the three-copy inserter build's ore lines)
    local a = line(x, y - 4, S, 4)
    local exit = build("turbo-underground-belt", x, y, E, "output")
    local after = line(x + 1, y, E, 3)
    local other = join({exit}, after)
    case("side-load-into-an-exit-from-the-north", join(a, other, picker(a[1], 1, 0)), a[1], other)
end
do local x, y = origin()  -- into an exit that has no entrance, from the south
    local a = line(x, y + 4, N, 4)
    local exit = build("turbo-underground-belt", x, y, E, "output")
    local after = line(x + 1, y, E, 3)
    local other = join({exit}, after)
    case("side-load-into-an-exit-from-the-south", join(a, other, picker(a[1], 1, 0)), a[1], other)
end
do local x, y = origin()  -- into an exit whose entrance has a belt behind it: the other belt may carry items from upstream
    local a = line(x, y - 4, S, 4)
    local behind = line(x - 5, y, E, 1)
    local entrance = build("turbo-underground-belt", x - 4, y, E, "input")
    local exit = build("turbo-underground-belt", x, y, E, "output")
    local after = line(x + 1, y, E, 3)
    case("side-load-into-an-exit-fed-through-its-tunnel", join(a, behind, {entrance, exit}, after, picker(a[1], 1, 0)), a[1])
end
do local x, y = origin()  -- a line into a splitter
    local a = line(x, y, E, 3)
    local splitter = build("turbo-splitter", x + 3, y, E)
    local after = line(x + 4, y, E, 2)
    assert(a[3].belt_neighbours.outputs[1] == splitter, "the line runs into the splitter")
    case("into-a-splitter", join(a, {splitter}, after, picker(a[1], 0, 1)), a[1])
end
do local x, y = origin()  -- another belt side-loads onto the line past the pickup
    local a = line(x, y, E, 6)
    local side = line(x + 3, y + 1, N, 1)
    assert(a[4].belt_shape == "straight", "the side belt side-loads onto the line")
    case("merge-onto-the-line-past-the-pickup", join(a, side, picker(a[1], 0, -1)), a[1])
end
do local x, y = origin()  -- a line that turns, with a pickup before the curve and one after it
    local a, b = line(x, y, E, 3), line(x + 3, y, S, 3)
    assert(b[1].belt_shape ~= "straight", "the piece that turns is a curve")
    case("pickups-either-side-of-a-curve", join(a, b, picker(a[1], 0, -1), picker(b[2], 1, 0)), a[1])
end
do local x, y = origin()  -- a belt the build only drops onto, which runs on past the selection to takers outside it
    local a = line(x, y, E, 6)
    local inserter = build("stack-inserter", x + 1, y + 1, S)
    local chest = build("infinity-chest", x + 1, y + 2)
    chest.set_infinity_container_filter(1, {name = "iron-plate", count = 50, mode = "at-least", index = 1})
    inserter.pickup_target = chest
    inserter.drop_target = a[2]
    assert(inserter.drop_target == a[2], "the inserter drops onto the belt")
    case("export-belt-dropped-onto", join({a[1], a[2], a[3], a[4]}, {inserter, chest}), a[1])
end

local report = {samples = {}, cases = {}}

local function line_items(pieces)
    local found = {{}, {}}
    for _, piece in ipairs(pieces) do
        for lane = 1, 2 do
            for _, item in ipairs(piece.get_transport_line(lane).get_contents()) do found[lane][item.name] = true end
        end
    end
    local lists = {}
    for lane = 1, 2 do
        local names = {}
        for name in pairs(found[lane]) do table.insert(names, name) end
        table.sort(names)
        lists[lane] = names
    end
    return lists
end

capture.each_tick({first_tick = options.ticks, last_tick = options.ticks, report = report, output = options.output,
    sample = function() return {} end,
    after_tick = function(elapsed)
        if elapsed < options.ticks then
            for _, c in ipairs(cases) do feed(c.first) end
            return
        end
        for _, c in ipairs(cases) do
            local result = extraction.extract_all_entities(c.selection, force)
            table.insert(report.cases, {name = c.name, belts = export.to_table(result).belts,
                other_items = c.other and line_items(c.other) or nil})
        end
    end})
