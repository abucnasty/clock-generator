import { SAMPLE_BUILDS_DIR } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { HarnessSession } from "../../../../src/harness/factorio-harness";

/** Runs a headless Factorio, so it needs the game and a save to build in; without either it is skipped, not failed */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

let scratch: string | null = null;
afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

interface Placed { unit_number: number; config_id?: number; x: number; y: number; tick: number }

describe("a staged start builds the inserters of the cell in one tick, after the belts are saturated", () => {
    test("saturation, the placement tick, the order of the unit numbers and empty machines", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "staged-start-"));

        const scaffold = path.join(SAMPLE_BUILDS_DIR, "science", "agriculture-science", "agriculture-science-scaffold.txt");
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const log: string[] = [];
        const session = await HarnessSession.start({ factorio: FACTORIO!, save: SAVE!, work_dir: path.join(scratch, "work"), timeout_seconds: 900, log: message => log.push(message) });
        let failed = true;
        try {
            const record = (build_order: "ascending" | "descending") => session.record({
                blueprint: fs.readFileSync(scaffold, "utf-8").trim(),
                out: path.join(scratch!, `staged-${build_order}.json`),
                ticks: 60,
                warmup_ticks: 0,
                seed: [],
                config,
                unclocked: true,
                game_speed: 1000,
                timeout_seconds: 900,
                log: message => log.push(message),
                staged_start: { build_order, loop_seed: 50 },
            });

            for (const build_order of ["ascending", "descending"] as const) {
                const result = await record(build_order);
                const saturation = result.build.saturation as { phase: string; started_tick: number; saturated_tick: number; lanes: Record<string, { in_use: boolean; full_since?: number }> };

                // the first stage ran until every lane that carries items was full, and says when each became full
                expect(saturation.phase).toBe("saturated");
                expect(saturation.saturated_tick).toBeGreaterThan(saturation.started_tick);
                const in_use = Object.values(saturation.lanes).filter(lane => lane.in_use);
                expect(in_use.length, "at least one lane under a pickup carries items").toBeGreaterThan(0);
                for (const lane of in_use) {
                    expect(lane.full_since, "a lane that carries items is full from a tick on").toBeDefined();
                    expect(lane.full_since!).toBeLessThanOrEqual(saturation.saturated_tick);
                }

                // the inserters of the cell were all built in one tick, after the belts were saturated
                const placed = Object.values((result.start.staged as { placed: Record<string, Placed> }).placed);
                expect(placed.length).toBe(config.inserters.length);
                expect(new Set(placed.map(it => it.tick)).size, "every inserter is built in the same tick").toBe(1);
                expect(placed[0].tick).toBeGreaterThanOrEqual(saturation.saturated_tick);
                expect((result.start.staged as { tick: number }).tick).toBe(placed[0].tick);
                expect(result.recording.start_game_tick, "the recording starts the tick after").toBe(placed[0].tick + 1);

                // the unit numbers come out in the order asked for
                const by_unit = [...placed].sort((a, b) => a.unit_number - b.unit_number).map(it => it.config_id);
                const ids = config.inserters.map(it => it.id!).sort((a, b) => a - b);
                expect(by_unit).toEqual(build_order === "ascending" ? ids : [...ids].reverse());

                // machines are empty at the first sample, but for the loop that is seeded once
                for (const machine of result.recording.machines) {
                    const held = Object.entries(machine.samples.inputs).flatMap(([item, series]) => series[0] > 0 ? [[item, series[0]] as const] : []);
                    const products = Object.values(machine.samples.outputs).reduce((sum, series) => sum + series[0], 0);
                    expect(machine.samples.products_finished[0], `machine ${machine.id} has finished nothing`).toBe(0);
                    expect(products, `machine ${machine.id} holds no product`).toBe(0);
                    for (const [item, count] of held) {
                        expect(item, `machine ${machine.id} holds only the seed of the loop`).toBe("pentapod-egg");
                        expect(count).toBeLessThanOrEqual(50);
                        expect(count).toBeGreaterThan(0);
                    }
                }
                const seeds = Object.values<{ item: string; inserted: number }>((result.start.loop_seeds ?? {}) as Record<string, { item: string; inserted: number }>);
                expect(seeds.length, "the egg loop is seeded").toBeGreaterThan(0);
                expect(seeds.every(it => it.item === "pentapod-egg" && it.inserted === 50)).toBe(true);
            }
            failed = false;
        } finally {
            await session.close(failed);
        }
    }, 960_000);
});
