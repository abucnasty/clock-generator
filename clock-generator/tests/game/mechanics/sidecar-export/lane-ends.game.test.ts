import { REPOSITORY_ROOT } from "../../helpers/fixture-paths";
import { composeProbeSource } from "../../helpers/probe-source";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { BeltConfigSchema } from "../../../../src/config/schema";
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

// any scaffold: the builds of lane-ends-probe.lua stand on their own ground, away from it
const SCAFFOLD = ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY.replace(/\.json$/, ".scaffold");

const TICKS = 600;
const LANE_ITEMS = ["iron-plate", "copper-plate"] as const;

type End = "dead_end" | "infinite" | "unknown";
interface ExportedLane { ingredient: string; lane_end?: Record<string, unknown>; consumption_per_second?: number }
interface ExportedBelt { id: number; type: string; flow_direction?: number; lanes: ExportedLane[] }
/** Lua writes an empty table as {} */
interface CaseReport { name: string; belts: ExportedBelt[] | Record<string, never>; other_items?: (string[] | Record<string, never>)[] }

/**
 * What the export gives each build of lane-ends-probe.lua for the one belt it has: the end of lane 1 (iron plates) and
 * lane 2 (copper plates), none where the belt states no end, and the way its items move (0 north, 4 east, 8 south,
 * none where it states none). `flows`: for a line that side-loads into an underground piece of a belt that has nothing
 * behind it, the lane whose items reach that belt in the game; the other lane is the one the hood blocks.
 */
const EXPECTED: Record<string, { ends: [End, End] | null; flow_direction: number | null; flows?: 1 | 2 }> = {
    // nothing after the line's last piece: the items stay on both lanes
    "dead-end": { ends: ["dead_end", "dead_end"], flow_direction: 4 },
    // the line goes on beyond the selection: the export does not see its end
    "runs-past-the-selection": { ends: ["unknown", "unknown"], flow_direction: 4 },
    // a loader as fast as the belt into an infinity chest that removes everything: nothing in view limits the lanes
    "runs-on-into-a-loader-that-takes-everything": { ends: ["infinite", "infinite"], flow_direction: 4 },
    // a chest that fills up limits them, at a rate the export does not know
    "runs-on-into-a-loader-that-fills-a-chest": { ends: ["unknown", "unknown"], flow_direction: 4 },
    // the items run under the hood of an entrance without an exit and stop there
    "entrance-without-exit": { ends: ["dead_end", "dead_end"], flow_direction: 4 },
    // a side-load into an underground piece: the lane the hood blocks stops; the lane that goes on runs at what the hands
    // past the side-load take, which the export does not know
    "side-load-into-an-entrance-from-the-north": { ends: ["dead_end", "unknown"], flow_direction: 8, flows: 2 },
    "side-load-into-an-entrance-from-the-south": { ends: ["unknown", "dead_end"], flow_direction: 0, flows: 1 },
    "side-load-into-an-exit-from-the-north": { ends: ["unknown", "dead_end"], flow_direction: 8, flows: 1 },
    "side-load-into-an-exit-from-the-south": { ends: ["dead_end", "unknown"], flow_direction: 0, flows: 2 },
    // the other belt may carry items from upstream on the lane the side-load goes onto
    "side-load-into-an-exit-fed-through-its-tunnel": { ends: ["unknown", "dead_end"], flow_direction: 8 },
    // the walk does not follow a splitter or a merge
    "into-a-splitter": { ends: ["unknown", "unknown"], flow_direction: 4 },
    "merge-onto-the-line-past-the-pickup": { ends: ["unknown", "unknown"], flow_direction: 4 },
    // the pickups do not give one way, so the belt states none
    "pickups-either-side-of-a-curve": { ends: ["dead_end", "dead_end"], flow_direction: null },
    // a belt no inserter picks up from (an export belt, which the site gives its consumption) has no end and no way
    "export-belt-dropped-onto": { ends: null, flow_direction: null },
};

test("Sidecar exports the end of each lane and the way the items move for a belt an inserter picks up from", async context => {
    const factorio = process.env.FACTORIO_PATH;
    const save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    // LANE_ENDS_CAPTURE_DIR keeps the game's report there
    const retained = process.env.LANE_ENDS_CAPTURE_DIR;
    const scratch = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-lane-ends-"));
    fs.mkdirSync(scratch, { recursive: true });
    try {
        await recordInFactorio({
            factorio: factorio!, save: save!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf8").trim(),
            out: path.join(scratch, "capture.json"), ticks: TICKS + 10, warmup_ticks: 60, settle_ticks: 0,
            seed: [], drill_resource: "coal", unclocked: true, game_speed: 1000, watch: false, timeout_seconds: 300, log() {},
            work_dir: scratch,
            lua: captureModules + composeProbeSource(path.join(__dirname, "lane-ends-probe.lua"), { ticks: TICKS, output: "lane-ends.json" }),
        });
        const report = JSON.parse(fs.readFileSync(path.join(scratch, "script-output", "lane-ends.json"), "utf8")) as { cases: CaseReport[] };
        const read = Object.fromEntries(report.cases.map(found => [found.name, found]));
        expect(Object.keys(read).sort()).toEqual(Object.keys(EXPECTED).sort());
        for (const [name, expected] of Object.entries(EXPECTED)) {
            const belts = Array.isArray(read[name].belts) ? read[name].belts : [];
            expect(belts.length, name).toBe(1);
            const [belt] = belts;
            // the lanes as the line's first piece is fed, and an export the config schema takes
            expect(belt.lanes.map(lane => lane.ingredient), name).toEqual([...LANE_ITEMS]);
            expect(BeltConfigSchema.safeParse(belt).success, name).toBe(true);
            expect(belt.lanes.some(lane => lane.consumption_per_second !== undefined), name).toBe(false);
            // each end is its kind and nothing more
            expect({ name, ends: belt.lanes.map(lane => lane.lane_end) }).toStrictEqual({ name,
                ends: expected.ends === null ? [undefined, undefined] : expected.ends.map(kind => ({ kind })) });
            expect({ name, flow_direction: belt.flow_direction ?? null }).toEqual({ name, flow_direction: expected.flow_direction });
            if (expected.flows !== undefined) {
                // in the game only the lane that goes on reaches the other belt, and the export's dead end is the other lane
                const other = (read[name].other_items ?? []).map(items => Array.isArray(items) ? items : []);
                const reached = [...new Set(other.flat())].sort();
                expect({ name, reached }).toEqual({ name, reached: [LANE_ITEMS[expected.flows - 1]] });
                expect(belt.lanes[2 - expected.flows].lane_end?.kind, name).toBe("dead_end");
            }
        }
    } finally {
        if (!retained) fs.rmSync(scratch, { recursive: true, force: true });
    }
}, 600_000);
