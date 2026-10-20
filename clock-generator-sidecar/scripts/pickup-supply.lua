-- Side-loading at a belt pickup tile.
-- Picking up from a belt tile that another belt side-loads onto, as one stream or two merging, is out of scope for the
-- Clock Generator, as splitters are. The export marks such a pickup unsupported and gives a warning for it.
local supply = {}

---Why the supply of a pickup tile is out of scope: "side-loaded" when another belt side-loads onto it, else nil.
---Extraction calls it only for a pickup without a pickup_problem, so the tile is a straight belt or an underground
---endpoint: bends and splitters are refused before it by helpers.get_pickup_problem.
---@param belt LuaEntity The belt piece an inserter picks up from
---@return "side-loaded"|nil
function supply.problem(belt)
    if not belt or not belt.valid or (belt.type ~= "transport-belt" and belt.type ~= "underground-belt") then
        return nil
    end
    local ok, neighbours = pcall(function() return belt.belt_neighbours end)
    if not ok or type(neighbours) ~= "table" then
        return nil
    end
    -- A belt that runs straight onto the tile faces the way the tile does. One that side-loads onto it does not.
    for _, input in pairs(neighbours.inputs or {}) do
        if input.valid and input.direction ~= belt.direction then
            return "side-loaded"
        end
    end
    return nil
end

return supply
