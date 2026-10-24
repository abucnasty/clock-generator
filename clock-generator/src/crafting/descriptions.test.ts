import { describe, expect, it } from "vitest";
import Fraction, { fraction } from "../data-types/fraction";
import { OpenRange } from "../data-types";
import { SignalId } from "../blueprints/components";
import { EntityId, ReadableEntityRegistry } from "../entities";
import { chestDrillDescriptionLines, clockDescriptionLines, deciderWindows, plannedDescriptionLines, shownPeriodTicks, unplannedDescriptionLines } from "./descriptions";
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
            "[entity=cargo-wagon] → [entity=turbo-transport-belt] [item=jelly] (inserter 4)",
            "2 swings in 2 windows per 144-tick period: open 27–39, 72–84",
        ]);
    });

    it("names a machine the config has no prototype for, and a plain chest, by their ids, a machine with its recipe", () => {
        expect(planned([EntityId.forInserter(2)])[0])
            .toBe("machine 1 [recipe=rocket-fuel-from-jelly] → [entity=turbo-transport-belt] [item=jelly] (inserter 2)");
        expect(planned([EntityId.forInserter(6)])[0]).toBe("chest 2 → machine 2 [recipe=jellynut-processing] [item=jelly] (inserter 6)");
    });

    it("names a machine and a chest the config gives a prototype by their icons, the machine it fills with its recipe", () => {
        expect(planned([EntityId.forInserter(7)])[0]).toBe("[entity=electric-furnace] → [entity=steel-chest] [item=jelly] (inserter 7)");
        expect(planned([EntityId.forInserter(8)])[0]).toBe("[entity=steel-chest] → [entity=electric-furnace] [recipe=steel-plate] [item=jelly] (inserter 8)");
    });

    it("says once what the inserters of one combinator share, listing the machines that differ only by their ids", () => {
        expect(planned([EntityId.forInserter(5), EntityId.forInserter(1)])).toEqual([
            "2 inserters: [entity=turbo-transport-belt] → machines 1, 3 [recipe=rocket-fuel-from-jelly] [item=jelly] (1, 5)",
            "2 swings each in 2 windows per 144-tick period: open 27–39, 72–84",
        ]);
    });

    it("gives the range and each count by who moves it when the inserters of one combinator move different numbers", () => {
        const ids = [EntityId.forInserter(1), EntityId.forInserter(5), EntityId.forInserter(3)];
        expect(planned(ids, [fraction(2), fraction(3), fraction(2)])[1])
            .toBe("2 to 3 swings (inserters 1, 3: 2; inserter 5: 3) in 2 windows per 144-tick period: open 27–39, 72–84");
        expect(planned([EntityId.forInserter(4), EntityId.forInserter(5)], [fraction(5, 4), fraction(2)])[1])
            .toBe("1.25 to 2 swings (inserter 4: 1.25; inserter 5: 2) in 2 windows per 144-tick period: open 27–39, 72–84");
    });

    it("gives the range and each count of the drills of one combinator that mine different amounts", () => {
        expect(planned([EntityId.forDrill(1), EntityId.forDrill(2), EntityId.forDrill(3)], [fraction(15), fraction(15), fraction(19)])[1])
            .toBe("Mines 240 to 304 (drills 1, 2: 240; drill 3: 304) in 2 windows per 144-tick period: open 27–39, 72–84");
    });

    it("gives each route a line after the counts when the inserters of one combinator work with different machines", () => {
        expect(planned([EntityId.forInserter(3), EntityId.forInserter(1)])).toEqual([
            "2 inserters [item=jelly] (1, 3)",
            "2 swings each in 2 windows per 144-tick period: open 27–39, 72–84",
            "- 1: [entity=turbo-transport-belt] → machine 1 [recipe=rocket-fuel-from-jelly]",
            "- 3: [entity=turbo-transport-belt] → machine 2 [recipe=jellynut-processing]",
        ]);
    });

    it("gives a drill's items, not the plan's unit of 16, from the drill to the machine it fills", () => {
        expect(planned([EntityId.forDrill(1)], fraction(15))[0]).toBe("[entity=big-mining-drill] [item=jelly] → machine 1 [recipe=rocket-fuel-from-jelly] (drill 1)");
        expect(planned([EntityId.forDrill(1)], fraction(15))[1]).toBe("Mines 240 in 2 windows per 144-tick period: open 27–39, 72–84");
    });

    it("gives a count that is not whole to 3 decimals, and one swing as one", () => {
        expect(planned([EntityId.forInserter(4)], fraction(285, 2))[1]).toMatch(/^142\.5 swings in /);
        expect(planned([EntityId.forInserter(4)], fraction(1))[1]).toMatch(/^1 swing in /);
    });

    it("gives a window of one tick as its one value", () => {
        const one_tick = deciderWindows([OpenRange.from(27, 27), OpenRange.from(71, 83)], values);
        expect(planned([EntityId.forInserter(4)], fraction(2), one_tick)[1]).toBe("2 swings in 2 windows per 144-tick period: open 28, 72–84");
        const by_product: InserterClock = { inserter_id: EntityId.forInserter(2), kind: "by-product", modulus: 32, own_clock: false, window: OpenRange.from(6, 6) };
        expect(unplannedDescriptionLines([EntityId.forInserter(2)], registry, ["jellynut-seed"], by_product, OpenRange.from(7, 7), SignalId.clock)[1])
            .toBe("Clears it: open [virtual-signal=signal-clock] 7 of every 32 ticks; outside the main plan");
    });

    it("lists no windows past three, nor repeating ones, and says what is unusual", () => {
        const four = deciderWindows([0, 10, 20, 30].map(at => OpenRange.from(at, at + 2)), values);
        expect(planned([EntityId.forInserter(4)], fraction(4), four)[1]).toBe("4 swings in 4 windows per 144-tick period");
        const repeating = deciderWindows([OpenRange.from(0, 2)], values, { modulus: 48, signal: SignalId.virtual("signal-A") });
        expect(planned([EntityId.forInserter(4)], fraction(3), repeating).slice(1)).toEqual([
            "3 swings in 1 window per 144-tick period",
            "Windows repeat every 48 ticks: [virtual-signal=signal-A] = clock mod 48",
        ]);
        const subtick = deciderWindows([OpenRange.from(0, 2)], values, undefined, 13);
        // the unit of the windows is on their line, so the numbers are not read as ticks
        expect(planned([EntityId.forInserter(4)], fraction(3), subtick).slice(1)).toEqual(["3 swings in 1 window per 144-tick period: open 1–3 (in 1/13 ticks)"]);
        const many_subtick = deciderWindows([0, 10, 20, 30].map(at => OpenRange.from(at, at + 2)), values, undefined, 13);
        expect(planned([EntityId.forInserter(4)], fraction(4), many_subtick)[1]).toBe("4 swings in 4 windows per 144-tick period; windows in 1/13 ticks");
    });

    it("says of a drill into a chest that it tops that chest up, named by its icon, else by its id", () => {
        const one = deciderWindows([OpenRange.from(27, 27)], values);
        expect(chestDrillDescriptionLines([EntityId.forDrill(2)], registry, ["iron-ore"], one, "72")).toEqual([
            "[entity=big-mining-drill] [item=iron-ore] → [entity=cargo-wagon] (drill 2)",
            "Tops the [entity=cargo-wagon] up just in time, 1 window per 72-tick period: open 28",
            "Not counted as swings: opens just before the inserters take from the [entity=cargo-wagon]",
        ]);
        expect(chestDrillDescriptionLines([EntityId.forDrill(3)], registry, ["iron-ore"], one, "72").slice(1)).toEqual([
            "Tops chest 2 up just in time, 1 window per 72-tick period: open 28",
            "Not counted as swings: opens just before the inserters take from chest 2",
        ]);
        expect(chestDrillDescriptionLines([EntityId.forDrill(2), EntityId.forDrill(3)], registry, ["iron-ore"], one, "72")[2])
            .toBe("Not counted as swings: opens just before the inserters take from it");
    });

    it("gives a fuel and a by-product inserter their windows as the conditions read them", () => {
        const fuel: InserterClock = { inserter_id: EntityId.forInserter(1), kind: "fuel", modulus: 192, own_clock: true, window: OpenRange.from(0, 7) };
        expect(unplannedDescriptionLines([EntityId.forInserter(1)], registry, ["nutrients"], fuel, OpenRange.from(1, 8), null)).toEqual([
            "Fuel: [entity=turbo-transport-belt] → machine 1 [recipe=rocket-fuel-from-jelly] [item=nutrients] (inserter 1)",
            "Open [virtual-signal=signal-clock] 1–8 of the fuel clock, once every 192 ticks; does not swing while the fuel slot is full",
        ]);
        const by_product: InserterClock = { inserter_id: EntityId.forInserter(2), kind: "by-product", modulus: 32, own_clock: false, window: OpenRange.from(6, 10) };
        expect(unplannedDescriptionLines([EntityId.forInserter(2)], registry, ["jellynut-seed"], by_product, OpenRange.from(7, 11), SignalId.clock)).toEqual([
            "By-product: machine 1 [recipe=rocket-fuel-from-jelly] → [entity=turbo-transport-belt] [item=jellynut-seed] (inserter 2)",
            "Clears it: open [virtual-signal=signal-clock] 7–11 of every 32 ticks; outside the main plan",
        ]);
    });
});

describe("the description of the clock", () => {
    it("gives the rate of every copy and of one, and how to wire the rest", () => {
        expect(clockDescriptionLines({ item_name: "iron-plate", items_per_second: 120, copies: 7, period_text: "Period 336 ticks; counts 1–336", drills: true,
            not_clocked: { inserters: [], drills: [] } })).toEqual([
            "Clock for [item=iron-plate] 120/s over 7 copies (17.143/s each). Period 336 ticks; counts 1–336",
            "Wire every other combinator's output to the inserters and drills it names, in every copy; set them Enable if Anything > 0, drills with Read resources off",
            `Made by Clock Generator ${GENERATOR.version}: clock-generator-self.vercel.app`,
        ]);
    });

    it("lists the inserters and drills not on the clock before the generator's line, when that fits", () => {
        const lines = (inserters: number[]) => clockDescriptionLines({ item_name: "iron-plate", items_per_second: 80, copies: 1,
            period_text: "Period 72 ticks; counts 1–72", drills: false, not_clocked: { inserters, drills: [1] } });
        expect(lines([5, 8, 11]).slice(2)).toEqual([
            "Not on the clock, so not wired: inserters 5, 8, 11; drill 1",
            `Made by Clock Generator ${GENERATOR.version}: clock-generator-self.vercel.app`,
        ]);
        // too many to fit: left out, and the generator's line stays last
        const many = lines(Array.from({ length: 120 }, (_, index) => index + 1));
        expect(many).toHaveLength(3);
        expect(many[2]).toMatch(/^Made by Clock Generator /);
    });

    it("gives the period of a clock of whole ticks of a fractional period as the ticks it counts", () => {
        expect(shownPeriodTicks(82.28571428571429, false)).toBe("82");
        expect(shownPeriodTicks(886.1538461538462, true)).toBe("886.154");
        expect(shownPeriodTicks(72, false)).toBe("72");
    });
});
