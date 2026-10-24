import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { computeMachineTargetRates } from "./machine-target-rates";
import { ConfigPaths } from "../config/config-paths";

// the exact-speed recycler cell of the ore voider benchmark (save F): 400 iron ore a second destroyed, a quarter of the
// 1600/3 crafts a second given back into its car, which two inserters empty back into the recycler
const FIXTURE = ConfigPaths.REAL_OWNER_ORE_VOIDER_EXACT_SPEED;

describe("the at-target rates of a machine that places its results itself", () => {
    it("are what its plan takes out of the container it places them into, against what it can make", async () => {
        const [recycler] = computeMachineTargetRates(await loadConfigFromFile(FIXTURE));
        expect(recycler.machine_id).toBe(1);
        // 1600/3 crafts a second at a quarter of an ore each
        expect(recycler.output_rate_per_second).toBeCloseTo(400 / 3, 9);
        // 540 crafts a second at crafting speed 16.875
        expect(recycler.crafting_share).toBeCloseTo(1600 / 3 / 540, 9);
    });
});
