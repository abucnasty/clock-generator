import fs from "fs";
import os from "os";
import path from "path";
import {createHash} from "crypto";
import {expect, test} from "vitest";
import {recordInFactorio} from "../../../src/harness/factorio-harness";
import {REPOSITORY_ROOT} from "../helpers/fixture-paths";
import {composeProbeSource} from "../helpers/probe-source";

const MODULES = ["types", "helpers", "pickup-supply", "drop-merge", "suggested-target", "extraction", "export"];
const sidecarModules = "local capture_modules, require = {}, nil\nrequire = function(name) return assert(capture_modules[name], name) end\n"
    + MODULES.map(name => {
        const source = fs.readFileSync(path.join(REPOSITORY_ROOT, "clock-generator-sidecar/scripts/" + name + ".lua"), "utf8");
        return "capture_modules[\"__clock-generator-sidecar__.scripts." + name + "\"] = (function()\n" + source + "\nend)() or true\n";
    }).join("");
const scaffold = path.join(REPOSITORY_ROOT, "clock-generator/resources/config-samples/real/owner/pink-science-original/pink-science-original-scaffold.txt");
const originalHash = "3cb6ca71400bda8580d605cbbc3eff69f4db594ee761a27311bdefe2487573a5";

type Candidate = {unit_number: number; name: string; type: string; position: {x: number; y: number}};
type Recycler = {unit_number: number; recipe: string | false; products_finished: number; status_name: string;
    drop_target: {unit_number: number; name: string; type: string} | false; drop_position: {x: number; y: number};
    collision_candidates: Candidate[]; result_target: {type: string; id: number} | false; target_unit_number: number | false;
    target_prototype: string | false; target_selected: boolean | false; target_inventory: unknown};
type AdvancedTaker = {unit_number: number; exported: boolean; geometric_lane: number | false;
    source: {unit_number: number; name: string; type: string; selected: boolean} | false;
    sink: {unit_number: number; name: string; type: string; selected: boolean; line_contents: {name: string; count: number}[][]} | false};
type Snapshot = {state: string; machines: {id: number; prototype: string; result_target?: {type: string; id: number}}[];
    belts: {lanes: {ingredient: string; stack_size: number}[]}[]; recyclers: Recycler[]; advanced_takers: AdvancedTaker[];
    left_out_advanced_takers: {unit_number: number; pickup: boolean; target_type: string | false; target_name: string | false}[];
    interventions?: {target_unit: number; status_before_hold: string}[]};
type Report = {snapshot?: Snapshot; state?: string; machines?: Snapshot["machines"]; recyclers?: Recycler[];
    advanced_takers?: Snapshot["advanced_takers"]; left_out_advanced_takers?: Snapshot["left_out_advanced_takers"]};

function snapshotOf(report: Report): Snapshot {
    return report.snapshot ?? report as Snapshot;
}

test("Sidecar resolves a recycler's selected result receiver before the first output", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
    const bytes = fs.readFileSync(scaffold);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(originalHash);
    const retained = process.env.RECYCLER_SIDECAR_CAPTURE_DIR;
    const parent = retained ? path.resolve(retained) : fs.mkdtempSync(path.join(os.tmpdir(), "recycler-sidecar-export-"));
    fs.mkdirSync(parent, {recursive: true});
    let passed = false;
    try {
        const runs: {state: "idle-seeded" | "active" | "blocked" | "recently-emptied"; warmup: number}[] = [
            {state: "idle-seeded", warmup: 0},
            {state: "active", warmup: 7200},
            {state: "blocked", warmup: 7200},
            {state: "recently-emptied", warmup: 7200},
        ];
        const reports = new Map<string, Snapshot>();
        for (const run of runs) {
            const directory = path.join(parent, run.state);
            fs.mkdirSync(directory, {recursive: true});
            await recordInFactorio({
                factorio: factorio!, save: save!, blueprint: bytes.toString("utf8").trim(),
                lua: sidecarModules + composeProbeSource(path.join(__dirname, "recycler-sidecar-export-probe.lua"), {state: run.state}),
                out: path.join(directory, "recording.json"), work_dir: path.join(directory, "game"), ticks: 60,
                warmup_ticks: run.warmup, seed: run.state === "idle-seeded"
                    ? [{target: {name: "recycler"}, item: "processing-unit", count: 1}] : [],
                unclocked: true, settle_ticks: 0, watch: false, game_speed: 1000, timeout_seconds: 300, log() {},
            });
            const report = JSON.parse(fs.readFileSync(path.join(directory, "game/script-output/recycler-sidecar-export.json"), "utf8")) as Report;
            reports.set(run.state, snapshotOf(report));
        }

        const idle = reports.get("idle-seeded")!;
        expect(idle.recyclers).toHaveLength(2);
        for (const recycler of idle.recyclers) {
            expect(recycler).toMatchObject({recipe: "processing-unit-recycling", products_finished: 0,
                status_name: "disabled_by_script", drop_target: false, result_target: {type: "machine"},
                target_prototype: "electromagnetic-plant", target_selected: true});
            expect(recycler.collision_candidates).toHaveLength(1);
            expect(recycler.collision_candidates[0]).toMatchObject({unit_number: recycler.target_unit_number,
                name: "electromagnetic-plant", type: "assembling-machine"});
        }
        expect(idle.advanced_takers).toHaveLength(2);
        expect(idle.advanced_takers.every(taker => taker.exported && taker.source && taker.source.selected && taker.sink && taker.sink.selected
            && taker.sink.name === "turbo-transport-belt" && taker.geometric_lane === false)).toBe(true);
        expect(Object.keys(idle.left_out_advanced_takers)).toHaveLength(0);
        expect(idle.belts.some(belt => belt.lanes.some(lane => lane.ingredient === "advanced-circuit"))).toBe(true);

        const active = reports.get("active")!;
        expect(active.recyclers).toHaveLength(2);
        expect(active.recyclers.every(recycler => recycler.products_finished > 0 && recycler.drop_target
            && recycler.result_target && recycler.drop_target.unit_number === recycler.target_unit_number)).toBe(true);
        expect(active.advanced_takers).toHaveLength(2);
        for (const taker of active.advanced_takers) {
            expect(taker.exported).toBe(true);
            expect(taker.sink).not.toBe(false);
            if (taker.sink && taker.geometric_lane) {
                expect(taker.sink.line_contents[taker.geometric_lane - 1].some(item => item.name === "advanced-circuit")).toBe(true);
            }
        }
        expect(active.belts.some(belt => belt.lanes.some(lane => lane.ingredient === "advanced-circuit"))).toBe(true);

        const blocked = reports.get("blocked")!;
        expect(blocked.recyclers.every(recycler => recycler.status_name === "waiting_for_space_in_destination"
            && recycler.result_target && recycler.drop_target
            && recycler.drop_target.unit_number === recycler.target_unit_number)).toBe(true);
        expect(blocked.interventions?.length).toBe(2);
        expect(blocked.interventions?.every(intervention => blocked.recyclers.some(recycler =>
            recycler.target_unit_number === intervention.target_unit))).toBe(true);
        expect(blocked.advanced_takers).toHaveLength(2);
        expect(blocked.advanced_takers.every(taker => taker.exported)).toBe(true);
        expect(blocked.belts.some(belt => belt.lanes.some(lane => lane.ingredient === "advanced-circuit"))).toBe(true);

        const emptied = reports.get("recently-emptied")!;
        expect(emptied.recyclers.every(recycler => recycler.recipe === "processing-unit-recycling"
            && recycler.products_finished > 0 && recycler.drop_target
            && recycler.target_inventory && recycler.result_target
            && recycler.drop_target.unit_number === recycler.target_unit_number)).toBe(true);
        expect(emptied.advanced_takers).toHaveLength(2);
        expect(emptied.advanced_takers.every(taker => taker.exported)).toBe(true);
        passed = true;
    } finally {
        if (!retained && passed) fs.rmSync(parent, {recursive: true, force: true});
    }
}, 1_800_000);
