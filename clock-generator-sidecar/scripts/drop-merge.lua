-- Walks down a belt line from a piece an inserter uses.
-- A drop onto a belt that side-loads onto another belt downstream: the Clock Generator describes the belts of a build as
-- one belt, so an inserter that drops on a belt gets that belt's room. Where its stream side-loads onto a belt that is fed
-- from behind, the game makes the side-loading stream wait for gaps, and the room is less. The export marks such a drop
-- with the number of tiles to the merge.
-- The end of each lane of the line a pickup takes from (merge.lane_ends): what happens to an item that no hand takes.
-- Where the next copy stands from a copy (merge.copy_offset), from the inserters along the lines they take from.
local merge = {}

-- Never reached on a real build: a bound on the steps of a walk, so that a walk cannot run on.
merge.MAX_STEPS = 10000

local function belt_piece(entity)
    return entity.type == "transport-belt" or entity.type == "underground-belt"
end

---Whether a stream of the belt piece `piece` has another stream from behind: an input that faces the way the piece does,
---or, for an underground exit, the tunnel.
---@param piece LuaEntity A transport belt or an underground belt
---@return boolean
local function has_through_stream(piece)
    if piece.type == "underground-belt" and piece.belt_to_ground_type == "output" then
        local ok, entrance = pcall(function() return piece.underground_belt_neighbour end)
        return ok and entrance ~= nil and entrance.valid
    end
    local ok, neighbours = pcall(function() return piece.belt_neighbours end)
    if not ok or type(neighbours) ~= "table" then
        return false
    end
    for _, input in pairs(neighbours.inputs or {}) do
        if input.valid and input.direction == piece.direction then
            return true
        end
    end
    return false
end

---The tiles from a drop tile to the tile its stream side-loads onto, when that belt is fed from behind: nil when the
---stream does not. The walk follows the belt downstream, through undergrounds, over the pieces in `selected` only; it
---stops with nil at a piece that is not selected, a belt end, a splitter, a loader, a linked belt or a piece seen before.
---@param drop_target LuaEntity The belt piece the inserter drops onto
---@param selected table<number, LuaEntity> The belt pieces of the export by unit number
---@return number|nil tiles From the drop tile (0), an underground pair counting the tiles between its ends
function merge.tiles(drop_target, selected)
    local piece = drop_target
    local tiles = 0
    local seen = {}
    for _ = 1, merge.MAX_STEPS do
        if not piece or not piece.valid or not piece.unit_number or not selected[piece.unit_number]
            or not belt_piece(piece) or seen[piece.unit_number] then
            return nil
        end
        seen[piece.unit_number] = true
        local next_piece, step
        if piece.type == "underground-belt" and piece.belt_to_ground_type == "input" then
            local ok, exit = pcall(function() return piece.underground_belt_neighbour end)
            if not ok or not exit or not exit.valid then
                return nil
            end
            next_piece = exit
            step = math.floor(math.abs(exit.position.x - piece.position.x) + math.abs(exit.position.y - piece.position.y) + 0.5)
        else
            local ok, neighbours = pcall(function() return piece.belt_neighbours end)
            local outputs = ok and type(neighbours) == "table" and neighbours.outputs or {}
            if #outputs ~= 1 then
                return nil
            end
            next_piece = outputs[1]
            step = 1
        end
        if not next_piece.valid or not next_piece.unit_number or not selected[next_piece.unit_number]
            or not belt_piece(next_piece) then
            return nil
        end
        tiles = tiles + step
        -- a stream that does not face the way the next piece does side-loads onto it, and waits if that has a stream
        -- from behind
        if next_piece.direction ~= piece.direction and has_through_stream(next_piece) then
            return tiles
        end
        piece = next_piece
    end
    return nil
end

local DEAD_END = { kind = "dead_end" }
local INFINITE = { kind = "infinite" }
local UNKNOWN = { kind = "unknown" }

---The direction a transport belt takes its items in from: a curve turns them, a straight piece does not
---@param belt LuaEntity A transport belt
---@return defines.direction
local function incoming_direction(belt)
    if belt.belt_shape == "right" then
        return (belt.direction + 12) % 16
    elseif belt.belt_shape == "left" then
        return (belt.direction + 4) % 16
    end
    return belt.direction
end

---Whether a belt piece has an input other than `from` (and, for an underground exit, other than its tunnel)
---@param piece LuaEntity
---@param from LuaEntity|nil
---@return boolean|nil nil when the game does not tell
local function has_other_input(piece, from)
    local ok, neighbours = pcall(function() return piece.belt_neighbours end)
    if not ok or type(neighbours) ~= "table" then
        return nil
    end
    local tunnel = nil
    if piece.type == "underground-belt" then
        local ok_tunnel, partner = pcall(function() return piece.underground_belt_neighbour end)
        tunnel = ok_tunnel and partner or nil
    end
    for _, input in pairs(neighbours.inputs or {}) do
        if input.valid and input ~= from and input ~= tunnel then
            return true
        end
    end
    return false
end

---Whether a loader at the end of a line takes every item that reaches it, at least as fast as the line brings them: a
---loader that loads into a selected infinity chest that removes every item, with no filter on either, and that runs at
---least as fast as the belt piece before it
---@param loader LuaEntity
---@param before LuaEntity The last belt piece of the line
---@param selected_units table<number, true> The unit numbers of every selected entity
---@return boolean
local function loader_voids(loader, before, selected_units)
    local ok, voids = pcall(function()
        if loader.loader_type ~= "input" then return false end
        local container = loader.loader_container
        if not (container and container.valid and container.unit_number and selected_units[container.unit_number]) then
            return false
        end
        if container.type ~= "infinity-container" or not container.remove_unfiltered_items
            or #(container.infinity_container_filters or {}) > 0 then
            return false
        end
        for index = 1, loader.filter_slot_count or 0 do
            if loader.get_filter(index) then return false end
        end
        return loader.prototype.belt_speed >= before.prototype.belt_speed
    end)
    return ok and voids == true
end

---The end of each lane of the belt line that `pickup` belongs to, followed downstream from `pickup` over the selected
---pieces only, never upstream:
--- - the line ends (its last piece has nothing after it, or an underground entrance has no exit): both lanes dead_end;
--- - the line ends in a loader that takes everything (loader_voids): both lanes an infinite end;
--- - the line side-loads into an underground piece of another belt: the lane the hood blocks is dead_end; the lane that
---   goes on is unknown. Where the other belt carries items from upstream, they take its room; where it does not, the
---   lane runs at what the hands past the side-load take, which depends on the machines they feed and not on anything
---   the export reads (a machine's full speed would be a guess);
--- - anything else the walk cannot follow (a merge onto the line, a side-load onto a belt, a splitter, a linked belt, a
---   loop, a piece that is not selected): both lanes unknown.
---@param pickup LuaEntity The belt piece an inserter picks up from
---@param selected table<number, LuaEntity> The belt pieces of the export by unit number
---@param selected_units table<number, true> The unit numbers of every selected entity
---@return {kind: "dead_end"|"infinite"|"unknown"}[] ends Lane 1 (left) and lane 2 (right), as the transport lines number them
function merge.lane_ends(pickup, selected, selected_units)
    local piece = pickup
    local seen = {}
    for _ = 1, merge.MAX_STEPS do
        if not piece or not piece.valid or not piece.unit_number or not selected[piece.unit_number]
            or not belt_piece(piece) or seen[piece.unit_number] then
            return { UNKNOWN, UNKNOWN }
        end
        seen[piece.unit_number] = true
        if piece.type == "underground-belt" and piece.belt_to_ground_type == "input" then
            local ok, exit = pcall(function() return piece.underground_belt_neighbour end)
            if not ok then
                return { UNKNOWN, UNKNOWN }
            end
            if not exit or not exit.valid then
                -- items run under the hood and stop there
                return { DEAD_END, DEAD_END }
            end
            if not exit.unit_number or not selected[exit.unit_number] or has_other_input(exit, nil) ~= false then
                return { UNKNOWN, UNKNOWN }
            end
            piece = exit
        else
            local ok, neighbours = pcall(function() return piece.belt_neighbours end)
            if not ok or type(neighbours) ~= "table" then
                return { UNKNOWN, UNKNOWN }
            end
            local outputs = neighbours.outputs or {}
            if #outputs == 0 then
                return { DEAD_END, DEAD_END }
            end
            local next_piece = outputs[1]
            if #outputs > 1 or not next_piece.valid or not next_piece.unit_number or not selected[next_piece.unit_number] then
                return { UNKNOWN, UNKNOWN }
            end
            if next_piece.type == "loader" or next_piece.type == "loader-1x1" then
                if loader_voids(next_piece, piece, selected_units) then
                    return { INFINITE, INFINITE }
                end
                return { UNKNOWN, UNKNOWN }
            end
            if next_piece.type == "transport-belt" then
                -- a stream that does not come in the way the piece takes its items in side-loads onto it: a merge
                if piece.direction ~= incoming_direction(next_piece) or has_other_input(next_piece, piece) ~= false then
                    return { UNKNOWN, UNKNOWN }
                end
            elseif next_piece.type == "underground-belt" then
                if next_piece.direction == piece.direction then
                    -- only an entrance takes items in from behind
                    if next_piece.belt_to_ground_type ~= "input" or has_other_input(next_piece, piece) ~= false then
                        return { UNKNOWN, UNKNOWN }
                    end
                elseif (next_piece.direction - piece.direction) % 8 == 4 then
                    -- A side-load into an underground piece: the lane that reaches the tile's open half goes on, the
                    -- lane that reaches the hood stops. An entrance's hood is its downstream half, an exit's its
                    -- upstream half. Of the side-loading line, the lane on the downstream side is its right lane where
                    -- the other belt runs to its right, else its left lane.
                    local downstream_lane = next_piece.direction == (piece.direction + 4) % 16 and 2 or 1
                    local blocked = next_piece.belt_to_ground_type == "input" and downstream_lane or 3 - downstream_lane
                    local ends = { UNKNOWN, UNKNOWN }
                    ends[blocked] = DEAD_END
                    return ends
                else
                    return { UNKNOWN, UNKNOWN }
                end
            else
                -- a splitter, a linked belt
                return { UNKNOWN, UNKNOWN }
            end
            piece = next_piece
        end
    end
    return { UNKNOWN, UNKNOWN }
end

---The pieces of the belt line that `pickup` belongs to, from `pickup` downstream, each with the tiles to it from
---`pickup`, over the selected pieces only, never upstream. The line stops where it ends, at an entrance without an exit,
---where it side-loads onto another belt, at a piece that is not a transport belt or an underground (a splitter, a
---loader, a linked belt), at a piece that is not selected, or at a piece seen before.
---@param pickup LuaEntity The belt piece an inserter picks up from
---@param selected table<number, LuaEntity> The belt pieces of the export by unit number
---@return table<number, number> along The tiles from `pickup` to each piece of the line, by unit number
---@return LuaEntity[] pieces The pieces of the line in order, `pickup` first
function merge.line_after(pickup, selected)
    local along, order = {}, {}
    local piece, tiles = pickup, 0
    for _ = 1, merge.MAX_STEPS do
        along[piece.unit_number] = tiles
        table.insert(order, piece)
        local next_piece, step
        if piece.type == "underground-belt" and piece.belt_to_ground_type == "input" then
            local ok, exit = pcall(function() return piece.underground_belt_neighbour end)
            if not ok or not exit or not exit.valid then return along, order end
            next_piece = exit
            step = math.floor(math.abs(exit.position.x - piece.position.x) + math.abs(exit.position.y - piece.position.y) + 0.5)
        else
            local ok, neighbours = pcall(function() return piece.belt_neighbours end)
            local outputs = ok and type(neighbours) == "table" and neighbours.outputs or {}
            if #outputs ~= 1 then return along, order end
            next_piece = outputs[1]
            step = 1
            -- a stream that does not come in the way the next piece takes its items in side-loads onto another belt
            if not next_piece.valid or (next_piece.type == "transport-belt" and incoming_direction(next_piece) ~= piece.direction)
                or (next_piece.type == "underground-belt" and next_piece.direction ~= piece.direction) then
                return along, order
            end
        end
        if not next_piece.valid or not next_piece.unit_number or not selected[next_piece.unit_number]
            or not belt_piece(next_piece) or along[next_piece.unit_number] then
            return along, order
        end
        tiles = tiles + step
        piece = next_piece
    end
    return along, order
end

---The way the items move at the piece `pickup` (defines.direction), where the line does not turn from it to its last
---selected piece (merge.line_after): every piece faces the way `pickup` does and none is a curve. False where it turns,
---or where `pickup` is a curve, a splitter, a loader or a linked belt.
---@param pickup LuaEntity The belt piece an inserter picks up from
---@param selected table<number, LuaEntity> The belt pieces of the export by unit number
---@return defines.direction|false
function merge.pickup_way(pickup, selected)
    local straight = function(piece)
        return piece.type == "underground-belt" or (piece.type == "transport-belt" and piece.belt_shape == "straight")
    end
    if not straight(pickup) then return false end
    local _, pieces = merge.line_after(pickup, selected)
    for _, piece in ipairs(pieces) do
        if piece.direction ~= pickup.direction or not straight(piece) then return false end
    end
    return pickup.direction
end

---What an inserter that takes from a belt is, apart from where it stands: its prototype and quality, the way it faces,
---and what it takes from and drops into, with where those stand from it. An inserter of the next copy is alike.
---@param inserter LuaEntity
---@return string
local function likeness(inserter)
    local function place(entity)
        if not (entity and entity.valid) then return "none" end
        local recipe = ""
        if entity.type == "assembling-machine" or entity.type == "furnace" then
            local ok, current = pcall(function() return entity.get_recipe() end)
            recipe = ok and current and current.name or ""
        end
        return string.format("%s/%s/%.4f/%.4f", entity.name, recipe,
            entity.position.x - inserter.position.x, entity.position.y - inserter.position.y)
    end
    return string.format("%s|%s|%d|%s|%s", inserter.name, inserter.quality and inserter.quality.name or "",
        inserter.direction, place(inserter.pickup_target), place(inserter.drop_target))
end

local function spot(x, y, like)
    return string.format("%.4f,%.4f,%s", x, y, like)
end

---Whether the takers split into runs B, B + step, ..., B + (n - 1) step of one length n of at least 2, each taker in
---one run and each run of alike takers
---@param takers {x: number, y: number, like: string}[]
---@param step {x: number, y: number}
---@return boolean
local function splits(takers, step)
    local at = {}
    for _, taker in ipairs(takers) do
        local key = spot(taker.x, taker.y, taker.like)
        if at[key] then return false end
        at[key] = true
    end
    local length, runs = nil, 0
    for _, taker in ipairs(takers) do
        if not at[spot(taker.x - step.x, taker.y - step.y, taker.like)] then
            local count = 0
            while at[spot(taker.x + count * step.x, taker.y + count * step.y, taker.like)] do count = count + 1 end
            if length == nil then
                length = count
            elseif length ~= count then
                return false
            end
            runs = runs + 1
        end
    end
    return length ~= nil and length >= 2 and runs * length == #takers
end

---Where the next copy stands from a copy, read from the inserters that take from the selected belts; nil where the
---selection does not show copies at one spacing.
---
---Each belt line is read from its first piece an inserter takes from, downstream (merge.line_after). On a line with two
---or more takers, a step is the distance from its first taker to a taker alike (`likeness`) further along it, where the
---line's takers split into runs of one length of two or more by that step: each copy's takers moved by the step are the
---next copy's. The copy spacing is the shortest step that every such line gives and by which every inserter that takes
---from a selected belt, on any line, splits as well. So none where the selection holds one copy, where the copies stand
---unevenly or mirrored, where a part copy has only some of a copy's takers, or where no line has two takers.
---Nothing along the lines tells two copies from one copy whose own takers stand alike at an even spacing.
---@param inserters LuaEntity[] The selected inserters
---@param selected table<number, LuaEntity> The belt pieces of the export by unit number
---@return {x: number, y: number}|nil
function merge.copy_offset(inserters, selected)
    local takers, starts = {}, {}
    for _, inserter in ipairs(inserters) do
        local piece = inserter.valid and inserter.pickup_target
        if piece and piece.valid and piece.unit_number and selected[piece.unit_number] then
            table.insert(takers, { x = inserter.position.x, y = inserter.position.y, like = likeness(inserter), piece = piece.unit_number })
            if belt_piece(piece) then starts[piece.unit_number] = piece end
        end
    end
    local lines = {}
    for unit, piece in pairs(starts) do lines[unit] = merge.line_after(piece, selected) end
    local common = nil -- the steps every line of two or more takers gives, by spot
    for unit, along in pairs(lines) do
        local first = true
        for other, other_along in pairs(lines) do
            if other ~= unit and other_along[unit] then first = false break end
        end
        if first then
            local on_line = {}
            for _, taker in ipairs(takers) do
                if along[taker.piece] then table.insert(on_line, taker) end
            end
            table.sort(on_line, function(a, b)
                if along[a.piece] ~= along[b.piece] then return along[a.piece] < along[b.piece] end
                if a.x ~= b.x then return a.x < b.x end
                return a.y < b.y
            end)
            if #on_line >= 2 then
                local steps = {}
                local head = on_line[1]
                for index = 2, #on_line do
                    local taker = on_line[index]
                    local step = { x = taker.x - head.x, y = taker.y - head.y }
                    if taker.like == head.like and splits(on_line, step) then steps[spot(step.x, step.y, "")] = step end
                end
                if common == nil then
                    common = steps
                else
                    for key in pairs(common) do
                        if not steps[key] then common[key] = nil end
                    end
                end
            end
        end
    end
    local best = nil
    for _, step in pairs(common or {}) do
        local size, best_size = math.abs(step.x) + math.abs(step.y), best and math.abs(best.x) + math.abs(best.y)
        if splits(takers, step) and (best == nil or size < best_size
            or (size == best_size and (step.x < best.x or (step.x == best.x and step.y < best.y)))) then
            best = step
        end
    end
    return best
end

return merge
