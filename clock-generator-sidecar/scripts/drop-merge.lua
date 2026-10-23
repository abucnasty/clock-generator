-- A drop onto a belt that side-loads onto another belt downstream.
-- The Clock Generator describes the belts of a build as one belt, so an inserter that drops on a belt gets that belt's
-- room. Where its stream side-loads onto a belt that is fed from behind, the game makes the side-loading stream wait for
-- gaps, and the room is less. The export marks such a drop with the number of tiles to the merge.
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

return merge
