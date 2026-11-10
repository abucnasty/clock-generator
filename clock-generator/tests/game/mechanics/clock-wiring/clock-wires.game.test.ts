import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { generateClockAlternatives } from "../../../../src/crafting/generate-blueprint";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";
import { COPIES, OWNER_CLOCK } from "../../builds/inserter-crafting-240-shared-signal-clock-fixtures";

/** Runs a headless Factorio, so it needs the game and a save to build in; without either it is skipped, not failed */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

/** Three copies of a unit whose inserters are wired to each other in the base, each to its neighbours, and the build's foundry part (36 of the 57 inserters carry wires) */
const WIRED_BUILD = path.join(__dirname, "..", "..", "builds", "inserter-crafting-240-shared-signal-clock-three-copies.scaffold");
const RECORDED_TICKS = 1_200;
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

let scratch: string | null = null;
afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

/** The ticks of a recording of `count` samples that an inserter is not disabled by its circuit condition in, from its change list */
function openTicks(status: [number, string][], count: number): Set<number> {
    const open = new Set<number>();
    status.forEach(([from, name], index) => {
        const until = index + 1 < status.length ? status[index + 1][0] : count;
        if (name !== "disabled_by_control_behavior") {
            for (let tick = from; tick < until; tick++) open.add(tick);
        }
    });
    return open;
}

describe("the harness wires the clock to the build", () => {
    test("an inserter wired to others in the base opens on the generated clock's windows alone", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "clock-wires-"));

        const config = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        const selected = alternatives[selected_index];
        const exported = selected.result.subtick ?? selected.result;
        const period = selected.result.subtick?.clock.window_cycle_ticks ?? selected.result.simulation_duration.ticks;
        const work_dir = path.join(scratch, "game");
        const result = await recordInFactorio({
            factorio: FACTORIO!, save: SAVE!, config, blueprint: fs.readFileSync(WIRED_BUILD, "utf8").trim(), copies: COPIES,
            // the hand-made clock of the build is taken out, and the wires that chain its inserters stay
            built_clock: OWNER_CLOCK,
            clock: { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule },
            out: path.join(scratch, "recording.json"), work_dir, ticks: RECORDED_TICKS, record_at_once: true,
            warmup_ticks: 600, settle_ticks: 600, seed: [], unclocked: false, game_speed: 1000, watch: false, timeout_seconds: 900, log: () => { },
        });

        const report = JSON.parse(fs.readFileSync(path.join(work_dir, "script-output", "clock-wires.json"), "utf8")) as
            { wired: { inserter: number; unit_number: number; wires_cut: { red: number; green: number } }[] };
        const cut = report.wired.reduce((sum, it) => sum + it.wires_cut.red + it.wires_cut.green, 0);
        expect(cut, "the build's wires are cut: the report lists them").toBeGreaterThan(0);

        const windows = (id: number) => {
            const ticks = new Set<number>();
            for (const { start, end } of selected.result.clock_windows[`inserter:${id}`] ?? []) {
                for (let tick = start; tick <= end; tick++) ticks.add(tick % period);
            }
            return ticks;
        };
        const opens = report.wired.map(it => {
            const recorded = result.recording.inserters.find(inserter => inserter.unit_number === it.unit_number)!;
            const open = openTicks(recorded.samples.status, result.recording.sample_count);
            return { id: it.inserter, open, windows: windows(it.inserter) };
        });
        // the clock runs at one shift against the first tick of the recording, the same for every inserter
        const shifts = [...Array(period).keys()].filter(shift => opens.every(({ open, windows }) => {
            for (let tick = 0; tick < result.recording.sample_count; tick++) {
                if (open.has(tick) !== windows.has(((tick - shift) % period + period) % period)) return false;
            }
            return true;
        }));
        expect(shifts.length, `all ${opens.length} scheduled inserters open on their own windows of the ${period}-tick clock and on nothing else, at one shift`).toBeGreaterThan(0);
    }, 960_000);
});
