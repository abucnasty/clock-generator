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
local function belt(name, x, y, direction)
    return assert(surface.create_entity{name = name, position = {x, y}, direction = direction, force = "player"})
end
local straight = belt("turbo-transport-belt", 100, 100, defines.direction.east)
assert(h.get_pickup_problem({position = {x = 100, y = 99}}, straight) == nil)
assert(h.get_pickup_length({position = {x = 100, y = 99}}, straight) == 1)
assert(h.get_pickup_problem({position = {x = straight.position.x - 1, y = straight.position.y}}, straight) == "inline")
local splitter = belt("turbo-splitter", 110, 100, defines.direction.east)
assert(h.get_pickup_problem({position = {x = 110, y = 99}}, splitter) == "splitter")
assert(h.get_pickup_length({position = {x = 110, y = 99}}, splitter) == nil)
belt("turbo-transport-belt", 100, 101, defines.direction.north)
assert(straight.belt_shape ~= "straight", "fixture must form a bend")
assert(h.get_pickup_problem({position = {x = 100, y = 99}}, straight) == "bend")
assert(h.get_pickup_length({position = {x = 100, y = 99}}, straight) == nil)

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
