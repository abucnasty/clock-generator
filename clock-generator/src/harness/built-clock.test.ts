import { describe, expect, test } from "vitest";
import zlib from "zlib";
import { blueprintWithNamedClock, recordingOfBuiltClock } from "./built-clock";
import { encodeBlueprintFile } from "../blueprints/serde";

const decider = (entity_number: number, extra: object = {}) => ({
    entity_number, name: "decider-combinator", position: { x: entity_number, y: 0 },
    control_behavior: { decider_conditions: {
        conditions: [{ first_signal: { type: "virtual", name: "signal-clock" }, constant: 215 }],
        outputs: [{ signal: { type: "virtual", name: "signal-clock" } }],
    } },
    ...extra,
});

const blueprintOf = (entities: object[]) => encodeBlueprintFile({ blueprint: { entities, item: "blueprint", version: 1 } } as never);
const entitiesOf = (blueprint: string) =>
    JSON.parse(zlib.inflateSync(Buffer.from(blueprint.slice(1), "base64")).toString("utf-8")).blueprint.entities;

describe("naming the clock a build came with", () => {
    test("puts the clock's description before the counter's own, and leaves the rest as it was", () => {
        const given = blueprintOf([decider(36, { player_description: "ore: swings of 3" }), decider(39)]);
        const named = blueprintWithNamedClock(given, { counter: 36, period: 216, first_value: 0 });
        const [counter, other] = entitiesOf(named);
        expect(counter.player_description).toBe("Clock for the clock the build came with\nore: swings of 3");
        expect(other.player_description).toBeUndefined();
        expect(entitiesOf(given)[0].player_description).toBe("ore: swings of 3");
    });

    test("a counter without a description of its own gets the clock's", () => {
        const named = blueprintWithNamedClock(blueprintOf([decider(1)]), { counter: 1, period: 216, first_value: 0 });
        expect(entitiesOf(named)[0].player_description).toBe("Clock for the clock the build came with");
    });

    test("a counter that starts at 1 counts as many ticks as its constant", () => {
        expect(() => blueprintWithNamedClock(blueprintOf([decider(1)]), { counter: 1, period: 215, first_value: 1 })).not.toThrow();
        expect(() => blueprintWithNamedClock(blueprintOf([decider(1)]), { counter: 1, period: 216, first_value: 1 })).toThrow(/counts 1 to 215, a period of 215/);
    });

    test("refuses an entity that is no counter of the clock signal, or a period that is not its own", () => {
        const given = blueprintOf([decider(1), { entity_number: 2, name: "constant-combinator" },
            decider(3, { control_behavior: { decider_conditions: { conditions: [], outputs: [{ signal: { name: "iron-plate" } }] } } })]);
        expect(() => blueprintWithNamedClock(given, { counter: 9, period: 216, first_value: 0 })).toThrow(/no entity 9/);
        expect(() => blueprintWithNamedClock(given, { counter: 2, period: 216, first_value: 0 })).toThrow(/is a constant-combinator/);
        expect(() => blueprintWithNamedClock(given, { counter: 3, period: 216, first_value: 0 })).toThrow(/does not output signal-clock/);
        expect(() => blueprintWithNamedClock(given, { counter: 1, period: 100, first_value: 0 })).toThrow(/a period of 216 ticks, not the 100/);
        expect(() => blueprintWithNamedClock(given, { counter: 1, period: 0, first_value: 0 })).toThrow(/whole number of ticks/);
    });

    test("refuses a build with a clock of the generator beside the one named", () => {
        const given = blueprintOf([decider(1), decider(2, { player_description: "Clock for a copy" })]);
        expect(() => blueprintWithNamedClock(given, { counter: 1, period: 216, first_value: 0 })).toThrow(/two clocks to tell apart/);
    });
});

describe("the recording of a clock the build came with", () => {
    test("carries what the clock is", () => {
        expect(recordingOfBuiltClock({ clock: { values: [0, 1] } }, { counter: 1, period: 2, first_value: 0 }))
            .toEqual({ clock: { values: [0, 1], first_value: 0, period: 2 } });
    });

    test("is refused without a clock", () => {
        expect(() => recordingOfBuiltClock({}, { counter: 1, period: 2, first_value: 0 })).toThrow(/found no clock/);
    });
});
