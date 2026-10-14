import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Option } from "../data-types/option";
import { Machine } from "../entities/machine/machine";
import { MachineConfiguration, MachineConfigurationSchema } from "./schema";
import { checkSidecarImport, LATEST_SIDECAR_VERSION } from "./sidecar-version";
import { inferSuggestedTarget, parseSuggestedTarget, suggestedTargetOf } from "./suggested-target";

type MachineInput = Omit<MachineConfiguration, "id"> & { id?: number };

function machines(...inputs: MachineInput[]): MachineConfiguration[] {
    return inputs.map((input, index) => ({ ...input, id: input.id ?? index + 1 }));
}

/** An assembling machine 2 with no modules */
function assembler(recipe: string, crafting_speed = 0.75, productivity = 0): MachineInput {
    return { recipe, crafting_speed, productivity, type: "machine" };
}

/** What the site's machine facts show as the output rate of this machine */
function factsRate(machine: MachineInput): number {
    return Machine.computeMachineFacts({
        recipe: machine.recipe,
        productivity: machine.productivity,
        crafting_speed: machine.crafting_speed,
        type: machine.type,
        energy_consumption_bonus: machine.energy_consumption_bonus,
        fuel: machine.fuel,
    }).output_rate_per_second;
}

describe("parseSuggestedTarget", () => {
    const valid = { recipe: "transport-belt", items_per_second: 3, copies: 1 };

    it("takes a valid target as it is", () => {
        expect(parseSuggestedTarget(valid)).toEqual(Option.some(valid));
    });

    it("ignores an extra key inside it", () => {
        expect(parseSuggestedTarget({ ...valid, note: "from a newer mod" })).toEqual(Option.some(valid));
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["a string", "transport-belt"],
        ["an empty object", {}],
        ["an empty recipe", { ...valid, recipe: "" }],
        ["a rate of 0", { ...valid, items_per_second: 0 }],
        ["a negative rate", { ...valid, items_per_second: -1 }],
        ["a rate as a string", { ...valid, items_per_second: "3" }],
        ["a rate that is NaN", { ...valid, items_per_second: Number.NaN }],
        ["0 copies", { ...valid, copies: 0 }],
        ["a fraction of a copy", { ...valid, copies: 1.5 }],
    ])("gives None for %s and does not throw", (_, raw) => {
        expect(() => parseSuggestedTarget(raw)).not.toThrow();
        expect(parseSuggestedTarget(raw)).toEqual(Option.none());
    });
});

describe("inferSuggestedTarget", () => {
    it("suggests the product of a single machine at its output rate", () => {
        const gear = assembler("iron-gear-wheel");
        expect(inferSuggestedTarget(machines(gear))).toEqual(
            Option.some({ recipe: "iron-gear-wheel", items_per_second: factsRate(gear), copies: 1 }),
        );
        expect(factsRate(gear)).toBeCloseTo(1.5);
    });

    it("sums the machines of one recipe", () => {
        const slow = assembler("iron-gear-wheel");
        const fast = assembler("iron-gear-wheel", 1.25);
        expect(Option.toNullable(inferSuggestedTarget(machines(slow, fast)))?.items_per_second)
            .toBeCloseTo(factsRate(slow) + factsRate(fast), 10);
    });

    it("skips an intermediate product for the one that consumes it", () => {
        const belt = assembler("transport-belt");
        expect(inferSuggestedTarget(machines(assembler("iron-gear-wheel"), belt))).toEqual(
            Option.some({ recipe: "transport-belt", items_per_second: factsRate(belt), copies: 1 }),
        );
        expect(factsRate(belt)).toBeCloseTo(3);
    });

    it("takes the final product made faster when there are several", () => {
        const gear = assembler("iron-gear-wheel");
        const cable = assembler("copper-cable");
        expect(factsRate(cable)).toBeGreaterThan(factsRate(gear));
        for (const order of [[gear, cable], [cable, gear]]) {
            expect(Option.toNullable(inferSuggestedTarget(machines(...order)))?.recipe).toBe("copper-cable");
        }
    });

    it("takes the product whose name sorts first when the rates are exactly equal", () => {
        const gear = assembler("iron-gear-wheel", 1.5);
        const cable = assembler("copper-cable", 0.75);
        expect(factsRate(gear)).toBe(factsRate(cable));
        for (const order of [[gear, cable], [cable, gear]]) {
            expect(Option.toNullable(inferSuggestedTarget(machines(...order)))?.recipe).toBe("copper-cable");
        }
    });

    it("names the main product, not the recipe", () => {
        const rocket_fuel = assembler("rocket-fuel-from-jelly", 2);
        expect(inferSuggestedTarget(machines(rocket_fuel))).toEqual(
            Option.some({ recipe: "rocket-fuel", items_per_second: factsRate(rocket_fuel), copies: 1 }),
        );
        const foundry = assembler("casting-iron", 4);
        expect(Option.toNullable(inferSuggestedTarget(machines(foundry)))).toEqual(
            { recipe: "iron-plate", items_per_second: factsRate(foundry), copies: 1 },
        );
    });

    it("counts productivity as the machine facts do", () => {
        const productive = assembler("iron-gear-wheel", 0.75, 50);
        expect(Option.toNullable(inferSuggestedTarget(machines(productive)))?.items_per_second).toBe(factsRate(productive));
        expect(factsRate(productive)).toBeCloseTo(2.25);
    });

    it("counts the part of a product productivity ignores as the machine facts do, and a recipe consuming its own product is final", () => {
        const egg: MachineInput = { recipe: "pentapod-egg", crafting_speed: 2, productivity: 50, type: "biochamber" };
        const suggested = Option.toNullable(inferSuggestedTarget(machines(egg)));
        expect(suggested).toEqual({ recipe: "pentapod-egg", items_per_second: factsRate(egg), copies: 1 });
        // (2 - 1) * 1.5 + 1 eggs per 15 s craft at speed 2
        expect(suggested?.items_per_second).toBeCloseTo(2.5 * 2 / 15);
    });

    // a sample's target is the total over its copies, set a little below what the machines make at most
    it.each([
        "science/logistic-science/logistic-science.json",
        "science/agriculture-science/agriculture-science.json",
        "intermediates/advanced-circuit/advanced-circuit.json",
        "intermediates/processing-units/processing-units-belt-export.json",
        "gleba/jellynut-processing/jellynut-processing-rocket-fuel.json",
    ])("agrees with the hand-written target of the sample %s", file => {
        const sample = JSON.parse(fs.readFileSync(
            path.resolve(__dirname, "../../resources/config-samples", file), "utf8",
        )) as { machines: MachineConfiguration[], target_output: { recipe: string, items_per_second: number, copies: number } };
        const suggested = Option.toNullable(inferSuggestedTarget(sample.machines));
        expect(suggested?.recipe).toBe(sample.target_output.recipe);
        expect(suggested!.items_per_second * sample.target_output.copies).toBeGreaterThanOrEqual(sample.target_output.items_per_second);
        expect(suggested?.copies).toBe(1);
    });

    it("suggests nothing for no machines", () => {
        expect(inferSuggestedTarget([])).toEqual(Option.none());
    });

    it("skips an unknown recipe without throwing", () => {
        const gear = assembler("iron-gear-wheel");
        expect(inferSuggestedTarget(machines(assembler("no-such-recipe")))).toEqual(Option.none());
        expect(inferSuggestedTarget(machines(assembler("no-such-recipe"), gear))).toEqual(
            Option.some({ recipe: "iron-gear-wheel", items_per_second: factsRate(gear), copies: 1 }),
        );
    });

    it("suggests nothing when the recipes consume each other's products", () => {
        // the speed module is made of advanced circuits, and recycling it gives advanced circuits back
        expect(Option.toNullable(inferSuggestedTarget(machines(assembler("speed-module"))))?.recipe).toBe("speed-module");
        expect(Option.toNullable(inferSuggestedTarget(machines(assembler("speed-module-recycling"))))?.recipe).toBe("advanced-circuit");
        expect(inferSuggestedTarget(machines(assembler("speed-module"), assembler("speed-module-recycling")))).toEqual(Option.none());
    });
});

describe("suggestedTargetOf", () => {
    const gear = machines(assembler("iron-gear-wheel"));

    it("takes the mod's target over the machines", () => {
        const from_mod = { recipe: "transport-belt", items_per_second: 10, copies: 1 };
        expect(suggestedTargetOf(from_mod, gear)).toEqual(Option.some({ target: from_mod, source: "mod" }));
    });

    it("works it out from the machines when the mod's target is invalid or missing", () => {
        const inferred = Option.some({
            target: { recipe: "iron-gear-wheel", items_per_second: factsRate(gear[0]), copies: 1 },
            source: "inferred",
        });
        expect(suggestedTargetOf({ recipe: "", items_per_second: -1 }, gear)).toEqual(inferred);
        expect(suggestedTargetOf(undefined, gear)).toEqual(inferred);
    });

    it("suggests nothing with no target and no usable machines", () => {
        expect(suggestedTargetOf(undefined, [])).toEqual(Option.none());
        expect(suggestedTargetOf(null, machines(assembler("no-such-recipe")))).toEqual(Option.none());
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

        const suggested = Option.toNullable(suggestedTargetOf(pasted.suggested_target, parsed));
        expect(suggested?.source).toBe(version === "0.8.0" ? "mod" : "inferred");
        expect(suggested?.target.recipe).toBe("transport-belt");
        expect(suggested?.target.items_per_second).toBeCloseTo(3);
    });

    it("says nothing about the latest version", () => {
        const parsed = gear_and_belt.map(machine => MachineConfigurationSchema.parse(machine));
        expect(checkSidecarImport(LATEST_SIDECAR_VERSION, parsed)).toEqual(Option.none());
    });
});
