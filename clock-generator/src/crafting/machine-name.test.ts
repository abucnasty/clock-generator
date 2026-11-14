import { describe, expect, it } from "vitest";
import { setGameWords, type TextWords } from "./entity-name";
import { machineNameInText, machineNameOf, type MachineToName } from "./machine-name";

const plant = (id: number, recipe: string): MachineToName => ({ id, prototype: "electromagnetic-plant", recipe });

describe("the name a text gives a machine", () => {
    it("is its kind and its recipe, with no number, where it is the only one of its kind and recipe", () => {
        const machines = [plant(1, "accumulator"), { id: 3, prototype: "foundry", recipe: "casting-iron" }];
        expect(machineNameInText(machines[1], machines)).toBe("foundry that makes casting iron");
    });

    it("has its number where one copy holds two machines of the same kind and recipe", () => {
        const machines = [plant(1, "accumulator"), plant(2, "accumulator")];
        expect(machineNameInText(machines[0], machines)).toBe("electromagnetic plant (machine 1) that makes accumulator");
        expect(machineNameInText(machines[1], machines)).toBe("electromagnetic plant (machine 2) that makes accumulator");
    });

    it("has no number where the machines of one kind make different recipes", () => {
        const machines = [plant(1, "accumulator"), plant(2, "supercapacitor")];
        expect(machineNameInText(machines[0], machines)).toBe("electromagnetic plant that makes accumulator");
        expect(machineNameInText(machines[1], machines)).toBe("electromagnetic plant that makes supercapacitor");
    });

    it("has no number where machines of different kinds make one recipe", () => {
        const machines = [plant(1, "electronic-circuit"), { id: 2, prototype: "assembling-machine-3", recipe: "electronic-circuit" }];
        expect(machineNameInText(machines[1], machines)).toBe("assembling machine 3 that makes electronic circuit");
    });

    it("is a machine that makes its recipe without a prototype, with its number after the word where two are alike", () => {
        const machines: MachineToName[] = [{ id: 1, recipe: "military-science-pack" }, { id: 2, recipe: "military-science-pack" }, { id: 5, recipe: "casting-iron" }];
        expect(machineNameInText(machines[0], machines)).toBe("machine 1 that makes military science pack");
        expect(machineNameInText(machines[2], machines)).toBe("machine that makes casting iron");
    });

    it("writes the kind and the recipe in the words a text uses without the game data", () => {
        const machines = [plant(1, "accumulator"), plant(2, "accumulator")];
        const words = { kind: (id: string) => id.replace(/-/g, " "), recipe: (id: string) => id.toUpperCase() };
        const previous = setGameWords((): TextWords | undefined => undefined);
        try {
            expect(machineNameInText(machines[1], machines, words)).toBe("electromagnetic plant (machine 2) that makes ACCUMULATOR");
        } finally {
            setGameWords(previous);
        }
    });
});

describe("the name of a machine by its id", () => {
    const machines = [plant(1, "accumulator"), plant(2, "accumulator"), { id: 3, prototype: "foundry", recipe: "casting-iron" }];

    it("is found by the entity's id or the configuration's number", () => {
        expect(machineNameOf("machine:3", machines)).toBe("foundry that makes casting iron");
        expect(machineNameOf(2, machines)).toBe("electromagnetic plant (machine 2) that makes accumulator");
    });

    it("is undefined for an id that is no machine of the configuration", () => {
        expect(machineNameOf("machine:9", machines)).toBeUndefined();
        expect(machineNameOf("inserter:1", machines)).toBeUndefined();
    });
});
