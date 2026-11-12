import { describe, expect, it } from "vitest";
import { beltNameInText, chestNameInText, drillNameInText, entityNameOf, inserterNameInText, insertersInSentence, laneNameInText, lanesInSentence, type BuildToName } from "./entity-name";

const build = (part: Partial<BuildToName>): BuildToName => ({ belts: [], inserters: [], chests: [], drills: [], ...part });

describe("the name a text gives a lane", () => {
    it("is its item, with no number, where it is the only lane of the item", () => {
        const one = build({ belts: [{ id: 1, lanes: ["iron-gear-wheel", "copper-plate"] }] });
        expect(laneNameInText(1, 1, one)).toBe("iron-gear-wheel lane");
        expect(laneNameInText(1, 2, one)).toBe("copper-plate lane");
    });

    it("has its number where two lanes of one copy carry the same item", () => {
        const alike = build({ belts: [{ id: 1, lanes: ["tungsten-ore", "tungsten-ore"] }] });
        expect(laneNameInText(1, 2, alike)).toBe("tungsten-ore lane (lane 2 of belt 1)");
    });

    it("has no number where the lanes of one belt carry different items", () => {
        const two = build({ belts: [{ id: 3, lanes: ["stone-wall", "piercing-rounds-magazine"] }] });
        expect([laneNameInText(3, 1, two), laneNameInText(3, 2, two)]).toEqual(["stone-wall lane", "piercing-rounds-magazine lane"]);
    });

    it("is by its belt where it has no item, and has its number always where it is to find a row of the form", () => {
        const empty = build({ belts: [{ id: 2, lanes: ["automation-science-pack"] }] });
        expect(laneNameInText(2, 2, empty)).toBe("lane 2 of the automation-science-pack belt");
        expect(laneNameInText(2, 1, empty, { numbered: true })).toBe("automation-science-pack lane (lane 1 of belt 2)");
    });

    it("names lanes together", () => {
        const lanes = build({ belts: [{ id: 1, lanes: ["iron-gear-wheel", "copper-plate"] }, { id: 5, lanes: ["coal", "coal"] }, { id: 6, lanes: ["coal", "coal"] }] });
        expect(lanesInSentence([{ belt_id: 1, lane: 1 }], lanes)).toBe("the iron-gear-wheel lane");
        expect(lanesInSentence([{ belt_id: 1, lane: 1 }, { belt_id: 1, lane: 2 }], lanes)).toBe("both lanes of the iron-gear-wheel and copper-plate belt");
        expect(lanesInSentence([{ belt_id: 5, lane: 1 }, { belt_id: 5, lane: 2 }], lanes)).toBe("both lanes of the coal belt (belt 5)");
        expect(lanesInSentence([{ belt_id: 5, lane: 1 }, { belt_id: 6, lane: 1 }], lanes)).toBe("the coal lanes (lane 1 of belt 5 and lane 1 of belt 6)");
        const apart = build({ belts: [{ id: 1, lanes: ["low-density-structure", "flying-robot-frame"] }, { id: 2, lanes: ["processing-unit"] }] });
        expect(lanesInSentence([{ belt_id: 1, lane: 1 }, { belt_id: 2, lane: 1 }], apart)).toBe("the low-density-structure and processing-unit lanes");
    });
});

describe("the name a text gives a belt", () => {
    it("is its items, with no number, where no other belt carries the same items", () => {
        const one = build({ belts: [{ id: 1, lanes: ["iron-gear-wheel", "copper-plate"] }, { id: 2, lanes: ["automation-science-pack"] }] });
        expect(beltNameInText(1, one)).toBe("iron-gear-wheel and copper-plate belt");
        expect(beltNameInText(2, one)).toBe("automation-science-pack belt");
    });

    it("has its number where two belts of one copy carry the same items", () => {
        const alike = build({ belts: [{ id: 1, lanes: ["accumulator"] }, { id: 2, lanes: ["accumulator"] }] });
        expect(beltNameInText(2, alike)).toBe("accumulator belt (belt 2)");
    });

    it("has no number where two belts carry different items, and its item once where both lanes carry it", () => {
        const two = build({ belts: [{ id: 1, lanes: ["tungsten-ore", "tungsten-ore"] }, { id: 2, lanes: ["coal", "coal"] }] });
        expect([beltNameInText(1, two), beltNameInText(2, two)]).toEqual(["tungsten-ore belt", "coal belt"]);
        expect(beltNameInText(1, two, { numbered: true })).toBe("tungsten-ore belt (belt 1)");
    });
});

describe("the name a text gives an inserter", () => {
    const inserters = build({ inserters: [
        { id: 1, from: "belt", to: "machine", items: ["iron-gear-wheel", "copper-plate"] },
        { id: 2, from: "machine", to: "belt", items: ["automation-science-pack"] },
        { id: 3, from: "machine", to: "chest", items: ["grenade"] },
        { id: 4, from: "chest", to: "machine", items: ["coal"] },
        { id: 6, from: "machine", to: "machine", items: ["battery"] },
        { id: 8, from: "machine", to: "machine", items: ["battery"] },
        { id: 9, from: "belt", to: "machine", items: ["coal"] },
    ] });

    it("is what it takes or drops, with no number, where it is the only one", () => {
        expect(inserterNameInText(1, inserters)).toBe("inserter that takes iron-gear-wheel and copper-plate");
        expect(inserterNameInText(2, inserters)).toBe("inserter that drops automation-science-pack");
        expect(inserterNameInText(3, inserters)).toBe("inserter that drops grenade into a chest");
    });

    it("has its number where two of one copy do the same", () => {
        expect(inserterNameInText(6, inserters)).toBe("inserter (inserter 6) that moves battery");
        expect(insertersInSentence([6, 8], inserters)).toEqual({ text: "the inserters (6 and 8) that move battery", plural: true });
    });

    it("has no number where two take the same item from different places", () => {
        expect([inserterNameInText(4, inserters), inserterNameInText(9, inserters)]).toEqual(["inserter that takes coal out of a chest", "inserter that takes coal"]);
    });

    it("has no number where two take from the same place different items", () => {
        expect([inserterNameInText(1, inserters), inserterNameInText(9, inserters)]).toEqual(["inserter that takes iron-gear-wheel and copper-plate", "inserter that takes coal"]);
    });

    it("has its number always where it is to find a row of the form, and is its number where its items are not known", () => {
        expect(inserterNameInText(9, inserters, { numbered: true })).toBe("inserter (inserter 9) that takes coal");
        expect(inserterNameInText(12, inserters)).toBe("inserter 12");
    });
});

describe("the name a text gives a chest and a drill", () => {
    const chests = build({
        chests: [{ id: 1, kind: "buffer-chest", holds: ["iron-plate"] }, { id: 2, kind: "car", holds: [] }, { id: 3, kind: "car", holds: [] },
            { id: 4, kind: "infinity-chest", holds: [] }],
        drills: [{ id: 1, mines: "stone" }, { id: 2, mines: "iron-ore" }, { id: 3, mines: "iron-ore" }],
    });

    it("is a chest's kind and what it holds, a car's kind, with the number where two read the same", () => {
        expect(chestNameInText(1, chests)).toBe("buffer-chest that holds iron-plate");
        expect(chestNameInText(4, chests)).toBe("infinity-chest");
        expect(chestNameInText(2, chests)).toBe("car (car 2)");
        expect(chestNameInText(1, chests, { numbered: true })).toBe("buffer-chest (chest 1) that holds iron-plate");
    });

    it("is what a drill mines, with the number where two mine the same", () => {
        expect(drillNameInText(1, chests)).toBe("drill that mines stone");
        expect(drillNameInText(3, chests)).toBe("drill (drill 3) that mines iron-ore");
    });

    it("is found by the entity's id, in the words a text uses", () => {
        expect(entityNameOf("chest:1", chests, { words: { item: id => id.replace(/-/g, " ") } })).toBe("buffer chest that holds iron plate");
        expect(entityNameOf("machine:1", chests)).toBeUndefined();
    });
});
