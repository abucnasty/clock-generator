-- An inserter dropping items from a chest onto a straight belt, one scenario each: which lane of the belt the items land on,
-- how many at a time, logged every tick. The belt runs in `direction` for six tiles; the inserter stands at one of four
-- places in the belt's own frame (u along the travel, v to the right of it, as the game's lane 2 is the right lane):
--   left   beside tile 3, on the left of the belt, dropping toward the right
--   right  beside tile 3, on the right of the belt, dropping toward the left
--   back   behind tile 0, dropping along the belt (the belt moves away from the inserter)
--   front  ahead of tile 5, dropping against the belt (the belt moves toward the inserter)
-- A scenario: {name, direction, side, inserter, item}. The inserter's drop position is its own: the vanilla inserters do not
-- allow custom vectors (allow_custom_vectors is logged).
local entities, surface = ...
local base
for _, entity in pairs(entities) do if entity.valid then base = entity.position end end
local force = game.forces["player"]
for key, value in pairs(options.force or {}) do force[key] = value end
local info = {scenarios = {}, status = {}, inserter_status = {}}
info.force = {inserter_stack_size_bonus = force.inserter_stack_size_bonus,
    bulk_inserter_capacity_bonus = force.bulk_inserter_capacity_bonus, belt_stack_size_bonus = force.belt_stack_size_bonus}
for key, value in pairs(defines.entity_status) do info.status[tostring(value)] = key end

local DIRECTIONS = {north = defines.direction.north, east = defines.direction.east, south = defines.direction.south, west = defines.direction.west}
-- a belt's frame: the world vector of one tile along the travel (u) and of one tile to the right of it (v)
local FRAMES = {north = {u = {0, -1}, v = {1, 0}}, east = {u = {1, 0}, v = {0, 1}}, south = {u = {0, 1}, v = {-1, 0}}, west = {u = {-1, 0}, v = {0, -1}}}
local OPPOSITE = {north = "south", south = "north", east = "west", west = "east"}
local BELT_LENGTH = 6

local function clear(area)
    for _, other in pairs(surface.find_entities_filtered({area = area})) do
        if other.valid and other.type ~= "character" then other.destroy() end
    end
end

--- the direction (a name) a local vector (du, dv) points to in the world
local function world_direction(direction, du, dv)
    local frame = FRAMES[direction]
    local x = du * frame.u[1] + dv * frame.v[1]
    local y = du * frame.u[2] + dv * frame.v[2]
    if x == 1 then return "east" elseif x == -1 then return "west" elseif y == 1 then return "south" else return "north" end
end

local runs = {}
for index, spec in ipairs(options.scenarios) do
    local ox = math.floor(base.x) + 14 + ((index - 1) % 10) * 20
    local oy = math.floor(base.y) + 14 + math.floor((index - 1) / 10) * 20
    clear({{ox - 9, oy - 9}, {ox + 10, oy + 10}})
    local frame = FRAMES[spec.direction]
    -- a position in the belt's frame, at the centre of a tile
    local function at(u, v) return {ox + 0.5 + u * frame.u[1] + v * frame.v[1], oy + 0.5 + u * frame.u[2] + v * frame.v[2]} end
    local run = {spec = spec, belts = {}, log = {}}
    for u = 0, BELT_LENGTH - 1 do
        table.insert(run.belts, surface.create_entity({name = "transport-belt", position = at(u, 0), force = "player", direction = DIRECTIONS[spec.direction]}))
    end
    -- the inserter's tile, the chest behind it, a pole and the power
    local iu, iv, du, dv
    if spec.side == "left" then iu, iv, du, dv = 3, -1, 0, 1
    elseif spec.side == "right" then iu, iv, du, dv = 3, 1, 0, -1
    elseif spec.side == "back" then iu, iv, du, dv = -1, 0, 1, 0
    else iu, iv, du, dv = BELT_LENGTH, 0, -1, 0 end
    local pickup = world_direction(spec.direction, -du, -dv)
    run.source = surface.create_entity({name = "steel-chest", position = at(iu - du, iv - dv), force = "player"})
    run.source.get_inventory(defines.inventory.chest).insert({name = spec.item, count = 400})
    run.inserter = surface.create_entity({name = spec.inserter, position = at(iu, iv), force = "player", direction = DIRECTIONS[pickup]})
    local pole_u, pole_v = iu + (du == 0 and 1 or 0), iv + (dv == 0 and -1 or 0)
    surface.create_entity({name = "small-electric-pole", position = at(pole_u, pole_v), force = "player"})
    local iface = surface.create_entity({name = "electric-energy-interface", position = at(pole_u, pole_v - 2), force = "player"})
    iface.electric_buffer_size = 1e10
    iface.power_production = 1e7
    iface.energy = 1e10
    info.scenarios[index] = {name = spec.name, direction = spec.direction, side = spec.side, inserter = spec.inserter, item = spec.item}
    run.frame_origin = {x = ox + 0.5, y = oy + 0.5}
    runs[index] = run
end

local function lane_counts(run)
    local left, right = 0, 0
    for _, belt in ipairs(run.belts) do
        left = left + belt.get_transport_line(1).get_item_count()
        right = right + belt.get_transport_line(2).get_item_count()
    end
    return left, right
end

local started = game.tick
script.on_nth_tick(1, function()
    local t = game.tick - started
    if t == 3 then
        -- what the inserter's targets and drop position are once the game has settled them, in the belt's frame
        for index, run in ipairs(runs) do
            local entry, inserter, frame = info.scenarios[index], run.inserter, FRAMES[run.spec.direction]
            entry.allow_custom_vectors = prototypes.entity[inserter.name].allow_custom_vectors
            entry.pickup = inserter.pickup_target and inserter.pickup_target.name or "none"
            entry.drop_target = inserter.drop_target and inserter.drop_target.name or "none"
            local rx, ry = inserter.drop_position.x - run.frame_origin.x, inserter.drop_position.y - run.frame_origin.y
            entry.drop = {u = rx * frame.u[1] + ry * frame.u[2], v = rx * frame.v[1] + ry * frame.v[2]}
        end
    end
    for _, run in ipairs(runs) do
        local held = run.inserter.held_stack
        local left, right = lane_counts(run)
        table.insert(run.log, {t, left, right, held.valid_for_read and held.count or 0, run.inserter.status or -1})
    end
    if t >= options.ticks then
        script.on_nth_tick(1, nil)
        local out = {info = info, columns = {"t", "left", "right", "hand", "inserter_status"}, runs = {}}
        for _, run in ipairs(runs) do out.runs[run.spec.name] = run.log end
        helpers.write_file("belt-drop-lane.json", helpers.table_to_json(out), false)
    end
end)
