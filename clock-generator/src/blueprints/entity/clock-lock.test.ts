import { describe, expect, it } from "vitest";
import { Position, SignalId } from "../components";
import { ConstantCombinatorEntity } from "./constant-combinator";
import { DeciderCombinatorEntity } from "./decider-combinator";

/** What a blueprint stores of an entity, with the fields left out that are undefined */
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

const virtual = (name: string) => ({ name, type: "virtual" });
const lock_is_off = { first_signal: virtual("signal-lock"), comparator: "=" };

describe("the lock constant combinator", () => {
    const lock = ConstantCombinatorEntity.lock({ position: Position.fromXY(0.5, 1.5), description: ["Clock lock"] });

    it("puts out the lock signal once and is off", () => {
        expect(json(lock.control_behavior)).toEqual({
            sections: { sections: [{ index: 1, filters: [{ index: 1, type: "virtual", name: "signal-lock", quality: "normal", comparator: "=", count: 1 }] }] },
            is_on: false,
        });
    });
});

describe("the decider combinator of a clock", () => {
    // the example a user gave, with the fields it leaves to their defaults written out
    it("counts while below the period and the lock is off, and starts over at 1", () => {
        const clock = DeciderCombinatorEntity.clock(216).build();
        expect(json(clock.control_behavior)).toEqual({
            decider_conditions: {
                conditions: [
                    { first_signal: virtual("signal-clock"), comparator: "<", constant: 216 },
                    { ...lock_is_off, compare_type: "and" },
                ],
                outputs: [
                    { signal: virtual("signal-clock"), copy_count_from_input: true, constant: 1, networks: { red: true, green: true } },
                    { signal: virtual("signal-clock"), copy_count_from_input: false, constant: 1 },
                ],
                else_outputs: [
                    { signal: virtual("signal-clock"), copy_count_from_input: false, constant: 1 },
                ],
            },
        });
    });

    it("counts the signals derived from the count from 1 as well, counting or not", () => {
        const clock = DeciderCombinatorEntity.clock(216, SignalId.virtual("signal-T"), [SignalId.clock, SignalId.virtual("signal-B")]).build();
        const { conditions, outputs, else_outputs } = json(clock.control_behavior).decider_conditions;
        expect(conditions[0].first_signal.name).toBe("signal-T");
        const constants = (rows: { signal: { name: string }; copy_count_from_input: boolean; constant: number }[]) =>
            rows.filter(row => !row.copy_count_from_input).map(row => [row.signal.name, row.constant]);
        expect(constants(outputs)).toEqual([["signal-T", 1], ["signal-clock", 1], ["signal-B", 1]]);
        expect(constants(else_outputs)).toEqual([["signal-T", 1], ["signal-clock", 1], ["signal-B", 1]]);
        expect(outputs.filter((row: { copy_count_from_input: boolean }) => row.copy_count_from_input)).toHaveLength(1);
    });
});

describe("the filter of the lock", () => {
    it("passes everything while the lock is off and outputs nothing otherwise", () => {
        const filter = DeciderCombinatorEntity.lockFilter().build();
        expect(json(filter.control_behavior)).toEqual({
            decider_conditions: {
                conditions: [lock_is_off],
                outputs: [{ signal: virtual("signal-everything"), copy_count_from_input: true, constant: 1 }],
                else_outputs: [],
            },
        });
        // an empty list of else outputs is written out, as in the example
        expect(JSON.stringify(filter.control_behavior)).toContain('"else_outputs":[]');
    });

    it("adds 1 to the signals asked for", () => {
        const filter = DeciderCombinatorEntity.lockFilter([SignalId.clock]).build();
        expect(json(filter.control_behavior).decider_conditions.outputs).toEqual([
            { signal: virtual("signal-everything"), copy_count_from_input: true, constant: 1 },
            { signal: virtual("signal-clock"), copy_count_from_input: false, constant: 1 },
        ]);
    });
});

describe("the description of a decider combinator", () => {
    it("is kept to the 500 bytes Factorio keeps", () => {
        const lines = Array.from({ length: 40 }, (_, index) => `line ${index} of a description that is long`);
        const decider = DeciderCombinatorEntity.lockFilter().setMultiLinePlayerDescription(lines).build();
        expect(new TextEncoder().encode(decider.player_description!).length).toBeLessThanOrEqual(500);
        expect(decider.player_description!.startsWith("line 0")).toBe(true);
    });
});
