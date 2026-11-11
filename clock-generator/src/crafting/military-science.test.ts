import { beforeAll, describe, expect, it } from "vitest";
import { generateClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { quiet, selectedAlternativeOf } from "./generate-blueprint-test-helpers";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { laneFactsOf } from "../entities/traits/lane-facts";

// abucnasty's military science build: five copies 9 tiles apart, each a mirrored pair (a military science assembler and a
// grenade assembler above a foundry, and the same below it) that makes 48 a second, 240 in all.
describe("the military science sample", () => {
    let config: Config;
    let generated: ClockAlternativesResult;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_240);
        generated = generateClockAlternatives(config, { logger: quiet });
    });

    it("is five copies of a mirrored pair, 9 tiles apart, at 240 a second", () => {
        expect(config.setpoint).toMatchObject({ recipe: "military-science-pack", items_per_second: 240, copies: 5, copy_offset: { x: 9, y: 0 } });
        expect(config.machines.map(machine => machine.recipe))
            .toEqual(["military-science-pack", "military-science-pack", "grenade", "grenade", "casting-iron"]);
        // one coal inserter for each grenade assembler, as built
        expect(config.inserters.filter(inserter => inserter.source.type === "belt" && [5, 6].includes(inserter.source.id))).toHaveLength(2);
    });

    it("states the lanes of its build", () => {
        const facts = laneFactsOf(config);
        const of = (belt_id: number, lane: 1 | 2) => {
            const lane_facts = facts.of(belt_id, lane);
            return [lane_facts.lane_end.kind, lane_facts.sharing, lane_facts.flow_direction];
        };
        const east = { x: 1, y: 0 };
        // the walls and rounds belts end after the last copy's pickup, and the copies share them
        for (const belt_id of [3, 4]) {
            expect([of(belt_id, 1), of(belt_id, 2)]).toEqual([["dead_end", "shared_by_copies", east], ["dead_end", "shared_by_copies", east]]);
        }
        // each copy has coal lanes of its own, which end at its pickup
        for (const belt_id of [5, 6]) {
            expect([of(belt_id, 1), of(belt_id, 2)]).toEqual([["dead_end", "one_per_copy", east], ["dead_end", "one_per_copy", east]]);
        }
        // the packs lanes go on to a loader: the config states the outlet, not only the default
        for (const belt_id of [1, 2]) {
            expect(config.belts.find(belt => belt.id === belt_id)!.lanes[0].lane_end).toEqual({ kind: "outlet" });
            expect(of(belt_id, 1)[0]).toBe("outlet");
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
});
