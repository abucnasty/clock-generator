import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { InserterConfigSchema, type Config } from "../../config/schema";
import { generateClockForConfig } from "../../crafting/generate-blueprint";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { Entity } from "../entity";
import { handSizeFor, Inserter } from "./inserter";

/** The automation science sample with the given fields set on its inserters, one of them or all */
async function sampleWith(fields: Record<string, unknown>, only_first = false): Promise<Config> {
    const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
    config.inserters = config.inserters.map((inserter, index) => {
        if (only_first && index > 0) {
            return inserter;
        }
        const changed: Record<string, unknown> = { ...inserter, ...fields };
        for (const [key, value] of Object.entries(changed)) {
            if (value === undefined) {
                delete changed[key];
            }
        }
        return changed as Config["inserters"][number];
    });
    return config;
}

/** The inserters of the sample as the simulation makes them, in the order of the config */
function insertersOf(config: Config): Inserter[] {
    return SimulationContext.fromConfig(config).entity_registry.getAll().filter(Entity.isInserter);
}

describe("an inserter that names its prototype and quality", () => {
    it("runs the legendary stack inserter and the configured hand when the config names neither", async () => {
        const [belt_to_machine, machine_to_belt] = insertersOf(await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE));
        for (const inserter of [belt_to_machine, machine_to_belt]) {
            expect(inserter.metadata.type).toBe("stack-inserter");
            expect(inserter.metadata.quality).toBe("legendary");
            expect(inserter.metadata.stack_size).toBe(16);
            expect(inserter.animation.rotation.ticks).toBe(3);
        }
        expect(belt_to_machine.animation.pickup.ticks).toBe(4);
        expect(belt_to_machine.animation.drop.ticks).toBe(1);
        expect(machine_to_belt.animation.pickup.ticks).toBe(1);
    });

    it("runs the same as a config that names the legendary stack inserter", async () => {
        const [plain] = insertersOf(await sampleWith({}));
        const [named] = insertersOf(await sampleWith({ prototype: "stack-inserter", quality: "legendary" }));
        expect(named.animation).toEqual(plain.animation);
        expect(named.metadata.stack_size).toBe(plain.metadata.stack_size);
    });

    it("turns a rare stack inserter for 6 ticks each way, 14 ticks machine to machine", async () => {
        const config = await sampleWith({ prototype: "stack-inserter", quality: "rare" }, true);
        const [rare, untouched] = insertersOf(config);
        expect(rare.metadata.quality).toBe("rare");
        expect(rare.animation.rotation.ticks).toBe(6);
        expect(rare.animation.pickup.ticks).toBe(4);
        // the one that was not changed is still the legendary one
        expect(untouched.animation.rotation.ticks).toBe(3);
        // the machine to machine swing of the same inserter
        expect(1 + 1 + 2 * rare.animation.rotation.ticks).toBe(14);
    });

    it("turns a normal fast inserter for 11 ticks each way, 24 ticks machine to machine, with a hand of 4", async () => {
        const config = await sampleWith({ prototype: "fast-inserter", quality: "normal", stack_size: undefined }, true);
        const [fast, untouched] = insertersOf(config);
        expect(fast.metadata.type).toBe("fast-inserter");
        expect(fast.animation.rotation.ticks).toBe(11);
        expect(1 + 1 + 2 * fast.animation.rotation.ticks).toBe(24);
        expect(fast.metadata.stack_size).toBe(4);
        expect(handSizeFor(fast, "copper-plate")).toBe(4);
        expect(untouched.metadata.stack_size).toBe(16);
    });

    it("takes the stack size the config sets over the hand of the prototype", async () => {
        const [fast] = insertersOf(await sampleWith({ prototype: "fast-inserter", quality: "normal", stack_size: 2 }, true));
        expect(fast.metadata.stack_size).toBe(2);
    });

    it("is read from the config: the stack size is optional, the quality is one of the five", () => {
        const inserter = { source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 } };
        expect(InserterConfigSchema.parse(inserter)).toEqual(inserter);
        expect(InserterConfigSchema.parse({ ...inserter, prototype: "fast-inserter", quality: "epic" })).toMatchObject({ prototype: "fast-inserter", quality: "epic" });
        expect(() => InserterConfigSchema.parse({ ...inserter, quality: "mythic" })).toThrow();
    });

    it("refuses the burner inserter and a name that is not an inserter", async () => {
        await expect(async () => insertersOf(await sampleWith({ prototype: "burner-inserter" }))).rejects.toThrow("burner inserter needs fuel");
        await expect(async () => insertersOf(await sampleWith({ prototype: "assembling-machine-3" }))).rejects.toThrow("not an inserter of the game data");
    });

    it("generates a clock for the sample with normal fast inserters, whatever its verdict", async () => {
        const config = await sampleWith({ prototype: "fast-inserter", quality: "normal", stack_size: undefined });
        const result = generateClockForConfig(config);
        expect(result).toBeDefined();
        expect(result.serializable_transfer_plan.entities.length).toBeGreaterThan(0);
        for (const planned of result.serializable_transfer_plan.entities) {
            expect(planned.stack_size).toBe(4);
        }
    });
});
