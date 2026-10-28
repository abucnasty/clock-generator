import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { FactorioDataService } from "../../data";
import { Chest, Machine, RecipeMetadata } from "../../entities";
import { directMachineInsertionLimit } from "../../entities/drill/mining-drill-ext";
import { MachineState } from "../../state/machine-state";
import { ContainerStorage } from "./container-storage";
import { HeldStorage } from "./held-storage";
import { MachineOutputPort } from "./machine-output-port";
import { MachinePlacementPort } from "./machine-placement-port";
import { Placement } from "./placement";
import { DropBy } from "./ports";

/** An assembling machine on rail: stone, iron sticks and steel plates in, never crafting here */
const railMachine = () => MachineState.forMachine(Machine.createMachine(1, {
    crafting_speed: 0.5,
    productivity: 0,
    recipe: RecipeMetadata.fromRecipeName("rail"),
}));

const held = (item: string, quantity: number) => {
    const storage = HeldStorage.forItem(item);
    storage.insert(item, quantity);
    return storage;
};

describe("a machine's placement port", () => {
    it("takes an ingredient from a placer up to the drill's stop, and nothing it does not craft with", () => {
        const machine = railMachine();
        const port = new MachinePlacementPort(machine);
        const stop = directMachineInsertionLimit(FactorioDataService.findItemOrThrow("stone"), machine.machine);
        expect(port.accepts("stone", stop + 10, DropBy.PLACER)).toBe(stop);
        expect(port.accepts("stone", 3, DropBy.PLACER)).toBe(3);
        port.insert("stone", stop - 1);
        expect(machine.inventoryState.getQuantity("stone")).toBe(stop - 1);
        expect(port.accepts("stone", 3, DropBy.PLACER)).toBe(1);
        port.insert("stone", 1);
        expect(port.accepts("stone", 3, DropBy.PLACER)).toBe(0);
        expect(port.accepts("iron-ore", 3, DropBy.PLACER)).toBe(0);
    });

    it("puts an ingredient the recipe also makes apart, with the self-ingredients", () => {
        const machine = MachineState.forMachine(Machine.createMachine(1, {
            crafting_speed: 2,
            productivity: 0,
            recipe: RecipeMetadata.fromRecipeName("pentapod-egg"),
            prototype: "biochamber",
        }));
        const port = new MachinePlacementPort(machine);
        const seeded = machine.selfIngredients.getQuantity("pentapod-egg");
        const stop = directMachineInsertionLimit(FactorioDataService.findItemOrThrow("pentapod-egg"), machine.machine);
        expect(port.accepts("pentapod-egg", 1000, DropBy.PLACER)).toBe(stop - seeded);
        port.insert("pentapod-egg", 2);
        expect(machine.selfIngredients.getQuantity("pentapod-egg")).toBe(seeded + 2);
        expect(machine.inventoryState.getQuantity("pentapod-egg")).toBe(0);
    });

    it("answers the items a placer binds at build as the Ingress answers a placer, and puts them where the Ingress does", () => {
        for (const [build, items] of [[railMachine, ["stone", "iron-stick", "iron-ore"]], [() => MachineState.forMachine(Machine.createMachine(1, {
            crafting_speed: 2,
            productivity: 0,
            recipe: RecipeMetadata.fromRecipeName("pentapod-egg"),
            prototype: "biochamber",
        })), ["pentapod-egg", "nutrients", "coal"]]] as const) {
            const bound = build();
            const unbound = build();
            const port = new MachinePlacementPort(bound, items);
            const reference = new MachinePlacementPort(unbound);
            for (let step = 0; step < 60; step++) {
                const item = items[step % items.length];
                const held = 1 + (step * 7) % 40;
                const amount = port.accepts(item, held, DropBy.PLACER);
                expect(amount).toBe(reference.accepts(item, held, DropBy.PLACER));
                expect(amount).toBe(unbound.ingress.accepts(item, held, DropBy.PLACER));
                if (amount > 0) {
                    port.insert(item, amount);
                    reference.insert(item, amount);
                }
                expect(bound.inventoryState.export()).toEqual(unbound.inventoryState.export());
                expect(bound.selfIngredients.export()).toEqual(unbound.selfIngredients.export());
                expect(bound.fuelInventory.export()).toEqual(unbound.fuelInventory.export());
            }
        }
    });

    it("answers a placer only: a hand drops into a machine by its own logic", () => {
        expect(() => new MachinePlacementPort(railMachine()).accepts("stone", 1, DropBy.HAND)).toThrow();
    });
});

describe("Placement", () => {
    it("places what waits at its source as far as the target accepts it, and counts what it placed", () => {
        const source = held("stone", 30);
        const machine = railMachine();
        const stop = directMachineInsertionLimit(FactorioDataService.findItemOrThrow("stone"), machine.machine);
        machine.inventoryState.addQuantity("stone", stop - 12);
        const placement = new Placement(source, ["stone"], false);
        placement.placeInto(new MachinePlacementPort(machine), true);
        placement.place();
        expect(source.getCurrentQuantity("stone")).toBe(18);
        expect(machine.inventoryState.getQuantity("stone")).toBe(stop);
        expect(placement.results_placed).toBe(12);
        // at the stop, nothing more goes in
        placement.place();
        expect(source.getCurrentQuantity("stone")).toBe(18);
        expect(placement.results_placed).toBe(12);
    });

    it("places into a container through its drop port, each result in its order, as far as it has room", () => {
        const car = ContainerStorage.forChest(Chest.fromConfig({ type: "car", id: 1 }, ["iron-ore", "iron-gear-wheel"]));
        const output = railMachine().inventoryState;
        output.addQuantity("iron-ore", 7);
        output.addQuantity("iron-gear-wheel", 3);
        const placement = new Placement(new MachineOutputPort(output), ["iron-ore", "iron-gear-wheel", "stone"], true);
        placement.placeInto(car, false);
        placement.place();
        expect(output.getQuantity("iron-ore")).toBe(0);
        expect(output.getQuantity("iron-gear-wheel")).toBe(0);
        expect(car.getCurrentQuantity("iron-ore")).toBe(7);
        expect(car.getCurrentQuantity("iron-gear-wheel")).toBe(3);
        expect(placement.results_placed).toBe(10);
    });

    it("places nothing without a target", () => {
        const source = held("stone", 5);
        const placement = new Placement(source, ["stone"], false);
        placement.place();
        placement.placeInto(null, true);
        placement.place();
        expect(source.getCurrentQuantity("stone")).toBe(5);
        expect(placement.results_placed).toBe(0);
    });

    it("counts results put in its own output where it places its results itself, with no container as its target", () => {
        const counted = (places_results_itself: boolean, target: "none" | "machine" | "car") => {
            const placement = new Placement(held("stone", 0), ["stone"], places_results_itself);
            placement.placeInto(target === "none" ? null : target === "machine" ? new MachinePlacementPort(railMachine())
                : ContainerStorage.forChest(Chest.fromConfig({ type: "car", id: 1 }, ["stone"])), target !== "car");
            placement.countPlacedInOwnOutput(4);
            return placement.results_placed;
        };
        expect(counted(true, "none")).toBe(4);
        // into a machine they count in its own output and again as they are placed (kept as before the components)
        expect(counted(true, "machine")).toBe(4);
        expect(counted(true, "car")).toBe(0);
        expect(counted(false, "none")).toBe(0);
    });

    it("copies its count and how it counts into a snapshot, which has no target and places nothing", () => {
        const source = held("stone", 5);
        const live = new Placement(source, ["stone"], true);
        live.placeInto(ContainerStorage.forChest(Chest.fromConfig({ type: "car", id: 1 }, ["stone"])), false);
        live.place();
        const snapshot = new Placement(held("stone", 5), ["stone"], true);
        snapshot.copyCountFrom(live);
        expect(snapshot.results_placed).toBe(5);
        // it counts as the live one does: not in its own output, with a container as the live target
        snapshot.countPlacedInOwnOutput(4);
        snapshot.place();
        expect(snapshot.results_placed).toBe(5);
    });

    // a running total and fields fixed at build only, none of them in a key: pinned with every component's fields
    // (crafting/runner/steady-state.test.ts)
});

describe("a placement that is blocked", () => {
    it("is blocked while the target takes less than what waits at the source, and asking it moves nothing", () => {
        const machine = railMachine();
        const stop = directMachineInsertionLimit(FactorioDataService.findItemOrThrow("stone"), machine.machine);
        const source = held("stone", 5);
        const placement = new Placement(source, ["stone"], false);
        expect(placement.blocked()).toBe(false);
        placement.placeInto(new MachinePlacementPort(machine, ["stone"]), true);
        expect(placement.blocked()).toBe(false);
        machine.inventoryState.addQuantity("stone", stop - 4);
        expect(placement.blocked()).toBe(true);
        expect([source.getCurrentQuantity("stone"), machine.inventoryState.getQuantity("stone")]).toEqual([5, stop - 4]);
        machine.inventoryState.removeQuantity("stone", 1);
        expect(placement.blocked()).toBe(false);
        expect(new Placement(HeldStorage.forItem("stone"), ["stone"], false).blocked()).toBe(false);
    });
});
