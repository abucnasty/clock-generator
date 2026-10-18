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

-- Supply classifier checks only: these inserted stacks do not measure pickup timing.
local supply = require("__clock-generator-sidecar__.scripts.pickup-supply")
for index, entry in ipairs(directions) do
    local direction, dx, dy = entry[1], entry[2], entry[3]
    local x, y = 210 + index * 8, 160
    local target = belt("turbo-transport-belt", x, y, direction)
    local rear = belt("turbo-transport-belt", x - dx, y - dy, direction)
    local feed = belt("turbo-transport-belt", x - dy, y + dx, (direction + 12) % 16)
    assert(target.belt_shape == "straight")
    feed.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
    local view = supply.capture(target)
    assert(view and view.problem == nil)
    assert(view.profiles[1] == "through" and view.profiles[2] == "side-inner")
    assert(view.lanes[1].ingredient == nil and view.lanes[2].ingredient == "iron-plate")
    -- A rear stream and a side stream merging on the same receiving lane are unsupported.
    rear.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
    assert(supply.capture(target).problem == "merge")
    rear.get_transport_line(2).clear()
    -- Two lanes of one turbo side input form the supported merge, including distinct ingredients.
    feed.get_transport_line(1).insert_at_back({name = "copper-plate", count = 4}, 4)
    local two = supply.capture(target)
    assert(two.problem == nil and two.profiles == nil)
    assert(two.merge.lane == 2 and two.merge.outer.ingredient == "copper-plate" and two.merge.inner.ingredient == "iron-plate")
    assert(two.merge.downstream_tiles == 0 and two.merge.outlet == "closed")
    -- A third observed rear stream remains unsupported.
    rear.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
    assert(supply.capture(target).problem == "merge")
    rear.get_transport_line(2).clear()
    -- A partial incoming stack is not proof of the calibrated four-item stream.
    feed.get_transport_line(1).clear()
    feed.get_transport_line(1).insert_at_back({name = "copper-plate", count = 2}, 2)
    assert(supply.capture(target).problem == "merge")
end
local target = belt("turbo-transport-belt", 260, 160, defines.direction.east)
belt("turbo-transport-belt", 259, 160, defines.direction.east)
local feed = belt("turbo-transport-belt", 260, 161, defines.direction.north)
feed.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
assert(supply.capture(target).problem == nil)
-- A dry adjacent piece can still have an upstream stream. Retain that stream's item/lane mapping.
feed.get_transport_line(2).clear()
local upstream = belt("turbo-transport-belt", 260, 162, defines.direction.north)
upstream.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
local dry_front = supply.capture(target)
assert(dry_front.problem == nil and dry_front.profiles[2] == "side-inner")
assert(dry_front.lanes[2].ingredient == "iron-plate")
-- Empty does not mean unused: this unpowered feeder could populate the other incoming lane later.
local potential = assert(surface.create_entity{name = "stack-inserter", position = {261, 161},
    direction = defines.direction.east, force = "player"})
assert(math.abs(potential.drop_position.x - feed.position.x) < 0.5 and math.abs(potential.drop_position.y - feed.position.y) < 0.5, "empty feeder must target incoming lane")
assert(supply.capture(target).problem == "supply-unknown")
potential.destroy()
feed.destroy()
feed = belt("express-transport-belt", 260, 161, defines.direction.north)
feed.get_transport_line(2).insert_at_back({name = "iron-plate", count = 4}, 4)
assert(supply.capture(target).problem == "supply-unknown")
`,
        });
        expect(result.recording.inserters.some(inserter => inserter.source.pickup_length === 1)).toBe(true);
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 240_000);
