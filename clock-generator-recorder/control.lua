-- Clock Generator Recorder - Main Control Script

local recorder = require("scripts.recorder")

local function on_tick_while_recording()
    recorder.on_tick()
    if not recorder.is_active() then
        script.on_event(defines.events.on_tick, nil)
    end
end

---@param event EventData.on_player_selected_area
local function on_player_selected_area(event)
    if event.item ~= "clock-generator-recorder" then
        return
    end
    local player = game.get_player(event.player_index)
    if player and recorder.start(player.force, event.entities, player.index) then
        script.on_event(defines.events.on_tick, on_tick_while_recording)
    end
end

---@param event EventData.on_player_alt_selected_area
local function on_player_alt_selected_area(event)
    if event.item ~= "clock-generator-recorder" then
        return
    end
    recorder.finish("stopped by player")
    script.on_event(defines.events.on_tick, nil)
end

script.on_event(defines.events.on_player_selected_area, on_player_selected_area)
script.on_event(defines.events.on_player_alt_selected_area, on_player_alt_selected_area)

-- on_tick is only registered while recording; restore it after a save/load mid-recording
script.on_load(function()
    if storage.recording then
        script.on_event(defines.events.on_tick, on_tick_while_recording)
    end
end)

-- Lets scripts and automated tests record without a player selection
remote.add_interface("clock-generator-recorder", {
    ---@param surface_index uint
    ---@param area BoundingBox
    ---@param force_name string
    start_recording = function(surface_index, area, force_name)
        local entities = game.surfaces[surface_index].find_entities_filtered({ area = area, force = force_name })
        if recorder.start(game.forces[force_name], entities, nil) then
            script.on_event(defines.events.on_tick, on_tick_while_recording)
            return true
        end
        return false
    end,
    stop_recording = function()
        recorder.finish("stopped by remote call")
        script.on_event(defines.events.on_tick, nil)
    end,
})
