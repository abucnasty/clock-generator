import { GameFixturePaths, REPOSITORY_ROOT } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";

// Factorio permits require only while parsing control.lua. Load the same Sidecar sources into test-local closures.
const modules = ["types", "helpers", "suggested-target", "extraction", "export"];
const captureModules = `local capture_modules, require = {}, nil
require = function(name) return assert(capture_modules[name], name) end
` + modules.map(name => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, `clock-generator-sidecar/scripts/${name}.lua`), "utf8");
    return `capture_modules["__clock-generator-sidecar__.scripts.${name}"] = (function()\n${source}\nend)() or true\n`;
}).join("");

test("Sidecar classifies supported pickups and explains unclassified captures", async context => {
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
            assert(h.get_pickup_problem(front, target) == nil)
            -- Side pickups keep their physical nearest lane regardless of endpoint or mirroring.
            assert(h.get_near_lane({position = {x = target.position.x + dy, y = target.position.y - dx}, mirroring = mirrored}, target) == 1)
            assert(h.get_near_lane({position = {x = target.position.x - dy, y = target.position.y + dx}, mirroring = mirrored}, target) == 2)
            unclassified({position = {x = target.position.x - dx, y = target.position.y - dy},
                direction = direction, mirroring = mirrored}, target)
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
assert(input and input.source.pickup_length == 1)
-- Exercise the export boundary with an unclassified capture: geometry must stay absent and IDs match the JSON.
input.inserter.source.pickup_length = nil
input.inserter.source.pickup_problem = "bend"
local unknown = export.to_table(captured)
assert(#unknown.pickup_warnings == 1)
assert(unknown.pickup_warnings[1].inserter_id == input.id)
assert(unknown.pickup_warnings[1].reason == "bend")
assert(unknown.inserters[input.id].source.pickup_length == nil)
assert(unknown.inserters[input.id].source.pickup_problem == nil)
`,
        });
        expect(result.recording.inserters.some(inserter => inserter.source.pickup_length === 1)).toBe(true);
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 240_000);
