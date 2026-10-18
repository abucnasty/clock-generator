import { SAMPLE_BUILDS_DIR } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";
import { ConfigPaths } from "../../../../src/config/config-paths";
import { loadConfigFromFile } from "../../../../src/config/loader";
import { generateClockAlternatives } from "../../../../src/crafting/generate-blueprint";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";

/** Runs a headless Factorio, so it needs the game and a save to build in; without either it is skipped, not failed */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

let scratch: string | null = null;
afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

describe("the recorder samples the belt lane under an inserter", () => {
    test("an inserter that drops on a belt has the items on its lane every tick, and they go up when it drops", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "belt-lanes-"));

        const scaffold = path.join(SAMPLE_BUILDS_DIR, "science", "automation-science", "automation-science-scaffold.txt");
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const { alternatives, selected_index } = generateClockAlternatives(config, { logger: quiet });
        const selected = alternatives[selected_index];
        const exported = selected.result.subtick ?? selected.result;
        const result = await recordInFactorio({
            factorio: FACTORIO!,
            save: SAVE!,
            blueprint: fs.readFileSync(scaffold, "utf-8").trim(),
            out: path.join(scratch, "automation-science-belt-lanes.json"),
            ticks: 1_800,
            warmup_ticks: 3600,
            settle_ticks: 1200,
            seed: [],
            clock: { blueprint: encodeBlueprintFile({ blueprint: exported.blueprint }), schedule: exported.schedule },
            config,
            unclocked: false,
            game_speed: 1000,
            watch: false,
            timeout_seconds: 900,
            log: () => { },
        });

        const recording = result.recording;
        const to_belt = recording.inserters.filter(it => it.source.type === "machine" && it.sink.type === "belt");
        expect(to_belt.length, "the scaffold has an inserter that takes from a machine and drops on a belt").toBeGreaterThan(0);

        let rises = 0;
        for (const inserter of to_belt) {
            const label = `inserter ${inserter.id}`;
            const { drop_lane_items: items, drop_lane_stacks: stacks, drop_lane_room: room } = inserter.samples;
            expect(inserter.drop_lane, `${label} names the transport line it drops on`).toBeDefined();
            for (const [name, series] of Object.entries({ items, stacks, room })) {
                expect(series?.length, `${label} has a ${name} sample for each of the ${recording.sample_count} ticks`).toBe(recording.sample_count);
            }
            for (const value of [...items!, ...stacks!, ...room!]) {
                expect(Number.isInteger(value) && value >= 0, `${label}: ${value} is a whole number of at least 0`).toBe(true);
            }
            for (let tick = 1; tick < items!.length; tick++) {
                if (items![tick] > items![tick - 1]) rises++;
            }
        }
        expect(rises, "the items on the lane at the drop go up at least once: a drop lands on it").toBeGreaterThan(0);

        // what an inserter picking up from a belt sees, on each of its lanes
        const from_belt = recording.inserters.filter(it => it.source.type === "belt");
        expect(from_belt.length).toBeGreaterThan(0);
        for (const inserter of from_belt) {
            const lanes = Object.values(inserter.samples.pickup_lane_items ?? {});
            expect(lanes.length, `inserter ${inserter.id} has the lanes of the belt it picks up from`).toBeGreaterThan(0);
            for (const series of lanes) {
                expect(series.length).toBe(recording.sample_count);
            }
        }
    }, 960_000);
});
