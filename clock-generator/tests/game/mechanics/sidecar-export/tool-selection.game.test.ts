import { REPOSITORY_ROOT } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
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

// any scaffold: the builds of tool-selection-probe.lua stand on their own ground, away from it
const SCAFFOLD = ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY.replace(/\.json$/, ".scaffold");

const TICKS = 120;

interface CaseReport { name: string; mode: "select" | "alt_select"; belts: number; ends: string[] | Record<string, never> }

/**
 * The lane ends the export gives the one belt of each build of tool-selection-probe.lua, for a selection that the tool's
 * own filters make, in each selection mode
 */
const EXPECTED: Record<string, string[]> = {
    // the loader and its chest are in the selection, so the export sees that nothing in view limits the lanes
    "line-into-a-loader-into-a-chest-that-removes-everything": ["outlet", "outlet"],
    // a chest that fills up limits them, at a rate the export does not know
    "line-into-a-loader-into-a-chest-that-keeps-what-it-gets": ["unknown", "unknown"],
};

test("Sidecar exports a line that ends in a loader into a chest that removes everything as an outlet, from a selection of its tool", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    // TOOL_SELECTION_CAPTURE_DIR keeps the game's report there
    const retained = process.env.TOOL_SELECTION_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-tool-selection-"));
    fs.mkdirSync(scratch, { recursive: true });
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: TICKS + 10, warmup_ticks: 60, settle_ticks: 0,
            seed: [], drill_resource: "coal", unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
            work_dir: scratch,
            lua: captureModules + composeProbeSource(path.join(__dirname, "tool-selection-probe.lua"), { ticks: TICKS, output: "tool-selection.json" }),
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "script-output", "tool-selection.json"), "utf8")) as { cases: CaseReport[] };
        const read = report.cases.map(found => ({ name: found.name, mode: found.mode, belts: found.belts,
            ends: Array.isArray(found.ends) ? found.ends : [] })).sort((a, b) => `${a.name} ${a.mode}`.localeCompare(`${b.name} ${b.mode}`));
        const expected = Object.entries(EXPECTED).flatMap(([name, ends]) => (["alt_select", "select"] as const)
            .map(mode => ({ name, mode, belts: 1, ends }))).sort((a, b) => `${a.name} ${a.mode}`.localeCompare(`${b.name} ${b.mode}`));
        expect(read).toEqual(expected);
    } finally {
        if (!retained) fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
