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

return M
