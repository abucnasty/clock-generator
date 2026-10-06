-- Clock Generator Recorder
-- Samples inserters and machines every tick, aligned to the generated clock combinator,
-- and writes the raw samples to script-output so the simulation can be verified offline.

require("scripts.types")
local extraction = require("scripts.extraction")
local export = require("scripts.export")

local recorder = {}

local RECORDING_FORMAT = "clock-generator-recording"
local RECORDING_FORMAT_VERSION = 1
local CLOCK_SIGNAL = { type = "virtual", name = "signal-clock" }
local CLOCK_DESCRIPTION_PREFIX = "Clock for"
local MAX_WAIT_TICKS = 100000

local status_names = {}
for name, value in pairs(defines.entity_status) do
    status_names[value] = name
end

---@param entity LuaEntity
---@return string
local function status_name(entity)
    local s = entity.status
    if s == nil then
        return "none"
    end
    return status_names[s] or tostring(s)
end

---@param value number
---@return number
local function round4(value)
    return math.floor(value * 10000 + 0.5) / 10000
end

---Find the generated clock combinator, preferring the one labelled by the blueprint generator
---@param entities LuaEntity[]
---@return LuaEntity|nil
local function find_clock(entities)
    local fallback = nil
    for _, entity in pairs(entities) do
        if entity.valid and entity.type == "decider-combinator" then
            local ok, description = pcall(function() return entity.combinator_description end)
            if ok and description and string.sub(description, 1, #CLOCK_DESCRIPTION_PREFIX) == CLOCK_DESCRIPTION_PREFIX then
                return entity
            end
            fallback = fallback or entity
        end
    end
    return fallback
end

---@param clock LuaEntity|nil
---@return number|nil
local function read_clock(clock)
    if not clock or not clock.valid then
        return nil
    end
    local connectors = {
        defines.wire_connector_id.combinator_output_green,
        defines.wire_connector_id.combinator_output_red,
        defines.wire_connector_id.combinator_input_green,
        defines.wire_connector_id.combinator_input_red,
    }
    for _, connector in ipairs(connectors) do
        local network = clock.get_circuit_network(connector)
        if network then
            return network.get_signal(CLOCK_SIGNAL)
        end
    end
    return nil
end

---Append to a change-list only when the value differs from the last entry
---@param list table
---@param index number 0-based sample index
---@param value any
local function record_change(list, index, value)
    local last = list[#list]
    if last == nil or last[2] ~= value then
        table.insert(list, { index, value })
    end
end

---@param recipe LuaRecipe|LuaRecipePrototype
---@param key "ingredients"|"products"
---@return string[]
local function recipe_item_names(recipe, key)
    local names = {}
    for _, entry in pairs(recipe[key]) do
        if entry.type == "item" then
            table.insert(names, entry.name)
        end
    end
    return names
end

---Names of the items a burner machine accepts as fuel
---@param burner LuaBurner
---@return string[]
local function fuel_item_names(burner)
    local categories = burner.fuel_categories
    local names = {}
    for name, item in pairs(prototypes.item) do
        if item.fuel_category and categories[item.fuel_category] then
            table.insert(names, name)
        end
    end
    table.sort(names)
    return names
end

---@param result ExtractionResult
---@return table[] inserters, table[] machines
local function build_tracks(result)
    local inserters = {}
    for _, exported in ipairs(export.exported_inserters(result)) do
        local entity = exported.inserter.entity
        table.insert(inserters, {
            entity = entity,
            info = {
                id = exported.id,
                unit_number = entity.unit_number,
                name = entity.name,
                source = exported.source,
                sink = exported.sink,
                stack_size = exported.inserter.stack_size,
            },
            samples = { held_count = {}, held_item = {}, status = {} },
        })
    end

    local machines = {}
    for id, machine in ipairs(result.machines) do
        local entity = machine.entity
        local recipe = entity.get_recipe() or prototypes.recipe[machine.recipe]
        local inputs, outputs = {}, {}
        for _, name in ipairs(recipe_item_names(recipe, "ingredients")) do inputs[name] = {} end
        for _, name in ipairs(recipe_item_names(recipe, "products")) do outputs[name] = {} end
        -- A burner machine (biochamber) also records its fuel slot and the fuel it is burning
        local fuel = nil
        if entity.burner then
            fuel = {}
            for _, name in ipairs(fuel_item_names(entity.burner)) do fuel[name] = {} end
        end
        table.insert(machines, {
            entity = entity,
            info = {
                id = id,
                unit_number = entity.unit_number,
                name = entity.name,
                recipe = machine.recipe,
            },
            samples = {
                status = {},
                crafting_progress = {},
                bonus_progress = {},
                products_finished = {},
                inputs = inputs,
                outputs = outputs,
                fuel = fuel,
                burning_remaining = fuel and {} or nil,
                currently_burning = fuel and {} or nil,
            },
        })
    end
    return inserters, machines
end

---@param recording table
local function sample(recording)
    local index = recording.sample_count
    recording.sample_count = index + 1

    if recording.clock then
        table.insert(recording.clock_values, read_clock(recording.clock) or 0)
    end

    for _, track in ipairs(recording.inserters) do
        local entity, s = track.entity, track.samples
        if entity.valid then
            local held = entity.held_stack
            local has_items = held and held.valid_for_read
            table.insert(s.held_count, has_items and held.count or 0)
            record_change(s.held_item, index, has_items and held.name or "")
            record_change(s.status, index, status_name(entity))
        else
            table.insert(s.held_count, 0)
            record_change(s.status, index, "invalid")
        end
    end

    for _, track in ipairs(recording.machines) do
        local entity, s = track.entity, track.samples
        if entity.valid then
            record_change(s.status, index, status_name(entity))
            table.insert(s.crafting_progress, round4(entity.crafting_progress))
            table.insert(s.bonus_progress, round4(entity.bonus_progress))
            table.insert(s.products_finished, entity.products_finished)
            local input_inventory = entity.get_inventory(defines.inventory.crafter_input)
            local output_inventory = entity.get_inventory(defines.inventory.crafter_output)
            for name, values in pairs(s.inputs) do
                table.insert(values, input_inventory and input_inventory.get_item_count(name) or 0)
            end
            for name, values in pairs(s.outputs) do
                table.insert(values, output_inventory and output_inventory.get_item_count(name) or 0)
            end
            local burner = s.fuel and entity.burner
            if burner then
                local fuel_inventory = burner.inventory
                for name, values in pairs(s.fuel) do
                    table.insert(values, fuel_inventory and fuel_inventory.get_item_count(name) or 0)
                end
                -- energy left in the item being burned, in MJ
                table.insert(s.burning_remaining, round4(burner.remaining_burning_fuel / 1000000))
                local burning = burner.currently_burning
                record_change(s.currently_burning, index, burning and burning.name.name or "")
            end
        else
            record_change(s.status, index, "invalid")
        end
    end
end

---@param tracks table[]
---@return table[]
local function serialize_tracks(tracks)
    local out = {}
    for _, track in ipairs(tracks) do
        local entry = {}
        for k, v in pairs(track.info) do entry[k] = v end
        entry.samples = track.samples
        table.insert(out, entry)
    end
    return out
end

---@param player_index uint|nil
---@param message string
local function notify(player_index, message)
    local player = player_index and game.get_player(player_index)
    if player then
        player.print("[Clock Recorder] " .. message)
    else
        log("[Clock Recorder] " .. message)
    end
end

---@return boolean
function recorder.is_active()
    return storage.recording ~= nil
end

---Write the recording to script-output and clear it
---@param reason string
function recorder.finish(reason)
    local recording = storage.recording
    if not recording then
        return
    end
    storage.recording = nil

    if recording.sample_count == 0 then
        notify(recording.player_index, "Stopped before any ticks were recorded (" .. reason .. ").")
        return
    end

    local output = {
        format = RECORDING_FORMAT,
        version = RECORDING_FORMAT_VERSION,
        factorio_version = script.active_mods["base"],
        start_game_tick = recording.start_game_tick,
        sample_count = recording.sample_count,
        stop_reason = reason,
        clock = recording.clock and { values = recording.clock_values } or nil,
        config = recording.config,
        inserters = serialize_tracks(recording.inserters),
        machines = serialize_tracks(recording.machines),
    }

    local filename = "clock-generator-recorder/recording-" .. recording.start_game_tick .. ".json"
    helpers.write_file(filename, helpers.table_to_json(output), false, recording.player_index)
    notify(recording.player_index, "Recorded " .. recording.sample_count .. " ticks (" .. reason .. "). Saved to script-output/" .. filename)
end

---Start a recording for the selected entities
---@param force LuaForce
---@param entities LuaEntity[]
---@param player_index uint|nil Player to notify and to write the file for; nil writes on the server
---@return boolean started
function recorder.start(force, entities, player_index)
    if storage.recording then
        notify(player_index, "A recording is already running. Alt-select with the recorder to stop it.")
        return false
    end

    local result = extraction.extract_all_entities(entities, force)
    local inserters, machines = build_tracks(result)
    if #inserters == 0 and #machines == 0 then
        notify(player_index, "No machines or inserters found in selection.")
        return false
    end

    local settings_table = settings.global
    local clock = find_clock(entities)

    storage.recording = {
        player_index = player_index,
        clock = clock,
        clock_values = {},
        periods = settings_table["clock-generator-recorder-periods"].value,
        fallback_ticks = settings_table["clock-generator-recorder-ticks-without-clock"].value,
        phase = clock and "waiting" or "recording",
        waited_ticks = 0,
        wraps = 0,
        last_clock = nil,
        start_game_tick = game.tick,
        sample_count = 0,
        config = export.to_table(result),
        inserters = inserters,
        machines = machines,
    }

    if clock then
        notify(player_index, "Found clock combinator. Waiting for it to wrap to start recording "
            .. storage.recording.periods .. " period(s) of " .. #inserters .. " inserters and " .. #machines .. " machines.")
    else
        notify(player_index, "No clock combinator selected; recording "
            .. storage.recording.fallback_ticks .. " ticks without clock alignment.")
    end
    return true
end

---Per-tick handler while a recording is active
function recorder.on_tick()
    local recording = storage.recording
    if not recording then
        return
    end

    if recording.phase == "waiting" then
        local value = read_clock(recording.clock)
        if value == nil then
            recorder.finish("clock combinator no longer readable")
            return
        end
        local wrapped = recording.last_clock ~= nil and value < recording.last_clock
        recording.last_clock = value
        recording.waited_ticks = recording.waited_ticks + 1
        if not wrapped then
            if recording.waited_ticks > MAX_WAIT_TICKS then
                recorder.finish("clock never wrapped")
            end
            return
        end
        recording.phase = "recording"
        recording.start_game_tick = game.tick
    end

    if recording.clock then
        local value = read_clock(recording.clock) or 0
        if recording.sample_count > 0 and value < recording.last_clock then
            recording.wraps = recording.wraps + 1
            if recording.wraps >= recording.periods then
                recorder.finish("recorded " .. recording.periods .. " clock period(s)")
                return
            end
        end
        recording.last_clock = value
    elseif recording.sample_count >= recording.fallback_ticks then
        recorder.finish("recorded " .. recording.fallback_ticks .. " ticks")
        return
    end

    sample(recording)
end

return recorder
