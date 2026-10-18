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

local function simple_upstream(piece)
    local seen = {}
    for _ = 1, 128 do
        if seen[piece.unit_number] or piece.type ~= "transport-belt" or piece.belt_shape ~= "straight"
            or piece.prototype.belt_speed ~= 0.125 then return false end
        seen[piece.unit_number] = true
        local inputs = piece.belt_neighbours.inputs
        if #inputs == 0 then return true end
        if #inputs ~= 1 or inputs[1].direction ~= piece.direction then return false end
        piece = inputs[1]
    end
    return false
end

-- A finite straight output, ending either in a closed belt end or a turbo loader into a disposal chest.
-- A finite chest, downstream pickup/dropper, junction or cycle cannot establish an always-open outlet.
local function output_path(belt)
    local seen, count, piece = {}, 0, belt
    for _ = 1, 129 do
        if seen[piece.unit_number] then return nil end
        seen[piece.unit_number] = true
        local outputs = piece.belt_neighbours.outputs
        if #outputs == 0 then return count, "closed" end
        if #outputs ~= 1 then return nil end
        local next_piece = outputs[1]
        if next_piece.type == "loader" then
            local chest = next_piece.loader_container
            if next_piece.name == "turbo-loader" and next_piece.direction == belt.direction
                and next_piece.loader_type == "input" and chest and chest.type == "infinity-container"
                and chest.remove_unfiltered_items and #(chest.infinity_container_filters or {}) == 0 then return count, "open" end
            return nil
        end
        if next_piece.type ~= "transport-belt" or next_piece.direction ~= belt.direction
            or next_piece.belt_shape ~= "straight" or next_piece.prototype.belt_speed ~= 0.125
            or #next_piece.belt_neighbours.inputs ~= 1 then return nil end
        for lane = 1, 2 do if droppers(next_piece, lane) then return nil end end
        for _, inserter in pairs(next_piece.surface.find_entities_filtered{type = "inserter", area = {
            {next_piece.position.x - 3, next_piece.position.y - 3}, {next_piece.position.x + 3, next_piece.position.y + 3}
        }}) do if inserter.pickup_target == next_piece then return nil end end
        count, piece = count + 1, next_piece
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
                local ingredient, stack_size = helpers.get_lane_info(observed_line, default)
                local full_stacks = true
                for _, detailed in pairs(observed_line.get_detailed_contents()) do
                    if detailed.stack.count ~= 4 then full_stacks = false end
                end
                table.insert(streams[target], {profile = profile, ingredient = ingredient, stack_size = stack_size, input = input, full_stacks = full_stacks})
                for _, item in pairs(observed_line.get_contents()) do
                    if item.name ~= ingredient then unsupported = true end
                end
                lanes[target].ingredient = lanes[target].ingredient or ingredient
                lanes[target].stack_size = math.max(lanes[target].stack_size, stack_size)
            end
        end
    end
    local profiles = {"through", "through"}
    local merge = false
    for lane = 1, 2 do
        if #streams[lane] > 1 then merge = true end
        if #streams[lane] == 1 then
            local stream = streams[lane][1]
            profiles[lane] = stream.profile
            if lanes[lane].ingredient and lanes[lane].ingredient ~= stream.ingredient then unsupported = true end
            for _, item in pairs(belt.get_transport_line(lane).get_contents()) do
                if item.name ~= stream.ingredient then unsupported = true end
            end
        end
    end
    if merge and not unsupported and not unknown and belt.name == "turbo-transport-belt" then
        for lane = 1, 2 do
            if #streams[lane] == 2 and #streams[3 - lane] == 0 and not lanes[3 - lane].ingredient then
                local pair = {}
                for _, stream in ipairs(streams[lane]) do pair[stream.profile] = stream end
                local outer, inner = pair["side-outer"], pair["side-inner"]
                local tiles, outlet = output_path(belt)
                local pickups = 0
                for _, inserter in pairs(belt.surface.find_entities_filtered{type = "inserter", area = {
                    {belt.position.x - 3, belt.position.y - 3}, {belt.position.x + 3, belt.position.y + 3}
                }}) do if inserter.pickup_target == belt then pickups = pickups + 1 end end
                if outer and inner and outer.input == inner.input and outer.stack_size == 4 and inner.stack_size == 4
                    and outer.full_stacks and inner.full_stacks
                    and simple_upstream(outer.input) and tiles and pickups <= 1 then
                    local valid = true
                    for _, item in pairs(belt.get_transport_line(lane).get_contents()) do
                        if item.name ~= outer.ingredient and item.name ~= inner.ingredient then valid = false end
                    end
                    if valid then
                        lanes[lane] = {ingredient = outer.ingredient, stack_size = 4}
                        return {lanes = lanes, merge = {lane = lane,
                            outer = {ingredient = outer.ingredient, stack_size = 4},
                            inner = {ingredient = inner.ingredient, stack_size = 4}, downstream_tiles = tiles, outlet = outlet}}
                    end
                end
            end
        end
    end
    local problem = merge and "merge" or (unsupported or unknown) and "supply-unknown" or nil
    return {lanes = lanes, profiles = not problem and profiles or nil, problem = problem}
end

return supply
