import {describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {EntityId} from "../entities";
import {circuitExportClockTests} from "../../tests/game/builds/processing-unit-80-circuit-export-generation";

// A real cell (#189) on its scaffold, at 80 processing units a second. Before windows were left out for the inserters whose hands
// take the whole cycle, no clock the generator made held the target (the best, 3 output swings, made 65.19 a second). The hands in
// groups (src/crafting/candidates/grouped-hands.ts) give a clock of one cycle, 24 ticks, that holds and recovers. The selection is
// pinned as it is, so a change to what the generator makes of it shows
// (The backed-up case and the replay of a settled period are in files of their own, so that a shard of the generation tests does not wait on all of them.)
describe("processing units at 80 a second with a circuit export", () => {
    // The export belt (2) is consumed outside the config: the selected clock fills its lanes at their consumption rate, which the
    // two inserters that put circuits on it (16 and 17) move over the simulated period
    circuitExportClockTests(variant => !variant.backed, (selected, config) => {
        const lanes = config.belts.find(it => it.id === 2)!.lanes;
        const consumption_per_second = lanes.reduce((sum, lane) => sum + ("consumption_per_second" in lane ? lane.consumption_per_second! : 0), 0);
        const exported = [16, 17].reduce((sum, number) => {
            const [, transfers] = Array.from(selected.result.transfer_history.entries()).find(([id]) => id.id === EntityId.forInserter(number).id)!;
            return sum + transfers.reduce((total, transfer) => total + transfer.amount, 0);
        }, 0);
        expect(exported).toBe(consumption_per_second * selected.result.simulation_duration.ticks / 60);
    });

    it("exports the circuits on belt 2 at 40 a second a lane", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
        const belt = config.belts.find(it => it.id === 2)!;
        expect(belt.strategy).toBe("export");
        expect(belt.lanes.map(lane => [lane.ingredient, "consumption_per_second" in lane ? lane.consumption_per_second : undefined]))
            .toEqual([["electronic-circuit", 40], ["electronic-circuit", 40]]);
    });
});
