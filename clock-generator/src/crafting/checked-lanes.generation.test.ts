import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { ClockAlternative, ClockAlternativesResult } from "./alternatives";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

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

    it("on the 72-tick clock: copy 2 short on both input lanes, the output belt not the cause", () => {
        const clock = clockOf(result, "euclidean_swings");
        expect(clock.result.simulation_duration.ticks).toBe(72);
        expect(rowsOf(clock)).toEqual([
            { at: "1/1", together: "take 120", label: "Short on copy 2", sentence: "Copy 2 misses 3 of 65 swings." },
            { at: "1/2", together: "take 120", label: "Short on copy 2", sentence: "Copy 2 misses 3 of 65 swings." },
            { at: "2/1", together: "drop 240", label: "Not the cause", sentence: "No copy waits at its join." },
        ]);
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
    });
});
