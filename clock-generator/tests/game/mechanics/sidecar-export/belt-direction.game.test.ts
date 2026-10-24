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

/** The inserter ids of the scaffold's four output inserters in export order, with the way their belts run: both lines run west */
const EXPECTED_DIRECTIONS = "west,west,west,west";

test("Sidecar exports the way the belt runs where an inserter drops onto it", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-belt-direction-"));
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
local names = { [defines.direction.north] = "north", [defines.direction.east] = "east", [defines.direction.south] = "south", [defines.direction.west] = "west" }
local captured = extraction.extract_all_entities(entities, game.forces.player)
local report = {}
for _, inserter in ipairs(export.to_table(captured).inserters) do
    if inserter.sink.type == "belt" then table.insert(report, names[inserter.sink.belt_direction] or tostring(inserter.sink.belt_direction)) end
end
helpers.write_file("sidecar-belt-direction.txt", table.concat(report, ",") .. "\\n", false)
`,
        });
        expect(fs.readFileSync(path.join(scratch, "script-output", "sidecar-belt-direction.txt"), "utf8").trim()).toBe(EXPECTED_DIRECTIONS);
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
