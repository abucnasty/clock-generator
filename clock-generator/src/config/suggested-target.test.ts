import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as O from "fp-ts/Option";
import { computeMachineFacts } from "../entities/traits/machine-facts-of";
import { targetRateMaxOf } from "../crafting/feasibility/max-rate";
import { BeltConfig, Config, ConfigSchema, InserterConfig, MachineConfiguration, MachineConfigurationSchema } from "./schema";
import { checkSidecarImport, LATEST_SIDECAR_VERSION } from "./sidecar-version";
import { inferSuggestedTarget, parseSuggestedTarget, suggestedTargetOf } from "./suggested-target";

type MachineInput = Omit<MachineConfiguration, "id"> & { id?: number };

function machines(...inputs: MachineInput[]): MachineConfiguration[] {
    return inputs.map((input, index) => ({ ...input, id: input.id ?? index + 1 }));
}

/** An assembling machine 2 with no modules */
function assembler(recipe: string, crafting_speed = 0.75, productivity = 0): MachineInput {
    return { recipe, crafting_speed, productivity };
}

/** What the site's machine facts show as the output rate of this machine */
function factsRate(machine: MachineInput): number {
    return computeMachineFacts({
        recipe: machine.recipe,
        productivity: machine.productivity,
        crafting_speed: machine.crafting_speed,
        prototype: machine.prototype,
        energy_consumption_bonus: machine.energy_consumption_bonus,
        fuel: machine.fuel,
    }).output_rate_per_second;
}

describe("parseSuggestedTarget", () => {
    const valid = { item: "transport-belt", items_per_second: 3, copies: 1 };

    it("takes a valid target as it is", () => {
        expect(parseSuggestedTarget(valid)).toEqual(O.some(valid));
    });

    it.each([5.5, 2.25, 0.5, 0.001, 0.0625])("keeps supported fractional Copies %s", copies => {
        const target = { ...valid, copies };
        expect(parseSuggestedTarget(target)).toEqual(O.some(target));
    });

    it("ignores an extra key inside it", () => {
        expect(parseSuggestedTarget({ ...valid, note: "from a newer mod" })).toEqual(O.some(valid));
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["a string", "transport-belt"],
        ["an empty object", {}],
        ["an empty item", { ...valid, item: "" }],
        ["a rate of 0", { ...valid, items_per_second: 0 }],
        ["a negative rate", { ...valid, items_per_second: -1 }],
        ["a rate as a string", { ...valid, items_per_second: "3" }],
        ["a rate that is NaN", { ...valid, items_per_second: Number.NaN }],
        ["0 copies", { ...valid, copies: 0 }],
        ["an unsupported fraction of a copy", { ...valid, copies: 0.0001 }],
    ])("gives None for %s and does not throw", (_, raw) => {
        expect(() => parseSuggestedTarget(raw)).not.toThrow();
        expect(parseSuggestedTarget(raw)).toEqual(O.none);
    });
});

describe("parseSuggestedTarget, for the field the Sidecar writes (`recipe`) and the one a setpoint holds (`item`)", () => {
    const pasted = { recipe: "transport-belt", items_per_second: 3, copies: 1 };

    it("gives a pasted `recipe` as the target's `item`, with the rest as it was", () => {
        expect(parseSuggestedTarget(pasted)).toEqual(O.some({ item: "transport-belt", items_per_second: 3, copies: 1 }));
        expect(O.toNullable(parseSuggestedTarget(pasted))).not.toHaveProperty("recipe");
    });

    it("takes a pasted `item` as it is, and takes `item` where both are given", () => {
        const item = { item: "transport-belt", items_per_second: 3, copies: 1 };
        expect(parseSuggestedTarget(item)).toEqual(O.some(item));
        expect(parseSuggestedTarget({ ...pasted, item: "iron-gear-wheel" })).toEqual(O.some({ ...item, item: "iron-gear-wheel" }));
    });

    it("gives None for an empty name under either key", () => {
        expect(parseSuggestedTarget({ ...pasted, recipe: "" })).toEqual(O.none);
        expect(parseSuggestedTarget({ item: "", items_per_second: 3, copies: 1 })).toEqual(O.none);
    });

    it("names the item of a target worked out from the machines", () => {
        expect(O.toNullable(inferSuggestedTarget(machines(assembler("iron-gear-wheel"))))).toHaveProperty("item", "iron-gear-wheel");
        expect(O.toNullable(inferSuggestedTarget(machines(assembler("iron-gear-wheel"))))).not.toHaveProperty("recipe");
    });
});

describe("inferSuggestedTarget", () => {
    it("suggests the product of a single machine at its output rate", () => {
        const gear = assembler("iron-gear-wheel");
        expect(inferSuggestedTarget(machines(gear))).toEqual(
            O.some({ item: "iron-gear-wheel", items_per_second: factsRate(gear), copies: 1 }),
        );
        expect(factsRate(gear)).toBeCloseTo(1.5);
    });

    it("sums the machines of one recipe", () => {
        const slow = assembler("iron-gear-wheel");
        const fast = assembler("iron-gear-wheel", 1.25);
        expect(O.toNullable(inferSuggestedTarget(machines(slow, fast)))?.items_per_second)
            .toBeCloseTo(factsRate(slow) + factsRate(fast), 10);
    });

    it("skips an intermediate product for the one that consumes it", () => {
        const belt = assembler("transport-belt");
        expect(inferSuggestedTarget(machines(assembler("iron-gear-wheel"), belt))).toEqual(
            O.some({ item: "transport-belt", items_per_second: factsRate(belt), copies: 1 }),
        );
        expect(factsRate(belt)).toBeCloseTo(3);
    });

    it("takes the final product made faster when there are several", () => {
        const gear = assembler("iron-gear-wheel");
        const cable = assembler("copper-cable");
        expect(factsRate(cable)).toBeGreaterThan(factsRate(gear));
        for (const order of [[gear, cable], [cable, gear]]) {
            expect(O.toNullable(inferSuggestedTarget(machines(...order)))?.item).toBe("copper-cable");
        }
    });

    it("takes the product whose name sorts first when the rates are exactly equal", () => {
        const gear = assembler("iron-gear-wheel", 1.5);
        const cable = assembler("copper-cable", 0.75);
        expect(factsRate(gear)).toBe(factsRate(cable));
        for (const order of [[gear, cable], [cable, gear]]) {
            expect(O.toNullable(inferSuggestedTarget(machines(...order)))?.item).toBe("copper-cable");
        }
    });

    it("names the main product, not the recipe", () => {
        const rocket_fuel = assembler("rocket-fuel-from-jelly", 2);
        expect(inferSuggestedTarget(machines(rocket_fuel))).toEqual(
            O.some({ item: "rocket-fuel", items_per_second: factsRate(rocket_fuel), copies: 1 }),
        );
        const foundry = assembler("casting-iron", 4);
        expect(O.toNullable(inferSuggestedTarget(machines(foundry)))).toEqual(
            { item: "iron-plate", items_per_second: factsRate(foundry), copies: 1 },
        );
    });

    it("counts productivity as the machine facts do", () => {
        const productive = assembler("iron-gear-wheel", 0.75, 50);
        expect(O.toNullable(inferSuggestedTarget(machines(productive)))?.items_per_second).toBe(factsRate(productive));
        expect(factsRate(productive)).toBeCloseTo(2.25);
    });

    it("counts the part of a product productivity ignores as the machine facts do, and a recipe consuming its own product is final", () => {
        const egg: MachineInput = { recipe: "pentapod-egg", crafting_speed: 2, productivity: 50, prototype: "biochamber" };
        const suggested = O.toNullable(inferSuggestedTarget(machines(egg)));
        expect(suggested).toEqual({ item: "pentapod-egg", items_per_second: factsRate(egg), copies: 1 });
        // (2 - 1) * 1.5 + 1 eggs per 15 s craft at speed 2
        expect(suggested?.items_per_second).toBeCloseTo(2.5 * 2 / 15);
    });

    // a sample's target is the total over its copies, set a little below what the machines make at most
    it.each([
        "science/logistic/logistic-240.json",
        "science/agricultural/agricultural-250.json",
        "intermediates/advanced-circuit/advanced-circuit-240.json",
        "gleba/rocket-fuel/rocket-fuel-60.json",
    ])("agrees with the hand-written target of the sample %s", file => {
        const sample = JSON.parse(fs.readFileSync(
            path.resolve(__dirname, "../../resources/config-samples", file), "utf8",
        )) as { machines: MachineConfiguration[], setpoint: { item: string, items_per_second: number, copies: number } };
        const suggested = O.toNullable(inferSuggestedTarget(sample.machines));
        expect(suggested?.item).toBe(sample.setpoint.item);
        expect(suggested!.items_per_second * sample.setpoint.copies).toBeGreaterThanOrEqual(sample.setpoint.items_per_second);
        expect(suggested?.copies).toBe(1);
    });

    it("suggests nothing for no machines", () => {
        expect(inferSuggestedTarget([])).toEqual(O.none);
    });

    it("skips an unknown recipe without throwing", () => {
        const gear = assembler("iron-gear-wheel");
        expect(inferSuggestedTarget(machines(assembler("no-such-recipe")))).toEqual(O.none);
        expect(inferSuggestedTarget(machines(assembler("no-such-recipe"), gear))).toEqual(
            O.some({ item: "iron-gear-wheel", items_per_second: factsRate(gear), copies: 1 }),
        );
    });

    it("suggests nothing when the recipes consume each other's products", () => {
        // the speed module is made of advanced circuits, and recycling it gives advanced circuits back
        expect(O.toNullable(inferSuggestedTarget(machines(assembler("speed-module"))))?.item).toBe("speed-module");
        expect(O.toNullable(inferSuggestedTarget(machines(assembler("speed-module-recycling"))))?.item).toBe("advanced-circuit");
        expect(inferSuggestedTarget(machines(assembler("speed-module"), assembler("speed-module-recycling")))).toEqual(O.none);
    });
});

describe("suggestedTargetOf", () => {
    const gear = machines(assembler("iron-gear-wheel"));

    it("takes the mod's target over the machines", () => {
        const from_mod = { recipe: "transport-belt", items_per_second: 10, copies: 1 };
        expect(suggestedTargetOf(from_mod, gear)).toEqual(O.some({ target: { item: "transport-belt", items_per_second: 10, copies: 1 }, source: "mod" }));
    });

    it("works it out from the machines when the mod's target is invalid or missing", () => {
        const inferred = O.some({
            target: { item: "iron-gear-wheel", items_per_second: factsRate(gear[0]), copies: 1 },
            source: "inferred",
        });
        expect(suggestedTargetOf({ recipe: "", items_per_second: -1 }, gear)).toEqual(inferred);
        expect(suggestedTargetOf(undefined, gear)).toEqual(inferred);
    });

    it("suggests nothing with no target and no usable machines", () => {
        expect(suggestedTargetOf(undefined, [])).toEqual(O.none);
        expect(suggestedTargetOf(null, machines(assembler("no-such-recipe")))).toEqual(O.none);
    });
});

describe("suggestedTargetOf, held to the belt the product is put on", () => {
    // the automation science sample's unit, nine times in one selection as a paste gives it: copies 1, nine machines
    // that make 248.006 a second together, all dropping onto belt 2, a turbo belt with stacks of 4 (240 a second)
    const sample = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, "../../resources/config-samples/science/automation/automation-240.json"), "utf8",
    )) as Config;
    const pasted = (count: number, output_belt: Partial<BeltConfig> = {}) => {
        const unit = sample.machines[0];
        const machines = Array.from({ length: count }, (_, index) => ({ ...unit, id: index + 1 }));
        const inserters: InserterConfig[] = machines.flatMap(machine => [
            { ...sample.inserters[0], sink: { type: "machine" as const, id: machine.id } },
            { ...sample.inserters[1], source: { type: "machine" as const, id: machine.id } },
        ]).map((inserter, index) => ({ ...inserter, id: index + 1 }));
        const belts = [sample.belts[0], { ...sample.belts[1], ...output_belt } as BeltConfig];
        return { machines, outputs: { inserters, belts } };
    };
    const from_mod = (machines: readonly MachineConfiguration[]) => O.toNullable(inferSuggestedTarget(machines))!;

    it("lowers the suggestion to what the output belt carries: 248.006 a second against 240", () => {
        const { machines, outputs } = pasted(9);
        expect(from_mod(machines).items_per_second).toBeCloseTo(248.006, 3);
        for (const raw of [from_mod(machines), undefined]) {
            const suggested = O.toNullable(suggestedTargetOf(raw, machines, outputs));
            expect(suggested?.target).toEqual({ item: "automation-science-pack", items_per_second: 240, copies: 1 });
            expect(suggested?.belt_limit).toEqual({ belt_id: 2, machines_per_second: from_mod(machines).items_per_second });
        }
    });

    describe("with the rest of the paste, held to the most the build can hold", () => {
        // the input belt is a fast belt: each ingredient lane carries 60 a second, so the build holds at most 120 a
        // second, less than the turbo output belt's 240
        const slow_input = () => {
            const { machines, outputs } = pasted(9);
            const belts = [{ ...outputs.belts[0], type: "fast-transport-belt" } as BeltConfig, outputs.belts[1]];
            return { machines, outputs: { ...outputs, belts } };
        };
        const configAt = (items_per_second: number, machines: MachineConfiguration[], outputs: { inserters: InserterConfig[], belts: BeltConfig[] }) =>
            ConfigSchema.parse({ setpoint: { item: "automation-science-pack", items_per_second, copies: 1 }, overrides: {}, machines,
                inserters: outputs.inserters, belts: outputs.belts, chests: [] }) as Config;

        it("lowers it to an input lane that allows less than the output belt, and gives the engine's words for that limit", () => {
            const { machines, outputs } = slow_input();
            const made = from_mod(machines).items_per_second;
            const suggested = O.toNullable(suggestedTargetOf(from_mod(machines), machines, outputs, { chests: [], drills: [] }));
            const most = targetRateMaxOf(configAt(made, machines, outputs));
            expect(most?.cut).toMatch(/^C2 /);
            expect(suggested).toEqual({ target: { item: "automation-science-pack", items_per_second: 120, copies: 1 }, source: "mod",
                build_limit: { machines_per_second: made, text: most!.limit } });
            expect(most!.limit).toMatch(/^At most 60 a second of (copper plate|iron gear wheel) reaches the machines/);
            // at the suggested rate the site's check finds nothing above the most
            const at_suggested = targetRateMaxOf(configAt(suggested!.target.items_per_second, machines, outputs));
            expect(at_suggested!.per_copy_per_second).toBeGreaterThanOrEqual(suggested!.target.items_per_second);
            expect(at_suggested!.limit).toBeNull();
        });

        it("names the output belt where it is the lower limit, as without the rest of the paste", () => {
            const { machines, outputs } = pasted(9, { type: "fast-transport-belt" });
            expect(suggestedTargetOf(from_mod(machines), machines, outputs, { chests: [], drills: [] }))
                .toEqual(suggestedTargetOf(from_mod(machines), machines, outputs));
        });

        it("leaves a paste with no belts as it is", () => {
            const { machines, outputs } = pasted(9);
            const no_belts = { inserters: outputs.inserters.filter(inserter => inserter.sink.type !== "belt" && inserter.source.type !== "belt"), belts: [] };
            expect(O.toNullable(suggestedTargetOf(from_mod(machines), machines, no_belts, { chests: [], drills: [] })))
                .toEqual({ target: from_mod(machines), source: "mod" });
        });
    });

    it("keeps the reason for an export the sidecar already lowered to what the belt carries", () => {
        const { machines, outputs } = pasted(9);
        const lowered = { recipe: "automation-science-pack", items_per_second: 240, copies: 1 };
        expect(O.toNullable(suggestedTargetOf(lowered, machines, outputs))).toEqual({ target: { item: lowered.recipe, items_per_second: 240, copies: 1 }, source: "mod",
            belt_limit: { belt_id: 2, machines_per_second: from_mod(machines).items_per_second } });
    });

    it("lowers it to a slower belt: a fast belt carries 120, which the engine's most for the build says too", () => {
        const { machines, outputs } = pasted(9, { type: "fast-transport-belt" });
        const suggested = O.toNullable(suggestedTargetOf(from_mod(machines), machines, outputs));
        expect(suggested?.target.items_per_second).toBe(120);
        // the build as the paste gives it, with the suggestion as its setpoint
        const config = { setpoint: { item: "automation-science-pack", items_per_second: 120, copies: 1 }, overrides: {}, machines,
            inserters: outputs.inserters, belts: outputs.belts, chests: [] };
        const most = targetRateMaxOf(ConfigSchema.parse(config) as Config);
        expect(most?.cut).toBe("C3 automation-science-pack");
        expect(most?.per_copy_per_second).toBe(suggested?.target.items_per_second);
    });

    it("keeps the machines' rate when the belt carries more", () => {
        const { machines, outputs } = pasted(1);
        const suggested = O.toNullable(suggestedTargetOf(from_mod(machines), machines, outputs));
        expect(suggested).toEqual({ target: from_mod(machines), source: "mod" });
    });

    it("keeps the machines' rate when the product goes into a chest, not onto a belt", () => {
        const { machines, outputs } = pasted(9);
        const into_chest = outputs.inserters.map(inserter => inserter.sink.type === "belt"
            ? { ...inserter, sink: { type: "chest" as const, id: 1 } } : inserter);
        const suggested = O.toNullable(suggestedTargetOf(from_mod(machines), machines, { ...outputs, inserters: into_chest }));
        expect(suggested).toEqual({ target: from_mod(machines), source: "mod" });
    });

    it("keeps the machines' rate when the product goes onto more than one belt", () => {
        const { machines, outputs } = pasted(9);
        const third = { ...outputs.belts[1], id: 3 } as BeltConfig;
        const split = outputs.inserters.map((inserter, index) => inserter.sink.type === "belt" && index > 9
            ? { ...inserter, sink: { ...inserter.sink, id: 3 } } : inserter);
        const suggested = O.toNullable(suggestedTargetOf(from_mod(machines), machines, { inserters: split, belts: [...outputs.belts, third] }));
        expect(suggested).toEqual({ target: from_mod(machines), source: "mod" });
    });
});

describe("exports of every sidecar version", () => {
    const gear_and_belt = [
        { id: 1, recipe: "iron-gear-wheel", crafting_speed: 0.75, productivity: 0, type: "machine" },
        { id: 2, recipe: "transport-belt", crafting_speed: 0.75, productivity: 0, type: "machine" },
    ];
    const inserters = [{ source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, stack_size: 1 }];
    const exports = {
        "before 0.6.0": { machines: gear_and_belt, drills: [], inserters, belts: [], chests: [] },
        "0.6.0": {
            sidecar_version: "0.6.0", machines: gear_and_belt,
            drills: { mining_productivity_level: 0, configs: [] }, inserters, belts: [], chests: [],
        },
        "0.7.0": {
            sidecar_version: "0.7.0", machines: gear_and_belt,
            drills: { mining_productivity_level: 0, configs: [] }, inserters, belts: [], chests: [],
        },
        "0.8.0": {
            sidecar_version: "0.8.0",
            suggested_target: { recipe: "transport-belt", items_per_second: 3, copies: 1 },
            machines: gear_and_belt,
            drills: { mining_productivity_level: 0, configs: [] }, inserters, belts: [], chests: [],
        },
    };

    it.each(Object.entries(exports))("imports an export of %s as before, with a suggested target", (version, exported) => {
        const pasted = exported as { sidecar_version?: unknown, suggested_target?: unknown, machines: unknown[] };
        const parsed = pasted.machines.map(machine => MachineConfigurationSchema.parse(machine));
        expect(() => checkSidecarImport(pasted.sidecar_version, parsed)).not.toThrow();

        const suggested = O.toNullable(suggestedTargetOf(pasted.suggested_target, parsed));
        expect(suggested?.source).toBe(version === "0.8.0" ? "mod" : "inferred");
        expect(suggested?.target.item).toBe("transport-belt");
        expect(suggested?.target.items_per_second).toBeCloseTo(3);
    });

    it("says nothing about the latest version", () => {
        const parsed = gear_and_belt.map(machine => MachineConfigurationSchema.parse(machine));
        expect(checkSidecarImport(LATEST_SIDECAR_VERSION, parsed)).toEqual(O.none);
    });
});

describe("a paste whose machines make a recipe with several outputs", () => {
    // the paste counts what the engine counts (`outputItemOf`), whatever the setpoint's rule offers
    it.each([
        ["iron-bacteria", "spoilage"],
        ["copper-bacteria", "spoilage"],
        ["metallic-asteroid-reprocessing", "metallic-asteroid-chunk"],
        ["kovarex-enrichment-process", "uranium-235"],
        ["jellynut-processing", "jelly"],
    ])("suggests the item the engine counts for %s: %s", (recipe, item) => {
        const machine = assembler(recipe);
        expect(inferSuggestedTarget(machines(machine))).toEqual(O.some({ item, items_per_second: factsRate(machine), copies: 1 }));
        expect(O.toNullable(suggestedTargetOf(undefined, machines(machine), { inserters: [], belts: [] }, { chests: [], drills: [] }))?.target.item).toBe(item);
    });

    it("sums the machines of the two bacteria recipes as spoilage", () => {
        const both = machines(assembler("iron-bacteria"), assembler("copper-bacteria"));
        expect(O.toNullable(inferSuggestedTarget(both))?.items_per_second).toBeCloseTo(factsRate(both[0]) + factsRate(both[1]), 10);
    });

    it("keeps a pasted setpoint that names an item the engine does not count yet, and loses the build's limit: the check of the build refuses it", () => {
        const pasted = { recipe: "jellynut-seed", items_per_second: 1, copies: 1 };
        const sample = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../resources/config-samples/science/automation/automation-240.json"), "utf8")) as Config;
        const build = machines(assembler("jellynut-processing"));
        const suggested = O.toNullable(suggestedTargetOf(pasted, build, { inserters: [], belts: [sample.belts[1]] }, { chests: [], drills: [] }));
        expect(suggested).toEqual({ target: { item: "jellynut-seed", items_per_second: 1, copies: 1 }, source: "mod" });
        expect(suggested).not.toHaveProperty("build_limit");
        const refused = ConfigSchema.safeParse({ setpoint: suggested!.target, machines: build, inserters: [], belts: [] });
        expect(refused.success).toBe(false);
        expect(refused.error?.issues.some(issue => issue.path.join(".") === "setpoint.item")).toBe(true);
    });
});
