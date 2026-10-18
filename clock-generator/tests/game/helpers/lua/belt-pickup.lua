-- Observation only: no filtering, inventory clearing, control changes, or blueprint edits.
local M = {}

-- Reuse the same observation schema for incoming and downstream pieces.
-- Ordinary pickups expose two lanes; probes of larger pieces supply their actual transport-line count.
function M.lanes(belt, line_count)
    local lanes = {}
    for index = 1, line_count or 2 do
        local line = belt.get_transport_line(index)
        local lane = {length = line.line_length, stacks = {}}
        for _, detailed in pairs(line.get_detailed_contents()) do
            table.insert(lane.stacks, {
                at = detailed.position, count = detailed.stack.count,
                item = detailed.stack.name, id = detailed.unique_id
            })
        end
        lanes[index] = lane
    end
    return lanes
end

function M.snapshot(input, tick, line_count)
    local held, belt = input.held_stack, input.pickup_target
    local sample = {
        tick = tick,
        held = held.valid_for_read and held.count or 0,
        held_item = held.valid_for_read and held.name or nil,
        hand = input.held_stack_position,
        lanes = M.lanes(belt, line_count)
    }
    return sample
end

-- Internal line links are observations, not an inferred routing decision.
function M.connections(belt, line_count)
    local result = {}
    local function describe(lines)
        local descriptions = {}
        for _, line in pairs(lines) do
            local local_indices = {}
            for index = 1, line_count do
                if line.line_equals(belt.get_transport_line(index)) then table.insert(local_indices, index) end
            end
            table.insert(descriptions, {owner = line.owner.unit_number, local_indices = local_indices})
        end
        return descriptions
    end
    for index = 1, line_count do
        local line = belt.get_transport_line(index)
        result[index] = {inputs = describe(line.input_lines), outputs = describe(line.output_lines)}
    end
    return result
end

return M
