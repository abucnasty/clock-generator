-- Inserters dropping a full hand from a chest onto turbo belts, one scenario each, side by side, logged every tick: the tick each
-- stack lands, where on which lane, and what the lane held. Nothing is read from settings: the log is the contents of every belt
-- piece's transport lines (position, count, item, unique id), the hand and the inserter's status.
--
-- A scenario (see cases.ts): {name, approach, direction, inserter, quality, traffic?, queue?}.
-- The line runs in `direction` for 8 tile slots 0..7 (u along the travel, v to the right of it). Its pieces are belts, or, for the
-- underground approaches, an entrance in slot 0, tunnel slots 1 and 2 and an exit in slot 3, then belts to slot 7.
-- `traffic` puts copper stacks on both lanes at the start of the line from tick 1 on, while the chest is still empty: {ticks, period, phase, stop}.
-- A position in a transport line is the distance to the end of its piece (it falls as items move on; a belt piece is 1 long).
-- `queue` puts that many copper stacks on each lane at the end of a dead-end line before the chest is filled.
-- The chest is filled at tick `go`; the inserter picks up in the tick after. A line that flows ends in a sink: the last
-- piece's lanes are emptied after every sample.
local entities, surface = ...
local base
for _, entity in pairs(entities) do if entity.valid then base = entity.position end end
local force = game.forces["player"]
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {researched = technology.researched, level = technology.level} end
    return helpers.table_to_json(result)
end
local research_before = research()
for key, value in pairs(options.force or {}) do force[key] = value end
assert(research() == research_before, "research changed")

local DIRECTIONS = {north = defines.direction.north, east = defines.direction.east, south = defines.direction.south, west = defines.direction.west}
local FRAMES = {north = {u = {0, -1}, v = {1, 0}}, east = {u = {1, 0}, v = {0, 1}}, south = {u = {0, 1}, v = {-1, 0}}, west = {u = {-1, 0}, v = {0, -1}}}
local SLOTS = 8
local GO = options.go

-- approach: where the inserter stands, in slots along the line (iu) and to the right (iv), the unit step (du, dv) of its swing from
-- its pickup to its drop, which piece layout, whether the line flows on to a sink, and the slot its drop lands in (the log keeps the
-- pieces from the slot before it to three after it). The offsets are for an inserter that reaches one slot.
local APPROACHES = {
    left = {iu = 3, iv = -1, du = 0, dv = 1, layout = "belts", flows = true, drop_slot = 3},
    right = {iu = 3, iv = 1, du = 0, dv = -1, layout = "belts", flows = true, drop_slot = 3},
    back = {iu = -1, iv = 0, du = 1, dv = 0, layout = "belts", flows = true, drop_slot = 0},
    front = {iu = 8, iv = 0, du = -1, dv = 0, layout = "belts", flows = false, drop_slot = 7},
    ["entrance-left"] = {iu = 0, iv = -1, du = 0, dv = 1, layout = "underground", flows = true, drop_slot = 0},
    ["entrance-right"] = {iu = 0, iv = 1, du = 0, dv = -1, layout = "underground", flows = true, drop_slot = 0},
    ["exit-left"] = {iu = 3, iv = -1, du = 0, dv = 1, layout = "underground", flows = true, drop_slot = 3},
    ["exit-right"] = {iu = 3, iv = 1, du = 0, dv = -1, layout = "underground", flows = true, drop_slot = 3},
    ["entrance-from-upstream"] = {iu = -1, iv = 0, du = 1, dv = 0, layout = "underground", flows = true, drop_slot = 0},
    ["entrance-from-downstream"] = {iu = 1, iv = 0, du = -1, dv = 0, layout = "underground", flows = true, drop_slot = 0},
    ["exit-from-upstream"] = {iu = 2, iv = 0, du = 1, dv = 0, layout = "underground", flows = true, drop_slot = 3},
    ["exit-from-downstream"] = {iu = 4, iv = 0, du = -1, dv = 0, layout = "underground", flows = false, drop_slot = 3},
}
-- the underground line: entrance, two tunnel slots, exit, and belts after it unless the exit ends the line
local function pieces_of(approach)
    local spec = APPROACHES[approach]
    local result = {}
    if spec.layout == "belts" then
        for u = 0, SLOTS - 1 do result[#result + 1] = {u = u, kind = "transport-belt"} end
    else
        result[#result + 1] = {u = 0, kind = "underground-belt", io = "input"}
        result[#result + 1] = {u = 3, kind = "underground-belt", io = "output"}
        if spec.flows then for u = 4, SLOTS - 1 do result[#result + 1] = {u = u, kind = "transport-belt"} end end
    end
    return result
end

local info = {scenarios = {}, status = {}, go = GO, ticks = options.ticks, slots = SLOTS}
info.force = {inserter_stack_size_bonus = force.inserter_stack_size_bonus,
    bulk_inserter_capacity_bonus = force.bulk_inserter_capacity_bonus, belt_stack_size_bonus = force.belt_stack_size_bonus}
info.research_unchanged = research() == research_before
info.factorio = script.active_mods.base
for key, value in pairs(defines.entity_status) do info.status[tostring(value)] = key end

-- the cells: east and west lines in short wide cells, north and south lines in tall narrow ones
local ZONE = {east = {w = 18, h = 12}, west = {w = 18, h = 12}, north = {w = 12, h = 18}, south = {w = 12, h = 18}}
local PER_ROW = 14
local cursor = {ew = {x = 0, y = 0, row_h = 0}, ns = {x = 0, y = 0, row_h = 0}}
local zone_y0 = {ew = 0}
-- count the rows the east-west zone needs, so the north-south zone starts below it
local ew_count = 0
for _, spec in ipairs(options.scenarios) do if spec.direction == "east" or spec.direction == "west" then ew_count = ew_count + 1 end end
zone_y0.ns = math.ceil(ew_count / PER_ROW) * 12 + 4
local function cell_of(spec)
    local ns = spec.direction == "north" or spec.direction == "south"
    local zone = ns and "ns" or "ew"
    local c = cursor[zone]
    local size = ZONE[spec.direction]
    if c.x + size.w > PER_ROW * 18 then c.x = 0; c.y = c.y + c.row_h; c.row_h = 0 end
    local x, y = c.x, c.y
    c.x = c.x + size.w
    c.row_h = math.max(c.row_h, size.h)
    return base.x + 14 + x + size.w / 2, base.y + 14 + (zone == "ns" and zone_y0.ns or 0) + y + size.h / 2
end

-- make the ground the same everywhere, generated and buildable
local min_x, min_y, max_x, max_y = math.huge, math.huge, -math.huge, -math.huge
local cells = {}
for index, spec in ipairs(options.scenarios) do
    local cx, cy = cell_of(spec)
    cells[index] = {cx, cy}
    local size = ZONE[spec.direction]
    min_x, min_y = math.min(min_x, cx - size.w / 2), math.min(min_y, cy - size.h / 2)
    max_x, max_y = math.max(max_x, cx + size.w / 2), math.max(max_y, cy + size.h / 2)
end
surface.request_to_generate_chunks({(min_x + max_x) / 2, (min_y + max_y) / 2}, math.ceil(math.max(max_x - min_x, max_y - min_y) / 64) + 1)
surface.force_generate_chunk_requests()
for _, other in pairs(surface.find_entities_filtered({area = {{min_x - 2, min_y - 2}, {max_x + 2, max_y + 2}}})) do
    if other.valid and other.type ~= "character" and not (other.position.x == base.x and other.position.y == base.y) then
        other.destroy()
    end
end
local tiles = {}
for x = math.floor(min_x) - 2, math.ceil(max_x) + 2 do
    for y = math.floor(min_y) - 2, math.ceil(max_y) + 2 do tiles[#tiles + 1] = {name = "refined-concrete", position = {x, y}} end
end
surface.set_tiles(tiles)

local runs = {}
for index, spec in ipairs(options.scenarios) do
    local approach = assert(APPROACHES[spec.approach], "unknown approach " .. spec.approach)
    local frame = FRAMES[spec.direction]
    local cx, cy = cells[index][1], cells[index][2]
    -- the origin is the middle of slot 0; the middle of the line (slot 3.5) is the cell's middle
    local ox, oy = cx - 3.5 * frame.u[1] - 0.0, cy - 3.5 * frame.u[2]
    ox, oy = math.floor(ox) + 0.5, math.floor(oy) + 0.5
    local function at(u, v) return {ox + u * frame.u[1] + v * frame.v[1], oy + u * frame.u[2] + v * frame.v[2]} end
    local run = {spec = spec, pieces = {}, log = {}, approach = approach, seen = {}, next_seq = 0}
    local travel = DIRECTIONS[spec.direction]
    for _, piece in ipairs(pieces_of(spec.approach)) do
        local params = {name = "turbo-" .. piece.kind, position = at(piece.u, 0), force = "player", direction = travel}
        if piece.io then params.type = piece.io end
        local entity = assert(surface.create_entity(params), "could not build " .. params.name .. " in " .. spec.name)
        run.pieces[#run.pieces + 1] = {entity = entity, u = piece.u, kind = piece.kind, io = piece.io, lines = entity.get_max_transport_line_index()}
    end
    local reach = (spec.inserter == "long-handed-inserter") and 2 or 1
    local iu, iv = approach.iu, approach.iv
    -- the inserter stands `reach` slots from the line on the side it swings to; the offsets above are for reach 1
    if approach.iv ~= 0 then iv = approach.iv * reach elseif approach.du == 1 then iu = approach.iu - (reach - 1) else iu = approach.iu + (reach - 1) end
    local pickup_dir
    do
        local x = -approach.du * frame.u[1] - approach.dv * frame.v[1]
        local y = -approach.du * frame.u[2] - approach.dv * frame.v[2]
        pickup_dir = (x == 1 and "east") or (x == -1 and "west") or (y == 1 and "south") or "north"
    end
    run.chest = assert(surface.create_entity({name = "steel-chest", position = at(iu - approach.du * reach, iv - approach.dv * reach), force = "player"}))
    local inserter_params = {name = spec.inserter, position = at(iu, iv), force = "player", direction = DIRECTIONS[pickup_dir]}
    if spec.quality then inserter_params.quality = spec.quality end
    run.inserter = assert(surface.create_entity(inserter_params), "could not build the inserter of " .. spec.name)
    if spec.hand then run.inserter.inserter_stack_size_override = spec.hand end
    -- the pole stands beside the inserter, the power source three tiles beyond it
    local pole_u, pole_v
    if approach.du == 0 then pole_u, pole_v = iu + 1, iv else pole_u, pole_v = iu, iv + 1 end
    assert(surface.create_entity({name = "small-electric-pole", position = at(pole_u, pole_v), force = "player"}), "pole of " .. spec.name)
    local iface = assert(surface.create_entity({name = "electric-energy-interface", position = at(pole_u, pole_v + ((pole_v >= 0) and 3 or -3)), force = "player"}), "power of " .. spec.name)
    iface.electric_buffer_size = 1e10
    iface.power_production = 1e7
    iface.energy = 1e10
    run.last = run.pieces[#run.pieces]
    local queue_placed
    if spec.queue then
        queue_placed = {}
        for _, line_index in ipairs({1, 2}) do
            local line = run.last.entity.get_transport_line(line_index)
            -- positions are the distance to the end of the piece: the first stack stands at the end, the next a quarter tile before it;
            -- a short piece (an underground end) takes fewer, and the count placed is logged
            queue_placed[line_index] = 0
            for k = 0, spec.queue - 1 do
                if not line.insert_at(k * 0.25, {name = "copper-plate", count = force.belt_stack_size_bonus + 1}, force.belt_stack_size_bonus + 1) then break end
                queue_placed[line_index] = k + 1
            end
        end
    end
    info.scenarios[index] = {name = spec.name, approach = spec.approach, direction = spec.direction, inserter = spec.inserter,
        quality = spec.quality or "normal", traffic = spec.traffic, queue = spec.queue, queue_placed = queue_placed, flows = approach.flows,
        pieces = (function() local l = {} for _, p in ipairs(run.pieces) do l[#l + 1] = {u = p.u, kind = p.kind, io = p.io, lines = p.lines, length = p.entity.get_transport_line(1).line_length} end return l end)()}
    run.origin = {x = ox, y = oy}
    runs[index] = run
end

-- Each stack is four whole numbers: piece * 8 + line, a number for its unique id (in order of first sight), its position along
-- the line in 1/256 tile, and count * 2 plus 0 for iron, 1 for copper.
local function stacks_of(run)
    local rows = {}
    for piece_index, piece in ipairs(run.pieces) do
        if piece.u >= run.approach.drop_slot - 1 and piece.u <= run.approach.drop_slot + 3 then
        for line_index = 1, piece.lines do
            for _, detailed in pairs(piece.entity.get_transport_line(line_index).get_detailed_contents()) do
                local seq = run.seen[detailed.unique_id]
                if not seq then run.next_seq = run.next_seq + 1; seq = run.next_seq; run.seen[detailed.unique_id] = seq end
                rows[#rows + 1] = {piece_index * 8 + line_index, seq, math.floor(detailed.position * 256 + 0.5),
                    detailed.stack.count * 2 + (detailed.stack.name == "iron-plate" and 0 or 1)}
            end
        end
        end
    end
    return rows
end

local started = game.tick
script.on_nth_tick(1, function()
    local t = game.tick - started
    for index, run in ipairs(runs) do
        local spec, inserter = run.spec, run.inserter
        if t == GO + 1 then
            local entry, frame = info.scenarios[index], FRAMES[spec.direction]
            entry.allow_custom_vectors = prototypes.entity[inserter.name].allow_custom_vectors
            entry.pickup = inserter.pickup_target and inserter.pickup_target.name or "none"
            entry.drop_target = inserter.drop_target and inserter.drop_target.name or "none"
            local rx, ry = inserter.drop_position.x - run.origin.x, inserter.drop_position.y - run.origin.y
            entry.drop = {u = rx * frame.u[1] + ry * frame.u[2], v = rx * frame.v[1] + ry * frame.v[2]}
            entry.hand_capacity = inserter.inserter_stack_size_override or -1
        end
        -- scripted traffic and the chest are set before the sample of the tick
        local traffic = spec.traffic
        if traffic and t >= 1 and t <= traffic.stop then
            local phase = (t - traffic.phase) % traffic.period
            for _, tick_in_period in ipairs(traffic.ticks) do
                if phase == tick_in_period then
                    local stack = force.belt_stack_size_bonus + 1
                    -- a position is the distance to the end of the piece: the start of its first piece is its line length
                    for line_index = 1, 2 do
                        local line = run.pieces[1].entity.get_transport_line(line_index)
                        line.insert_at(line.line_length - 1 / 256, {name = "copper-plate", count = stack}, stack)
                    end
                end
            end
        end
        if t == GO then
            assert(run.chest.insert({name = spec.item or "iron-plate", count = 64}) == 64, "chest of " .. spec.name)
        end
    end
    if t >= GO - 2 then
        for _, run in ipairs(runs) do
            local held = run.inserter.held_stack
            table.insert(run.log, {t, held.valid_for_read and held.count or 0, run.inserter.status or -1, stacks_of(run)})
        end
    end
    for _, run in ipairs(runs) do
        if run.approach.flows then
            for line_index = 1, run.last.lines do run.last.entity.get_transport_line(line_index).clear() end
        end
    end
    if t >= GO + options.ticks then
        script.on_nth_tick(1, nil)
        local out = {info = info, columns = {"t", "held", "status", "stacks"},
            stack_columns = {"piece*8+line", "id", "position in 1/256 tile along the line", "count*2+item (0 iron, 1 copper)"}, runs = {}}
        for _, run in ipairs(runs) do out.runs[run.spec.name] = run.log end
        helpers.write_file("belt-drop-timing.json", helpers.table_to_json(out), false)
    end
end)
