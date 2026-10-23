import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import "../data/factorio-data-file";
import { Machine } from "../entities/machine/machine";
import { parseConfig } from "./loader";
import { machinePrototypeIssues, machinePrototypesNote, machineRuleOf } from "./machine-prototype";
import { ConfigSchema, MachineConfiguration } from "./schema";
import { MachineType } from "../entities/machine/machine-type";

const machine = (fields: Partial<MachineConfiguration>): MachineConfiguration =>
    ({ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1, ...fields });

describe("a machine's rule from its prototype", () => {
    it("is the prototype's, and the crafting rule with none or an unknown prototype", () => {
        expect(machineRuleOf(machine({ prototype: "electric-furnace" }))).toBe("furnace");
        expect(machineRuleOf(machine({ prototype: "recycler" }))).toBe("furnace");
        expect(machineRuleOf(machine({ prototype: "biochamber" }))).toBe("biochamber");
        expect(machineRuleOf(machine({ prototype: "cryogenic-plant" }))).toBe("machine");
        expect(machineRuleOf(machine({}))).toBe("machine");
        expect(machineRuleOf(machine({ prototype: "modded-smelter" }))).toBe("machine");
    });

    it("decides the simulation: a furnace by prototype holds a stack, a machine without one does not", () => {
        const furnace = Machine.fromConfig(machine({ prototype: "electric-furnace" }));
        const crafting = Machine.fromConfig(machine({}));
        expect(furnace.metadata.type).toBe("furnace");
        expect(furnace.output.outputBlock.ingredients_blocked_at).toBe(100);
        expect(crafting.output.outputBlock.ingredients_blocked_at).not.toBe(100);
    });
});

describe("the warnings of a machine's prototype", () => {
    it("say nothing when the prototype and recipe agree", () => {
        expect(machinePrototypeIssues({ machines: [machine({ prototype: "electric-furnace" }), machine({ id: 2, prototype: "stone-furnace" })] })).toEqual([]);
        expect(machinePrototypesNote({ machines: [machine({})] })).toBeNull();
    });

    it("name a recipe the machine cannot make, and a prototype that is no crafting machine of the data", () => {
        expect(machinePrototypeIssues({ machines: [machine({ prototype: "cryogenic-plant", recipe: "iron-plate" })] })
            .map(issue => issue.kind)).toEqual(["recipe-not-made"]);
        expect(machinePrototypeIssues({ machines: [machine({ prototype: "modded-smelter" })] }).map(issue => issue.kind))
            .toEqual(["unknown-prototype"]);
    });

    it("do not stop a config loading: an unmakeable recipe parses", () => {
        const parsed = ConfigSchema.safeParse({ target_output: { recipe: "iron-plate", items_per_second: 1, copies: 1 }, belts: [], inserters: [],
            machines: [machine({ prototype: "cryogenic-plant" })] });
        expect(parsed.success).toBe(true);
    });
});

describe("the config samples' machines", () => {
    const root = path.resolve(__dirname, "../../resources/config-samples");
    const filesUnder = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap(entry => entry.isDirectory()
            ? filesUnder(path.join(dir, entry.name))
            : entry.name.endsWith(".json") ? [path.join(dir, entry.name)] : []);

    it("keep the rule their former type gave, agree with their recipes, and keep no type", async () => {
        let typed = 0;
        for (const file of filesUnder(root)) {
            const text = fs.readFileSync(file, "utf-8");
            let sample;
            try {
                sample = await parseConfig(text);
            } catch {
                continue; // not a config
            }
            const name = path.relative(root, file);
            expect(machinePrototypeIssues(sample), name).toEqual([]);
            const raw = JSON.parse(text) as { machines: { type?: MachineType }[] };
            sample.machines.forEach((parsed, index) => {
                expect(parsed, name).not.toHaveProperty("type");
                const type = raw.machines[index].type;
                if (type !== undefined) {
                    typed++;
                    expect(machineRuleOf(parsed), `${name} machine ${parsed.id}`).toBe(type);
                }
            });
        }
        expect(typed).toBeGreaterThan(100);
    });
});
