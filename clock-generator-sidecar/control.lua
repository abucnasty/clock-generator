-- Clock Generator Sidecar - Main Control Script
-- Entry point for the mod. Handles player storage, event handlers, and
-- event registration. All heavy lifting is delegated to modules in scripts/.

require("__clock-generator-sidecar__.scripts.types")
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")
local gui = require("__clock-generator-sidecar__.scripts.gui")

-- Player Storage

---@type table<uint, PlayerData>
storage = storage or {}

---Initialize player data in storage
---@param player_index uint
local function init_player_data(player_index)
    storage[player_index] = storage[player_index] or {
        machines = {},
        gui = nil
    }
end

-- Event Handlers

---Handle selection tool area selection
---@param event EventData.on_player_selected_area
local function on_player_selected_area(event)
    if event.item ~= "clock-generator-sidecar" then
        return
    end

    local player = game.get_player(event.player_index)
    if not player then
        return
    end

    init_player_data(event.player_index)
    local player_data = storage[event.player_index]

    -- Extract entity data (machines, drills, inserters, belts, and chests)
    local result = extraction.extract_all_entities(event.entities, player.force)
    player_data.extraction_result = result

    -- Show GUI
    gui.create(player, player_data, result)

    local total = #result.machines + #result.drills + #result.inserters + #result.belts + #result.chests
    if total == 0 then
        player.print({ "clock-generator-sidecar.no-machines-selected" })
    else
        player.print({ "clock-generator-sidecar.machines-found", total })
    end
end

---Handle GUI button clicks
---@param event EventData.on_gui_click
local function on_gui_click(event)
    local element = event.element
    if not element or not element.valid then
        return
    end

    local player = game.get_player(event.player_index)
    if not player then
        return
    end

    local player_data = storage[event.player_index]

    if element.name == "clock_generator_sidecar_copy" then
        -- Show copy popup with JSON text
        if player_data and player_data.extraction_result then
            local result = player_data.extraction_result
            if #result.machines > 0 or #result.drills > 0 or #result.inserters > 0 or #result.belts > 0 or #result.chests > 0 then
                local json = export.to_json(result)
                gui.create_copy_popup(player, json, export.left_out_inserters(result))
            else
                player.print("[Clock Generator Sidecar] No data found. Please select entities first.")
            end
        else
            player.print("[Clock Generator Sidecar] No data found. Please select entities first.")
        end
    elseif element.name == "clock_generator_sidecar_close" then
        gui.destroy_all(player, player_data)
    elseif element.name == "clock_generator_sidecar_select_all" then
        -- Select the JSON again, in case the player clicked away from it
        gui.select_json(player)
    elseif element.name == "clock_generator_sidecar_copy_close" then
        -- Close just the copy popup
        local copy_frame = player.gui.screen[gui.COPY_GUI_NAME]
        if copy_frame and copy_frame.valid then
            copy_frame.destroy()
        end
    end
end

---Handle GUI close
---@param event EventData.on_gui_closed
local function on_gui_closed(event)
    if event.element and event.element.valid and event.element.name == gui.GUI_NAME then
        local player = game.get_player(event.player_index)
        if player then
            local player_data = storage[event.player_index]
            gui.destroy(player, player_data, true)  -- Clear data when user closes the window
        end
    end
end

-- Event Registration

script.on_event(defines.events.on_player_selected_area, on_player_selected_area)
script.on_event(defines.events.on_player_alt_selected_area, on_player_selected_area)
script.on_event(defines.events.on_gui_click, on_gui_click)
script.on_event(defines.events.on_gui_closed, on_gui_closed)

-- Initialize storage for new players
script.on_event(defines.events.on_player_created, function(event)
    init_player_data(event.player_index)
end)

-- Initialize storage on load
script.on_init(function()
    for _, player in pairs(game.players) do
        init_player_data(player.index)
    end
end)
