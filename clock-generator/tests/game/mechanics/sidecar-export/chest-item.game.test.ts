import { REPOSITORY_ROOT } from "../../helpers/fixture-paths";
import { ConfigPaths } from "../../../../src/config/config-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";

// Factorio permits require only while parsing control.lua. Load the same Sidecar sources into test-local closures.
const modules = ["types", "helpers", "pickup-supply", "drop-merge", "suggested-target", "extraction", "export"];
const captureModules = `local capture_modules, require = {}, nil
require = function(name) return assert(capture_modules[name], name) end
` + modules.map(name => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, `clock-generator-sidecar/scripts/${name}.lua`), "utf8");
    return `capture_modules["__clock-generator-sidecar__.scripts.${name}"] = (function()\n${source}\nend)() or true\n`;
}).join("");

// any small build will do: the cases are built on their own ground
const SCAFFOLD = path.join(path.dirname(ConfigPaths.REAL_OWNER_LITHIUM_SILO), "lithium-silo-scaffold.txt");

/** Every case the lua chunk builds, with what the export gives for its chests, written as `case: result` lines */
const EXPECTED_CASES: Record<string, string> = {
    "product-meets-ingredient": "advanced-circuit",
    "inserter-filter-in": "iron-plate",
    "inserter-filter-out": "copper-plate",
    "drill-into-chest": "iron-ore",
    "two-chests-in-a-row": "advanced-circuit, advanced-circuit",
    "storage-chest": "advanced-circuit",
    "blacklist-is-ignored": "advanced-circuit",
    "sources-disagree": "left out",
    "no-inserter-touches-it": "left out",
    "several-items-left": "left out",
    "chest-with-an-item-keeps-it": "copper-plate",
    "inserter-left-out-names-the-chest": "ok",
};

test("Sidecar exports an empty buffer chest with the item the inserters and drills around it move", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-chest-item-"));
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: 60, warmup_ticks: 3600, settle_ticks: 0,
            seed: [], drill_resource: "coal", unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
            work_dir: scratch,
            lua: captureModules + `
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")
local report = {}
local function note(case, text) table.insert(report, case .. ": " .. text) end
local E, W = defines.direction.east, defines.direction.west

-- One row of a case, a tile at a time from the left: an endpoint (a machine of 3 tiles, a chest or a drill's chest of 1) then an
-- inserter, an endpoint, ... Every inserter moves items east (it faces west, as an inserter faces where it picks up) and is wired to the endpoints on either side of it.
local Y = 600
local function build(spec)
    Y = Y + 10
    local x = 100
    local made, list = {}, {}
    for _, item in ipairs(spec) do
        local entity
        if item.machine then
            entity = assert(surface.create_entity{name = item.entity or "assembling-machine-3", position = {x + 1.5, Y + 0.5}, force = "player"})
            entity.set_recipe(item.machine)
            x = x + 3
        elseif item.chest then
            entity = assert(surface.create_entity{name = item.chest, position = {x + 0.5, Y + 0.5}, force = "player"})
            if item.holds then entity.insert{name = item.holds, count = 1} end
            x = x + 1
        elseif item.sink then
            entity = assert(surface.create_entity{name = "infinity-chest", position = {x + 0.5, Y + 0.5}, force = "player"})
            x = x + 1
        elseif item.inserter then
            entity = assert(surface.create_entity{name = item.inserter, position = {x + 0.5, Y + 0.5}, direction = W, force = "player"})
            if item.whitelist or item.blacklist then
                assert(entity.filter_slot_count > 0, item.inserter .. " has filter slots")
                for i, name in ipairs(item.whitelist or item.blacklist) do entity.set_filter(i, name) end
                entity.use_filters = true
                entity.inserter_filter_mode = item.whitelist and "whitelist" or "blacklist"
            end
            x = x + 1
        end
        table.insert(made, entity)
        table.insert(list, entity)
    end
    for i, item in ipairs(spec) do
        if item.inserter then
            made[i].pickup_target = made[i - 1]
            made[i].drop_target = made[i + 1]
        end
    end
    return made, list
end
local function chest_items(result)
    local items = {}
    for _, chest in ipairs(result.chests) do
        if chest.chest_type == "buffer-chest" then table.insert(items, chest.item_filter) end
    end
    return items
end
local function run(name, spec, expected)
    local made, list = build(spec)
    local result = extraction.extract_all_entities(list, game.forces.player)
    local items = chest_items(result)
    local got = #items == 0 and "left out" or table.concat(items, ", ")
    local diag = ""
    for _, ins in ipairs(result.inserters) do diag = diag .. " [ins src=" .. tostring(ins.source and ins.source.type) .. " sink=" .. tostring(ins.sink and ins.sink.type) .. " f=" .. #ins.filters .. "]" end
    diag = diag .. " machines=" .. #result.machines .. " chests=" .. #result.chests
    assert(got == expected, name .. ": expected " .. expected .. ", got " .. got .. diag)
    note(name, got)
    return result, made
end

run("product-meets-ingredient", {
    {machine = "advanced-circuit"}, {inserter = "stack-inserter"}, {chest = "steel-chest"},
    {inserter = "stack-inserter"}, {machine = "processing-unit"} }, "advanced-circuit")

run("inserter-filter-in", {
    {sink = true}, {inserter = "fast-inserter", whitelist = {"iron-plate"}}, {chest = "steel-chest"} }, "iron-plate")

run("inserter-filter-out", {
    {chest = "steel-chest"}, {inserter = "fast-inserter", whitelist = {"copper-plate"}}, {sink = true} }, "copper-plate")

do -- a drill mining iron ore, dropping into the chest at its drop position
    Y = Y + 10
    for dx = -3, 3 do for dy = -3, 3 do
        surface.create_entity{name = "iron-ore", position = {100.5 + dx, Y + 0.5 + dy}, amount = 1000}
    end end
    local drill = assert(surface.create_entity{name = "electric-mining-drill", position = {100.5, Y + 0.5}, direction = E, force = "player"})
    local drop = drill.drop_position
    local chest = assert(surface.create_entity{name = "steel-chest", position = {math.floor(drop.x) + 0.5, math.floor(drop.y) + 0.5}, force = "player"})
    local result = extraction.extract_all_entities({drill, chest}, game.forces.player)
    local items = chest_items(result)
    assert(#items == 1 and items[1] == "iron-ore", "drill-into-chest: " .. table.concat(items, ", "))
    note("drill-into-chest", items[1])
end

run("two-chests-in-a-row", {
    {machine = "advanced-circuit"}, {inserter = "stack-inserter"}, {chest = "steel-chest"},
    {inserter = "stack-inserter"}, {chest = "steel-chest"},
    {inserter = "stack-inserter"}, {machine = "processing-unit"} }, "advanced-circuit, advanced-circuit")

run("storage-chest", {
    {machine = "advanced-circuit"}, {inserter = "stack-inserter"}, {chest = "storage-chest"},
    {inserter = "stack-inserter"}, {machine = "processing-unit"} }, "advanced-circuit")

run("blacklist-is-ignored", {
    {machine = "advanced-circuit"}, {inserter = "fast-inserter", blacklist = {"iron-plate"}}, {chest = "steel-chest"} }, "advanced-circuit")

run("sources-disagree", {
    {machine = "advanced-circuit"}, {inserter = "stack-inserter"}, {chest = "steel-chest"},
    {inserter = "fast-inserter", whitelist = {"copper-plate"}}, {sink = true} }, "left out")

run("no-inserter-touches-it", { {chest = "steel-chest"} }, "left out")

-- a machine that makes two items into a chest nothing takes from: both are left, so the chest is left out
run("several-items-left", {
    {machine = "uranium-processing", entity = "centrifuge"}, {inserter = "stack-inserter"}, {chest = "steel-chest"} }, "left out")

-- a chest that holds something keeps it, whatever the inserters around it say
run("chest-with-an-item-keeps-it", {
    {machine = "advanced-circuit"}, {inserter = "stack-inserter"}, {chest = "steel-chest", holds = "copper-plate"} }, "copper-plate")

-- the inserter that touches a chest left out is listed as left out, with a chest as the end
do
    local result = run("sources-disagree-listed", {
        {machine = "advanced-circuit"}, {inserter = "stack-inserter"}, {chest = "steel-chest"},
        {inserter = "fast-inserter", whitelist = {"copper-plate"}}, {sink = true} }, "left out")
    local left_out = export.left_out_inserters(result, nil)
    assert(#left_out >= 1, "an inserter is left out")
    for _, left in ipairs(left_out) do assert(left.target and left.target.type == "chest", "the end left out is a chest") end
    note("inserter-left-out-names-the-chest", "ok")
end

helpers.write_file("sidecar-chest-item-cases.txt", table.concat(report, "\\n") .. "\\n", false)
`,
        });
        const report = fs.readFileSync(path.join(scratch, "script-output", "sidecar-chest-item-cases.txt"), "utf8")
            .trim().split("\n").map(line => line.split(": "));
        const read = Object.fromEntries(report.map(([name, text]) => [name, text]));
        for (const [name, expected] of Object.entries(EXPECTED_CASES)) {
            expect(read[name], name).toBeDefined();
            expect(read[name], name).toBe(expected);
        }
        expect(Object.keys(read).filter(name => name in EXPECTED_CASES).sort()).toEqual(Object.keys(EXPECTED_CASES).sort());
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
