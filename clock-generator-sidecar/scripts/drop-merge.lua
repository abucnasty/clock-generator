-- Walks down a belt line from a piece an inserter uses.
-- A drop onto a belt that side-loads onto another belt downstream: the Clock Generator describes the belts of a build as
-- one belt, so an inserter that drops on a belt gets that belt's room. Where its stream side-loads onto a belt that is fed
-- from behind, the game makes the side-loading stream wait for gaps, and the room is less. The export marks such a drop
-- with the number of tiles to the merge.
-- The end of each lane of the line a pickup takes from (merge.lane_ends): what happens to an item that no hand takes.
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
local OUTLET = { kind = "outlet" }
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
--- - the line ends in a loader that takes everything (loader_voids): both lanes an outlet, at no stated rate;
--- - the line side-loads into an underground piece of another belt: the lane the hood blocks is dead_end; the lane that
---   goes on is unknown. Where the other belt carries items from upstream, they take its room; where it does not, the
---   lane runs at what the hands past the side-load take, which depends on the machines they feed and not on anything
---   the export reads (a machine's full speed would be a guess);
--- - anything else the walk cannot follow (a merge onto the line, a side-load onto a belt, a splitter, a linked belt, a
---   loop, a piece that is not selected): both lanes unknown.
---@param pickup LuaEntity The belt piece an inserter picks up from
---@param selected table<number, LuaEntity> The belt pieces of the export by unit number
---@param selected_units table<number, true> The unit numbers of every selected entity
---@return {kind: "dead_end"|"outlet"|"unknown"}[] ends Lane 1 (left) and lane 2 (right), as the transport lines number them
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
                    return { OUTLET, OUTLET }
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

return merge
