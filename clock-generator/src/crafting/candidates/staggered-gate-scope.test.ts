import { describe, expect, it } from "vitest";
import type { InputWindowJudge } from "./metered-input-windows";
import { chooseStaggeredWindows, repeatedRun, type StaggerProposal } from "./staggered-input-windows";

const SERVICE = 108;
const every = (start: number, end: number) => repeatedRun({ start, length: end - start + 1 }, SERVICE, 324);

describe("the recovery gate of a whole build's stagger step", () => {
    const proposal: StaggerProposal = { reference: "inserter:2", changes: { "inserter:2": every(14, 41) },
        staggered: { "inserter:2": { kind: "staggered", role: "input", reference: "inserter:2", shift_ticks: 0, service_ticks: SERVICE } } };
    const judge = (mine: [number, number], theirs: [number, number]): InputWindowJudge => ({
        longRun: changes => ({ holds: true, wake_ups: Object.keys(changes).length === 0 ? 632.07 : 498.71, stage: null }),
        wholeCheck: () => null,
        recovery: changes => {
            const [one_copy, copies] = Object.keys(changes).length === 0 ? theirs : mine;
            return { one_copy, copies };
        },
    });

    it("refuses a proposal slower on one copy even where the worse of the two readings is not slower", () => {
        expect(chooseStaggeredWindows([proposal], judge([16, 19], [15, 19])).decisions["inserter:2"]).toEqual({ kind: "retained", reason: "recovery_worse" });
    });
});
