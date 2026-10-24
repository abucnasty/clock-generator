import {createHash} from "crypto";
import {describe, expect, it} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {quiet} from "./generate-blueprint-test-helpers";

// A real cell (#189) on its scaffold: no clock holds the target of 80 a second. The result is pinned as it
// is, so a change to what the generator makes of it shows
describe("the real stupidfathobbit cell 02", () => {
    it.each([["as it is", false], ["with backed-up belts", true]])("selects the 3-swing clock, unstable at 65.19 a second, %s", async (_name, backed_up_belts) => {
        const loaded = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const config = backed_up_belts ? {...loaded, overrides: {...loaded.overrides, backed_up_belts: true}} : loaded;
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("swings-3");
        expect(selected.verdict).toBe("unstable");
        expect(selected.assessment.holds).toBe(false);
        expect(selected.assessment.items_per_second).toBeCloseTo(65.1894, 4);
        // a clock that fails its first check is listed by the mean items of its long run, 1721 a period of 1584 ticks
        expect(selected.result.stability_check.as_built).toMatchObject({holds: false, actual_output_items: 1721, output_basis: "long-run mean"});
        expect(selected.belt).toEqual({kind: "backed_up"});
        const exported = selected.result.subtick ?? selected.result;
        expect(selected.result.simulation_duration.ticks).toBe(1584);
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"))
            .toBe("faac97a6a6bc1668c51b229a86c1014aaa0016564caf6eb9b5fbb5b1ba08cce0");
        // no clock reaches the target, and the generation says so
        expect(generated.alternatives.every(alternative => alternative.verdict === "unstable")).toBe(true);
        // listed by the mean of the long run: the game makes 62.1 with swings-1 and 66.4 with swings-3
        const rates = Object.fromEntries(generated.alternatives.filter(it => it.id.startsWith("swings-")).map(it => [it.id, Number(it.assessment.items_per_second.toFixed(2))]));
        expect(rates["swings-1"]).toBe(61.93);
        expect(rates["swings-3"]).toBe(65.19);
        expect(generated.why_not_stable?.cause).toBe("nothing holds");
        expect(generated.why_not_stable?.message).toContain("No clock holds the target rate of 80 a second. The closest, 3 output swings per cycle, moves 65.19 a second");
    }, 120_000);

    it("exports the circuits on belt 2 at 40 a second a lane", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const belt = config.belts.find(it => it.id === 2)!;
        expect(belt.strategy).toBe("export");
        expect(belt.lanes.map(lane => [lane.ingredient, "consumption_per_second" in lane ? lane.consumption_per_second : undefined]))
            .toEqual([["electronic-circuit", 40], ["electronic-circuit", 40]]);
    });
});
