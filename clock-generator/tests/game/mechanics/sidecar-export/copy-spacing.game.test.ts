import { REPOSITORY_ROOT } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { TargetProductionRateConfigSchema } from "../../../../src/config/schema";
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

// any scaffold: the builds of copy-spacing-probe.lua stand on their own ground, away from it
const SCAFFOLD = ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY.replace(/\.json$/, ".scaffold");

const TICKS = 120;

/** Lua writes false for a missing suggested target */
interface CaseReport { name: string; suggested_target: false | Record<string, unknown>; setpoint: boolean; inserters: number;
    flows: (number | "none")[] | Record<string, never> }

/**
 * The copy spacing each build of copy-spacing-probe.lua exports in its suggested target: where the next copy stands from
 * a copy, read downstream along the belt line; none where the build does not show copies at one spacing; "no target"
 * where the build has no machine, so no suggested target. `inserters`: the inserters the build exports.
 *
 * `flows`: the flow_direction of each exported belt (0 north, 4 east, 8 south, 12 west), the way its items pass the
 * copies: with a copy spacing, its direction; without one, the direction of the piece each inserter picks up from where
 * the line does not turn after it, none where it turns or where the pickups give different directions.
 */
type Flow = number | "none";
const EXPECTED: Record<string, { copy_offset: { x: number; y: number } | null | "no target"; inserters: number; flows: Flow[] }> = {
    "two-copies-4-apart": { copy_offset: { x: 4, y: 0 }, inserters: 2, flows: [4] },
    "three-copies-6-apart": { copy_offset: { x: 6, y: 0 }, inserters: 3, flows: [4] },
    // a copy of two inserters into one assembler: each inserter has its like in the next copy
    "three-copies-of-two-inserters-7-apart": { copy_offset: { x: 7, y: 0 }, inserters: 6, flows: [4] },
    "two-copies-5-apart-on-a-belt-running-south": { copy_offset: { x: 0, y: 5 }, inserters: 2, flows: [8] },
    // the next copy is the one downstream
    "two-copies-4-apart-on-a-belt-running-west": { copy_offset: { x: -4, y: 0 }, inserters: 2, flows: [12] },
    // no one step moves each copy onto the next
    "three-copies-unevenly-apart": { copy_offset: null, inserters: 3, flows: [4] },
    // the second copy is not the first one moved along the belt
    "two-copies-mirrored": { copy_offset: null, inserters: 2, flows: [4] },
    "one-copy": { copy_offset: null, inserters: 1, flows: [4] },
    // the copies do not all have every inserter
    "two-copies-and-a-part-copy": { copy_offset: null, inserters: 5, flows: [4] },
    "two-copies-into-chests": { copy_offset: "no target", inserters: 2, flows: [4] },
    // every belt that two or more inserters take from gives the step
    "two-copies-4-apart-on-two-belts": { copy_offset: { x: 4, y: 0 }, inserters: 4, flows: [4] },
    // the belts give no one step
    "two-belts-whose-spacings-differ": { copy_offset: null, inserters: 4, flows: [4] },
    // each belt gives the step to the copy downstream, and those are opposite
    "two-copies-on-belts-running-opposite-ways": { copy_offset: null, inserters: 4, flows: ["none"] },
    // the inserter on the second belt has none alike at the step: the two assemblers are one copy
    "two-assemblers-alike-and-an-inserter-unlike-on-a-second-belt": { copy_offset: null, inserters: 3, flows: [4] },
    // the pickup pieces face south across a run that goes east, and the items pass the copies eastward
    "three-copies-on-stubs-across-a-run-going-east": { copy_offset: { x: 6, y: 0 }, inserters: 3, flows: [4] },
    "three-copies-on-stubs-across-a-run-going-west": { copy_offset: { x: -6, y: 0 }, inserters: 3, flows: [12] },
    // no copy spacing, and each line turns after its pickup piece
    "three-copies-unevenly-apart-on-stubs": { copy_offset: null, inserters: 3, flows: ["none"] },
    "one-copy-on-a-line-that-turns": { copy_offset: null, inserters: 1, flows: ["none"] },
};

test("Sidecar exports where the next copy stands and the way the items pass the copies, from the inserters along a belt line", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    // COPY_SPACING_CAPTURE_DIR keeps the game's report there
    const retained = process.env.COPY_SPACING_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-copy-spacing-"));
    fs.mkdirSync(scratch, { recursive: true });
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: TICKS + 10, warmup_ticks: 60, settle_ticks: 0,
            seed: [], drill_resource: "coal", unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
            work_dir: scratch,
            lua: captureModules + composeProbeSource(path.join(__dirname, "copy-spacing-probe.lua"), { ticks: TICKS, output: "copy-spacing.json" }),
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "script-output", "copy-spacing.json"), "utf8")) as { cases: CaseReport[] };
        const read = Object.fromEntries(report.cases.map(found => [found.name, found]));
        expect(Object.keys(read).sort()).toEqual(Object.keys(EXPECTED).sort());
        for (const [name, expected] of Object.entries(EXPECTED)) {
            const found = read[name];
            // a paste refuses an export with a setpoint as a build file of the site
            expect({ name, setpoint: found.setpoint, inserters: found.inserters }).toEqual({ name, setpoint: false, inserters: expected.inserters });
            expect({ name, flows: Array.isArray(found.flows) ? found.flows : [] }).toEqual({ name, flows: expected.flows });
            if (expected.copy_offset === "no target") {
                expect({ name, suggested_target: found.suggested_target }).toEqual({ name, suggested_target: false });
                continue;
            }
            const target = found.suggested_target;
            expect(target, name).not.toBe(false);
            expect(TargetProductionRateConfigSchema.safeParse(target).success, name).toBe(true);
            expect({ name, recipe: (target as Record<string, unknown>).recipe, copies: (target as Record<string, unknown>).copies,
                copy_offset: (target as Record<string, unknown>).copy_offset ?? null })
                .toEqual({ name, recipe: "iron-gear-wheel", copies: 1, copy_offset: expected.copy_offset });
        }
    } finally {
        if (!retained) fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
