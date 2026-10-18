-- Local supply entry for a straight pickup tile. Occupied streams describe a saturated-input
-- assumption, not a measured rate. Empty connected inputs are excluded only when their upstream
-- straight path has no item source; a temporarily empty feeder remains ambiguous.
local helpers = require("__clock-generator-sidecar__.scripts.helpers")
local supply = {}
local runs = {[0] = {0, -1}, [4] = {1, 0}, [8] = {0, 1}, [12] = {-1, 0}}

local function droppers(belt, lane)
    local run = runs[belt.direction]
    if not run then return true end
    -- Vanilla inserters can drop at most two tiles away; include their entity width too.
    for _, inserter in pairs(belt.surface.find_entities_filtered{type = "inserter", area = {
        {belt.position.x - 3, belt.position.y - 3}, {belt.position.x + 3, belt.position.y + 3}
    }}) do
        -- Drop targets may not be resolved yet for a newly built/unpowered inserter.
        local spot = inserter.drop_position
        if math.abs(spot.x - belt.position.x) < 0.5 and math.abs(spot.y - belt.position.y) < 0.5 then
            local left = (spot.x - belt.position.x) * run[2] - (spot.y - belt.position.y) * run[1]
            if math.abs(left) < 0.01 or (left > 0 and lane == 1) or (left < 0 and lane == 2) then return true end
        end
    end
    return false
end

-- true = observed supply, false = empty path with no source, nil = could supply later.
local function incoming_state(piece, lane)
    local seen = {}
    for _ = 1, 128 do
        if seen[piece.unit_number] then return nil end
        seen[piece.unit_number] = true
        local line = piece.get_transport_line(lane)
        if line.get_item_count() > 0 then return true, line end
        if piece.type ~= "transport-belt" or piece.belt_shape ~= "straight" or droppers(piece, lane) then return nil end
        local inputs = piece.belt_neighbours.inputs
        if #inputs == 0 then return false end
        if #inputs ~= 1 or inputs[1].direction ~= piece.direction then return nil end
        piece = inputs[1]
    end
    return nil
end

---Return a local physical lane view, profiles, and a diagnostic, only when a pickup has side inputs.
---Ordinary through/underground pickups retain their existing network capture.
function supply.capture(belt)
    if belt.type ~= "transport-belt" or belt.belt_shape ~= "straight" then return nil end
    local run = runs[belt.direction]
    if not run then return nil end
    local inputs = belt.belt_neighbours.inputs
    local side = false
    for _, input in pairs(inputs) do
        if input.direction ~= belt.direction then side = true end
    end
    if not side then return nil end
    local streams = {{}, {}}
    local unknown, unsupported = false, false
    local default = helpers.get_default_belt_stack_size(belt.force)
    local lanes = {}
    for lane = 1, 2 do
        local ingredient, stack_size = helpers.get_lane_info(belt.get_transport_line(lane), default)
        lanes[lane] = {ingredient = ingredient, stack_size = stack_size}
        if droppers(belt, lane) then unknown = true end
    end
    for _, input in pairs(inputs) do
        local dx, dy = input.position.x - belt.position.x, input.position.y - belt.position.y
        local left = dx * run[2] - dy * run[1]
        local is_side = math.abs(left) > 0.25
        local receiving = left > 0 and 1 or 2
        if input.type ~= "transport-belt" or input.belt_shape ~= "straight"
            or input.prototype.belt_speed ~= belt.prototype.belt_speed
            or (not is_side and input.direction ~= belt.direction) then unsupported = true end
        for lane = 1, 2 do
            local state, observed_line = incoming_state(input, lane)
            if state == nil then unknown = true end
            if state then
                local target = is_side and receiving or lane
                local profile = is_side and (lane == receiving and "side-inner" or "side-outer") or "through"
                table.insert(streams[target], profile)
                local ingredient, stack_size = helpers.get_lane_info(observed_line, default)
                for _, item in pairs(observed_line.get_contents()) do
                    if item.name ~= ingredient then unsupported = true end
                end
                if lanes[target].ingredient and ingredient and lanes[target].ingredient ~= ingredient then unsupported = true end
                lanes[target].ingredient = lanes[target].ingredient or ingredient
                lanes[target].stack_size = math.max(lanes[target].stack_size, stack_size)
            end
        end
    end
    local profiles = {"through", "through"}
    local merge = false
    for lane = 1, 2 do
        if #streams[lane] > 1 then merge = true end
        if #streams[lane] == 1 then profiles[lane] = streams[lane][1] end
    end
    local problem = merge and "merge" or (unsupported or unknown) and "supply-unknown" or nil
    return {lanes = lanes, profiles = not problem and profiles or nil, problem = problem}
end

return supply
