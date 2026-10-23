import {createHash} from "crypto";
import {describe, expect, it} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {quiet} from "./generate-blueprint-test-helpers";

// A real cell (#189) on the owner's scaffold: no clock holds the target of 80 a second. The result is pinned as it
// is, so a change to what the generator makes of it shows
describe("the real stupidfathobbit cell 02", () => {
    it.each([["as it is", false], ["with backed-up belts", true]])("selects the 1-swing clock, unstable at 69.09 a second, %s", async (_name, backed_up_belts) => {
        const loaded = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const config = backed_up_belts ? {...loaded, overrides: {...loaded.overrides, backed_up_belts: true}} : loaded;
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("swings-1");
        expect(selected.verdict).toBe("unstable");
        expect(selected.assessment.holds).toBe(false);
        expect(selected.assessment.items_per_second).toBeCloseTo(69.0909, 4);
        expect(selected.belt).toEqual({kind: "backed_up"});
        const exported = selected.result.subtick ?? selected.result;
        expect(selected.result.simulation_duration.ticks).toBe(528);
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"))
            .toBe("c1b06b5232d4a0bd294cc35e361e98890cf8da8e9ab1d253e697b96cfc1ae824");
        // no clock reaches the target, and the generation says so
        expect(generated.alternatives.every(alternative => alternative.verdict === "unstable")).toBe(true);
        expect(generated.why_not_stable?.cause).toBe("nothing holds");
        expect(generated.why_not_stable?.message).toContain("No clock holds the target rate of 80 a second. The closest, 1 output swing per cycle, moves 69.09 a second");
    }, 120_000);

    it("exports the circuits on belt 2 at 40 a second a lane", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const belt = config.belts.find(it => it.id === 2)!;
        expect(belt.strategy).toBe("export");
        expect(belt.lanes.map(lane => [lane.ingredient, "consumption_per_second" in lane ? lane.consumption_per_second : undefined]))
            .toEqual([["electronic-circuit", 40], ["electronic-circuit", 40]]);
    });
});
