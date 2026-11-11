-- The spacing of the copies, as the Sidecar exports it in the suggested target. Small builds on their own ground, each a
-- belt line of iron plates that inserters take from into assemblers making gears (into chests in one build). A copy is
-- one or two inserters and the assembler they fill; the copies stand along the line. At the end every build is exported
-- as the Sidecar's selection of its entities.
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")

local force = game.forces.player
local N, E, S, W = defines.direction.north, defines.direction.east, defines.direction.south, defines.direction.west

local function build(name, x, y, direction, extra)
    local spec = {name = name, position = {x, y}, direction = direction, force = force}
    for key, value in pairs(extra or {}) do spec[key] = value end
    local entity = surface.create_entity(spec)
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
    for lane = 1, 2 do piece.get_transport_line(lane).insert_at_back({name = "iron-plate", count = 1}) end
end

-- An inserter beside `piece` (dx, dy: the side) that takes from it into `target`
local function taker(piece, dx, dy, target)
    local px, py = piece.position.x, piece.position.y
    local inserter = build("stack-inserter", px + dx, py + dy, dx == 1 and W or dx == -1 and E or dy == 1 and N or S)
    inserter.pickup_target = piece
    inserter.drop_target = target
    assert(inserter.pickup_target == piece and inserter.drop_target == target, "the inserter takes from its piece into its target")
    return inserter
end
-- An assembler making gears beyond the inserter beside `piece`, on side (dx, dy); it also reaches the next piece along
local function assembler(piece, dx, dy)
    local px, py = piece.position.x, piece.position.y
    return build("assembling-machine-3", px + 3 * dx, py + 3 * dy, nil, {recipe = "iron-gear-wheel"})
end
-- A copy of one inserter and its assembler beside `piece`, on side (dx, dy)
local function copy(piece, dx, dy)
    local machine = assembler(piece, dx, dy)
    return {taker(piece, dx, dy, machine), machine}
end
local function join(...)
    local all = {}
    for _, list in ipairs{...} do for _, entity in ipairs(list) do table.insert(all, entity) end end
    return all
end

local cases = {}
-- `first`: the first piece of the line, fed every tick; `also`: the first piece of a second line
local function case(name, selection, first, also)
    table.insert(cases, {name = name, selection = selection, first = first, also = also})
end

-- one build every 40 tiles in x, so none touches another
local X, Y = 200, 700
local function origin() X = X + 40; return X, Y end

do local x, y = origin()  -- two copies 4 tiles apart
    local a = line(x, y, E, 10)
    case("two-copies-4-apart", join(a, copy(a[2], 0, 1), copy(a[6], 0, 1)), a[1])
end
do local x, y = origin()  -- three copies 6 tiles apart
    local a = line(x, y, E, 16)
    case("three-copies-6-apart", join(a, copy(a[2], 0, 1), copy(a[8], 0, 1), copy(a[14], 0, 1)), a[1])
end
do local x, y = origin()  -- three copies 7 tiles apart, each two inserters into one assembler
    local a = line(x, y, E, 20)
    local all = {}
    for k = 0, 2 do
        local machine = assembler(a[2 + 7 * k], 0, 1)
        all = join(all, {machine, taker(a[2 + 7 * k], 0, 1, machine), taker(a[3 + 7 * k], 0, 1, machine)})
    end
    case("three-copies-of-two-inserters-7-apart", join(a, all), a[1])
end
do local x, y = origin()  -- two copies 5 tiles apart along a belt that runs south
    local a = line(x, y, S, 10)
    case("two-copies-5-apart-on-a-belt-running-south", join(a, copy(a[2], 1, 0), copy(a[7], 1, 0)), a[1])
end
do local x, y = origin()  -- two copies 4 tiles apart along a belt that runs west: the next copy is the one downstream
    local a = line(x + 10, y, W, 10)
    case("two-copies-4-apart-on-a-belt-running-west", join(a, copy(a[2], 0, 1), copy(a[6], 0, 1)), a[1])
end
do local x, y = origin()  -- three copies 4 and then 5 tiles apart
    local a = line(x, y, E, 14)
    case("three-copies-unevenly-apart", join(a, copy(a[2], 0, 1), copy(a[6], 0, 1), copy(a[11], 0, 1)), a[1])
end
do local x, y = origin()  -- two copies 4 tiles apart, the second on the other side of the belt
    local a = line(x, y, E, 10)
    case("two-copies-mirrored", join(a, copy(a[2], 0, 1), copy(a[6], 0, -1)), a[1])
end
do local x, y = origin()  -- one copy
    local a = line(x, y, E, 6)
    case("one-copy", join(a, copy(a[2], 0, 1)), a[1])
end
do local x, y = origin()  -- two copies of two inserters 7 tiles apart, and a part copy of the first inserter only
    local a = line(x, y, E, 20)
    local all = {}
    for k = 0, 2 do
        local machine = assembler(a[2 + 7 * k], 0, 1)
        all = join(all, {machine, taker(a[2 + 7 * k], 0, 1, machine)})
        if k < 2 then table.insert(all, taker(a[3 + 7 * k], 0, 1, machine)) end
    end
    case("two-copies-and-a-part-copy", join(a, all), a[1])
end
do local x, y = origin()  -- two copies 4 tiles apart that fill chests: no machine, so no suggested target to state it in
    local a = line(x, y, E, 10)
    local all = {}
    for _, k in ipairs{2, 6} do
        local chest = build("wooden-chest", a[k].position.x, a[k].position.y + 2)
        all = join(all, {chest, taker(a[k], 0, 1, chest)})
    end
    case("two-copies-into-chests", join(a, all), a[1])
end
-- Builds of two belts: a second belt runs 6 tiles south of the first, below the assemblers
do local x, y = origin()  -- two copies 4 tiles apart that take from both belts
    local a, b = line(x, y, E, 10), line(x, y + 6, E, 10)
    local one, two = copy(a[2], 0, 1), copy(a[6], 0, 1)
    case("two-copies-4-apart-on-two-belts", join(a, b, one, two, {taker(b[2], 0, -1, one[2]), taker(b[6], 0, -1, two[2])}), a[1], b[1])
end
do local x, y = origin()  -- inserters alike 4 tiles apart on one belt and 6 tiles apart on the other, into chests
    local a, b = line(x, y, E, 10), line(x, y + 8, E, 10)
    local all = join(copy(a[2], 0, 1), copy(a[6], 0, 1))
    for _, k in ipairs{2, 8} do
        local chest = build("wooden-chest", b[k].position.x, b[k].position.y - 2)
        all = join(all, {chest, taker(b[k], 0, -1, chest)})
    end
    case("two-belts-whose-spacings-differ", join(a, b, all), a[1], b[1])
end
do local x, y = origin()  -- two copies 4 tiles apart that take from two belts running opposite ways
    local a, b = line(x, y, E, 10), line(x + 9, y + 6, W, 10)
    local one, two = copy(a[2], 0, 1), copy(a[6], 0, 1)
    -- b[9] is below the first assembler and b[5] below the second
    case("two-copies-on-belts-running-opposite-ways", join(a, b, one, two, {taker(b[9], 0, -1, one[2]), taker(b[5], 0, -1, two[2])}), a[1], b[1])
end
do local x, y = origin()  -- two assemblers alike on one belt, and one inserter from the other belt into the first only
    local a, b = line(x, y, E, 10), line(x, y + 6, E, 10)
    local one, two = copy(a[2], 0, 1), copy(a[6], 0, 1)
    case("two-assemblers-alike-and-an-inserter-unlike-on-a-second-belt", join(a, b, one, two, {taker(b[2], 0, -1, one[2])}), a[1], b[1])
end
-- A run of belt going `way` (east or west) that dips into a stub at each copy: at each offset of `at` along the run it
-- turns south, an inserter picks up from the straight piece of the stub, which faces south, and the belt comes back up
-- to the run. The inserter stands beside the stub on the side the run comes from, and fills an assembler behind it.
local function stubs(x, y, way, at, length)
    local sx = way == E and 1 or -1
    local pieces, copies = {}, {}
    local function put(i, dy, direction)
        local piece = build("turbo-transport-belt", x + sx * i, y + dy, direction)
        table.insert(pieces, piece)
        return piece
    end
    local stub = {}
    for _, k in ipairs(at) do stub[k] = true end
    local i = 0
    while i < length do
        if stub[i] then
            put(i, 0, S)
            local pickup = put(i, 1, S)
            put(i, 2, way); put(i + 1, 2, N); put(i + 1, 1, N); put(i + 1, 0, way)
            local machine = build("assembling-machine-3", pickup.position.x - 3 * sx, pickup.position.y + 1, nil, {recipe = "iron-gear-wheel"})
            copies = join(copies, {machine, taker(pickup, -sx, 0, machine)})
            i = i + 2
        else
            put(i, 0, way)
            i = i + 1
        end
    end
    return pieces, copies
end
do local x, y = origin()  -- three copies 6 tiles apart on stubs across a run going east
    local pieces, copies = stubs(x + 4, y, E, {4, 10, 16}, 20)
    case("three-copies-on-stubs-across-a-run-going-east", join(pieces, copies), pieces[1])
end
do local x, y = origin()  -- the same mirrored: the run goes west
    local pieces, copies = stubs(x + 30, y, W, {4, 10, 16}, 20)
    case("three-copies-on-stubs-across-a-run-going-west", join(pieces, copies), pieces[1])
end
do local x, y = origin()  -- three copies on stubs 6 and then 7 tiles apart
    local pieces, copies = stubs(x + 4, y, E, {4, 10, 17}, 21)
    case("three-copies-unevenly-apart-on-stubs", join(pieces, copies), pieces[1])
end
do local x, y = origin()  -- one copy on a line that turns north past the pickup
    local a = line(x, y, E, 4)
    local up = line(x + 4, y, N, 3)
    case("one-copy-on-a-line-that-turns", join(a, up, copy(a[2], 0, 1)), a[1])
end

local report = {samples = {}, cases = {}}

capture.each_tick({first_tick = options.ticks, last_tick = options.ticks, report = report, output = options.output,
    sample = function() return {} end,
    after_tick = function(elapsed)
        if elapsed < options.ticks then
            for _, c in ipairs(cases) do
                feed(c.first)
                if c.also then feed(c.also) end
            end
            return
        end
        for _, c in ipairs(cases) do
            local exported = export.to_table(extraction.extract_all_entities(c.selection, force))
            local flows = {}
            for _, belt in ipairs(exported.belts) do table.insert(flows, belt.flow_direction or "none") end
            table.insert(report.cases, {name = c.name, suggested_target = exported.suggested_target or false,
                setpoint = exported.setpoint ~= nil, inserters = #exported.inserters, flows = flows})
        end
    end})
