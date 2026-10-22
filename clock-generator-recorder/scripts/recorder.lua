-- Clock Generator Recorder
-- Samples inserters and machines every tick, aligned to the generated clock combinator,
-- and writes the raw samples to script-output so the simulation can be verified offline.

require("__clock-generator-sidecar__.scripts.types")
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")

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

---Names of the items a burner machine accepts as fuel. Which prototype attributes and filters exist differs between
---Factorio versions, so each way of finding them is tried safely, and the fuel of a biochamber is the last resort.
---@param burner LuaBurner
---@return string[]
local function fuel_item_names(burner)
    local found = {}

    local categories = {}
    local ok_categories, fuel_categories = pcall(function() return burner.fuel_categories end)
    if ok_categories and fuel_categories then
        for category in pairs(fuel_categories) do
            categories[category] = true
        end
    end

    -- the items of each fuel category, from the prototype filter
    for category in pairs(categories) do
        local ok, items = pcall(prototypes.get_item_filtered, { { filter = "fuel-category", ["fuel-category"] = category } })
        if ok and items then
            for name in pairs(items) do
                found[name] = true
            end
        end
    end

    -- else the fuel category of every item prototype, where the attribute exists
    if next(found) == nil then
        for name, item in pairs(prototypes.item) do
            local ok, category = pcall(function() return item.fuel_category end)
            if ok and category and categories[category] then
                found[name] = true
            end
        end
    end

    -- else whatever the burner holds or burns now
    if next(found) == nil then
        local ok_inventory, inventory = pcall(function() return burner.inventory end)
        if ok_inventory and inventory then
            for _, stack in pairs(inventory.get_contents()) do
                found[stack.name] = true
            end
        end
        local ok_burning, burning = pcall(function() return burner.currently_burning end)
        if ok_burning and burning and burning.name then
            found[burning.name.name] = true
        end
    end

    -- biochambers burn nutrients and nothing else
    if next(found) == nil and categories["nutrients"] then
        found["nutrients"] = true
    end

    local names = {}
    for name in pairs(found) do
        table.insert(names, name)
    end
    table.sort(names)
    return names
end

---The transport line of a belt that is nearest to a map position, and the linear position in the middle of its piece of
---belt, where a drop is made. nil where the entity has no transport lines
---@param belt LuaEntity|nil
---@param position MapPosition
---@return { index: number, line: LuaTransportLine, at: number }|nil
local function nearest_line(belt, position)
    if not belt or not belt.valid then
        return nil
    end
    local ok, count = pcall(function() return belt.get_max_transport_line_index() end)
    if not ok or type(count) ~= "number" then
        return nil
    end
    local best, best_distance = nil, nil
    for index = 1, count do
        local line = belt.get_transport_line(index)
        local at = line.line_length / 2
        local where = line.get_line_item_position(at)
        local distance = (where.x - position.x) ^ 2 + (where.y - position.y) ^ 2
        if best_distance == nil or distance < best_distance then
            best, best_distance = { index = index, line = line, at = at }, distance
        end
    end
    return best
end

---Items and stacks on a transport line
---@param line LuaTransportLine
---@return number items, number stacks
local function line_load(line)
    local items, stacks = 0, 0
    for _, detailed in pairs(line.get_detailed_contents()) do
        stacks = stacks + 1
        items = items + ((detailed.stack and detailed.stack.valid_for_read) and detailed.stack.count or 1)
    end
    return items, stacks
end

---@param result ExtractionResult
---@return table[] inserters, table[] machines, table[] drills
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
        -- An inserter that drops on a belt: the lane it drops on (the nearest line to its drop position) and what is on
        -- that lane's piece of belt each tick. One that picks up from a belt: what is on each lane of that piece.
        local track = inserters[#inserters]
        if exported.sink.type == "belt" and entity.valid then
            local drop = nearest_line(entity.drop_target, entity.drop_position)
            if drop then
                track.drop_line = drop
                track.info.drop_lane = { index = drop.index, length = drop.line.line_length }
                track.samples.drop_lane_items = {}
                track.samples.drop_lane_stacks = {}
                track.samples.drop_lane_room = {}
            end
        end
        if exported.source.type == "belt" and entity.valid and entity.pickup_target and entity.pickup_target.valid then
            local ok, count = pcall(function() return entity.pickup_target.get_max_transport_line_index() end)
            if ok and type(count) == "number" then
                track.pickup_lines = {}
                track.samples.pickup_lane_items = {}
                for index = 1, count do
                    track.pickup_lines[index] = entity.pickup_target.get_transport_line(index)
                    track.samples.pickup_lane_items[tostring(index)] = {}
                end
            end
        end
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
    -- A mining drill that drops into a machine or a chest: its status and how far along the ore it is mining is. Its id
    -- is the export's, which numbers only the drills it keeps (a drill that drops into nothing exported is left out)
    local drills = {}
    for _, drill in ipairs(result.drills) do
        local entity = drill.entity
        local target = export.drill_target(drill, result)
        if target then
            table.insert(drills, {
                entity = entity,
                info = {
                    id = #drills + 1,
                    unit_number = entity.unit_number,
                    name = entity.name,
                    mined_item_name = drill.mined_item_name,
                    target = target,
                },
                samples = { status = {}, mining_progress = {}, bonus_mining_progress = {} },
            })
        end
    end
    return inserters, machines, drills
end

---A number attribute of an entity, or 0 where this Factorio version does not have it
---@param entity LuaEntity
---@param attribute string
---@return number
local function number_or_zero(entity, attribute)
    local ok, value = pcall(function() return entity[attribute] end)
    return ok and type(value) == "number" and value or 0
end

---The belt lanes of an inserter that drops on or picks up from a belt, as they are this tick
---@param track table
local function sample_lanes(track)
    local s = track.samples
    local drop = track.drop_line
    if drop then
        if drop.line.valid then
            local items, stacks = line_load(drop.line)
            table.insert(s.drop_lane_items, items)
            table.insert(s.drop_lane_stacks, stacks)
            table.insert(s.drop_lane_room, drop.line.can_insert_at(drop.at) and 1 or 0)
        else
            table.insert(s.drop_lane_items, 0)
            table.insert(s.drop_lane_stacks, 0)
            table.insert(s.drop_lane_room, 0)
        end
    end
    if track.pickup_lines then
        for index, line in pairs(track.pickup_lines) do
            table.insert(s.pickup_lane_items[tostring(index)], line.valid and (line_load(line)) or 0)
        end
    end
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
        sample_lanes(track)
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
                -- the burner's attributes differ between Factorio versions, so a missing one records nothing instead of crashing
                local _, fuel_inventory = pcall(function() return burner.inventory end)
                for name, values in pairs(s.fuel) do
                    table.insert(values, fuel_inventory and fuel_inventory.get_item_count(name) or 0)
                end
                -- energy left in the item being burned, in MJ
                local _, remaining = pcall(function() return burner.remaining_burning_fuel end)
                table.insert(s.burning_remaining, round4((remaining or 0) / 1000000))
                local _, burning = pcall(function() return burner.currently_burning end)
                record_change(s.currently_burning, index, burning and burning.name and burning.name.name or "")
            end
        else
            record_change(s.status, index, "invalid")
        end
    end

    for _, track in ipairs(recording.drills or {}) do
        local entity, s = track.entity, track.samples
        if entity.valid then
            record_change(s.status, index, status_name(entity))
            table.insert(s.mining_progress, round4(number_or_zero(entity, "mining_progress")))
            table.insert(s.bonus_mining_progress, round4(number_or_zero(entity, "bonus_mining_progress")))
        else
            record_change(s.status, index, "invalid")
            table.insert(s.mining_progress, 0)
            table.insert(s.bonus_mining_progress, 0)
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

---How far the running recording is and where the last finished one was written, for a script that waits for it
---@return table
function recorder.status()
    local recording = storage.recording
    return {
        active = recording ~= nil,
        phase = recording and recording.phase or nil,
        sample_count = recording and recording.sample_count or nil,
        last_recording = storage.last_recording,
    }
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
        drills = serialize_tracks(recording.drills or {}),
    }

    local filename = "clock-generator-recorder/recording-" .. recording.start_game_tick .. ".json"
    helpers.write_file(filename, helpers.table_to_json(output), false, recording.player_index)
    -- where a script that started the recording finds it
    storage.last_recording = { filename = filename, sample_count = recording.sample_count, stop_reason = reason }
    notify(recording.player_index, "Recorded " .. recording.sample_count .. " ticks (" .. reason .. "). Saved to script-output/" .. filename)
end

local LEFT_OUT_REASONS = {
    machine = "it is not in the config: it is a lab, has no recipe or is outside the selection",
    belt = "it is not in the config: it is empty or outside the selection",
    chest = "it is not in the config: it is empty or outside the selection",
}

---The inserters the export leaves out, each with the end it is left out for and why
---@param result ExtractionResult
---@return table[]
local function left_out_inserters(result)
    local out = {}
    for _, left in ipairs(export.left_out_inserters(result)) do
        local inserter = left.inserter
        local target = left.target
        table.insert(out, {
            unit_number = inserter.entity.valid and inserter.entity.unit_number or nil,
            name = inserter.inserter_type,
            position = inserter.position,
            at = left.pickup and "pickup" or "drop",
            target = target and { type = target.type, unit_number = target.unit_number, name = target.name } or nil,
            reason = target and LEFT_OUT_REASONS[target.type] or "the sidecar has no type for what is there (the ground, a wagon)",
        })
    end
    return out
end

---The drills the export leaves out, with what each drops into (nil for the ground)
---@param result ExtractionResult
---@return table[]
local function left_out_drills(result)
    local out = {}
    for _, left in ipairs(export.left_out_drills(result)) do
        local entity = left.drill.entity
        table.insert(out, {
            unit_number = entity.valid and entity.unit_number or nil,
            name = left.drill.drill_type,
            position = left.drill.position,
            target_name = left.target_name,
            reason = left.target_name and ("it drops into " .. left.target_name .. ", which is not in the config")
                or "it drops onto the ground",
        })
    end
    return out
end

---What a recording of these entities would track, without samples: the config and the id of each inserter and machine,
---and the inserters the config leaves out, with why
---@param force LuaForce
---@param entities LuaEntity[]
---@return table
function recorder.describe(force, entities)
    local result = extraction.extract_all_entities(entities, force)
    local inserters, machines, drills = build_tracks(result)
    local function infos(tracks)
        local out = {}
        for _, track in ipairs(tracks) do
            table.insert(out, track.info)
        end
        return out
    end
    return {
        config = export.to_table(result),
        inserters = infos(inserters),
        machines = infos(machines),
        drills = infos(drills),
        left_out = left_out_inserters(result),
        left_out_drills = left_out_drills(result),
    }
end

---Start a recording for the selected entities
---@param force LuaForce
---@param entities LuaEntity[]
---@param player_index uint|nil Player to notify and to write the file for; nil writes on the server
---@param options {periods: number?, minimum_ticks: number?, ticks_without_clock: number?, ignore_clock: boolean?}|nil Used in place of the mod settings
---@return boolean started
function recorder.start(force, entities, player_index, options)
    if storage.recording then
        notify(player_index, "A recording is already running. Alt-select with the recorder to stop it.")
        return false
    end

    local result = extraction.extract_all_entities(entities, force)
    local inserters, machines, drills = build_tracks(result)
    if #inserters == 0 and #machines == 0 then
        notify(player_index, "No machines or inserters found in selection.")
        return false
    end
    storage.last_recording = nil

    options = options or {}
    local settings_table = settings.global
    local clock = not options.ignore_clock and find_clock(entities) or nil

    storage.recording = {
        player_index = player_index,
        clock = clock,
        clock_values = {},
        periods = options.periods or settings_table["clock-generator-recorder-periods"].value,
        minimum_ticks = options.minimum_ticks or settings_table["clock-generator-recorder-minimum-ticks"].value,
        fallback_ticks = options.ticks_without_clock or settings_table["clock-generator-recorder-ticks-without-clock"].value,
        phase = clock and "waiting" or "recording",
        waited_ticks = 0,
        wraps = 0,
        last_clock = nil,
        start_game_tick = game.tick,
        sample_count = 0,
        config = export.to_table(result),
        inserters = inserters,
        machines = machines,
        drills = drills,
    }

    if clock then
        notify(player_index, "Found clock combinator. Waiting for it to wrap to start recording "
            .. storage.recording.periods .. " period(s)"
            .. (storage.recording.minimum_ticks > 0 and (", and whole periods until at least " .. storage.recording.minimum_ticks .. " ticks,") or "")
            .. " of " .. #inserters .. " inserters, " .. #machines .. " machines and " .. #drills .. " mining drills.")
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
            -- whole periods: at least the periods asked for, and more until the minimum ticks are recorded
            if recording.wraps >= recording.periods and recording.sample_count >= (recording.minimum_ticks or 0) then
                recorder.finish("recorded " .. recording.wraps .. " clock period(s)")
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
