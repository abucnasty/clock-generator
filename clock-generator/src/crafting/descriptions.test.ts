import { describe, expect, it } from "vitest";
import Fraction, { fraction } from "../data-types/fraction";
import { OpenRange } from "../data-types";
import { SignalId } from "../blueprints/components";
import { EntityId, ReadableEntityRegistry } from "../entities";
import { chestDrillDescriptionLines, clockDescriptionLines, deciderWindows, plannedDescriptionLines, shownWindowCycleTicks, unplannedDescriptionLines } from "./descriptions";
import { InserterClock } from "./sequence/unplanned-inserter-clock";
import { GENERATOR } from "../generator";

describe("the description of an enabling combinator", () => {
    const machine = (id: number, recipe: string) => ({ entity_id: EntityId.forMachine(id), metadata: { recipe: { name: recipe } } });
    const inserter = (id: number, source: EntityId, sink: EntityId) =>
        ({ entity_id: EntityId.forInserter(id), source: { entity_id: source }, sink: { entity_id: sink } });
    const belt = EntityId.forBelt(1);
    const wagon = EntityId.forChest(1);
    const chest = EntityId.forChest(2);
    const entities = [
        machine(1, "rocket-fuel-from-jelly"),
        machine(2, "jellynut-processing"),
        machine(3, "rocket-fuel-from-jelly"),
        { entity_id: belt, prototype: "turbo-transport-belt" },
        { entity_id: wagon, chest_type: "cargo-wagon" },
        { entity_id: chest, chest_type: "buffer-chest" },
        inserter(1, belt, EntityId.forMachine(1)),
        inserter(2, EntityId.forMachine(1), belt),
        inserter(3, belt, EntityId.forMachine(2)),
        inserter(4, wagon, belt),
        inserter(5, belt, EntityId.forMachine(3)),
        inserter(6, chest, EntityId.forMachine(2)),
        { entity_id: EntityId.forMachine(4), metadata: { recipe: { name: "steel-plate" }, prototype: "electric-furnace" } },
        { entity_id: EntityId.forChest(3), chest_type: "buffer-chest", prototype: "steel-chest" },
        inserter(7, EntityId.forMachine(4), EntityId.forChest(3)),
        inserter(8, EntityId.forChest(3), EntityId.forMachine(4)),
        { entity_id: EntityId.forDrill(1), meta: { type: "big-mining-drill" }, sink_id: EntityId.forMachine(1) },
        { entity_id: EntityId.forDrill(2), meta: { type: "big-mining-drill" }, sink_id: wagon, item: { name: "iron-ore" } },
        { entity_id: EntityId.forDrill(3), meta: { type: "big-mining-drill" }, sink_id: chest, item: { name: "iron-ore" } },
    ];
    const registry = {
        getEntityById: (id: EntityId) => entities.find(entity => entity.entity_id.id === id.id) ?? null,
    } as unknown as ReadableEntityRegistry;
    const values = (ranges: OpenRange[]) => ranges.map(range => OpenRange.from(range.start_inclusive + 1, range.end_inclusive + 1));
    const two_windows = deciderWindows([OpenRange.from(26, 38), OpenRange.from(71, 83)], values);
    /** `swings` is the count of every entity, or one count for each */
    const planned = (ids: EntityId[], swings: Fraction | Fraction[] = fraction(2), windows = two_windows) =>
        plannedDescriptionLines(ids, registry, ["jelly"], ids.map((entity_id, index) => ({ entity_id, swings: Array.isArray(swings) ? swings[index] : swings })), windows, "144");

    it("names both ends by their icons, the machine it fills with its recipe, and lists a few windows", () => {
        expect(planned([EntityId.forInserter(4)])).toEqual([
            "1 inserter [item=jelly] (4)",
            "Inserter 4: [entity=cargo-wagon] → [item=jelly] → [entity=turbo-transport-belt]",
            "2 swings in 2 enable windows per 144-tick window cycle: open 27–39, 72–84",
        ]);
    });

    it("names a machine the config has no prototype for, and a plain chest, by their ids, a machine with its recipe", () => {
        expect(planned([EntityId.forInserter(2)])[1])
            .toBe("Inserter 2: machine 1 [recipe=rocket-fuel-from-jelly] → [item=jelly] → [entity=turbo-transport-belt]");
        expect(planned([EntityId.forInserter(6)])[1]).toBe("Inserter 6: chest 2 → [item=jelly] → machine 2 [recipe=jellynut-processing]");
    });

    it("names a machine and a chest the config gives a prototype by their icons, the machine it fills with its recipe", () => {
        expect(planned([EntityId.forInserter(7)])[1]).toBe("Inserter 7: [entity=electric-furnace] → [item=jelly] → [entity=steel-chest]");
        expect(planned([EntityId.forInserter(8)])[1]).toBe("Inserter 8: [entity=steel-chest] → [item=jelly] → [entity=electric-furnace] [recipe=steel-plate]");
    });

    it("says once what the inserters of one combinator share, listing the machines that differ only by their ids", () => {
        expect(planned([EntityId.forInserter(5), EntityId.forInserter(1)])).toEqual([
            "2 inserters [item=jelly] (1, 5)",
            "Inserters 1, 5: [entity=turbo-transport-belt] → [item=jelly] → machines 1, 3 [recipe=rocket-fuel-from-jelly]",
            "2 swings each in 2 enable windows per 144-tick window cycle: open 27–39, 72–84",
        ]);
    });

    it("gives the range and each count by who moves it when the inserters of one combinator move different numbers", () => {
        const ids = [EntityId.forInserter(1), EntityId.forInserter(5), EntityId.forInserter(3)];
        expect(planned(ids, [fraction(2), fraction(3), fraction(2)])[3])
            .toBe("2 to 3 swings (inserters 1, 3: 2; inserter 5: 3) in 2 enable windows per 144-tick window cycle: open 27–39, 72–84");
        expect(planned([EntityId.forInserter(4), EntityId.forInserter(5)], [fraction(5, 4), fraction(2)])[3])
            .toBe("1.25 to 2 swings (inserter 4: 1.25; inserter 5: 2) in 2 enable windows per 144-tick window cycle: open 27–39, 72–84");
    });

    it("gives the range and each count of the drills of one combinator that mine different amounts", () => {
        expect(planned([EntityId.forDrill(1), EntityId.forDrill(2), EntityId.forDrill(3)], [fraction(15), fraction(15), fraction(19)]).at(-1))
            .toBe("Mines 240 to 304 (drills 1, 2: 240; drill 3: 304) in 2 enable windows per 144-tick window cycle: open 27–39, 72–84");
    });

    it("gives each route a line under the header when the inserters of one combinator work with different machines", () => {
        expect(planned([EntityId.forInserter(3), EntityId.forInserter(1)])).toEqual([
            "2 inserters [item=jelly] (1, 3)",
            "Inserter 1: [entity=turbo-transport-belt] → [item=jelly] → machine 1 [recipe=rocket-fuel-from-jelly]",
            "Inserter 3: [entity=turbo-transport-belt] → [item=jelly] → machine 2 [recipe=jellynut-processing]",
            "2 swings each in 2 enable windows per 144-tick window cycle: open 27–39, 72–84",
        ]);
    });

    it("gives each inserter the items it moves itself, not those of the whole combinator", () => {
        const carrying = (id: number, source: EntityId, sink: EntityId, ...items: string[]) => ({ ...inserter(id, source, sink), filtered_items: new Set(items) });
        const own = {
            getEntityById: (id: EntityId) => [
                ...entities, carrying(9, belt, EntityId.forMachine(2), "plastic-bar"), carrying(10, belt, EntityId.forMachine(2), "copper-cable", "iron-plate"),
            ].find(entity => entity.entity_id.id === id.id) ?? null,
        } as unknown as ReadableEntityRegistry;
        const lines = plannedDescriptionLines([EntityId.forInserter(9), EntityId.forInserter(10)], own, ["plastic-bar", "copper-cable", "iron-plate"],
            [9, 10].map(id => ({ entity_id: EntityId.forInserter(id), swings: fraction(2) })), two_windows, "144");
        expect(lines.slice(0, 3)).toEqual([
            "2 inserters [item=plastic-bar] [item=copper-cable] [item=iron-plate] (9, 10)",
            "Inserter 9: [entity=turbo-transport-belt] → [item=plastic-bar] → machine 2 [recipe=jellynut-processing]",
            "Inserter 10: [entity=turbo-transport-belt] → [item=copper-cable] [item=iron-plate] → machine 2 [recipe=jellynut-processing]",
        ]);
    });

    it("joins the inserters that share both ends, with all their items, when a line for each would not fit in the 500 bytes Factorio keeps", () => {
        const carrying = (id: number, source: EntityId, sink: EntityId, ...items: string[]) => ({ ...inserter(id, source, sink), filtered_items: new Set(items) });
        const foundry = { entity_id: EntityId.forMachine(11), metadata: { recipe: { name: "casting-iron" }, prototype: "foundry" } };
        const plant = { entity_id: EntityId.forMachine(12), metadata: { recipe: { name: "electronic-circuit" }, prototype: "electromagnetic-plant" } };
        const cryo = { entity_id: EntityId.forMachine(13), metadata: { recipe: { name: "plastic-bar" }, prototype: "cryogenic-plant" } };
        const store = { entity_id: EntityId.forChest(4), chest_type: "buffer-chest", prototype: "steel-chest" };
        const crowded = {
            getEntityById: (id: EntityId) => [
                foundry, plant, cryo, store,
                carrying(3, foundry.entity_id, store.entity_id, "copper-cable"), carrying(4, cryo.entity_id, store.entity_id, "plastic-bar"),
                carrying(11, foundry.entity_id, plant.entity_id, "iron-plate"), carrying(12, foundry.entity_id, plant.entity_id, "copper-cable"),
            ].find(entity => entity.entity_id.id === id.id) ?? null,
        } as unknown as ReadableEntityRegistry;
        const ids = [3, 4, 11, 12].map(id => EntityId.forInserter(id));
        const lines = plannedDescriptionLines(ids, crowded, ["copper-cable", "plastic-bar", "iron-plate"],
            ids.map(entity_id => ({ entity_id, swings: fraction(1) })), deciderWindows([OpenRange.from(0, 11)], values), "72");
        expect(lines).toEqual([
            "4 inserters [item=copper-cable] [item=plastic-bar] [item=iron-plate] (3, 4, 11, 12)",
            "Inserter 3: [entity=foundry] → [item=copper-cable] → [entity=steel-chest]",
            "Inserter 4: [entity=cryogenic-plant] → [item=plastic-bar] → [entity=steel-chest]",
            "Inserters 11, 12: [entity=foundry] → [item=iron-plate] [item=copper-cable] → [entity=electromagnetic-plant] [recipe=electronic-circuit]",
            "1 swing each in 1 enable window per 72-tick window cycle: open 1–12",
        ]);
        expect(new TextEncoder().encode(lines.join("\n")).length).toBeLessThanOrEqual(500);
        // the counts of each inserter make the line of counts long: the lines start at the numbers, and then the header has no items
        const counted = plannedDescriptionLines(ids, crowded, ["copper-cable", "plastic-bar", "iron-plate"],
            ids.map((entity_id, index) => ({ entity_id, swings: fraction(index + 1, 7) })), deciderWindows([OpenRange.from(0, 11), OpenRange.from(30, 41)], values), "72");
        expect(new TextEncoder().encode(counted.join("\n")).length).toBeLessThanOrEqual(500);
        expect(counted.some(line => line.endsWith("..."))).toBe(false);
        expect(counted.slice(0, 4)).toEqual([
            "4 inserters (3, 4, 11, 12)",
            "3: [entity=foundry] → [item=copper-cable] → [entity=steel-chest]",
            "4: [entity=cryogenic-plant] → [item=plastic-bar] → [entity=steel-chest]",
            "11, 12: [entity=foundry] → [item=iron-plate] [item=copper-cable] → [entity=electromagnetic-plant] [recipe=electronic-circuit]",
        ]);
        // short enough in full: one line for each item
        const two = [3, 4].map(id => EntityId.forInserter(id));
        expect(plannedDescriptionLines(two, crowded, ["copper-cable", "plastic-bar"], two.map(entity_id => ({ entity_id, swings: fraction(1) })),
            deciderWindows([OpenRange.from(0, 11)], values), "72")).toHaveLength(4);
    });

    it("puts the turn line after the counts, below the lines of the inserters", () => {
        const lines = plannedDescriptionLines([EntityId.forInserter(3), EntityId.forInserter(1)], registry, ["jelly"],
            [3, 1].map(id => ({ entity_id: EntityId.forInserter(id), swings: fraction(2) })), two_windows, "144", "Group 1 of 2: takes its turn.");
        expect(lines.map(line => line.split(":")[0])).toEqual(["2 inserters [item=jelly] (1, 3)", "Inserter 1", "Inserter 3", "2 swings each in 2 enable windows per 144-tick window cycle", "Group 1 of 2"]);
    });

    it("gives a drill's items, not the plan's unit of 16, from the drill to the machine it fills", () => {
        expect(planned([EntityId.forDrill(1)], fraction(15)).slice(0, 2)).toEqual([
            "1 drill [item=jelly] (1)",
            "Drill 1: [entity=big-mining-drill] → [item=jelly] → machine 1 [recipe=rocket-fuel-from-jelly]",
        ]);
        expect(planned([EntityId.forDrill(1)], fraction(15))[2]).toBe("Mines 240 in 2 enable windows per 144-tick window cycle: open 27–39, 72–84");
    });

    it("gives a count that is not whole to 3 decimals, and one swing as one", () => {
        expect(planned([EntityId.forInserter(4)], fraction(285, 2))[2]).toMatch(/^142\.5 swings in /);
        expect(planned([EntityId.forInserter(4)], fraction(1))[2]).toMatch(/^1 swing in /);
    });

    it("gives a window of one tick as its one value", () => {
        const one_tick = deciderWindows([OpenRange.from(27, 27), OpenRange.from(71, 83)], values);
        expect(planned([EntityId.forInserter(4)], fraction(2), one_tick)[2]).toBe("2 swings in 2 enable windows per 144-tick window cycle: open 28, 72–84");
        const by_product: InserterClock = { inserter_id: EntityId.forInserter(2), kind: "by-product", modulus: 32, own_clock: false, window: OpenRange.from(6, 6) };
        expect(unplannedDescriptionLines([EntityId.forInserter(2)], registry, ["jellynut-seed"], by_product, OpenRange.from(7, 7), SignalId.clock)[2])
            .toBe("Clears it: open [virtual-signal=signal-clock] 7 of every 32 ticks; outside the main plan");
    });

    it("lists no windows past three, nor repeating ones, and says what is unusual", () => {
        const four = deciderWindows([0, 10, 20, 30].map(at => OpenRange.from(at, at + 2)), values);
        expect(planned([EntityId.forInserter(4)], fraction(4), four)[2]).toBe("4 swings in 4 enable windows per 144-tick window cycle");
        const repeating = deciderWindows([OpenRange.from(0, 2)], values, { modulus: 48, signal: SignalId.virtual("signal-A") });
        expect(planned([EntityId.forInserter(4)], fraction(3), repeating).slice(2)).toEqual([
            "3 swings in 1 enable window per 144-tick window cycle",
            "Enable windows repeat every 48 ticks: [virtual-signal=signal-A] = clock mod 48",
        ]);
        const subtick = deciderWindows([OpenRange.from(0, 2)], values, undefined, 13);
        // the unit of the windows is on their line, so the numbers are not read as ticks
        expect(planned([EntityId.forInserter(4)], fraction(3), subtick).slice(2)).toEqual(["3 swings in 1 enable window per 144-tick window cycle: open 1–3 (in 1/13 ticks)"]);
        const many_subtick = deciderWindows([0, 10, 20, 30].map(at => OpenRange.from(at, at + 2)), values, undefined, 13);
        expect(planned([EntityId.forInserter(4)], fraction(4), many_subtick)[2]).toBe("4 swings in 4 enable windows per 144-tick window cycle; enable windows in 1/13 ticks");
    });

    it("says of a drill into a chest that it tops that chest up, named by its icon, else by its id", () => {
        const one = deciderWindows([OpenRange.from(27, 27)], values);
        expect(chestDrillDescriptionLines([EntityId.forDrill(2)], registry, ["iron-ore"], one, "72")).toEqual([
            "1 drill [item=iron-ore] (2)",
            "Drill 2: [entity=big-mining-drill] → [item=iron-ore] → [entity=cargo-wagon]",
            "Tops the [entity=cargo-wagon] up just in time, 1 enable window per 72-tick window cycle: open 28",
            "Not counted as swings: opens just before the inserters take from the [entity=cargo-wagon]",
        ]);
        expect(chestDrillDescriptionLines([EntityId.forDrill(3)], registry, ["iron-ore"], one, "72").slice(2)).toEqual([
            "Tops chest 2 up just in time, 1 enable window per 72-tick window cycle: open 28",
            "Not counted as swings: opens just before the inserters take from chest 2",
        ]);
        expect(chestDrillDescriptionLines([EntityId.forDrill(2), EntityId.forDrill(3)], registry, ["iron-ore"], one, "72").at(-1))
            .toBe("Not counted as swings: opens just before the inserters take from it");
    });

    it("gives a fuel and a by-product inserter their windows as the conditions read them", () => {
        const fuel: InserterClock = { inserter_id: EntityId.forInserter(1), kind: "fuel", modulus: 192, own_clock: true, window: OpenRange.from(0, 7) };
        expect(unplannedDescriptionLines([EntityId.forInserter(1)], registry, ["nutrients"], fuel, OpenRange.from(1, 8), null)).toEqual([
            "Fuel: 1 inserter [item=nutrients] (1)",
            "Inserter 1: [entity=turbo-transport-belt] → [item=nutrients] → machine 1 [recipe=rocket-fuel-from-jelly]",
            "Open [virtual-signal=signal-clock] 1–8 of the fuel clock, once every 192 ticks; does not swing while the fuel slot is full",
        ]);
        const by_product: InserterClock = { inserter_id: EntityId.forInserter(2), kind: "by-product", modulus: 32, own_clock: false, window: OpenRange.from(6, 10) };
        expect(unplannedDescriptionLines([EntityId.forInserter(2)], registry, ["jellynut-seed"], by_product, OpenRange.from(7, 11), SignalId.clock)).toEqual([
            "By-product: 1 inserter [item=jellynut-seed] (2)",
            "Inserter 2: machine 1 [recipe=rocket-fuel-from-jelly] → [item=jellynut-seed] → [entity=turbo-transport-belt]",
            "Clears it: open [virtual-signal=signal-clock] 7–11 of every 32 ticks; outside the main plan",
        ]);
    });
});

describe("the letter at the end of the first line of an enabling combinator", () => {
    const machine = (id: number, recipe: string, prototype: string) => ({ entity_id: EntityId.forMachine(id), metadata: { recipe: { name: recipe }, prototype } });
    const carrying = (id: number, source: EntityId, sink: EntityId, ...items: string[]) =>
        ({ entity_id: EntityId.forInserter(id), source: { entity_id: source }, sink: { entity_id: sink }, filtered_items: new Set(items) });
    const belt = { entity_id: EntityId.forBelt(1), prototype: "turbo-transport-belt" };
    const foundry = machine(11, "casting-iron", "foundry");
    const plant = machine(12, "electronic-circuit", "electromagnetic-plant");
    const cryo = machine(13, "plastic-bar", "cryogenic-plant");
    const store = { entity_id: EntityId.forChest(4), chest_type: "buffer-chest", prototype: "steel-chest" };
    const entities = [
        belt, foundry, plant, cryo, store,
        carrying(1, belt.entity_id, plant.entity_id, "iron-plate"),
        carrying(3, foundry.entity_id, store.entity_id, "copper-cable"), carrying(4, cryo.entity_id, store.entity_id, "plastic-bar"),
        carrying(11, foundry.entity_id, plant.entity_id, "iron-plate"), carrying(12, foundry.entity_id, plant.entity_id, "copper-cable"),
        { entity_id: EntityId.forDrill(2), meta: { type: "big-mining-drill" }, sink_id: store.entity_id, item: { name: "iron-ore" } },
    ];
    const registry = { getEntityById: (id: EntityId) => entities.find(entity => entity.entity_id.id === id.id) ?? null } as unknown as ReadableEntityRegistry;
    const values = (ranges: OpenRange[]) => ranges.map(range => OpenRange.from(range.start_inclusive + 1, range.end_inclusive + 1));
    const windows = deciderWindows([OpenRange.from(0, 11)], values);
    const bytes = (lines: string[]) => new TextEncoder().encode(lines.join("\n")).length;
    const planned = (ids: number[], letter?: string, window_cycle_text = "72") => {
        const entity_ids = ids.map(id => EntityId.forInserter(id));
        return plannedDescriptionLines(entity_ids, registry, ["copper-cable", "plastic-bar", "iron-plate"],
            entity_ids.map(entity_id => ({ entity_id, swings: fraction(1) })), windows, window_cycle_text, undefined, letter);
    };

    it("ends the header of a planned combinator in its letter, and changes no other line", () => {
        const without = planned([3, 4]);
        const lines = planned([3, 4], "E");
        expect(lines[0]).toBe("2 inserters [item=copper-cable] [item=plastic-bar] [item=iron-plate] (3, 4) (E)");
        expect(lines.slice(1)).toEqual(without.slice(1));
        expect(lines[0]).toBe(`${without[0]} (E)`);
    });

    it("ends the header of a drill, a drill into a chest, a fuel and a by-product inserter in its letter", () => {
        const one = deciderWindows([OpenRange.from(27, 27)], values);
        const drill = chestDrillDescriptionLines([EntityId.forDrill(2)], registry, ["iron-ore"], one, "72", undefined, "AA");
        expect(drill[0]).toBe("1 drill [item=iron-ore] (2) (AA)");
        expect(drill.slice(1)).toEqual(chestDrillDescriptionLines([EntityId.forDrill(2)], registry, ["iron-ore"], one, "72").slice(1));
        const fuel: InserterClock = { inserter_id: EntityId.forInserter(1), kind: "fuel", modulus: 192, own_clock: true, window: OpenRange.from(0, 7) };
        expect(unplannedDescriptionLines([EntityId.forInserter(1)], registry, ["nutrients"], fuel, OpenRange.from(1, 8), null, undefined, "G")[0]).toBe("Fuel: 1 inserter [item=nutrients] (1) (G)");
        const by_product: InserterClock = { inserter_id: EntityId.forInserter(1), kind: "by-product", modulus: 32, own_clock: false, window: OpenRange.from(6, 10) };
        expect(unplannedDescriptionLines([EntityId.forInserter(1)], registry, ["jellynut-seed"], by_product, OpenRange.from(7, 11), SignalId.clock, undefined, "B")[0])
            .toBe("By-product: 1 inserter [item=jellynut-seed] (1) (B)");
    });

    it("counts the letter's bytes before it keeps lines: a description that fits by one letter takes the next compaction instead of losing lines", () => {
        // the window cycle's text is only interpolated: pad it until the lines without a letter are exactly the 500 bytes the game keeps
        const padding = "1".repeat(500 - bytes(planned([3, 4], undefined, "1")) + 1);
        const fits = planned([3, 4], undefined, padding);
        expect(bytes(fits)).toBe(500);
        expect(fits[1]).toBe("Inserter 3: [entity=foundry] → [item=copper-cable] → [entity=steel-chest]");
        const lettered = planned([3, 4], "E", padding);
        // the letter's 4 bytes do not fit: the lines start at the numbers of their inserters, and no line is cut
        expect(lettered.some(line => line.endsWith("..."))).toBe(false);
        expect(bytes(lettered)).toBeLessThanOrEqual(500);
        expect(lettered[0]).toBe("2 inserters [item=copper-cable] [item=plastic-bar] [item=iron-plate] (3, 4) (E)");
        expect(lettered[1]).toBe("3: [entity=foundry] → [item=copper-cable] → [entity=steel-chest]");
        expect(lettered).toHaveLength(fits.length);
    });
});

describe("the description of the clock", () => {
    it("gives the rate of every copy and of one, and how to wire the rest", () => {
        expect(clockDescriptionLines({ item_name: "iron-plate", items_per_second: 120, copies: 7, window_cycle_text: "Period 336 ticks; counts 1–336", drills: true,
            not_clocked: { inserters: [], drills: [] } })).toEqual([
            "Clock for [item=iron-plate] 120/s over 7 copies (17.143/s each). Period 336 ticks; counts 1–336",
            "Wire every other combinator's output to the inserters and drills it names, in every copy; set them Enable if Anything > 0, drills with Read resources off",
            `Made by Clock Generator ${GENERATOR.version}: clock.abucnasty.dev`,
        ]);
    });

    it("lists the inserters and drills not on the clock before the generator's line, when that fits", () => {
        const lines = (inserters: number[]) => clockDescriptionLines({ item_name: "iron-plate", items_per_second: 80, copies: 1,
            window_cycle_text: "Period 72 ticks; counts 1–72", drills: false, not_clocked: { inserters, drills: [1] } });
        expect(lines([5, 8, 11]).slice(2)).toEqual([
            "Not on the clock, so not wired: inserters 5, 8, 11; drill 1",
            `Made by Clock Generator ${GENERATOR.version}: clock.abucnasty.dev`,
        ]);
        // too many to fit: left out, and the generator's line stays last
        const many = lines(Array.from({ length: 120 }, (_, index) => index + 1));
        expect(many).toHaveLength(3);
        expect(many[2]).toMatch(/^Made by Clock Generator /);
    });

    it("gives the period of a clock of whole ticks of a fractional period as the ticks it counts", () => {
        expect(shownWindowCycleTicks(82.28571428571429, false)).toBe("82");
        expect(shownWindowCycleTicks(886.1538461538462, true)).toBe("886.154");
        expect(shownWindowCycleTicks(72, false)).toBe("72");
    });
});
