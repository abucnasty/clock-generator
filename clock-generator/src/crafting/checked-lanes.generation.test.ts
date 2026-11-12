import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { ClockAlternative, ClockAlternativesResult } from "./alternatives";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet, reasonsOf } from "./generate-blueprint-test-helpers";

/** The rows of a clock as the page reads them: belt and lane, the copies' take or drop a second, the state's label and sentence */
const rowsOf = (clock: ClockAlternative) => clock.checked_lanes!.rows.map(row => ({ at: `${row.belt_id}/${row.lane}`,
    together: row.together === null ? null : `${row.together.kind} ${row.together.items_per_second}`, label: row.label, sentence: row.sentence }));

const clockOf = (result: ClockAlternativesResult, id: string) => result.alternatives.find(it => it.id === id)!;

describe("what was checked on the lanes the copies of the automation science 240 build share", () => {
    let result: ClockAlternativesResult;
    beforeAll(async () => {
        result = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240), { logger: quiet });
    });

    it("lists every lane of the build once, with the end the role gives the output lane", () => {
        expect(result.lanes).toEqual([
            { belt_id: 1, lane: 1, item: "iron-gear-wheel", role: "input", end: "dead_end", end_given_by: "lane", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
            { belt_id: 1, lane: 2, item: "copper-plate", role: "input", end: "dead_end", end_given_by: "lane", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
            { belt_id: 2, lane: 1, item: "automation-science-pack", role: "output", end: "infinite", end_given_by: "role", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
        ]);
    });

    it("on the 72-tick clock: copy 2 short on both input lanes, the output belt not the cause, and the parts the run shows", () => {
        const clock = clockOf(result, "euclidean_swings");
        expect(clock.result.simulation_duration.ticks).toBe(72);
        expect(rowsOf(clock)).toEqual([
            { at: "1/1", together: "take 120", label: "Short on copy 2", sentence: "Copy 2 misses 3 of 65 swings." },
            { at: "1/2", together: "take 120", label: "Short on copy 2", sentence: "Copy 2 misses 3 of 65 swings." },
            { at: "2/1", together: "drop 240", label: "Not the cause", sentence: "No copy waits at its join." },
        ]);
        const cause = clock.checked_lanes!.cause!;
        expect(cause.headline.text).toBe("Copy 2 misses 6 of 130 swings");
        // the run shows the copy before's gap on the copper plate lane only; the machine's full output in 5 of the 6
        expect(cause.cause!.text).toBe("In 3 of the 6 missed swings, the gap that copy 1 leaves on the copper plate lane reaches copy 2 when its inserter must pick up. "
            + "In 5 of the 6 missed swings, the assembling machine 3 of copy 2 that makes automation science pack has its output full and takes no more items. 2 of the 6 show both.");
        // 3 of the 6 missed swings show the gap: the reason beside the status
        expect(cause.reason).toEqual({ code: "belt_gaps", data: { missed: 6, with_gap: 3 } });
        expect(cause.spacing!.text).toBe("The copies stand 9 tiles apart. It takes 72 ticks for items to travel between copies, and the window cycle is 72 ticks. "
            + "The 9 copies take every copper plate the lane brings, so the gap does not close on the way.");
        expect(cause.where.text).toBe("The inserter of copy 2 that takes iron gear wheel and copper plate misses 6 of its 130 swings in 65 window cycles: "
            + "3 with iron gear wheel and 3 with copper plate. Each swing is a hand of 16.");
        expect(cause.alone.text).toBe("The same inserter makes all 130 swings. The clock is right for one copy.");
        expect(cause.changes!.text).toBe("With 8 copies on the iron gear wheel and copper plate lanes, every copy makes every swing. "
            + "Another clock of this build holds with all 9: Time-Study Windows, window cycle 216 ticks.");
        expect(cause.changes!.data).toMatchObject({ fewer_copies: 8, other_clock: { id: "time_study_windows", window_cycle_ticks: 216 } });
        expect(clock.checked_lanes!.line.sentence).toBe("Checked with all 9 copies on the lanes they share. Copy 2 does not get all its items, and no copy is held back at the output belt.");
    });

    it("on the 216-tick clock of observed takt batches: the join of copies 4 and 8 full, both input lanes taking less", () => {
        const clock = clockOf(result, "takt_batches_observed");
        expect(clock.result.simulation_duration.ticks).toBe(216);
        expect(rowsOf(clock)).toEqual([
            { at: "2/1", together: "drop 240", label: "Join full on copies 4 and 8", sentence: "42 of 378 swings missed, on each." },
            { at: "1/1", together: "take 120", label: "Copies 4 and 8 take less", sentence: "They wait for the output belt. Without the output belt, copy 4 still misses 11 of 189 swings here." },
            { at: "1/2", together: "take 120", label: "Copies 4 and 8 take less", sentence: "They wait for the output belt. Without the output belt, copy 4 still misses 11 of 189 swings here." },
        ]);
        const cause = clock.checked_lanes!.cause!;
        expect(cause.headline.text).toBe("Copies 4 and 8 miss 42 of 378 swings each");
        expect(cause.cause!.text).toBe("The side belts of copies 4 and 8 are full where they join the automation science pack output belt.");
        // a full join: its code, with the missed output swings and the output swings of copies 4 and 8
        expect(cause.reason).toEqual({ code: "target_full", data: { missed: 84, swings: 756 } });
        expect(cause.spacing).toBeNull();
        expect(cause.where.text).toBe("The inserter of copy 4 that drops automation science pack misses 42 of its 378 swings in 63 window cycles, and so does that of copy 8. "
            + "84 of the 336 swings each one makes wait for room.");
        expect(cause.alone.text).toBe("The same inserter makes all 378 swings. The clock is right for one copy.");
        expect(cause.changes!.text).toBe("With 3 copies, every copy makes every swing. Another clock of this build has no full join: Time-Study Windows, window cycle 216 ticks.");
    });

    it("on the stable time study windows clock: the line and three rows that hold, with the waits at the join counted", () => {
        const clock = clockOf(result, "time_study_windows");
        expect(clock.verdict).toBe("stable");
        expect(clock.checked_lanes!.line.sentence).toBe("Checked with all 9 copies on the lanes they share. Every copy gets its items, and no copy misses a swing at the output belt.");
        expect(rowsOf(clock)).toEqual([
            { at: "1/1", together: "take 120", label: "Holds", sentence: "Every copy gets its items." },
            { at: "1/2", together: "take 120", label: "Holds", sentence: "Every copy gets its items." },
            { at: "2/1", together: "drop 240", label: "Holds", sentence: "Copies 4 and 8 wait for room at their join in 128 of their 384 swings. No swing is missed." },
        ]);
        expect(clock.checked_lanes!.cause).toBeNull();
    });

    it("gives the reason code of belt gaps on each lane loss where a missed swing shows the gap, and of a full join on the join clock, with their counts", () => {
        expect(reasonsOf(result)).toEqual({
            takt_batches_observed: { code: "target_full", data: { missed: 84, swings: 756 } },
            euclidean_swings: { code: "belt_gaps", data: { missed: 6, with_gap: 3 } },
            takt_batches_observed_swings_2: { code: "belt_gaps", data: { missed: 16, with_gap: 8 } },
            takt_batches_swings_1: { code: "belt_gaps", data: { missed: 26, with_gap: 26 } },
        });
        // the reason is a code: the engine writes no sentence for it
        for (const clock of result.alternatives) {
            for (const text of [clock.description, clock.shared_lane_loss_note ?? ""]) expect(text).not.toMatch(/belt gaps|belt_gaps|target_full/i);
        }
    });

    it("gives the description's sentences on a shared-lane loss as a field of their own, word for word", () => {
        for (const [id, lead] of [["euclidean_swings", "It is not stable on a lane its copies share. "], ["takt_batches_observed", "It is not stable on its output belt. "]]) {
            const clock = clockOf(result, id);
            expect(clock.shared_lane_loss_note!.startsWith(lead)).toBe(true);
            expect(clock.description).toContain(` ${clock.shared_lane_loss_note}`);
        }
        expect(clockOf(result, "time_study_windows").shared_lane_loss_note).toBeUndefined();
    });
});

describe("what was checked on other outputs", () => {
    it("on military science 240: its two plain output belts by rate, and its line", async () => {
        const result = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_240), { logger: quiet });
        const clock = result.alternatives[result.selected_index];
        expect(clock.checked_lanes!.line.sentence).toBe("Checked with all 5 copies on the lanes they share. Every copy gets its items. On the 2 output belts, only the sum of the drops is checked.");
        expect(rowsOf(clock).filter(row => row.label === "Rate fits").map(row => row.at)).toEqual(["1/1", "2/1"]);
        expect(rowsOf(clock).filter(row => row.label === "Holds").map(row => row.at)).toEqual(["3/1", "3/2", "4/1", "4/2"]);
        // the coal lanes are one per copy: no row
        expect(rowsOf(clock).some(row => row.at.startsWith("5/") || row.at.startsWith("6/"))).toBe(false);
    });

    it("on electromagnetic science 330: two input rows, no output row and the chest line", async () => {
        const result = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330), { logger: quiet });
        const clock = result.alternatives[result.selected_index];
        expect(rowsOf(clock)).toEqual([
            { at: "1/1", together: "take 120", label: "Holds", sentence: "Every copy gets its items." },
            { at: "1/2", together: "take 120", label: "Holds", sentence: "Every copy gets its items." },
        ]);
        expect(clock.checked_lanes!.line.sentence).toBe("Checked with all 11 copies on the lanes they share. Every copy gets its items. "
            + "The output goes into a chest of each copy: the infinity chest that holds electromagnetic science pack.");
        expect(clock.checked_lanes!.line.output_chests).toEqual([{ chest_id: 1, kind: "infinity-chest", items: ["electromagnetic-science-pack"] }]);
        expect(reasonsOf(result)).toEqual({
            euclidean_swings: { code: "belt_gaps", data: { missed: 162, with_gap: 162 } },
            takt_batches_swings_2: { code: "belt_gaps", data: { missed: 151, with_gap: 121 } },
        });
    });
});
