import {describe, expect, it} from "vitest";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {cell02SelectionTests} from "../../tests/game/builds/stupidfathobbit-cell02-generation";

// A real cell (#189) on its scaffold, at 80 processing units a second. Before windows were left out for the inserters whose hands
// take the whole cycle, no clock the generator made held the target (the best, 3 output swings, made 65.19 a second). The hands in
// groups (src/crafting/candidates/grouped-hands.ts) give a clock of one cycle, 24 ticks, that holds and recovers. The selection is
// pinned as it is, so a change to what the generator makes of it shows
// (The backed-up case and the replay of a settled period are in files of their own, so that a shard of the generation tests does not wait on all of them.)
describe("the real stupidfathobbit cell 02", () => {
    cell02SelectionTests(variant => !variant.backed);

    it("exports the circuits on belt 2 at 40 a second a lane", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const belt = config.belts.find(it => it.id === 2)!;
        expect(belt.strategy).toBe("export");
        expect(belt.lanes.map(lane => [lane.ingredient, "consumption_per_second" in lane ? lane.consumption_per_second : undefined]))
            .toEqual([["electronic-circuit", 40], ["electronic-circuit", 40]]);
    });
});
