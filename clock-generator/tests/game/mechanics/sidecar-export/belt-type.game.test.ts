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

const SCAFFOLD = path.join(path.dirname(ConfigPaths.REAL_OWNER_LITHIUM_SILO), "..", "grenade", "grenade-scaffold.txt");

/** Every case the lua chunk builds, with the belt type the export gives the line, written as `case: type` lines */
const EXPECTED_CASES: Record<string, string> = {
    "scaffold-belts": "turbo-transport-belt",
    "loader-built-first": "turbo-transport-belt",
    "slower-loader-built-first": "turbo-transport-belt",
    "loader-built-first-then-underground": "turbo-transport-belt",
    "loader-only-turbo": "turbo-transport-belt",
    "loader-only-basic": "transport-belt",
    "loader-only-fast": "fast-transport-belt",
    "loader-only-express": "express-transport-belt",
};

test("Sidecar exports the belt type of a line whose first piece is a loader as a transport belt", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-belt-type-"));
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

-- The scaffold: an infinity chest, a turbo loader and the belts the loader fills. The loader is built before the belts.
local loaders = 0
for _, entity in pairs(entities) do
    if entity.type == "loader" then loaders = loaders + 1 end
end
assert(loaders >= 1, "the scaffold has a loader")
local captured = extraction.extract_all_entities(entities, game.forces.player)
assert(#captured.belts >= 1, "the scaffold has a belt line")
for _, belt in ipairs(captured.belts) do
    assert(belt.belt_type == "turbo-transport-belt", "a belt line of the scaffold is " .. belt.belt_type)
end
note("scaffold-belts", captured.belts[1].belt_type)
-- the export as the Export button gives it: a type the Clock Generator's paste reads
for _, belt in ipairs(export.to_table(captured).belts) do
    assert(belt.type == "turbo-transport-belt", "the exported belt is " .. belt.type)
end

-- Small lines on their own ground, one every 100 tiles. Every piece carries a plate on lane 1, as a line with nothing on
-- it is not exported.
local N, E = defines.direction.north, defines.direction.east
local X, Y = 100, 400
local function make(name, x, direction, kind)
    local entity = assert(surface.create_entity{name = name, position = {x, Y}, direction = direction, type = kind, force = "player"})
    entity.get_transport_line(1).insert_at_back({name = "iron-plate", count = 1}, 1)
    return entity
end
local function line_type(name, pieces)
    local result = extraction.extract_all_entities(pieces, game.forces.player)
    assert(#result.belts == 1, name .. ": one belt line, got " .. #result.belts)
    note(name, result.belts[1].belt_type)
end

-- a loader built first, then belts: the loader has the lowest unit number
X = X + 100
do
    local loader = make("turbo-loader", X, E, "output")
    local a, b = make("turbo-transport-belt", X + 1, E), make("turbo-transport-belt", X + 2, E)
    assert(loader.unit_number < a.unit_number, "the loader is the first piece")
    line_type("loader-built-first", { loader, a, b })
end
-- a loader of a slower tier than the belts: the belts name the line
X = X + 100
do
    local loader = make("loader", X, E, "output")
    local a, b = make("turbo-transport-belt", X + 1, E), make("turbo-transport-belt", X + 2, E)
    line_type("slower-loader-built-first", { loader, a, b })
end
-- a loader, then an underground belt entrance and its exit
X = X + 100
do
    local loader = make("turbo-loader", X, E, "output")
    local entrance = make("turbo-underground-belt", X + 1, E, "input")
    local exit = make("turbo-underground-belt", X + 3, E, "output")
    line_type("loader-built-first-then-underground", { loader, entrance, exit })
end
-- a line of a loader only takes the belt of the loader's tier
for _, tier in ipairs{ {"turbo-loader", "loader-only-turbo"}, {"loader", "loader-only-basic"},
                       {"fast-loader", "loader-only-fast"}, {"express-loader", "loader-only-express"} } do
    X = X + 100
    line_type(tier[2], { make(tier[1], X, E, "output") })
end

helpers.write_file("sidecar-belt-type-cases.txt", table.concat(report, "\\n") .. "\\n", false)
`,
        });
        const report = fs.readFileSync(path.join(scratch, "script-output", "sidecar-belt-type-cases.txt"), "utf8")
            .trim().split("\n").map(line => line.split(": "));
        const read = Object.fromEntries(report.map(([name, text]) => [name, text]));
        for (const [name, expected] of Object.entries(EXPECTED_CASES)) {
            expect(read[name], name).toBeDefined();
            expect(read[name], name).toBe(expected);
        }
        expect(Object.keys(read).sort()).toEqual(Object.keys(EXPECTED_CASES).sort());
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
