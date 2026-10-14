-- GUI Management for Clock Generator Sidecar
-- Handles creation and destruction of the extraction results GUI and copy popup.

require("__clock-generator-sidecar__.scripts.types")

local gui = {}

-- Constants

gui.GUI_NAME = "clock_generator_sidecar_frame"
gui.COPY_GUI_NAME = "clock_generator_sidecar_copy_frame"

-- Helper Functions

---Add a section with header and table to the scroll pane
---@param scroll LuaGuiElement The scroll pane to add to
---@param title string The section header title
---@param column_count number Number of columns in the table
---@param headers string[]|table[] Array of header labels (can be strings or locale tables)
---@param alignments table<number, string>? Optional column alignments (1-indexed)
---@return LuaGuiElement table The created table element
local function add_section_table(scroll, title, column_count, headers, alignments)
    local section_header = scroll.add({
        type = "label",
        caption = title,
        style = "heading_2_label"
    })
    section_header.style.bottom_margin = 4

    local tbl = scroll.add({
        type = "table",
        column_count = column_count,
        draw_horizontal_lines = true,
        draw_vertical_lines = false
    })
    tbl.style.horizontal_spacing = 16
    
    -- Apply alignments
    if alignments then
        for col, alignment in pairs(alignments) do
            tbl.style.column_alignments[col] = alignment
        end
    end

    -- Add header row
    for _, h in ipairs(headers) do
        tbl.add({
            type = "label",
            caption = h,
            style = "bold_label"
        })
    end

    return tbl
end

---Add a vertical spacer between sections
---@param scroll LuaGuiElement The scroll pane to add to
local function add_spacer(scroll)
    local spacer = scroll.add({ type = "flow" })
    spacer.style.height = 16
end

-- GUI Destruction

---Destroy the main results GUI for a player (not the copy popup)
---@param player LuaPlayer
---@param player_data PlayerData|nil The player's storage data
---@param clear_data boolean? Whether to also clear the extraction result data (default: false)
function gui.destroy(player, player_data, clear_data)
    local frame = player.gui.screen[gui.GUI_NAME]
    if frame and frame.valid then
        frame.destroy()
    end
    if player_data then
        player_data.gui = nil
        if clear_data then
            player_data.extraction_result = nil
        end
    end
end

---Destroy all GUIs for a player (including copy popup)
---@param player LuaPlayer
---@param player_data PlayerData|nil The player's storage data
---@param clear_data boolean? Whether to also clear the extraction result data (default: true)
function gui.destroy_all(player, player_data, clear_data)
    if clear_data == nil then
        clear_data = true
    end
    gui.destroy(player, player_data, clear_data)
    local copy_frame = player.gui.screen[gui.COPY_GUI_NAME]
    if copy_frame and copy_frame.valid then
        copy_frame.destroy()
    end
end

-- Copy Popup

---Create the copy/paste popup with selectable JSON text
---@param player LuaPlayer
---@param json string
function gui.create_copy_popup(player, json)
    -- Remove any existing copy popup
    local existing = player.gui.screen[gui.COPY_GUI_NAME]
    if existing and existing.valid then
        existing.destroy()
    end

    -- Create popup frame
    local frame = player.gui.screen.add({
        type = "frame",
        name = gui.COPY_GUI_NAME,
        direction = "vertical",
        caption = { "clock-generator-sidecar.copy-popup-title" }
    })
    frame.auto_center = true

    -- Instructions
    frame.add({
        type = "label",
        caption = { "clock-generator-sidecar.copy-instructions" }
    })

    -- Text box with JSON (user can select all and copy)
    local textbox = frame.add({
        type = "text-box",
        name = "clock_generator_sidecar_json_text",
        text = json
    })
    textbox.style.width = 600
    textbox.style.height = 300
    textbox.read_only = true
    textbox.word_wrap = true
    -- Select all text automatically
    textbox.select_all()
    textbox.focus()

    -- Button flow
    local button_flow = frame.add({
        type = "flow",
        direction = "horizontal"
    })
    button_flow.style.horizontal_spacing = 8
    button_flow.style.top_margin = 8
    button_flow.style.horizontally_stretchable = true
    button_flow.style.horizontal_align = "right"

    button_flow.add({
        type = "button",
        name = "clock_generator_sidecar_copy_close",
        caption = { "clock-generator-sidecar.close-button" }
    })
end

-- Main Results GUI

---Create the GUI to display extracted data
---@param player LuaPlayer
---@param player_data PlayerData The player's storage data
---@param result ExtractionResult
function gui.create(player, player_data, result)
    -- Remove existing GUI
    gui.destroy(player, player_data)

    local total_count = #result.machines + #result.drills + #result.inserters + #result.belts + #result.chests

    -- Main frame
    local frame = player.gui.screen.add({
        type = "frame",
        name = gui.GUI_NAME,
        direction = "vertical",
        caption = { "clock-generator-sidecar.gui-title" }
    })
    frame.auto_center = true

    -- Store reference
    player_data.gui = frame

    -- Header flow with count
    local header = frame.add({
        type = "flow",
        direction = "horizontal"
    })
    header.style.horizontal_spacing = 8
    header.style.bottom_margin = 8

    header.add({
        type = "label",
        caption = { "clock-generator-sidecar.entity-count", total_count },
        style = "heading_2_label"
    })

    -- Content frame
    local content_frame = frame.add({
        type = "frame",
        direction = "vertical",
        style = "inside_shallow_frame_with_padding"
    })
    content_frame.style.minimal_width = 600
    content_frame.style.maximal_height = 500

    if total_count == 0 then
        content_frame.add({
            type = "label",
            caption = { "clock-generator-sidecar.no-machines" },
            style = "bold_label"
        })
    else
        -- Scroll pane for entity list
        local scroll = content_frame.add({
            type = "scroll-pane",
            direction = "vertical",
            vertical_scroll_policy = "auto",
            horizontal_scroll_policy = "never"
        })
        scroll.style.maximal_height = 500

        -- Display machines if any
        if #result.machines > 0 then
            local machine_table = add_section_table(
                scroll,
                "Machines & Furnaces (" .. #result.machines .. ")",
                5,
                { "#", { "clock-generator-sidecar.col-machine" }, { "clock-generator-sidecar.col-recipe" }, { "clock-generator-sidecar.col-speed" }, { "clock-generator-sidecar.col-productivity" } },
                { [1] = "center", [4] = "right", [5] = "right" }
            )

            -- Machine rows
            for i, machine in ipairs(result.machines) do
                machine_table.add({ type = "label", caption = tostring(i) })
                machine_table.add({ type = "label", caption = machine.name })
                machine_table.add({ type = "label", caption = machine.recipe })
                machine_table.add({ type = "label", caption = string.format("%.2f", machine.crafting_speed) })
                machine_table.add({ type = "label", caption = string.format("%.1f%%", machine.productivity) })
            end

            if #result.drills > 0 or #result.inserters > 0 or #result.belts > 0 then
                add_spacer(scroll)
            end
        end

        -- Display drills if any
        if #result.drills > 0 then
            local drill_table = add_section_table(
                scroll,
                "Mining Drills (" .. #result.drills .. ")",
                5,
                { "#", "Drill Type", "Resource", "Speed Bonus", { "clock-generator-sidecar.col-productivity" } },
                { [1] = "center", [4] = "right", [5] = "right" }
            )

            -- Drill rows
            for i, drill in ipairs(result.drills) do
                drill_table.add({ type = "label", caption = tostring(i) })
                drill_table.add({ type = "label", caption = drill.drill_type })
                drill_table.add({ type = "label", caption = drill.mined_item_name })
                drill_table.add({ type = "label", caption = string.format("+%.0f%%", drill.speed_bonus * 100) })
                drill_table.add({ type = "label", caption = string.format("%.1f%%", drill.productivity) })
            end
            
            if #result.inserters > 0 or #result.belts > 0 then
                add_spacer(scroll)
            end
        end
        
        -- Display inserters if any
        if #result.inserters > 0 then
            local inserter_table = add_section_table(
                scroll,
                "Inserters (" .. #result.inserters .. ")",
                5,
                { "#", "Type", "Source", "Stack", "Sink" },
                { [1] = "center", [2] = "left", [3] = "left", [4] = "center", [5] = "left" }
            )

            -- Inserter rows
            for i, inserter in ipairs(result.inserters) do
                inserter_table.add({ type = "label", caption = tostring(i) })
                inserter_table.add({ type = "label", caption = inserter.inserter_type })
                
                -- Source description
                local source_text = "?"
                if inserter.source then
                    source_text = inserter.source.type
                end
                inserter_table.add({ type = "label", caption = source_text })
                
                inserter_table.add({ type = "label", caption = tostring(inserter.stack_size) })
                
                -- Sink description
                local sink_text = "?"
                if inserter.sink then
                    sink_text = inserter.sink.type
                end
                inserter_table.add({ type = "label", caption = sink_text })
            end
            
            if #result.belts > 0 or #result.chests > 0 then
                add_spacer(scroll)
            end
        end
        
        -- Display belts if any
        if #result.belts > 0 then
            local belt_table = add_section_table(
                scroll,
                "Transport Belts (" .. #result.belts .. ")",
                4,
                { "#", "Type", "Lane 1", "Lane 2" },
                { [1] = "center", [2] = "left", [3] = "left", [4] = "left" }
            )

            -- Belt rows
            for i, belt in ipairs(result.belts) do
                belt_table.add({ type = "label", caption = tostring(i) })
                belt_table.add({ type = "label", caption = belt.belt_type })
                
                -- Lane 1 (left lane)
                local lane1_text = "(empty)"
                if belt.lanes[1] and belt.lanes[1].ingredient then
                    lane1_text = belt.lanes[1].ingredient
                end
                belt_table.add({ type = "label", caption = lane1_text })
                
                -- Lane 2 (right lane)
                local lane2_text = "(empty)"
                if belt.lanes[2] and belt.lanes[2].ingredient then
                    lane2_text = belt.lanes[2].ingredient
                end
                belt_table.add({ type = "label", caption = lane2_text })
            end
            
            if #result.chests > 0 then
                add_spacer(scroll)
            end
        end
        
        -- Display chests if any
        if #result.chests > 0 then
            local chest_table = add_section_table(
                scroll,
                "Chests (" .. #result.chests .. ")",
                4,
                { "#", "Type", "Items", "Slots" },
                { [1] = "center", [2] = "left", [3] = "left", [4] = "center" }
            )

            -- Chest rows
            for i, chest in ipairs(result.chests) do
                chest_table.add({ type = "label", caption = tostring(i) })
                chest_table.add({ type = "label", caption = chest.chest_type })
                
                -- Items description
                local items_text = ""
                if chest.chest_type == "infinity-chest" then
                    local item_names = {}
                    for _, filter in ipairs(chest.item_filters) do
                        table.insert(item_names, filter.item_name .. ":" .. filter.request_count)
                    end
                    items_text = table.concat(item_names, ", ")
                else
                    items_text = chest.item_filter
                end
                chest_table.add({ type = "label", caption = items_text })
                
                -- Slots (only for buffer chests)
                local slots_text = "-"
                if chest.chest_type == "buffer-chest" then
                    slots_text = tostring(chest.storage_size)
                end
                chest_table.add({ type = "label", caption = slots_text })
            end
        end
    end

    -- Button flow
    local button_flow = frame.add({
        type = "flow",
        direction = "horizontal"
    })
    button_flow.style.horizontal_spacing = 8
    button_flow.style.top_margin = 8
    button_flow.style.horizontally_stretchable = true
    button_flow.style.horizontal_align = "right"

    -- Copy button (only if we have data)
    if total_count > 0 then
        button_flow.add({
            type = "button",
            name = "clock_generator_sidecar_copy",
            caption = { "clock-generator-sidecar.copy-button" },
            style = "confirm_button"
        })
    end

    -- Close button
    button_flow.add({
        type = "button",
        name = "clock_generator_sidecar_close",
        caption = { "clock-generator-sidecar.close-button" }
    })

    player.opened = frame
end

return gui
