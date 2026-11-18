-- Run the selected clock on a sample's scaffold from the staged start under the game tests' protocol (helpers/lua/steady.lua):
-- steady state, a baseline of whole clock cycles, then the losses of the case, one after the other, each until the output falls
-- below the baseline's lowest minute, released, and recovered. A staged start has no settle: the recording is cut where the run
-- ends (settle.record_samples), as utility-science-120-selected-clock-probe.lua does.
-- options: window, expected, baseline, cap, recover_bound, recipes, item, ticks, losses, tail, finals, late
-- late: the recording starts where the run ends (settle.finish), not at the placement: the recorder does not start on machines with no recipe, and a furnace has none yet
-- losses: a list of
--   {kind = "cut", item}       the item stops arriving: the infinity chests that hold it lose that filter and their stock of it, and it is
--                              taken off every belt in every tick; hands and machines keep theirs
--   {kind = "block"}           the output is not taken: the loaders that empty the output belts are removed (rebuilt on release); a build
--                              whose output goes into infinity chests with no loader has those chests refuse what comes (their slots filtered);
--                              options.block_sinks: those chests refuse it also where the build has loaders (they drain its input belts)
--   {kind = "stop", recipe}    the machines making the recipe are stopped (disabled by script) and what they made and waits is taken
local entities, surface, _, settle = ...
local report = {events = {}}
local function event(t, action) table.insert(report.events, {tick = t, action = action}) end

local BELT_TYPES = {["transport-belt"] = true, ["underground-belt"] = true, ["splitter"] = true, ["loader"] = true}
local function take_off_belts(item)
    for _, e in pairs(entities) do
        if e.valid and BELT_TYPES[e.type] then
            for lane = 1, e.get_max_transport_line_index() do
                for quality in pairs(prototypes.quality) do e.get_transport_line(lane).remove_item{name = item, quality = quality, count = 100000} end
            end
        end
    end
end

-- the filters of an infinity chest as a list, and a list written back whole (removing a filter moves the ones after it up a place)
local function read_filters(e)
    local list = {}
    for place = 1, 64 do
        local filter = e.get_infinity_container_filter(place)
        if filter then table.insert(list, filter) end
    end
    return list
end
local function write_filters(e, list)
    for place = 1, 64 do e.set_infinity_container_filter(1, nil) end
    for place, f in ipairs(list) do
        e.set_infinity_container_filter(place, {name = f.name, count = f.count, mode = f.mode, quality = f.quality, index = place})
    end
end

-- the infinity chests that hold an item, each with all of its filters
local function chests_holding(item)
    local found = {}
    for _, e in pairs(entities) do
        if e.valid and e.type == "infinity-container" then
            local saved = read_filters(e)
            for _, filter in ipairs(saved) do
                if filter.name == item then table.insert(found, {entity = e, saved = saved}) break end
            end
        end
    end
    return found
end

local function cut(item)
    local chests = chests_holding(item)
    return {
        kind = "cut " .. item,
        start = function(t)
            for _, c in ipairs(chests) do
                local kept = {}
                for _, filter in ipairs(c.saved) do if filter.name ~= item then table.insert(kept, filter) end end
                write_filters(c.entity, kept)
                for quality in pairs(prototypes.quality) do c.entity.remove_item{name = item, quality = quality, count = 1000000} end
            end
            event(t, "cut " .. item .. " (" .. #chests .. " infinity chests hold it)")
        end,
        tick = function() take_off_belts(item) end,
        release = function(t)
            for _, c in ipairs(chests) do write_filters(c.entity, c.saved) end
            event(t, "restore " .. item)
        end,
    }
end

local loaders, sinks = {}, {}
-- options.block_sinks: the chests the build's loaders drain into are not the output's, and are left as they are
local drained = {}
if options.block_sinks then
    for _, e in pairs(entities) do
        if e.valid and e.type == "loader" and e.loader_container and e.loader_container.valid then drained[e.loader_container.unit_number] = true end
    end
end
for index, e in pairs(entities) do
    if e.valid and e.type == "loader" then
        table.insert(loaders, {index = index, spec = {name = e.name, position = e.position, direction = e.direction, force = e.force, type = e.loader_type}})
    end
    if e.valid and e.type == "infinity-container" and e.remove_unfiltered_items and not e.get_infinity_container_filter(1) and not drained[e.unit_number] then table.insert(sinks, e) end
end
local block = {
    kind = "block output",
    start = function(t)
        if #loaders > 0 and not options.block_sinks then
            for _, l in ipairs(loaders) do entities[l.index].destroy() end
            event(t, "block-output: " .. #loaders .. " loaders removed")
        else
            -- an infinity chest that keeps one full slot of each of its filters, as many as it has slots: nothing else fits
            local junk = {}
            for name, prototype in pairs(prototypes.item) do
                if not prototype.hidden and prototype.stack_size > 1 and name ~= options.item then table.insert(junk, name) end
            end
            table.sort(junk)
            local filtered = 0
            for _, sink in ipairs(sinks) do
                sink.remove_unfiltered_items = false
                local slots = #sink.get_inventory(defines.inventory.chest)
                local filters = {}
                for slot = 1, slots do
                    local name = junk[slot]
                    table.insert(filters, {name = name, count = prototypes.item[name].stack_size, mode = "at-least"})
                    filtered = filtered + 1
                end
                write_filters(sink, filters)
            end
            event(t, "block-output: " .. #sinks .. " infinity chests, " .. filtered .. " slots filled")
        end
    end,
    -- the recorder reads the build after the probe: the rebuilt loaders take the old ones' places
    release = function(t)
        if #loaders > 0 and not options.block_sinks then
            for _, l in ipairs(loaders) do entities[l.index] = assert(surface.create_entity(l.spec)) end
        else
            for _, sink in ipairs(sinks) do
                write_filters(sink, {})
                sink.remove_unfiltered_items = true
            end
        end
        event(t, "restore-output")
    end,
}

local function stop(recipe)
    local machines = {}
    for _, e in pairs(entities) do
        if e.valid and (e.type == "assembling-machine" or e.type == "furnace") then
            local current = e.get_recipe()
            if current and current.name == recipe then table.insert(machines, e) end
        end
    end
    assert(#machines > 0, "a machine making " .. recipe)
    return {
        kind = "stop " .. recipe,
        start = function(t)
            local removed = 0
            for _, m in ipairs(machines) do
                m.disabled_by_script = true
                local output = m.get_inventory(defines.inventory.crafter_output)
                if output then for _, product in ipairs(prototypes.recipe[recipe].products) do removed = removed + output.remove{name = product.name, count = 1000000} end end
            end
            table.insert(report.events, {tick = t, action = "stop " .. recipe, machines = #machines, removed = removed})
        end,
        release = function(t) for _, m in ipairs(machines) do m.disabled_by_script = false end event(t, "start " .. recipe) end,
    }
end

local disturbances = {}
for _, loss in ipairs(options.losses) do
    if loss.kind == "cut" then table.insert(disturbances, cut(loss.item))
    elseif loss.kind == "block" then table.insert(disturbances, block)
    elseif loss.kind == "stop" then table.insert(disturbances, stop(loss.recipe))
    else error("a loss of kind " .. tostring(loss.kind)) end
end
report.sinks, report.loaders = #sinks, #loaders
local began = game.tick
-- the run is counted from the first tick the final machines have a recipe (a furnace has none until it is given something to smelt): steady.after_finals
local function launch(finals, waited)
report.started_after = waited
local clock = steady.clock(entities)
-- where each final machine stands: a staged recording starts before every machine has its recipe, so the host cannot always match the copies
report.final_positions = {}
for _, f in ipairs(finals) do report.final_positions[tostring(f.unit_number)] = {x = f.entity.position.x, y = f.entity.position.y} end
local origin = {}
for k, f in ipairs(finals) do origin[k] = f.entity.products_finished end
local function products() local out = {} for k, f in ipairs(finals) do out[k] = f.entity.products_finished - origin[k] end return out end
local function stocks() local out = {} for k, f in ipairs(finals) do out[k] = f.entity.get_output_inventory().get_item_count(f.item) end return out end
-- after the last loss is recovered (or the run fails) the run goes on for `tail` ticks, and records every whole clock cycle of them as
-- steady.lua does (per final machine, the products and the output stock): what each copy makes after the losses is judged from those
local function run_tail()
    local rows = {}
    report.tail = {start = game.tick - began, rows = rows}
    local position = capture.clock_value(clock)
    local ended = game.tick + options.tail
    table.insert(rows, {t = game.tick - began, p = products(), s = stocks()})
    script.on_nth_tick(1, function()
        local t = game.tick - began
        if capture.clock_value(clock) == position then table.insert(rows, {t = t, p = products(), s = stocks()}) end
        if game.tick >= ended then
            script.on_nth_tick(1, nil)
            report.tail.ended = t
            helpers.write_file("clock-speed.json", helpers.table_to_json(report), false)
            -- a late recording (options.late) starts where the run ends
            if options.late then settle.finish() end
        end
    end)
end
steady.run{
    finals = finals, clock = clock,
    window = options.window, expected = options.expected, baseline = options.baseline, cap = options.cap,
    recover_bound = options.recover_bound, disturbances = disturbances,
    report = report, output = "clock-speed.json",
    -- the recording holds samples 0 .. ended + tail
    done = function()
        if not options.late then settle.record_samples(math.min(options.ticks, game.tick - began + 1 + options.tail + 30)) end
        -- what the run ended with, for a run that did not recover: the filters of the infinity chests, the hands, the final machines' input
        local final = {chests = {}, hands = {}, machines = {}}
        for _, e in pairs(entities) do
            if e.valid and e.type == "infinity-container" then
                local row = {}
                for _, filter in ipairs(read_filters(e)) do table.insert(row, {name = filter.name, in_chest = e.get_item_count(filter.name)}) end
                if #row > 0 and #row < 12 then table.insert(final.chests, row) end
            elseif e.valid and e.type == "inserter" and #final.hands < 80 then
                local held = e.held_stack
                table.insert(final.hands, {unit = e.unit_number, held = held.valid_for_read and (held.name .. " x" .. held.count) or "", status = e.status})
            end
        end
        for _, f in ipairs(finals) do
            local inventory = f.entity.get_inventory(defines.inventory.crafter_input)
            local row = {unit = f.unit_number}
            if inventory then for _, content in ipairs(inventory.get_contents()) do row[content.name] = content.count end end
            table.insert(final.machines, row)
        end
        report.final = final
        run_tail()
    end,
}
end
steady.after_finals(entities, options, launch)
