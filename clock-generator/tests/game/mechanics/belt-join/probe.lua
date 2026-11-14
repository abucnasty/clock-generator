-- The belt join family: copies of six shapes of turbo belts built side by side by this script, fed by script inserts and
-- by a stack inserter, logged every tick: every stack on every transport line of every belt piece of a copy. See README.md.
--
-- options = {ticks, copies = {{name, entities, streams, hands?, ends?, priority?}}} (join.game.test.ts makes it from
-- cases.ts). An entity is {name, x, y, direction?, type?, chest?} in tiles from the copy's top-left corner. A stream is
-- {line = "x,y/n", ticks, spot?}: a stack of 4 inserted on line n of the piece at tile (x, y), at `spot` 1/256 tiles from
-- the line's end (default the line's length less 1/256). The pieces are built in tick 0 and nothing is built, removed or
-- cleared on a belt after that: an end is shut by its chest (it keeps what comes and its slots are filled with wooden
-- chests) and opened by emptying the chest and letting it take again.
--
-- Each tick, in this order: the chest actions and hands, the inserts, then the log. The log (script-output/belt-join/)
-- has a row per copy and tick, "t,copy|piece,line,id,position;...", with a number for each stack's unique id in order of
-- first sight and its position in 1/256 tile; info.json has each copy's pieces (their tile, and their line lengths at the end), each
-- stream's done and failed insert ticks, the hand and chest actions, the force's belt stack size and the research.
local entities, surface = ...
local base
for _, entity in pairs(entities) do if entity.valid then base = entity.position end end
local force = game.forces["player"]
local function research()
    local result = {}
    for name, technology in pairs(force.technologies) do result[name] = {technology.researched, technology.level} end
    return helpers.table_to_json(result)
end
local research_before = research()
local info = {factorio = script.active_mods.base, ticks = options.ticks, copies = {}, problems = {},
    belt_stack_size_bonus = force.belt_stack_size_bonus}
local STACK = force.belt_stack_size_bonus + 1
local BELT_TYPES = {["transport-belt"] = true, ["underground-belt"] = true, ["splitter"] = true, ["loader"] = true}
local LOG, INFO = "belt-join/log.txt", "belt-join/info.json"

-- the copies stand in cells of 26 by 18 tiles, six to a row, away from the harness's own entity
local CELL_W, CELL_H, PER_ROW = 26, 18, 6
local rows = math.ceil(#options.copies / PER_ROW)
local x0, y0 = math.floor(base.x) + 8, math.floor(base.y) + 8
local area = {{x0 - 2, y0 - 2}, {x0 + PER_ROW * CELL_W + 2, y0 + rows * CELL_H + 2}}
surface.request_to_generate_chunks({(area[1][1] + area[2][1]) / 2, (area[1][2] + area[2][2]) / 2},
    math.ceil(math.max(area[2][1] - area[1][1], area[2][2] - area[1][2]) / 64) + 1)
surface.force_generate_chunk_requests()
for _, other in pairs(surface.find_entities_filtered({area = area})) do
    if other.valid and other.type ~= "character" and not (other.position.x == base.x and other.position.y == base.y) then other.destroy() end
end
local tiles = {}
for x = area[1][1], area[2][1] do for y = area[1][2], area[2][2] do tiles[#tiles + 1] = {name = "refined-concrete", position = {x, y}} end end
surface.set_tiles(tiles)

local runs = {}
for index, copy in ipairs(options.copies) do
    local ox, oy = x0 + ((index - 1) % PER_ROW) * CELL_W + 2, y0 + math.floor((index - 1) / PER_ROW) * CELL_H + 2
    local run = {copy = copy, pieces = {}, by_key = {}, chests = {}, seen = {}, next_id = 0, streams = {}, actions = {}}
    for _, spec in ipairs(copy.entities) do
        local params = {name = spec.name, position = {ox + spec.x, oy + spec.y}, force = force, direction = spec.direction}
        if spec.type then params.type = spec.type end
        local entity = surface.create_entity(params)
        if not entity then error("could not build " .. spec.name .. " at " .. spec.x .. "," .. spec.y .. " in " .. copy.name) end
        if entity.type == "splitter" then
            local priority = copy.priority or {"right", "right"}
            entity.splitter_input_priority = priority[1]
            entity.splitter_output_priority = priority[2]
            run.splitter = {entity.splitter_input_priority, entity.splitter_output_priority}
        elseif spec.chest == "end" then
            entity.remove_unfiltered_items = true
            run.chests[math.floor(spec.x) .. "," .. math.floor(spec.y)] = entity
        elseif spec.chest == "inserter" then
            run.supply = entity
        elseif entity.type == "inserter" then
            run.inserter = entity
        elseif entity.type == "electric-energy-interface" then
            entity.electric_buffer_size = 1e10; entity.power_production = 1e7; entity.energy = 1e10
        end
        if BELT_TYPES[entity.type] then
            -- the piece's top-left tile in the copy
            local key = math.floor(entity.position.x - ox - (entity.tile_width - 1) / 2) .. "," .. math.floor(entity.position.y - oy - (entity.tile_height - 1) / 2)
            local lines = {}
            for i = 1, entity.get_max_transport_line_index() do lines[i] = math.floor(entity.get_transport_line(i).line_length * 256 + 0.5) end
            run.pieces[#run.pieces + 1] = {entity = entity, key = key, lines = lines}
            run.by_key[key] = entity
        end
    end
    for _, s in ipairs(copy.streams) do
        local key, n = string.match(s.line, "^(.-)/(%d+)$")
        local piece = run.by_key[key]
        if not piece then error("no piece at " .. key .. " for a stream of " .. copy.name) end
        local line = piece.get_transport_line(tonumber(n))
        local at = {}
        for _, t in ipairs(s.ticks) do at[t] = true end
        run.streams[#run.streams + 1] = {line = line, name = s.line, at = at, spot = s.spot and s.spot / 256 or (line.line_length - 1 / 256), done = {}, failed = {}}
    end
    run.hand = run.inserter and run.inserter.inserter_target_pickup_count or nil
    run.hands_left = copy.hands and copy.hands.hands or 0
    local pieces = {}
    for _, p in ipairs(run.pieces) do pieces[#pieces + 1] = {key = p.key, name = p.entity.name, lines = p.lines} end
    info.copies[index] = {name = copy.name, pieces = pieces, splitter = run.splitter, hand = run.hand}
    runs[index] = run
end
info.research_unchanged = research() == research_before
helpers.write_file(LOG, "", false)

local function act(run, t)
    for _, e in ipairs(run.copy.ends or {}) do
        if e.t == t then
            for _, tile in ipairs(e.chests) do
                local chest = run.chests[tile[1] .. "," .. tile[2]]
                if not chest then error("no end chest at " .. tile[1] .. "," .. tile[2] .. " in " .. run.copy.name) end
                local inventory = chest.get_inventory(defines.inventory.chest)
                if e.action == "block" then
                    chest.remove_unfiltered_items = false
                    for slot = 1, #inventory do inventory[slot].set_stack({name = "wooden-chest", count = 50}) end
                else
                    inventory.clear()
                    chest.remove_unfiltered_items = true
                end
                run.actions[#run.actions + 1] = {t = t, action = e.action, chest = tile}
            end
        end
    end
    local hands = run.copy.hands
    if hands and t >= hands.t and run.hands_left > 0 and run.supply.get_item_count() == 0 then
        run.supply.insert({name = "automation-science-pack", count = run.hand})
        run.hands_left = run.hands_left - 1
        run.actions[#run.actions + 1] = {t = t, action = "hand"}
    end
end

local function sample(run, t)
    local parts = {}
    for pi, piece in ipairs(run.pieces) do
        for li = 1, #piece.lines do
            for _, detailed in pairs(piece.entity.get_transport_line(li).get_detailed_contents()) do
                local id = run.seen[detailed.unique_id]
                if not id then run.next_id = run.next_id + 1; id = run.next_id; run.seen[detailed.unique_id] = id end
                parts[#parts + 1] = pi .. "," .. li .. "," .. id .. "," .. math.floor(detailed.position * 256 + 0.5)
            end
        end
    end
    return t .. "," .. run.index .. "|" .. table.concat(parts, ";")
end

local function tick_all(t)
    local out = {}
    for _, run in ipairs(runs) do
        act(run, t)
        for _, s in ipairs(run.streams) do
            if s.at[t] then
                if s.line.insert_at(s.spot, {name = "iron-plate", count = STACK}, STACK) then s.done[#s.done + 1] = t
                else s.failed[#s.failed + 1] = t end
            end
        end
        out[#out + 1] = sample(run, t)
    end
    helpers.write_file(LOG, table.concat(out, "\n") .. "\n", true)
end

for index, run in ipairs(runs) do run.index = index end
local started = game.tick
tick_all(0)
local last_t = 0
script.on_nth_tick(1, function()
    local t = game.tick - started
    -- the handler's first call can fall in the probe's own tick (t 0, done above): each t runs once
    if t <= last_t then return end
    last_t = t
    tick_all(t)
    if t >= options.ticks then
        script.on_nth_tick(1, nil)
        for index, run in ipairs(runs) do
            -- the line lengths at the end: in the tick of the build the game still gives an entrance's tunnel line one tile
            for pi, piece in ipairs(run.pieces) do
                for li = 1, #piece.lines do info.copies[index].pieces[pi].lines[li] = math.floor(piece.entity.get_transport_line(li).line_length * 256 + 0.5) end
            end
            local streams = {}
            for _, s in ipairs(run.streams) do streams[#streams + 1] = {line = s.name, done = s.done, failed = s.failed} end
            info.copies[index].streams = streams
            info.copies[index].actions = run.actions
        end
        info.research_unchanged_at_end = research() == research_before
        helpers.write_file(INFO, helpers.table_to_json(info), false)
    end
end)
