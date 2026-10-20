import { GameFixturePaths, REPOSITORY_ROOT } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";

// Factorio permits require only while parsing control.lua. Load the same Sidecar sources into test-local closures.
const modules = ["types", "helpers", "pickup-supply", "suggested-target", "extraction", "export"];
const captureModules = `local capture_modules, require = {}, nil
require = function(name) return assert(capture_modules[name], name) end
` + modules.map(name => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, `clock-generator-sidecar/scripts/${name}.lua`), "utf8");
    return `capture_modules["__clock-generator-sidecar__.scripts.${name}"] = (function()\n${source}\nend)() or true\n`;
}).join("");

test("Sidecar classifies supported pickups, explains unclassified captures and exports inserter identity", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pickup-capture-"));
    try {
        const result = await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(path.join(GameFixturePaths.DIFFERENT_ITEMS, "straight-belt-scaffold.txt"), "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: 60, warmup_ticks: 600, settle_ticks: 0,
            seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 180, log() {},
            lua: captureModules + `
local entities, surface = ...
local h = require("__clock-generator-sidecar__.scripts.helpers")
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")
local function belt(name, x, y, direction, endpoint)
    return assert(surface.create_entity{name = name, position = {x, y}, direction = direction, type = endpoint, force = "player"})
end
local straight = belt("turbo-transport-belt", 100, 100, defines.direction.east)
assert(h.get_pickup_problem({position = {x = 100, y = 99}}, straight) == nil)
assert(h.get_pickup_length({position = {x = 100, y = 99}}, straight) == 1)
assert(h.get_pickup_layout({position = {x = 100, y = 99}}, straight) == "side-straight")
assert(h.get_pickup_problem({position = {x = straight.position.x - 1, y = straight.position.y}}, straight) == "inline")
assert(h.get_pickup_problem({position = {x = straight.position.x + 1, y = straight.position.y},
    direction = defines.direction.west, mirroring = true}, straight) == "inline")
local splitter = belt("turbo-splitter", 110, 100, defines.direction.east)
assert(h.get_pickup_problem({position = {x = 110, y = 99}}, splitter) == "splitter")
assert(h.get_pickup_length({position = {x = 110, y = 99}}, splitter) == nil)
belt("turbo-transport-belt", 100, 101, defines.direction.north)
assert(straight.belt_shape ~= "straight", "fixture must form a bend")
assert(h.get_pickup_problem({position = {x = 100, y = 99}}, straight) == "bend")
assert(h.get_pickup_length({position = {x = 100, y = 99}}, straight) == nil)

-- Classifier rotation checks, not additional measurements of actual grabs in these orientations.
local directions = {
    {defines.direction.north, 0, -1}, {defines.direction.east, 1, 0},
    {defines.direction.south, 0, 1}, {defines.direction.west, -1, 0}
}
local function unclassified(input, target)
    assert(h.get_near_lane(input, target) == nil)
    assert(h.get_pickup_length(input, target) == nil)
    assert(h.get_pickup_problem(input, target) == "inline")
end
for index, entry in ipairs(directions) do
    local direction, dx, dy = entry[1], entry[2], entry[3]
    local exit = belt("turbo-underground-belt", 130 + index * 6, 100, direction, "output")
    local entrance = belt("turbo-underground-belt", 130 + index * 6, 120, direction, "input")
    for _, mirrored in ipairs{false, true} do
        for _, target in ipairs{exit, entrance} do
            local front = {position = {x = target.position.x + dx, y = target.position.y + dy},
                direction = (direction + 8) % 16, mirroring = mirrored}
            assert(h.get_near_lane(front, target) == (mirrored and 2 or 1))
            assert(h.get_pickup_length(front, target) == 0.5)
            local endpoint = target.belt_to_ground_type == "input" and "entrance" or "exit"
            assert(h.get_pickup_layout(front, target) == "front-" .. endpoint)
            assert(h.get_pickup_layout({position = {x = target.position.x + dy, y = target.position.y - dx}}, target) == "side-" .. endpoint)
            assert(h.get_pickup_layout({position = {x = target.position.x - dy, y = target.position.y + dx}}, target) == "side-" .. endpoint)
            assert(h.get_pickup_problem(front, target) == nil)
            -- Side pickups keep their physical nearest lane regardless of endpoint or mirroring.
            assert(h.get_near_lane({position = {x = target.position.x + dy, y = target.position.y - dx}, mirroring = mirrored}, target) == 1)
            assert(h.get_near_lane({position = {x = target.position.x - dy, y = target.position.y + dx}, mirroring = mirrored}, target) == 2)
            local upstream = {position = {x = target.position.x - dx, y = target.position.y - dy},
                direction = direction, mirroring = mirrored}
            if endpoint == "exit" then
                assert(h.get_near_lane(upstream, target) == (mirrored and 2 or 1))
                assert(h.get_pickup_layout(upstream, target) == "over-hood-exit")
                assert(h.get_pickup_length(upstream, target) == 0.5 and h.get_pickup_problem(upstream, target) == nil)
                unclassified({position = upstream.position, direction = (direction + 8) % 16, mirroring = mirrored}, target)
                unclassified({position = {x = upstream.position.x + dy * 0.125, y = upstream.position.y - dx * 0.125},
                    direction = direction, mirroring = mirrored}, target)
            else
                unclassified(upstream, target)
            end
            unclassified({position = front.position, direction = direction, mirroring = mirrored}, target)
            unclassified({position = {x = front.position.x + dy * 0.125, y = front.position.y - dx * 0.125},
                direction = front.direction, mirroring = mirrored}, target)
        end
    end
end

local captured = extraction.extract_all_entities(entities, game.forces.player)
local supported = export.to_table(captured)
assert(supported.pickup_warnings == nil)
local input
for _, entry in ipairs(export.exported_inserters(captured)) do
    if entry.source.type == "belt" then input = entry end
end
assert(input and input.source.pickup_length == 1 and input.source.pickup_layout == "side-straight")
assert(supported.inserters[input.id].source.pickup_layout == "side-straight")
local provenance = supported.inserters[input.id].source.pickup_capture
assert(provenance.status == "supported" and provenance.model == "belt" and provenance.model_version == 2)
assert(provenance.entity_type == "transport-belt" and provenance.sidecar_version == script.active_mods["clock-generator-sidecar"])
-- Exercise the export boundary with an unclassified capture: geometry must stay absent and IDs match the JSON.
input.inserter.source.pickup_length = nil
input.inserter.source.pickup_problem = "bend"
local unknown = export.to_table(captured)
assert(#unknown.pickup_warnings == 1)
assert(unknown.pickup_warnings[1].inserter_id == input.id)
assert(unknown.pickup_warnings[1].reason == "bend")
assert(unknown.inserters[input.id].source.pickup_length == nil)
assert(unknown.inserters[input.id].source.pickup_problem == nil)
assert(unknown.inserters[input.id].source.pickup_capture.status == "unsupported")
assert(unknown.inserters[input.id].source.pickup_capture.reason == "bend")
assert(unknown.inserters[input.id].source.pickup_capture.entity_type == "transport-belt")
assert(unknown.inserters[input.id].source.pickup_capture.model == nil)

-- Side-loading checks only: these inserted stacks do not measure pickup timing. Picking up from a belt tile that
-- another belt side-loads onto, as one stream or two merging, is out of scope, as splitters are.
local supply = require("__clock-generator-sidecar__.scripts.pickup-supply")
for index, entry in ipairs(directions) do
    local direction, dx, dy = entry[1], entry[2], entry[3]
    local x, y = 210 + index * 8, 160
    local target = belt("turbo-transport-belt", x, y, direction)
    local rear = belt("turbo-transport-belt", x - dx, y - dy, direction)
    -- A belt that runs straight onto the pickup tile is ordinary supply, with or without items on it.
    assert(target.belt_shape == "straight")
    assert(supply.problem(target) == nil)
    rear.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
    assert(supply.problem(target) == nil)
    -- A belt that side-loads onto the tile is out of scope, whether or not it carries anything yet.
    local feed = belt("turbo-transport-belt", x - dy, y + dx, (direction + 12) % 16)
    assert(target.belt_shape == "straight", "the rear input must keep the tile straight")
    assert(supply.problem(target) == "side-loaded")
    feed.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
    assert(supply.problem(target) == "side-loaded")
    -- Two streams merging from both sides, with no rear input, are side-loading too.
    local other = belt("turbo-transport-belt", x + dy, y - dx, (direction + 4) % 16)
    rear.destroy()
    assert(target.belt_shape == "straight", "a T-junction must keep the tile straight")
    assert(supply.problem(target) == "side-loaded")
    other.get_transport_line(1).insert_at_back({name = "copper-plate", count = 4}, 4)
    assert(supply.problem(target) == "side-loaded")
    -- An underground entrance that a belt side-loads onto is out of scope as well.
    local entrance = belt("turbo-underground-belt", x, y + 10, direction, "input")
    belt("turbo-transport-belt", x - dx, y + 10 - dy, direction)
    assert(supply.problem(entrance) == nil)
    belt("turbo-transport-belt", x - dy, y + 10 + dx, (direction + 12) % 16)
    assert(supply.problem(entrance) == "side-loaded")
end

-- Exercise extraction and export with a side-loaded pickup: it is refused with a warning, never a plain belt pickup.
local tile = belt("turbo-transport-belt", 260, 160, defines.direction.east)
local behind = belt("turbo-transport-belt", 259, 160, defines.direction.east)
local side = belt("turbo-transport-belt", 260, 161, defines.direction.north)
assert(tile.belt_shape == "straight")
behind.get_transport_line(1).insert_at_back({name = "iron-plate", count = 4}, 4)
side.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
local picker = assert(surface.create_entity{name = "stack-inserter", position = {260, 159},
    direction = defines.direction.south, force = "player"})
local disposal = assert(surface.create_entity{name = "infinity-chest", position = {260, 158}, force = "player"})
-- A newly built inserter may know what it picks up from and drops into only after its first tick.
picker.pickup_target = tile
picker.drop_target = disposal
assert(picker.pickup_target == tile and picker.drop_target == disposal)
local side_loaded = extraction.extract_all_entities({tile, behind, side, picker, disposal}, game.forces.player)
local refused = export.to_table(side_loaded)
local taken
for _, entry in ipairs(export.exported_inserters(side_loaded)) do
    if entry.inserter.entity == picker then taken = entry end
end
assert(taken, "a side-loaded pickup must stay in the JSON")
local source = refused.inserters[taken.id].source
-- The geometry is captured as for any straight belt: only the supply is out of scope.
assert(source.pickup_length == 1 and source.pickup_layout == "side-straight")
assert(source.pickup_capture.status == "unsupported" and source.pickup_capture.reason == "side-loaded")
assert(source.pickup_capture.entity_type == "transport-belt")
assert(source.pickup_capture.model == nil and source.pickup_capture.model_version == nil)
assert(source.pickup_supply == nil and source.pickup_merge == nil)
assert(#refused.pickup_warnings == 1)
assert(refused.pickup_warnings[1].inserter_id == taken.id and refused.pickup_warnings[1].reason == "side-loaded")
local json = helpers.table_to_json(refused)
assert(not json:find("pickup_supply", 1, true) and not json:find("pickup_merge", 1, true))
assert(refused.inserters[taken.id].prototype == "stack-inserter")
assert(refused.inserters[taken.id].quality == "normal", "a stack inserter built without a quality is normal")

-- Inserter identity and filter mode: capture checks only, these inserters measure no timing. Every inserter is exported
-- with its prototype and quality; filters switched off are not exported, and a blacklist is marked so it is refused.
local function capture_one(index, name, quality, setup)
    local x = 300 + index * 4
    local tile = belt("turbo-transport-belt", x, 200, defines.direction.east)
    tile.get_transport_line(1).insert_at_back({name = "iron-plate", count = 4}, 4)
    local inserter = assert(surface.create_entity{name = name, quality = quality, position = {x, 199},
        direction = defines.direction.south, force = "player"})
    local chest = assert(surface.create_entity{name = "infinity-chest", position = {x, 198}, force = "player"})
    inserter.pickup_target = tile
    inserter.drop_target = chest
    assert(inserter.pickup_target == tile and inserter.drop_target == chest)
    if setup then setup(inserter) end
    local exported = export.to_table(extraction.extract_all_entities({tile, inserter, chest}, game.forces.player))
    assert(#exported.inserters == 1, name .. " must stay in the JSON")
    return exported.inserters[1], helpers.table_to_json(exported)
end
local fast = capture_one(1, "fast-inserter", "normal")
assert(fast.prototype == "fast-inserter" and fast.quality == "normal")
assert(fast.source.type == "belt" and fast.source.pickup_capture.status == "supported")
assert(fast.filters == nil and fast.filter_mode == nil)
local rare = capture_one(2, "stack-inserter", "rare")
assert(rare.prototype == "stack-inserter" and rare.quality == "rare")
local stack = capture_one(3, "stack-inserter", "legendary")
assert(stack.prototype == "stack-inserter" and stack.quality == "legendary")
local blacklist, blacklist_json = capture_one(4, "stack-inserter", "legendary", function(inserter)
    inserter.use_filters = true
    inserter.set_filter(1, "copper-plate")
    inserter.inserter_filter_mode = "blacklist"
end)
assert(#blacklist.filters == 1 and blacklist.filters[1] == "copper-plate" and blacklist.filter_mode == "blacklist")
assert(blacklist_json:find('"filter_mode":"blacklist"', 1, true))
local whitelist = capture_one(5, "bulk-inserter", "epic", function(inserter)
    inserter.use_filters = true
    inserter.set_filter(1, "iron-plate")
    inserter.inserter_filter_mode = "whitelist"
end)
assert(whitelist.prototype == "bulk-inserter" and whitelist.quality == "epic")
assert(#whitelist.filters == 1 and whitelist.filters[1] == "iron-plate" and whitelist.filter_mode == nil)
local switched_off, switched_off_json = capture_one(6, "stack-inserter", "legendary", function(inserter)
    inserter.use_filters = true
    inserter.set_filter(1, "copper-plate")
    inserter.inserter_filter_mode = "blacklist"
    inserter.use_filters = false
    assert(inserter.get_filter(1) ~= nil, "the filter stays set while it is switched off")
end)
assert(switched_off.filters == nil and switched_off.filter_mode == nil)
assert(not switched_off_json:find("copper-plate", 1, true))
`,
        });
        expect(result.recording.inserters.some(inserter => inserter.source.pickup_length === 1)).toBe(true);
        // the scaffold is built of legendary stack inserters, and the recorder exports them as the Sidecar does
        expect(result.recording.config.inserters.map(({ prototype, quality }) => ({ prototype, quality })))
            .toEqual(result.recording.config.inserters.map(() => ({ prototype: "stack-inserter", quality: "legendary" })));
        expect(result.recording.config.inserters.length).toBeGreaterThan(0);
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 240_000);
