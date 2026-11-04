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

// any scaffold: the cases below are built on their own ground, away from it
const SCAFFOLD = ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY.replace(/\.json$/, ".scaffold");

/**
 * Every case the lua chunk builds, with the item the export gives lane 1 and lane 2 of the one belt, written as `case: lane 1,lane 2`.
 * A belt of four pieces runs east: the first built carries iron on both lanes, the third (and the second) iron on lane 1 and copper
 * on lane 2, the fourth nothing.
 */
const EXPECTED_CASES: Record<string, string> = {
    // the inserter takes from the third piece: the lanes are what lies there, not what the first piece built carries
    "pickup-on-the-two-item-stretch": "iron-plate,copper-plate",
    // nothing picks up from the belt: the first piece that carries something on a lane names it, as before
    "no-pickup": "iron-plate,iron-plate",
    // the inserter takes from an empty piece: the lanes are read from the rest of the belt, as before
    "pickup-on-an-empty-piece": "iron-plate,iron-plate",
    // the first piece built is the one the inserter takes from, the later pieces carry other items: it still names the lanes
    "pickup-on-the-first-piece": "iron-plate,iron-plate",
};

test("Sidecar reads a belt lane's item where an inserter picks up, before the first piece built", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-belt-lane-reading-"));
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: 60, warmup_ticks: 3600, settle_ticks: 0,
            seed: [], drill_resource: "coal", unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
            work_dir: scratch,
            cache: false,
            lua: captureModules + `
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local report = {}

local E, N = defines.direction.east, defines.direction.north
local X, Y = 100, 400
-- four belt pieces running east, built in order. line 1 and line 2 are the two lanes; each is given what the case says
local function belt(x, lane_1, lane_2)
    local piece = assert(surface.create_entity{name = "transport-belt", position = {x + 0.5, Y + 0.5}, direction = E, force = "player"})
    if lane_1 then piece.get_transport_line(1).insert_at_back({name = lane_1, count = 1}) end
    if lane_2 then piece.get_transport_line(2).insert_at_back({name = lane_2, count = 1}) end
    return piece
end
-- an inserter south of piece number 'index' of the belt that takes from it (an inserter's direction is the side it picks up from);
-- a new inserter finds its targets on its first tick, so the pickup is set
local function inserter_at(x, index, piece)
    local inserter = assert(surface.create_entity{name = "inserter", position = {x + index - 1 + 0.5, Y + 1.5}, direction = N, force = "player"})
    inserter.pickup_target = piece
    assert(inserter.pickup_target and inserter.pickup_target.valid, "the inserter has a pickup target")
    return inserter
end
local function case(name, pieces, pickup_index, x)
    local selected = {}
    for _, piece in ipairs(pieces) do table.insert(selected, piece) end
    if pickup_index then
        local inserter = inserter_at(x, pickup_index, pieces[pickup_index])
        assert(inserter.pickup_target.unit_number == pieces[pickup_index].unit_number, name .. ": the inserter takes from the piece the case names")
        table.insert(selected, inserter)
    end
    local result = extraction.extract_all_entities(selected, game.forces.player)
    assert(#result.belts == 1, name .. ": one belt, got " .. #result.belts)
    local lanes = {}
    for _, lane in ipairs(result.belts[1].lanes) do table.insert(lanes, lane.ingredient) end
    table.insert(report, name .. ": " .. table.concat(lanes, ","))
end

local function four(x)
    local first = belt(x, "iron-plate", "iron-plate")
    local second = belt(x + 1, "iron-plate", "copper-plate")
    local third = belt(x + 2, "iron-plate", "copper-plate")
    local fourth = belt(x + 3)
    assert(first.unit_number < second.unit_number and second.unit_number < third.unit_number, "the pieces are built in order")
    return { first, second, third, fourth }
end

X = X + 100
case("pickup-on-the-two-item-stretch", four(X), 3, X)
X = X + 100
case("no-pickup", four(X), nil, X)
X = X + 100
case("pickup-on-an-empty-piece", four(X), 4, X)
-- the first piece built is where the inserter takes from; the pieces after it carry another item on lane 2
X = X + 100
case("pickup-on-the-first-piece", four(X), 1, X)

helpers.write_file("sidecar-belt-lane-reading-cases.txt", table.concat(report, "\\n") .. "\\n", false)
`,
        });
        const report = fs.readFileSync(path.join(scratch, "script-output", "sidecar-belt-lane-reading-cases.txt"), "utf8")
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
