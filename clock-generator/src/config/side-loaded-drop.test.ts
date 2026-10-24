import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { Config } from "./index";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { describeSideLoadedDrop, sideLoadedDropNote, sideLoadedDrops, sideLoadedDropWarning } from "./side-loaded-drop";

/** A gear assembler filled from a chest by inserter 1 and emptied onto a belt by inserter 2, which may be marked */
const gears = (mark?: object): Config => ConfigSchema.parse({
    target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }],
    inserters: [
        { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 } },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1, ...(mark && { drop_capture: mark }) } },
    ],
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }] }],
    chests: [{ id: 1, type: "infinity-chest", item_filter: [{ item_name: "iron-plate", request_count: 100 }] }],
});
const MARK = { status: "side-loaded", tiles: 3, sidecar_version: "0.13.0" };
const warnings = () => {
    const warned: string[] = [];
    return { warned, logger: { log() { }, warn: (message: string) => { warned.push(message); }, error() { }, debug() { } } };
};

describe("a drop marked as side-loading onto a belt downstream", () => {
    it("is read from the sink, and a config without the mark has none", () => {
        expect(sideLoadedDrops(gears(MARK))).toEqual([{ inserter_id: 2, tiles: 3 }]);
        expect(sideLoadedDrops(gears())).toEqual([]);
        expect(sideLoadedDropWarning(gears())).toBeNull();
        expect(sideLoadedDropNote([])).toBeNull();
    });

    it("is kept by the schema as it was exported", () => {
        expect(gears(MARK).inserters[1].sink).toEqual({ type: "belt", id: 1, drop_capture: MARK });
        expect(gears({ status: "side-loaded", tiles: 1 }).inserters[1].sink).toMatchObject({ drop_capture: { tiles: 1 } });
    });

    it.each([
        [{ status: "side-loaded", tiles: 0 }],
        [{ status: "side-loaded", tiles: 1.5 }],
        [{ status: "side-loaded" }],
        [{ status: "merged", tiles: 3 }],
    ])("is refused by the schema when it is malformed: %j", mark => {
        expect(() => gears(mark)).toThrow();
    });

    it("is told in the approved wording: a sentence for each inserter, then the advice", () => {
        expect(describeSideLoadedDrop({ inserter_id: 15, tiles: 3 })).toBe("Inserter 15 drops onto a 3 tile belt buffer that side-loads onto another belt.");
        expect(sideLoadedDropNote([{ inserter_id: 15, tiles: 3 }, { inserter_id: 16, tiles: 3 }])).toBe(
            "Inserter 15 drops onto a 3 tile belt buffer that side-loads onto another belt. "
            + "Inserter 16 drops onto a 3 tile belt buffer that side-loads onto another belt. "
            + "The clock may make less in the game than shown here, most of all when these inserters are switched on at the same time as "
            + "others that drop onto the belt. Give each of these drops a belt of its own, or check the clock in the game.");
    });

    it("is generated, with a build insight on every clock and one warning in the log, and changes no clock", () => {
        const plain = generateClockAlternatives(gears(), { logger: warnings().logger });
        const { warned, logger } = warnings();
        const marked = generateClockAlternatives(gears(MARK), { logger });
        expect(marked.alternatives.length).toBeGreaterThan(0);
        for (const alternative of marked.alternatives) {
            expect(alternative.insights.filter(it => it.id === "side-loaded-drop")).toEqual([{
                id: "side-loaded-drop",
                scope: "build",
                title: "Known limit: a drop onto a belt that side-loads onto another",
                what: "Inserter 2 drops onto a 3 tile belt buffer that side-loads onto another belt.",
                why: "",
                explanation: "The clock may make less in the game than shown here, most of all when these inserters are switched on at the same time as "
                    + "others that drop onto the belt. Give each of these drops a belt of its own, or check the clock in the game.",
            }]);
        }
        expect(warned).toEqual([sideLoadedDropWarning(gears(MARK))]);
        // everything else about every clock is what it is without the mark
        const withoutInsight = (result: typeof marked) => JSON.stringify(result.alternatives.map(alternative =>
            ({ ...alternative, insights: alternative.insights.filter(it => it.id !== "side-loaded-drop") })));
        expect(withoutInsight(marked)).toBe(withoutInsight(plain));
    });

    it("is not told about a build without the mark", () => {
        const { warned, logger } = warnings();
        const { alternatives } = generateClockAlternatives(gears(), { logger });
        expect(alternatives.flatMap(it => it.insights).filter(it => it.id === "side-loaded-drop")).toEqual([]);
        expect(warned).toEqual([]);
    });
});
