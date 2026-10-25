-- Side-loading at a belt pickup tile.
-- Picking up from a belt tile that another belt side-loads onto, as one stream or two merging, is out of scope for the
-- Clock Generator, as splitters are. The export marks such a pickup unsupported and gives a warning for it.
local supply = {}

---Why the supply of a pickup tile is out of scope: "side-loaded" when another belt side-loads onto it, else nil.
---Extraction calls it only for a classified pickup. The calibrated right bend takes its ordinary input from
---the incoming direction of its turn; an additional input is still side-loading. Splitters remain refused earlier.
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
    -- A bend's normal input turns into its outgoing direction. Comparing only to its outgoing direction would
    -- incorrectly mark that ordinary input as side-loading as soon as bend pickup geometry becomes supported.
    local incoming_direction = belt.direction
    if belt.type == "transport-belt" and belt.belt_shape == "right" then
        incoming_direction = (belt.direction + 12) % 16
    end
    for _, input in pairs(neighbours.inputs or {}) do
        if input.valid and input.direction ~= incoming_direction then
            return "side-loaded"
        end
    end
    return nil
end

return supply
