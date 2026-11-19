import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { generateClockAlternatives } from "../../../../src/crafting/generate-blueprint";
import { CachedHarnessSession, scheduledDrillIds } from "../../../../src/harness/factorio-harness";

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

const scaffoldOf = (config_path: string) => fs.readFileSync(config_path.replace(/\.json$/, ".scaffold"), "utf-8").trim();
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

describe("the staged start of a build the harness had two limits on", () => {
    test("a lane that only the inserters of the cell fill counts as saturated: automation science 120, foundries feeding a belt", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "staged-start-lanes-"));
        const config_path = ConfigPaths.AUTOMATION_SCIENCE_120_FOUNDRIES_FEED_BELT_TO_ASSEMBLER;
        const config = await loadConfigFromFile(config_path);
        const log: string[] = [];
        const session = new CachedHarnessSession({ factorio: FACTORIO!, save: SAVE!, work_dir: path.join(scratch, "lanes-work"), timeout_seconds: 900, log: message => log.push(message) });
        let failed = true;
        try {
            const result = await session.record({
                blueprint: scaffoldOf(config_path),
                out: path.join(scratch, "lanes.json"),
                ticks: 60,
                warmup_ticks: 0,
                seed: [],
                config,
                unclocked: true,
                game_speed: 1000,
                timeout_seconds: 900,
                log: message => log.push(message),
                staged_start: {},
            });
            const saturation = result.build.saturation as { phase: string; started_tick: number; saturated_tick: number; lanes: Record<string, { in_use: boolean }> };
            expect(saturation.phase).toBe("saturated");
            const lanes = Object.values(saturation.lanes);
            expect(lanes.length, "the lanes under the pickups of the cell").toBeGreaterThan(0);
            expect(lanes.every(lane => !lane.in_use), "nothing but the cell puts anything on these lanes").toBe(true);
            expect(result.start.staged, "the inserters of the cell were built").toBeDefined();
            failed = false;
        } finally {
            await session.close(failed);
        }
    }, 960_000);

    test("a staged build with several mining drills wires each clock drill to its matched drill: electric furnace 20", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "staged-start-drills-"));
        const config_path = ConfigPaths.ELECTRIC_FURNACE_20;
        const config = await loadConfigFromFile(config_path);
        const generated = generateClockAlternatives(config, { logger: quiet });
        const selected = generated.alternatives[generated.selected_index];
        const exported = selected.result.subtick ?? selected.result;
        const clock = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
        const scheduled_drills = scheduledDrillIds(clock.blueprint);
        expect(scheduled_drills.length, "the clock enables drills").toBeGreaterThan(0);
        expect(config.drills?.configs.length, "the build has several drills").toBeGreaterThan(1);

        const log: string[] = [];
        const session = new CachedHarnessSession({ factorio: FACTORIO!, save: SAVE!, work_dir: path.join(scratch, "drills-work"), timeout_seconds: 900, log: message => log.push(message) });
        let failed = true;
        try {
            const result = await session.record({
                blueprint: scaffoldOf(config_path),
                out: path.join(scratch, "drills.json"),
                ticks: 60,
                settle_ticks: 120,
                warmup_ticks: 0,
                seed: [],
                config,
                clock,
                unclocked: false,
                game_speed: 1000,
                timeout_seconds: 900,
                log: message => log.push(message),
                staged_start: {},
            });
            const wired = Object.values(((result.start as { clock?: { wired_drills?: unknown } }).clock?.wired_drills ?? {}) as Record<string, { drill: number; unit_number: number }>);
            expect(wired.map(it => it.drill).sort((a, b) => a - b), "every drill the clock enables is wired").toEqual([...scheduled_drills].sort((a, b) => a - b));
            expect(new Set(wired.map(it => it.unit_number)).size, "each to its own drill").toBe(wired.length);
            failed = false;
        } finally {
            await session.close(failed);
        }
    }, 960_000);

    test("a backpressure start records settle_ticks after its lock opens, so the recording keeps the furnaces that had no recipe at the opening: inserter crafting 240", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "staged-start-settle-"));
        const config_path = ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK;
        const config = await loadConfigFromFile(config_path);
        const generated = generateClockAlternatives(config, { logger: quiet });
        const selected = generated.alternatives[generated.selected_index];
        const exported = selected.result.subtick ?? selected.result;
        const clock = { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule };
        const settle_ticks = 600;

        const log: string[] = [];
        const session = new CachedHarnessSession({ factorio: FACTORIO!, save: SAVE!, work_dir: path.join(scratch, "settle-work"), timeout_seconds: 900, log: message => log.push(message) });
        let failed = true;
        try {
            const result = await session.record({
                blueprint: scaffoldOf(config_path),
                out: path.join(scratch, "settle.json"),
                ticks: 60,
                settle_ticks,
                warmup_ticks: 0,
                seed: [],
                config,
                clock,
                unclocked: false,
                game_speed: 1000,
                timeout_seconds: 900,
                log: message => log.push(message),
                staged_start: { backpressure: {} },
            });
            const opening = (result.start as { staged?: { backpressure?: { tick: number } } }).staged?.backpressure;
            expect(opening, "the game reported the opening of the fill").toBeDefined();
            expect(result.recording.start_game_tick - opening!.tick, "the recording begins settle_ticks after the lock was set off").toBeGreaterThanOrEqual(settle_ticks);
            expect(result.recording.machines.length, "every machine of the config is recorded: a furnace has a recipe by then").toBe(config.machines.length);
            failed = false;
        } finally {
            await session.close(failed);
        }
    }, 960_000);
});
