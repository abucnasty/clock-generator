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

// the scaffold's entities, kept to the types of the tool's filters, exported as the Sidecar exports them
const EXPORT = `
local entities, surface = ...
local extraction = require("__clock-generator-sidecar__.scripts.extraction")
local export = require("__clock-generator-sidecar__.scripts.export")
local filters = {}
for type in pairs(prototypes.item["clock-generator-sidecar"].get_entity_type_filters(defines.selection_mode.select)) do filters[type] = true end
local selected = {}
for _, entity in pairs(entities) do if entity.valid and filters[entity.type] then table.insert(selected, entity) end end
helpers.write_file("sample-flow.json", helpers.table_to_json(export.to_table(extraction.extract_all_entities(selected, game.forces.player))), false)
`;

interface ExportedBelt { flow_direction?: number; lanes: { ingredient: string }[] }

/**
 * Builds of one copy whose belt turns between the piece an inserter picks up from and the run past the copies: the
 * pickup piece faces south and the belt then goes east into an underground entrance. Without a copy spacing the export
 * states no flow for that belt. `items`: the items of the belt's lanes.
 */
const SAMPLES: { name: string; scaffold: string; items: string[] }[] = [
    { name: "advanced circuit, coal", scaffold: path.join(path.dirname(ConfigPaths.ADVANCED_CIRCUIT_240), "advanced-circuit.scaffold"), items: ["coal", "coal"] },
    { name: "inserter crafting, one copy, circuits", scaffold: ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK.replace(/\.json$/, ".scaffold"),
        items: ["electronic-circuit", "electronic-circuit"] },
];

for (const sample of SAMPLES) {
    test(`Sidecar states no flow for a belt of one copy that turns past its pickup: ${sample.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH;
        const save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-sample-flow-"));
        try {
            await recordInFactorio({
                factorio: factorio!, save: save!,
                blueprint: fs.readFileSync(sample.scaffold, "utf8").trim(),
                out: path.join(scratch, "capture.json"), ticks: 60, warmup_ticks: 600, settle_ticks: 0,
                seed: [], unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
                work_dir: scratch, lua: captureModules + EXPORT,
            });
            const exported = JSON.parse(fs.readFileSync(path.join(scratch, "script-output", "sample-flow.json"), "utf8")) as { belts: ExportedBelt[] };
            const belts = exported.belts.filter(belt => belt.lanes.map(lane => lane.ingredient).join("|") === sample.items.join("|"));
            expect(belts.map(belt => belt.flow_direction ?? null)).toEqual([null]);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }, 600_000);
}
