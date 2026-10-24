import { describe, expect, it } from "vitest";
import * as path from "path";
import { loadConfigFromFile } from "../../../config/loader";
import type { Config } from "../../../config/schema";
import { createEntityRegistryFromConfig } from "../simulation-context";
import { TargetProductionRate } from "../../target-production-rate";
import { CraftingCyclePlan } from "./crafting-cycle";
import { targetInsertersOf, targetMachinesOf } from "./target-ends";
import { fraction } from "../../../data-types/fraction";

// the exact-speed recycler cell of the ore voider benchmark (save F): 400 iron ore a second destroyed, brought in by four
// stack inserters; the recycler (9 crafts a tick) gives a quarter back into its car, which two stack inserters empty into it
const FIXTURE = path.join(__dirname, "..", "..", "fixtures", "ore-voider-F-recycler.json");

async function planOf(edit: (config: Config) => Config = config => config): Promise<CraftingCyclePlan> {
    const config = edit(await loadConfigFromFile(FIXTURE));
    return CraftingCyclePlan.create(TargetProductionRate.fromConfig(config.target_output), createEntityRegistryFromConfig(config), fraction(1), config.overrides ?? {});
}

describe("a target that counts an item destroyed", () => {
    it("is counted at the inserters that bring it in from outside the build, into the machine that destroys it", async () => {
        const config = await loadConfigFromFile(FIXTURE);
        const registry = createEntityRegistryFromConfig(config);
        const target = { item: "iron-ore", counts: "destroyed" as const };
        const machines = targetMachinesOf(target, registry);
        expect(machines.map(it => it.entity_id.id)).toEqual(["machine:1"]);
        // the four from the ore supply; the two from the car bring back what the recycler placed there
        expect(targetInsertersOf(machines[0], target, registry).map(it => it.entity_id.number)).toEqual([3, 4, 5, 6]);
    });

    it("is planned by arithmetic: a 12-tick cycle of 5 hands, 4/3 crafts an ore brought, a quarter of them back", async () => {
        const plan = await planOf();
        // 16 ore a hand at 400/60 a tick is 2.4 ticks; 5 hands are the fewest that last whole ticks
        expect(plan.total_duration_ticks.toString()).toBe("12");
        const transfers = Object.fromEntries(plan.entity_transfer_map.entries_array()
            .map(([entity_id, planned]) => [entity_id.id, planned.total_transfer_count.toString()]));
        // 80 ore brought a cycle, 320/3 crafts, 80/3 ore back: 5/4 hands each of the four, 5/6 each of the two
        expect(transfers).toEqual({
            "inserter:3": "5/4", "inserter:4": "5/4", "inserter:5": "5/4", "inserter:6": "5/4",
            "inserter:1": "5/6", "inserter:2": "5/6",
        });
        // 12 cycles make every hand whole: 144 ticks, 15 hands of each of the four and 10 of each of the two
        expect(EntityTransferLcm(plan)).toBe(12);
    });

    it("is refused where the machine does not place its results itself, or nothing takes them out of its container", async () => {
        await expect(planOf(config => ({ ...config, machines: config.machines.map(({ result_target: _, ...machine }) => machine) })))
            .rejects.toThrow("Machine 1 destroys iron-ore, which is planned for a machine that places its results itself into a container");
        await expect(planOf(config => ({ ...config, inserters: config.inserters.filter(it => it.source.id !== 1) })))
            .rejects.toThrow("Machine 1 places iron-ore into chest:1, and no inserter takes it out: it fills up");
    });
});

function EntityTransferLcm(plan: CraftingCyclePlan): number {
    const denominators = plan.entity_transfer_map.entries_array().map(([, planned]) => planned.total_transfer_count.getDenominator);
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    return denominators.reduce((lcm, denominator) => lcm / gcd(lcm, denominator) * denominator, 1);
}
