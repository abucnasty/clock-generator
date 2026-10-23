import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import "../data/factorio-data-file";
import { Machine } from "../entities/machine/machine";
import { parseConfig } from "./loader";
import { machinePrototypeIssues, machinePrototypesNote, machineRuleOf } from "./machine-prototype";
import { ConfigSchema, MachineConfiguration } from "./schema";

const machine = (fields: Partial<MachineConfiguration>): MachineConfiguration =>
    ({ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1, ...fields });

describe("a machine's rule from its prototype", () => {
    it("is the prototype's when the config sets no type", () => {
        expect(machineRuleOf(machine({ prototype: "electric-furnace" }))).toBe("furnace");
        expect(machineRuleOf(machine({ prototype: "recycler" }))).toBe("furnace");
        expect(machineRuleOf(machine({ prototype: "biochamber" }))).toBe("biochamber");
        expect(machineRuleOf(machine({ prototype: "cryogenic-plant" }))).toBe("machine");
    });

    it("is the type when the config sets one, and the crafting rule with neither or an unknown prototype", () => {
        expect(machineRuleOf(machine({ prototype: "electric-furnace", type: "machine" }))).toBe("machine");
        expect(machineRuleOf(machine({}))).toBe("machine");
        expect(machineRuleOf(machine({ prototype: "modded-smelter" }))).toBe("machine");
    });

    it("decides the simulation: a furnace by prototype alone holds a stack, as one by type", () => {
        const byType = Machine.fromConfig(machine({ type: "furnace" }));
        const byPrototype = Machine.fromConfig(machine({ prototype: "electric-furnace" }));
        const crafting = Machine.fromConfig(machine({}));
        expect(byPrototype.metadata.type).toBe("furnace");
        expect(byPrototype.output.outputBlock).toEqual(byType.output.outputBlock);
        expect(byPrototype.output.outputBlock.ingredients_blocked_at).toBe(100);
        expect(crafting.output.outputBlock.ingredients_blocked_at).not.toBe(100);
    });
});

describe("the warnings of a machine's prototype", () => {
    it("say nothing when the prototype, type and recipe agree", () => {
        expect(machinePrototypeIssues({ machines: [machine({ prototype: "electric-furnace", type: "furnace" }), machine({ id: 2, prototype: "electric-furnace" })] })).toEqual([]);
        expect(machinePrototypesNote({ machines: [machine({})] })).toBeNull();
    });

    it("name a type that disagrees with the prototype's rule, which is used as written", () => {
        const issues = machinePrototypeIssues({ machines: [machine({ prototype: "electric-furnace", type: "machine" })] });
        expect(issues.map(issue => issue.kind)).toEqual(["rule-disagrees"]);
        expect(issues[0].message).toContain("simulated under the crafting rule (machine)");
        expect(machineRuleOf(machine({ prototype: "electric-furnace", type: "machine" }))).toBe("machine");
    });

    it("name a recipe the machine cannot make, and a prototype that is no crafting machine of the data", () => {
        expect(machinePrototypeIssues({ machines: [machine({ prototype: "cryogenic-plant", recipe: "iron-plate", type: "machine" })] })
            .map(issue => issue.kind)).toEqual(["recipe-not-made"]);
        expect(machinePrototypeIssues({ machines: [machine({ prototype: "modded-smelter" })] }).map(issue => issue.kind))
            .toEqual(["unknown-prototype"]);
    });

    it("do not stop a config loading: a disagreeing type and an unmakeable recipe parse", () => {
        const parsed = ConfigSchema.safeParse({ target_output: { recipe: "iron-plate", items_per_second: 1, copies: 1 }, belts: [], inserters: [],
            machines: [machine({ prototype: "cryogenic-plant", type: "furnace" })] });
        expect(parsed.success).toBe(true);
    });
});

describe("the config samples' machine prototypes", () => {
    const root = path.resolve(__dirname, "../../resources/config-samples");
    const filesUnder = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap(entry => entry.isDirectory()
            ? filesUnder(path.join(dir, entry.name))
            : entry.name.endsWith(".json") ? [path.join(dir, entry.name)] : []);

    it("agree with their types and recipes, and every machine with a prototype also has a type (so no rule moves)", async () => {
        let named = 0;
        for (const file of filesUnder(root)) {
            let sample;
            try {
                sample = await parseConfig(fs.readFileSync(file, "utf-8"));
            } catch {
                continue; // not a config
            }
            expect(machinePrototypeIssues(sample), path.relative(root, file)).toEqual([]);
            for (const it of sample.machines.filter(m => m.prototype !== undefined)) {
                named++;
                expect(it.type, path.relative(root, file)).toBeDefined();
            }
        }
        expect(named).toBeGreaterThan(0);
    });
});
