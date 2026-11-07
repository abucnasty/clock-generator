import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Entity, EntityId, Inserter, Machine } from "../../entities";
import { createEntityRegistryFromConfig } from "./simulation-context";
import { SimulationMode, simulationModeForInput } from "./simulation-mode";

/** The utility science chain's inserter 5 and the machine it brings low density structures to, which takes them under 15 */
async function lowDensityStructureInput(): Promise<{ inserter: Inserter; machine: Machine }> {
    const registry = createEntityRegistryFromConfig(await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN));
    const inserter = registry.getEntityByIdOrThrow<Inserter>(EntityId.forInserter(5));
    const machine = registry.getEntityByIdOrThrow(inserter.sink.entity_id);
    if (!Entity.isMachine(machine)) throw new Error("inserter 5 does not put into a machine");
    expect(machine.inputs.get("low-density-structure")?.automated_insertion_limit.quantity).toBe(15);
    return { inserter, machine };
}

describe("the simulation mode of an input inserter", () => {
    it("is low insertion limits where the machine takes the item under the hand the inserter moves of it: 15 under 16", async () => {
        const { inserter, machine } = await lowDensityStructureInput();
        expect(simulationModeForInput(inserter, machine)).toBe(SimulationMode.LOW_INSERTION_LIMITS);
    });

    // its hand of the item, not the hand its research gives: a hand of 15 fits under a limit of 15, a research hand of 16 does not
    it("is normal where its hand of the item is at most the limit, though the research hand is over it", async () => {
        const { inserter, machine } = await lowDensityStructureInput();
        inserter.hand_sizes = new Map(Array.from(inserter.filtered_items, item => [item, 15]));
        expect(simulationModeForInput(inserter, machine)).toBe(SimulationMode.NORMAL);
    });
});
