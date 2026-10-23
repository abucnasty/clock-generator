import { describe, expect, it } from "vitest";
import { OpenRange } from "../../../data-types";
import { DeciderCombinatorEntity } from "../../entity/decider-combinator";
import { SignalId } from "../signal";
import { DeciderCombinatorCondition } from "./condition";
import { CircuitReplay } from "../../../crafting/circuit-replay";

describe("the conditions of a window", () => {
    const clock = SignalId.clock;

    it("are at least its start and at most its end", () => {
        expect(DeciderCombinatorCondition.fromOpenRange(OpenRange.from(2, 4), clock)).toEqual([
            expect.objectContaining({ first_signal: clock, comparator: "≥", constant: 2, compare_type: undefined }),
            expect.objectContaining({ first_signal: clock, comparator: "≤", constant: 4, compare_type: "and" }),
        ]);
    });

    it("are one condition, equal to it, for a window of one value", () => {
        expect(DeciderCombinatorCondition.fromOpenRange(OpenRange.from(28, 28), clock)).toEqual([
            expect.objectContaining({ first_signal: clock, comparator: "=", constant: 28, compare_type: undefined }),
        ]);
    });

    it("open a decider for the same values as the two conditions did, beside windows of more values", () => {
        const ranges = [OpenRange.from(3, 3), OpenRange.from(6, 8), OpenRange.from(11, 11)];
        const decider = { ...DeciderCombinatorEntity.fromRanges(clock, ranges, [SignalId.virtual("signal-A")]).build(), entity_number: 2 };
        const conditions = (decider.control_behavior as { decider_conditions: { conditions: { comparator: string }[] } }).decider_conditions.conditions;
        expect(conditions.map(condition => condition.comparator)).toEqual(["=", "≥", "≤", "="]);
        const open: number[] = [];
        for (let value = 0; value <= 13; value++) {
            const source = { entity_number: 1, name: "constant-combinator", position: { x: 0, y: 0 },
                control_behavior: { sections: { sections: [{ filters: [{ name: clock.name, count: value }] }] } } };
            const replay = new CircuitReplay({ entities: [source, decider] as never, wires: [[1, 1, 2, 1]] });
            replay.step();
            if ((replay.output(2).get("signal-A") ?? 0) > 0) {
                open.push(value);
            }
        }
        expect(open).toEqual([3, 6, 7, 8, 11]);
    });
});
