import { SAMPLE_BUILDS_DIR } from "../../helpers/fixture-paths";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "vitest";
import { recordInFactorio } from "../../../../src/harness/factorio-harness";

/** Runs a headless Factorio, so it needs the game and a save to build in; without either it is skipped, not failed */
const FACTORIO = process.env.FACTORIO_PATH;
const SAVE = process.env.FACTORIO_HARNESS_SAVE;
const WHY_SKIPPED = !FACTORIO ? "FACTORIO_PATH is not set to a Factorio executable or install folder"
    : !SAVE ? "FACTORIO_HARNESS_SAVE is not set to a save with a place to build in"
    : !fs.existsSync(SAVE) ? `the save FACTORIO_HARNESS_SAVE names does not exist: ${SAVE}`
    : null;

/**
 * Two east-running belts that carry the same two items on opposite lanes: processing units on the left lane of the
 * north belt, with its inserters north of it, and on the right lane of the south belt, with its inserters south of it.
 * Every one of the eight inserters is nearest to the lane of processing units (the game takes them first, 25 periods
 * of 25 in the recording of the cell).
 */
const SCAFFOLD = path.join(SAMPLE_BUILDS_DIR, "real", "thaeln", "cell09", "thaeln-cell09-scaffold.txt");

let scratch: string | null = null;
afterAll(() => {
    if (scratch) {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});

describe("the recorded build's belts", () => {
    test("belts that carry the same items on opposite lanes are two belts, so near_lane names the lane of its own belt", async context => {
        context.skip(WHY_SKIPPED !== null, WHY_SKIPPED ?? undefined);
        scratch ??= fs.mkdtempSync(path.join(os.tmpdir(), "belt-lanes-"));

        const result = await recordInFactorio({
            factorio: FACTORIO!,
            save: SAVE!,
            blueprint: fs.readFileSync(SCAFFOLD, "utf-8").trim(),
            out: path.join(scratch, "thaeln-cell09-belts.json"),
            ticks: 60,
            warmup_ticks: 1800,
            seed: [],
            unclocked: true,
            game_speed: 1000,
            watch: false,
            timeout_seconds: 900,
            log: () => { },
        });

        const belts = result.recording.config.belts;
        const near_items = result.recording.inserters
            .filter(inserter => inserter.source.type === "belt" && inserter.source.near_lane !== undefined)
            .map(inserter => {
                const belt = belts.find(it => it.id === inserter.source.id);
                return belt?.lanes[inserter.source.near_lane! - 1]?.ingredient;
            });
        expect(near_items.length, "inserters that pick up from a belt with two items on it").toBe(8);
        expect(near_items.filter(item => item !== "processing-unit"), "items on the lane nearest to an inserter, other than processing units").toEqual([]);
        const with_frames = belts.filter(belt => belt.lanes.some(lane => lane.ingredient === "flying-robot-frame"));
        expect(with_frames.map(belt => belt.lanes.map(lane => lane.ingredient)).sort()).toEqual([
            ["flying-robot-frame", "processing-unit"],
            ["processing-unit", "flying-robot-frame"],
        ]);
    }, 960_000);
});
