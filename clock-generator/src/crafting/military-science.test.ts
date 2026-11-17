import { beforeAll, describe, expect, it } from "vitest";
import { generateClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { quiet, selectedAlternativeOf } from "./generate-blueprint-test-helpers";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { outputBeltGeometry, outputBeltProblems } from "../config/output-belt";

// abucnasty's military science build: five copies 9 tiles apart, each a mirrored pair (a military science assembler and a
// grenade assembler above a foundry, and the same below it) that makes 48 a second, 240 in all.
describe("the military science sample", () => {
    let config: Config;
    let generated: ClockAlternativesResult;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_240);
        generated = generateClockAlternatives(config, { logger: quiet });
    }, 180_000);

    it("is five copies of a mirrored pair, 9 tiles apart, at 240 a second", () => {
        expect(config.setpoint).toMatchObject({ recipe: "military-science-pack", items_per_second: 240, copies: 5, copy_offset: { x: 9, y: 0 } });
        expect(config.machines.map(machine => machine.recipe))
            .toEqual(["military-science-pack", "military-science-pack", "grenade", "grenade", "casting-iron"]);
        // one coal inserter for each grenade assembler, as built
        expect(config.inserters.filter(inserter => inserter.source.type === "belt" && [5, 6].includes(inserter.source.id))).toHaveLength(2);
    });

    it("states the lanes of its build", () => {
        const facts = laneFactsOfConfig(config);
        const of = (belt_id: number, lane: 1 | 2) => {
            const lane_facts = facts.of(belt_id, lane);
            return [lane_facts.lane_end.kind, lane_facts.sharing, lane_facts.flow_direction];
        };
        const east = { x: 1, y: 0 };
        // the walls and rounds belts end after the last copy's pickup, and the copies share them
        for (const belt_id of [3, 4]) {
            expect([of(belt_id, 1), of(belt_id, 2)]).toEqual([["dead_end", "shared", east], ["dead_end", "shared", east]]);
        }
        // each copy has coal lanes of its own, which end at its pickup
        for (const belt_id of [5, 6]) {
            expect([of(belt_id, 1), of(belt_id, 2)]).toEqual([["dead_end", "per_copy", east], ["dead_end", "per_copy", east]]);
        }
        // the packs lanes go on to a loader: the config states the infinite end, not only the default
        for (const belt_id of [1, 2]) {
            expect(config.belts.find(belt => belt.id === belt_id)!.lanes[0].lane_end).toEqual({ kind: "infinite" });
            expect(of(belt_id, 1)[0]).toBe("infinite");
        }
        // the near lane of each belt pickup: the top half's lane 1, the bottom half's lane 2
        expect(config.inserters.flatMap(inserter => inserter.source.type === "belt" ? [[inserter.source.id, inserter.source.near_lane]] : []))
            .toEqual([[3, 1], [4, 2], [5, 1], [6, 2]]);
    });

    it("generates, and its selected clock is stable at 240 a second", () => {
        const selected = selectedAlternativeOf(generated);
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.items_per_second).toBeCloseTo(240, 6);
        // the per-branch clock on a window cycle of 80 ticks: machine 3's one coal inserter brings five hands of 16 a cycle, 60 a second
        expect([selected.id, selected.result.simulation_duration.ticks]).toEqual(["coordinated_sources", 80]);
        expect(generated.why_not_stable).toBeNull();
    });

    // The output side of the scaffold: each half has its own line. A copy's output inserter drops on a belt of its own (a drop tile and
    // two curves) that side-loads onto an underground entrance of the half's line from the north (the top half) or the south (the
    // bottom half); the line runs under the next copies' tiles to the next entrance, 9 tiles on, and after the fifth copy 10 tiles
    // to the loader.
    describe("its output belt", () => {
        it("states both lines with no problem: two output inserters a copy, one on each line", () => {
            expect(config.inserters.filter(inserter => inserter.source.type === "machine" && inserter.sink.type === "belt")).toHaveLength(2);
            expect(outputBeltProblems(config.output_belt!, config.setpoint.copy_offset, 2)).toEqual([]);
        });

        it("has the five copies' side loads 9 tiles apart on each line, each on an entrance, and the loader 10 tiles after the fifth", () => {
            const geometry = outputBeltGeometry(config.output_belt!, 9);
            expect(geometry.groups.map(group => [group.stretches, group.infinite_end_stretch])).toEqual([[[1], 1], [[2], 2]]);
            for (const [stretch, numbers, lane] of [[1, [1, 3, 5, 7, 9], "left"], [2, [2, 4, 6, 8, 10], "right"]] as const) {
                const loads = geometry.side_loads.filter(load => load.stretch === stretch);
                expect(loads.map(load => [("side_belt_of_copy" in load.sender) ? load.sender.side_belt_of_copy : 0, load.tile, load.layout, load.lane]))
                    .toEqual(numbers.map((number, copy) => [number, copy * 9, "side-entrance", lane]));
                expect(geometry.infinite_ends.find(end => end.stretch === stretch)!.tile).toBe(4 * 9 + 10);
            }
        });

        it("drops each output inserter on the lane of its side belt that the entrance's hood passes, and on no other", () => {
            const geometry = outputBeltGeometry(config.output_belt!, 9);
            for (const number of [1, 3, 5, 7, 9]) expect(geometry.side_belts.find(belt => belt.number === number)!.lane).toBe("right");
            for (const number of [2, 4, 6, 8, 10]) expect(geometry.side_belts.find(belt => belt.number === number)!.lane).toBe("left");
            // each side belt has a drop tile and two curves, 3 steps to the entrance's tile
            for (const belt of geometry.side_belts) expect(belt.line_end.left).toBe(belt.line_end.right);
            // the other lane would stop at the hood, and the section is refused
            const swapped = { ...config.output_belt!, side_belts: config.output_belt!.side_belts!.map(entry => ({ ...entry, lane: entry.lane === "left" ? "right" as const : "left" as const })) };
            const problems = outputBeltProblems(swapped, config.setpoint.copy_offset, 2);
            expect(problems.length).toBeGreaterThan(0);
            expect(problems[0].message).toMatch(/hood shuts that lane/);
        });

        // Recorded in the game (Factorio 2.1.24): the selected clock makes 64 packs a copy in each of 134 window cycles of 80 ticks, on
        // both lines. Time-Study Windows (480 ticks) makes 384 a copy in each of 22 window cycles on copies 1 to 4, and 352 (13
        // window cycles) or 368 (9) on copy 5: its output inserter on the lower line makes 160 or 176 of its 192.
        it("keeps the clock that holds in the game stable, and finds the clock that falls short in the game on the output belt, at copy 5", () => {
            expect([selectedAlternativeOf(generated).id, selectedAlternativeOf(generated).verdict]).toEqual(["coordinated_sources", "stable"]);
            const short = generated.alternatives.find(alternative => alternative.id === "time_study_windows")!;
            expect(short.verdict).toBe("unstable");
            expect(short.shared_lane_loss_note).toMatch(/^It is not stable on its output belt\. The side belt of copy 5 from the entry is full at its join onto the output belt\./);
        });
    });
});
