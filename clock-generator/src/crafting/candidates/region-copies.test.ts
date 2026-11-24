import { describe, expect, it } from "vitest";
import type { SerializableClockWindows } from "../clock";
import type { RegionOrbit } from "../graph/regions";
import type { InputWindowJudge } from "./metered-input-windows";
import { chooseRegionCopies, chooseRegionCopy, decidersOf, orbitProposals, shiftOnto, type OrbitProposals, type RegionCopyCandidate } from "./region-copies";

const PERIOD = 12;
const r = (start: number, end: number) => ({ start, end });
// Two regions about an anchor: in each a metered taker and one more arm. Arm 9 is the anchor's.
const ORBIT: RegionOrbit = {
    group: "group:1",
    anchor: ["machine:1", "inserter:9"],
    regions: [
        { key: "machine:1/region:1", nodes: ["machine:2"], arms: ["inserter:1", "inserter:2"] },
        { key: "machine:1/region:2", nodes: ["machine:3"], arms: ["inserter:3", "inserter:4"] },
    ],
    maps: [
        { "machine:2": "machine:2", "inserter:1": "inserter:1", "inserter:2": "inserter:2" },
        { "machine:2": "machine:3", "inserter:1": "inserter:3", "inserter:2": "inserter:4" },
    ],
};
const TAKERS = new Set(["inserter:1", "inserter:3"]);
// the second region's taker opens 3 ticks after the first's; its other arm's window wraps the end of the window cycle
const CLOCK: SerializableClockWindows = {
    "inserter:1": [r(0, 1)], "inserter:2": [r(4, 6)],
    "inserter:3": [r(3, 4)], "inserter:4": [r(0, 0), r(10, 11)],
    "inserter:9": [r(5, 5)],
};

describe("the candidates of an orbit", () => {
    it("moves a region's windows by one shift onto the landing region's turns, wrapped and merged, and copies them through the map", () => {
        const { candidates, refused } = orbitProposals(ORBIT, CLOCK, PERIOD, TAKERS, new Set());
        expect(refused).toBeUndefined();
        expect(candidates.map(it => [it.from, it.shift_ticks])).toEqual([["machine:1/region:1", 0], ["machine:1/region:2", -3]]);
        expect(candidates[1].changes).toEqual({
            "inserter:3": [r(0, 1)], "inserter:4": [r(7, 9)],
            "inserter:1": [r(0, 1)], "inserter:2": [r(7, 9)],
        });
        expect(candidates[1].copied["inserter:2"]).toEqual({ kind: "copied", region: "machine:1/region:1", from: "machine:1/region:2", shift_ticks: -3 });
        // the anchor's arm keeps its window
        for (const candidate of candidates) expect(candidate.changes["inserter:9"]).toBeUndefined();
    });

    it("takes the shift of least size, the negative one on a tie", () => {
        // a window every 6 ticks fits a shift of -3 and +3 alike
        const pair = { mine: [r(3, 3), r(9, 9)], theirs: [r(0, 0), r(6, 6)] };
        expect(shiftOnto([pair], PERIOD)).toBe(-3);
        expect(shiftOnto([{ mine: [r(2, 2)], theirs: [r(0, 0)] }], PERIOD)).toBe(-2);
    });

    it("gives a region whose takers no one shift puts on their partners' ticks the code uneven_shift", () => {
        const orbit: RegionOrbit = { ...ORBIT, maps: [ORBIT.maps[0], { ...ORBIT.maps[1] }] };
        const clock = { ...CLOCK, "inserter:2": [r(4, 4)], "inserter:4": [r(9, 9)] };
        // both arms are metered takers: the second region's are 3 and 5 ticks after their partners
        const { candidates, unmade } = orbitProposals(orbit, clock, PERIOD, new Set([...TAKERS, "inserter:2", "inserter:4"]), new Set());
        expect(candidates.map(it => it.from)).toEqual(["machine:1/region:1"]);
        expect(unmade).toEqual([{ from: "machine:1/region:2", reason: "uneven_shift" }]);
    });

    it("copies at shift 0 where no arm is a metered taker", () => {
        const { candidates } = orbitProposals(ORBIT, CLOCK, PERIOD, new Set(), new Set());
        expect(candidates.map(it => it.shift_ticks)).toEqual([0, 0]);
        expect(candidates[1].changes["inserter:2"]).toEqual([r(0, 0), r(10, 11)]);
    });

    it("copies nothing of an orbit where an arm has windows in one region and is always enabled in another", () => {
        for (const open of [new Set(["inserter:4"]), new Set(["inserter:2"])]) {
            const clock = { ...CLOCK };
            for (const id of open) delete clock[id];
            const proposals = orbitProposals(ORBIT, clock, PERIOD, TAKERS, open);
            expect(proposals.refused).toBe("open_differs");
            expect(proposals.candidates).toEqual([]);
            const { clock: kept, decisions } = chooseRegionCopies({ orbits: [{ found: { kind: "orbit", orbit: ORBIT }, proposals }] }, clock, PERIOD,
                ["inserter:1", "inserter:2", "inserter:3", "inserter:4", "inserter:9"], () => judge({}));
            expect(kept).toBe(clock);
            for (const id of ["inserter:1", "inserter:2", "inserter:3", "inserter:4"]) expect(decisions[id]).toEqual({ kind: "retained", reason: "open_differs" });
            expect(decisions["inserter:9"]).toEqual({ kind: "retained", reason: "no_orbit" });
        }
    });

    it("counts one decider for each distinct window set", () => {
        expect(decidersOf(CLOCK, PERIOD)).toBe(5);
        const { candidates } = orbitProposals(ORBIT, CLOCK, PERIOD, TAKERS, new Set());
        expect(decidersOf({ ...CLOCK, ...candidates[1].changes }, PERIOD)).toBe(3);
        // one window set however its ranges are split
        expect(decidersOf({ a: [r(0, 1), r(2, 3)], b: [r(0, 3)] }, PERIOD)).toBe(1);
    });
});

/** What a fake judge gives a clock: by the window of arm 2 a candidate gives it, "current" for no changes */
interface Outcome { wake_ups: number; holds?: boolean; whole?: string | null; one_copy?: number | null; copies?: number | null }
function judge(outcomes: Record<string, Outcome>): InputWindowJudge {
    const of = (changes: SerializableClockWindows): Outcome => {
        const key = Object.keys(changes).length === 0 ? "current" : JSON.stringify(changes["inserter:2"]);
        const it = outcomes[key];
        if (it === undefined) throw new Error(`no outcome for ${key}`);
        return it;
    };
    return {
        longRun: changes => ({ holds: of(changes).holds ?? true, wake_ups: of(changes).wake_ups, stage: (of(changes).holds ?? true) ? null : "long_run" }),
        wholeCheck: changes => (of(changes).whole ?? null) as ReturnType<InputWindowJudge["wholeCheck"]>,
        recovery: changes => ({ one_copy: of(changes).one_copy ?? null, copies: of(changes).copies ?? null }),
    };
}
const candidatesOf = () => orbitProposals(ORBIT, CLOCK, PERIOD, TAKERS, new Set());
const only = (proposals: OrbitProposals, ...from: number[]): OrbitProposals => ({ ...proposals, candidates: from.map(i => proposals.candidates[i]) });
const FIRST = JSON.stringify([r(4, 6)]);
const SECOND = JSON.stringify([r(7, 9)]);
const CURRENT: Outcome = { wake_ups: 100, one_copy: 19, copies: 18 };

describe("the choice of a region copy", () => {
    it("takes equal wake-ups with fewer deciders", () => {
        const choice = chooseRegionCopy(only(candidatesOf(), 1), CLOCK, PERIOD, judge({ current: CURRENT, [SECOND]: { ...CURRENT } }));
        expect(choice.taken?.from).toBe("machine:1/region:2");
    });

    it("retains equal wake-ups and equal deciders as not_better", () => {
        const proposals = candidatesOf();
        const base = { ...CLOCK, ...proposals.candidates[1].changes };
        const choice = chooseRegionCopy(only(proposals, 1), base, PERIOD, judge({ current: CURRENT, [SECOND]: { ...CURRENT } }));
        expect(choice).toEqual({ taken: null, reason: "not_better" });
    });

    it("retains more deciders at fewer wake-ups as more_deciders", () => {
        const base = { ...CLOCK, ...candidatesOf().candidates[1].changes };
        const split: RegionCopyCandidate = { from: "machine:1/region:2", shift_ticks: 0, changes: { "inserter:2": [r(8, 9)] }, copied: {} };
        const choice = chooseRegionCopy({ arms: [], candidates: [split], unmade: [] }, base, PERIOD,
            judge({ current: CURRENT, [JSON.stringify([r(8, 9)])]: { wake_ups: 90 } }));
        expect(choice).toEqual({ taken: null, reason: "more_deciders" });
    });

    it("judges recovery by the worse of the two readings", () => {
        const at = (recovery: Pick<Outcome, "one_copy" | "copies">) =>
            chooseRegionCopy(only(candidatesOf(), 1), CLOCK, PERIOD, judge({ current: CURRENT, [SECOND]: { wake_ups: 90, ...recovery } }));
        // 16 and 19 against 19 and 18: 19 against 19
        expect(at({ one_copy: 16, copies: 19 }).taken?.from).toBe("machine:1/region:2");
        // 20 and 16 against 19 and 18: 20 against 19
        expect(at({ one_copy: 20, copies: 16 })).toEqual({ taken: null, reason: "recovery_worse" });
        // no reading on one copy where the clock has one
        expect(at({ one_copy: null, copies: 16 })).toEqual({ taken: null, reason: "recovery_worse" });
    });

    it("of the candidates kept takes the fewest deciders, then the fewest wake-ups; a refusal names its stage", () => {
        const outcomes = { current: CURRENT, [FIRST]: { wake_ups: 95, one_copy: 10, copies: 10 }, [SECOND]: { wake_ups: 90, one_copy: 10, copies: 10 } };
        expect(chooseRegionCopy(candidatesOf(), CLOCK, PERIOD, judge(outcomes)).taken?.from).toBe("machine:1/region:2");
        const refused = chooseRegionCopy(candidatesOf(), CLOCK, PERIOD, judge({ ...outcomes, [FIRST]: { wake_ups: 101 }, [SECOND]: { wake_ups: 90, whole: "margin" } }));
        expect(refused).toEqual({ taken: null, reason: "joint_check_failed", stage: "margin" });
    });

    it("gives every arm of the orbit copied in the candidate taken, and every other inserter no_orbit", () => {
        const proposals = candidatesOf();
        const { clock, decisions } = chooseRegionCopies({ orbits: [{ found: { kind: "orbit", orbit: ORBIT }, proposals: only(proposals, 1) }] }, CLOCK, PERIOD,
            ["inserter:1", "inserter:2", "inserter:3", "inserter:4", "inserter:9"], () => judge({ current: CURRENT, [SECOND]: { wake_ups: 90, one_copy: 16, copies: 19 } }));
        expect(clock).toEqual({ ...CLOCK, ...proposals.candidates[1].changes });
        expect(decisions["inserter:1"]).toEqual({ kind: "copied", region: "machine:1/region:1", from: "machine:1/region:2", shift_ticks: -3 });
        expect(decisions["inserter:4"]).toEqual({ kind: "copied", region: "machine:1/region:2", from: "machine:1/region:2", shift_ticks: -3 });
        expect(decisions["inserter:9"]).toEqual({ kind: "retained", reason: "no_orbit" });
    });
});
