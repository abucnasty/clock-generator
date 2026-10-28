import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { Entity } from "../entity";
import { Machine } from "../machine/machine";
import { buildTraits, MachineTraits } from "./build-traits";
import { machineFactsOf } from "./machine-facts-of";

describe("the machine facts of the traits", () => {
    it("are the machine facts of every machine of every sample", async () => {
        let machines = 0;
        for (const [key, file] of Object.entries(ConfigPaths)) {
            const config = await loadConfigFromFile(file) as Config;
            const traits = buildTraits(config);
            for (const machine of SimulationContext.fromConfig(config).entity_registry.getAll().filter(Entity.isMachine)) {
                const facts = machineFactsOf(traits[machine.entity_id.id] as MachineTraits);
                expect(facts, `${key} ${machine.entity_id.id}`).toStrictEqual(Machine.getMachineFacts(machine));
                machines += 1;
            }
        }
        expect(machines).toBeGreaterThan(100);
    });
});
