import { SAMPLE_BUILDS_DIR } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { HarnessSession } from "../../../../src/harness/factorio-harness";
import { servedFirst } from "../../helpers/served-first";

/** Runs a headless Factorio, so it needs the game and a save to build in; without either it is skipped, not failed */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;
/** A folder to keep the recordings and what they show in; without it they go to a temporary folder that is removed */
const KEEP = process.env.TAKER_ORDER_CAPTURE_DIR ? path.resolve(process.env.TAKER_ORDER_CAPTURE_DIR) : null;
/** Ticks recorded from the staged start: 37 periods of agricultural science's 96-tick hands */
const RECORDED_TICKS = 3600;
/** Ticks a machine has to show who was served first on, to be judged */
const DECIDED_TICKS = 10;
/** The share of those ticks one taker has to have been served first on, for the order to count as fixed */
const FIXED_SHARE = 0.9;

let scratch: string | null = null;
afterAll(() => {
    if (scratch && !KEEP) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

interface Placed { unit_number: number; config_id?: number; x: number; y: number; tick: number }

/**
 * The game serves the takers of one machine output in one fixed order every tick (docs/simulator.md, "Two inserters that
 * take from one machine"). Which of them it puts first is not known from a config: the agricultural science scaffold is
 * built twice from the staged start, its inserters built in ascending and in descending config order, so the unit numbers
 * of each pair of egg takers come out the other way round while their places stay. If the one served first keeps its
 * place it is not the build order that decides; if it changes place with the order of the unit numbers, it is.
 */
describe("the order the game serves the takers of one machine in", () => {
    test("is fixed whichever order the inserters were built in, and the build order decides or does not", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= KEEP ?? fs.mkdtempSync(path.join(os.tmpdir(), "taker-order-"));
        fs.mkdirSync(scratch, { recursive: true });
        const scaffold = path.join(SAMPLE_BUILDS_DIR, "science", "agriculture-science", "agriculture-science-scaffold.txt");
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const log: string[] = [];
        const session = await HarnessSession.start({ factorio: FACTORIO!, save: SAVE!, work_dir: path.join(scratch, "work"), timeout_seconds: 900, log: message => log.push(message) });
        let failed = true;
        try {
            const runs: Record<string, { machine: number; first: { config_id: number; x: number; y: number; built: number }; decided: number; share: number; counts: Record<number, number> }[]> = {};
            for (const build_order of ["ascending", "descending"] as const) {
                const result = await session.record({
                    blueprint: fs.readFileSync(scaffold, "utf-8").trim(),
                    out: path.join(scratch, `taker-order-${build_order}.json`),
                    ticks: RECORDED_TICKS,
                    warmup_ticks: 0,
                    seed: [],
                    config,
                    unclocked: true,
                    game_speed: 1000,
                    timeout_seconds: 900,
                    log: message => log.push(message),
                    staged_start: { build_order },
                });
                const placed = new Map(Object.values((result.start.staged as { placed: Record<string, Placed> }).placed).map(it => [it.unit_number, it] as const));
                const built = [...placed.keys()].sort((a, b) => a - b);
                runs[build_order] = servedFirst(result.recording).flatMap(machine => {
                    const decided = Object.values(machine.first).reduce((sum, count) => sum + count, 0);
                    if (decided < DECIDED_TICKS) return [];
                    const [unit, count] = Object.entries(machine.first).map(([unit, count]) => [Number(unit), count] as const).sort((a, b) => b[1] - a[1])[0];
                    const at = placed.get(unit)!;
                    return [{ machine: machine.machine_id, first: { config_id: at.config_id!, x: at.x, y: at.y, built: built.indexOf(unit) }, decided, share: count / decided,
                        counts: Object.fromEntries(Object.entries(machine.first).map(([unit, count]) => [placed.get(Number(unit))!.config_id!, count])) }];
                });
            }
            fs.writeFileSync(path.join(scratch, "taker-order.json"), JSON.stringify(runs, null, 2) + "\n");
            for (const [build_order, machines] of Object.entries(runs)) {
                expect(machines.length, `machines with ${DECIDED_TICKS} decided ticks or more, built ${build_order}`).toBeGreaterThan(0);
                for (const machine of machines) {
                    expect(machine.share, `machine ${machine.machine} built ${build_order}: one taker is served first (${JSON.stringify(machine.counts)})`).toBeGreaterThanOrEqual(FIXED_SHARE);
                }
            }
            // the same machines in both runs: does the one served first keep its place, or follow the unit numbers?
            const keeps_place = runs.ascending.map(machine => {
                const other = runs.descending.find(it => it.machine === machine.machine);
                return other === undefined ? null : other.first.x === machine.first.x && other.first.y === machine.first.y;
            }).filter(it => it !== null);
            expect(keeps_place.length).toBeGreaterThan(0);
            expect(new Set(keeps_place).size, "every machine answers the same way").toBe(1);
            failed = false;
        } finally {
            await session.close(failed);
        }
    }, 960_000);
});
