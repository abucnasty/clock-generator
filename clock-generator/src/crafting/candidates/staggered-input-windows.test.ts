import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import type { Config } from "../../config/schema";
import type { SerializableClockWindows } from "../clock";
import { quiet } from "../generate-blueprint-test-helpers";
import { unclockedRun, type UnclockedRun } from "../plan/unclocked-run";
import type { InputJointStage, InputWindowJudge } from "./metered-input-windows";
import type { OutputWindowDecision } from "./metered-output-windows";
import {
    chooseStaggeredGroups, chooseStaggeredWindows, circularRuns, enabledTicks, repeatedRun, shiftedWindows, staggeredInputWindows, staggerProposals,
    type StaggerArm, type StaggerProposal,
} from "./staggered-input-windows";

const PERIOD = 324;
const SERVICE = 108;
type Range = { start: number; end: number };
/** One window from `start` to `end` each service interval, wrapped on the window cycle */
const every = (start: number, end: number): Range[] => repeatedRun({ start: ((start % SERVICE) + SERVICE) % SERVICE, length: end - start + 1 }, SERVICE, PERIOD);
const whole = [{ start: 0, end: PERIOD - 1 }];
const ids = (...numbers: number[]) => numbers.map(n => `inserter:${n}`);

describe("the shift of a shared window", () => {
    it("moves the window later, wrapped on the window cycle and merged", () => {
        expect(shiftedWindows(every(14, 41), 36, PERIOD)).toEqual([{ start: 50, end: 77 }, { start: 158, end: 185 }, { start: 266, end: 293 }]);
        // across the end of the window cycle: the last window wraps to tick 0
        expect(shiftedWindows(every(14, 41), 90, PERIOD)).toEqual([{ start: 0, end: 23 }, { start: 104, end: 131 }, { start: 212, end: 239 }, { start: 320, end: 323 }]);
        // two ranges that meet once moved are one
        expect(shiftedWindows([{ start: 0, end: 5 }, { start: 318, end: 323 }], 6, PERIOD)).toEqual([{ start: 0, end: 11 }]);
    });

    it("repeats one circular run each service interval", () => {
        expect(repeatedRun({ start: 100, length: 12 }, SERVICE, PERIOD)).toEqual([{ start: 0, end: 3 }, { start: 100, end: 111 }, { start: 208, end: 219 }, { start: 316, end: 323 }]);
        expect(repeatedRun({ start: 0, length: 25 }, SERVICE, PERIOD)).toEqual([{ start: 0, end: 24 }, { start: 108, end: 132 }, { start: 216, end: 240 }]);
    });

    it("reads a shared window that wraps tick 0 as one run that opens before the wrap", () => {
        const shared = every(102, 113);
        expect(shared).toEqual([{ start: 0, end: 5 }, { start: 102, end: 113 }, { start: 210, end: 221 }, { start: 318, end: 323 }]);
        expect(circularRuns(enabledTicks(shared, PERIOD)!, SERVICE)).toEqual([{ start: 102, length: 12 }]);
        const arms: StaggerArm[] = [{ id: "a", turn: 0 }, { id: "b", turn: 36 }].map(it => ({ ...it, on: enabledTicks(shared, PERIOD)!, service_ticks: SERVICE }));
        // the reference whose turn is nearest at or before the run's start (102): b at 36 (66 before), then a at 0 (102 before)
        const [first, second] = staggerProposals(arms, PERIOD);
        expect([first.reference, second.reference]).toEqual(["b", "a"]);
        expect(first.changes.a).toEqual(every(102 - 36, 113 - 36));
        expect(second.changes.b).toEqual(every(138, 149));
    });
});

describe("the references of a group", () => {
    const arm = (id: string, turn: number): StaggerArm => ({ id, turn, on: enabledTicks(every(14, 41), PERIOD)!, service_ticks: SERVICE });

    it("orders the references by the turn nearest at or before the shared window's start, then by turn", () => {
        const proposals = staggerProposals([arm("2", 0), arm("3", 36), arm("10", 72)], PERIOD);
        // 14 after the turn of 2, 50 after that of 10, 86 after that of 3
        expect(proposals.map(it => it.reference)).toEqual(["2", "10", "3"]);
        expect(proposals[0].changes).toEqual({ 2: every(14, 41), 3: every(50, 77), 10: every(86, 113) });
        expect(proposals[0].staggered["3"]).toEqual({ kind: "staggered", role: "input", reference: "2", shift_ticks: 36, service_ticks: SERVICE });
        expect(proposals[1].changes).toEqual({ 2: every(-58, -31), 3: every(-22, 5), 10: every(14, 41) });
    });

    it("makes one proposal for two references with one turn", () => {
        const proposals = staggerProposals([arm("a", 0), arm("b", 0), arm("c", 36)], PERIOD);
        expect(proposals.map(it => it.reference)).toEqual(["a", "c"]);
        expect(proposals[0].changes).toEqual({ a: every(14, 41), b: every(14, 41), c: every(50, 77) });
    });
});

describe("the arms the step looks at, and those it retains", () => {
    let config: Config;
    let plan: UnclockedRun;
    const overrides = { terminal_swing_count: 6, lcm: 1, derive_clock_windows: false };
    const planOf = (changed: Config) => unclockedRun({ ...changed, overrides }, { logger: quiet });
    beforeAll(async () => {
        config = await loadConfigFromFile(path.join(__dirname, "..", "fixtures", "utility-science-320-metered-takers.json"));
        plan = planOf(config);
    });

    // the six takers of the two foundries in their turns; the belt-5 inputs on one shared window, the belt-2 inputs always enabled;
    // the second foundry's outputs at 18 before their taker's turn to 6 after, the first foundry's always enabled
    const TURNS: Record<number, number> = { 5: 0, 6: 36, 9: 72, 14: 18, 16: 54, 17: 90 };
    const takers = new Set(ids(5, 6, 9, 14, 16, 17));
    const windowsOf = (changes: Record<number, Range[]> = {}): SerializableClockWindows => Object.fromEntries(Object.entries({
        ...Object.fromEntries(Object.entries(TURNS).map(([id, turn]) => [id, every(turn, turn + 1)])),
        2: every(14, 41), 3: every(14, 41), 10: every(14, 41), 12: whole, 20: whole, 21: whole,
        11: every(0, 24), 18: every(36, 60), 19: every(72, 96), 1: whole, 4: whole, 13: whole, ...changes,
    }).map(([id, ranges]) => [`inserter:${id}`, ranges]));
    const outputs = (changes: Record<number, OutputWindowDecision["kind"]> = {}): Record<string, OutputWindowDecision> => Object.fromEntries(Object.entries({
        1: "bounded", 4: "bounded", 13: "bounded", 11: "already_bounded", 18: "already_bounded", 19: "already_bounded", ...changes,
    }).map(([id, kind]) => [`inserter:${id}`, kind === "bounded" ? { kind, service_ticks: SERVICE, observed_ticks: 5184, items_taken: 768 }
        : kind === "retained" ? { kind, reason: "joint_check_failed" } : { kind }] as [string, OutputWindowDecision]));

    it("proposes the stagger of the belt-5 inputs with their outputs at the relation of the other outputs", () => {
        const stagger = staggeredInputWindows(plan, windowsOf(), takers, outputs())!;
        expect(stagger.decisions).toEqual(Object.fromEntries(ids(12, 20, 21).map(id => [id, { kind: "retained", reason: "not_bounded" }])));
        expect(stagger.groups.map(group => group.belt)).toEqual(["belt:5"]);
        const [first] = stagger.groups[0].proposals;
        expect(stagger.groups[0].proposals.map(it => it.reference)).toEqual(ids(2, 10, 3));
        expect(first.changes).toEqual({ "inserter:2": every(14, 41), "inserter:3": every(50, 77), "inserter:10": every(86, 113),
            "inserter:1": every(-18, 6), "inserter:4": every(18, 42), "inserter:13": every(54, 78) });
        expect(first.staggered["inserter:4"]).toEqual({ kind: "staggered", role: "output", relation_from: ids(11, 18, 19), shift_ticks: 18, service_ticks: SERVICE });
        expect(first.staggered["inserter:1"]).toMatchObject({ shift_ticks: 90 });
    });

    it("gives no decision where no metered taker feeds a target machine", () => {
        expect(staggeredInputWindows(plan, windowsOf(), new Set(), outputs())).toBeNull();
        // the plastic plant's taker feeds a foundry, not a science assembler
        expect(staggeredInputWindows(plan, windowsOf(), new Set(ids(8)), outputs())).toBeNull();
    });

    const codeOf = (windows: SerializableClockWindows, id: number, feeding = takers, from = plan) =>
        staggeredInputWindows(from, windows, feeding, outputs())!.decisions[`inserter:${id}`];

    it("retains an input that does not take from a belt", () => {
        // a belt-fed arm made the taker: the foundry's arm into the same assembler
        expect(codeOf(windowsOf({ 2: every(0, 1) }), 5, new Set(ids(2)))).toEqual({ kind: "retained", reason: "not_one_belt" });
    });

    it("retains an input whose machine two metered takers feed", () => {
        const twice = planOf({ ...config, inserters: [...config.inserters, { ...config.inserters.find(arm => arm.id === 2)!, id: 22,
            position: { x: 76.5, y: -77.5 } }] });
        expect(codeOf(windowsOf({ 22: every(54, 55) }), 2, new Set([...takers, "inserter:22"]), twice)).toEqual({ kind: "retained", reason: "no_single_metered_taker" });
    });

    it("retains an input whose taker's turns are not evenly spaced", () => {
        expect(codeOf(windowsOf({ 5: [{ start: 0, end: 1 }, { start: 100, end: 101 }, { start: 216, end: 217 }] }), 2)).toEqual({ kind: "retained", reason: "uneven_turns" });
    });

    it("retains an input the config always enables", () => {
        const always = planOf({ ...config, inserters: config.inserters.map(arm => arm.id === 2
            ? { ...arm, overrides: { ...arm.overrides, enable_control: { mode: "ALWAYS" as const } } } : arm) });
        expect(codeOf(windowsOf(), 2, takers, always)).toEqual({ kind: "retained", reason: "always_enabled" });
    });

    it("retains an input without a bounded window, or one that does not repeat each service interval", () => {
        expect(codeOf(windowsOf({ 2: whole }), 2)).toEqual({ kind: "retained", reason: "not_bounded" });
        expect(codeOf(windowsOf({ 2: [{ start: 14, end: 41 }] }), 2)).toEqual({ kind: "retained", reason: "window_not_periodic" });
    });

    it("retains the inputs of a belt whose windows differ, or whose takers' service intervals differ", () => {
        const differ = staggeredInputWindows(plan, windowsOf({ 3: every(50, 77) }), takers, outputs())!;
        for (const id of ids(2, 3, 10)) expect(differ.decisions[id]).toEqual({ kind: "retained", reason: "not_identical" });
        expect(differ.groups).toEqual([]);
        // assembler 2's taker every 162 ticks: its input's window, every 54, repeats on it
        const intervals = staggeredInputWindows(plan, windowsOf({ 6: [{ start: 36, end: 37 }, { start: 198, end: 199 }] }), takers, outputs())!;
        expect(intervals.decisions["inserter:3"]).toEqual({ kind: "retained", reason: "window_not_periodic" });
        const often = repeatedRun({ start: 14, length: 7 }, 54, PERIOD);
        const two = staggeredInputWindows(plan, windowsOf({ 2: whole, 6: [{ start: 36, end: 37 }, { start: 198, end: 199 }], 3: often, 10: often }), takers, outputs())!;
        expect([two.decisions["inserter:3"], two.decisions["inserter:10"]]).toEqual([{ kind: "retained", reason: "uneven_turns" }, { kind: "retained", reason: "uneven_turns" }]);
    });

    it("retains a lone input of its belt, and inputs whose takers all turn at one phase", () => {
        expect(codeOf(windowsOf(), 2, new Set(ids(5)))).toEqual({ kind: "retained", reason: "fewer_than_two_arms" });
        const one = windowsOf({ 6: every(0, 1), 9: every(0, 1) });
        for (const id of [2, 3, 10]) expect(codeOf(one, id)).toEqual({ kind: "retained", reason: "one_phase" });
    });

    it("staggers a group of exactly two inputs, whose turns are spaced unevenly against each other", () => {
        const pair = staggeredInputWindows(plan, windowsOf({ 6: every(20, 21) }), new Set(ids(5, 6)), outputs())!;
        expect(pair.groups[0].proposals.map(it => [it.reference, it.changes["inserter:2"], it.changes["inserter:3"]])).toEqual([
            ["inserter:2", every(14, 41), every(34, 61)], ["inserter:3", every(-6, 21), every(14, 41)]]);
        const uneven = staggeredInputWindows(plan, windowsOf({ 6: every(20, 21) }), takers, outputs())!;
        expect(uneven.groups[0].proposals[0].changes).toMatchObject({ "inserter:2": every(14, 41), "inserter:3": every(34, 61), "inserter:10": every(86, 113) });
    });

    it("orders several groups by their belt", () => {
        const both = staggeredInputWindows(plan, windowsOf({ 12: every(41, 58), 20: every(41, 58), 21: every(41, 58) }), takers, outputs())!;
        expect(both.groups.map(group => group.belt)).toEqual(["belt:2", "belt:5"]);
        // the outputs of the belt-2 assemblers are bounded already: the stagger alone
        expect(Object.keys(both.groups[0].proposals[0].changes)).toEqual(ids(12, 20, 21));
        for (const id of ids(11, 18, 19)) expect(both.decisions[id]).toEqual({ kind: "retained", reason: "output_not_bounded" });
    });

    describe("the outputs of the staggered machines", () => {
        const first = (windows: SerializableClockWindows, decisions = outputs()) => staggeredInputWindows(plan, windows, takers, decisions)!;

        it("proposes the stagger alone, with the code, where the other outputs' relations disagree", () => {
            const disagree = first(windowsOf({ 18: every(37, 61) }));
            for (const id of ids(1, 4, 13)) expect(disagree.decisions[id]).toEqual({ kind: "retained", reason: "relations_disagree" });
            expect(Object.keys(disagree.groups[0].proposals[0].changes)).toEqual(ids(2, 3, 10));
        });

        it("finds no relation where no other output is bounded already, or one has two windows an interval or another interval", () => {
            const none = first(windowsOf(), outputs({ 11: "bounded", 18: "bounded", 19: "bounded" }));
            for (const id of ids(1, 4, 13)) expect(none.decisions[id]).toEqual({ kind: "retained", reason: "no_output_relation" });
            const two = first(windowsOf({ 11: [...every(0, 10), ...every(15, 24)].sort((a, b) => a.start - b.start) }));
            expect(two.decisions["inserter:1"]).toEqual({ kind: "retained", reason: "no_output_relation" });
            const other = first(windowsOf({ 14: [{ start: 18, end: 19 }, { start: 180, end: 181 }] }));
            expect(other.decisions["inserter:1"]).toEqual({ kind: "retained", reason: "no_output_relation" });
            expect(Object.keys(other.groups[0].proposals[0].changes)).toEqual(ids(2, 3, 10));
        });

        it("keeps an output the output step did not bound", () => {
            const kept = first(windowsOf(), outputs({ 1: "retained", 4: "already_bounded" }));
            expect([kept.decisions["inserter:1"], kept.decisions["inserter:4"]]).toEqual([
                { kind: "retained", reason: "output_not_bounded" }, { kind: "retained", reason: "output_not_bounded" }]);
            expect(Object.keys(kept.groups[0].proposals[0].changes)).toEqual(ids(2, 3, 10, 13));
        });
    });
});

/** A judge over the clock as it is (no changes) and each proposal by its reference */
type Seen = { holds?: boolean; wake_ups?: number | null; stage?: InputJointStage | null; whole?: InputJointStage | null; one_copy?: number | null; copies?: number | null };
function judge(proposals: readonly StaggerProposal[], current: Seen, of: Partial<Record<string, Seen>>): InputWindowJudge & { asked: string[] } {
    const asked: string[] = [];
    const name = (changes: object) => Object.keys(changes).length === 0 ? "current" : proposals.find(it => it.changes === changes)!.reference;
    const seen = (changes: object): Seen => name(changes) === "current" ? current : of[name(changes)]!;
    return {
        asked,
        longRun: changes => { asked.push(`long run ${name(changes)}`); const it = seen(changes); return { holds: it.holds ?? true, wake_ups: it.wake_ups ?? null, stage: it.stage ?? null }; },
        wholeCheck: changes => { asked.push(`whole ${name(changes)}`); return seen(changes).whole ?? null; },
        recovery: changes => { const it = seen(changes); return { one_copy: it.one_copy === undefined ? 19 : it.one_copy, copies: it.copies === undefined ? 23 : it.copies }; },
    };
}

describe("the choice of a stagger", () => {
    const proposalOf = (reference: string, shift: number): StaggerProposal => ({ reference,
        changes: { "inserter:2": every(14, 41), "inserter:3": every(14 + shift, 41 + shift) },
        staggered: { "inserter:2": { kind: "staggered", role: "input", reference, shift_ticks: 0, service_ticks: SERVICE },
            "inserter:3": { kind: "staggered", role: "input", reference, shift_ticks: shift, service_ticks: SERVICE } } });
    const first = proposalOf("inserter:2", 36), second = proposalOf("inserter:3", 72);
    const both = [first, second];
    const now: Seen = { wake_ups: 964.77, one_copy: 19, copies: 23 };

    it("codes a proposal that does not hold to the long run, never judging it further", () => {
        const j = judge(both, now, { "inserter:2": { holds: false, stage: "first_window_cycle" } });
        const { taken, decisions } = chooseStaggeredWindows([first], j);
        expect(taken).toBeNull();
        expect(decisions).toEqual(Object.fromEntries(ids(2, 3).map(id => [id, { kind: "retained", reason: "joint_check_failed", stage: "first_window_cycle" }])));
        expect(j.asked).not.toContain("whole inserter:2");
    });

    it("refuses equal or more wake-ups, to a thousandth", () => {
        for (const wake_ups of [964.7704, 964.77, 1130.77]) {
            const j = judge(both, now, { "inserter:2": { wake_ups } });
            expect(chooseStaggeredWindows([first], j).decisions["inserter:3"]).toEqual({ kind: "retained", reason: "no_fewer_wake_ups" });
            expect(j.asked).not.toContain("whole inserter:2");
        }
    });

    it("codes a proposal whose whole check fails at the stage that fails", () => {
        const j = judge(both, now, { "inserter:2": { wake_ups: 565.39, whole: "margin" } });
        expect(chooseStaggeredWindows([first], j).decisions["inserter:2"]).toEqual({ kind: "retained", reason: "joint_check_failed", stage: "margin" });
    });

    it("refuses a slower recovery on one copy or on the copies", () => {
        for (const worse of [{ one_copy: 20 }, { copies: 24 }, { one_copy: null }]) {
            const j = judge(both, now, { "inserter:2": { wake_ups: 565.39, ...worse } });
            expect(chooseStaggeredWindows([first], j)).toEqual({ taken: null, decisions: Object.fromEntries(ids(2, 3).map(id => [id, { kind: "retained", reason: "recovery_worse" }])) });
        }
        expect(chooseStaggeredWindows([first], judge(both, now, { "inserter:2": { wake_ups: 565.39, one_copy: 19, copies: 19 } })).taken).toBe(first);
    });

    it("takes the passing proposal of the lowest cost, of equal costs the earlier, and gives each arm the code of its cheapest proposal", () => {
        const j = judge(both, now, { "inserter:2": { wake_ups: 600 }, "inserter:3": { wake_ups: 565.39 } });
        const { taken, decisions } = chooseStaggeredWindows(both, j);
        expect(taken).toBe(second);
        expect(decisions["inserter:3"]).toEqual(second.staggered["inserter:3"]);
        expect(j.asked.filter(it => it.startsWith("whole"))).toEqual(["whole inserter:3"]);
        expect(chooseStaggeredWindows(both, judge(both, now, { "inserter:2": { wake_ups: 565.39 }, "inserter:3": { wake_ups: 565.3904 } })).taken).toBe(first);
        // the cheaper fails its whole check, the other does not hold: the code of the cheaper
        const refused = chooseStaggeredWindows(both, judge(both, now, { "inserter:2": { holds: false, stage: "first_window_cycle" }, "inserter:3": { wake_ups: 565.39, whole: "copies" } }));
        expect(refused).toEqual({ taken: null, decisions: Object.fromEntries(ids(2, 3).map(id => [id, { kind: "retained", reason: "joint_check_failed", stage: "copies" }])) });
    });

    it("judges several groups one at a time, in their order, each against the clock the group before leaves", () => {
        const belt2: StaggerProposal = { reference: "inserter:12", changes: { "inserter:12": every(41, 58) },
            staggered: { "inserter:12": { kind: "staggered", role: "input", reference: "inserter:12", shift_ticks: 0, service_ticks: SERVICE } } };
        const clocks: SerializableClockWindows[] = [];
        const { clock, decisions } = chooseStaggeredGroups([{ belt: "belt:2", proposals: [belt2] }, { belt: "belt:5", proposals: [first] }], { "inserter:12": whole }, base => {
            clocks.push(base);
            return judge([belt2, first], { ...now, wake_ups: clocks.length === 1 ? 964.77 : 900 }, { "inserter:12": { wake_ups: 900 }, "inserter:2": { wake_ups: 900 } });
        });
        expect(clocks).toEqual([{ "inserter:12": whole }, { "inserter:12": every(41, 58) }]);
        // the second group against 900: no fewer wake-ups
        expect(decisions["inserter:12"]).toEqual(belt2.staggered["inserter:12"]);
        expect(decisions["inserter:2"]).toEqual({ kind: "retained", reason: "no_fewer_wake_ups" });
        expect(clock).toEqual({ "inserter:12": every(41, 58) });
    });

    describe("two belts that feed the same assemblers", () => {
        // belt 2 and belt 5 each stagger their own input arm, and both propose the one output arm of the shared machine
        const output = (windows: Range[], shift_ticks: number): Pick<StaggerProposal, "changes" | "staggered"> => ({
            changes: { "inserter:1": windows },
            staggered: { "inserter:1": { kind: "staggered", role: "output", relation_from: ["inserter:14"], shift_ticks, service_ticks: SERVICE } } });
        const proposalFor = (input: number, shared: Range[], out: Pick<StaggerProposal, "changes" | "staggered">): StaggerProposal => ({
            reference: `inserter:${input}`,
            changes: { [`inserter:${input}`]: shared, ...out.changes },
            staggered: { [`inserter:${input}`]: { kind: "staggered", role: "input", reference: `inserter:${input}`, shift_ticks: 0, service_ticks: SERVICE }, ...out.staggered } });
        const outputOne = every(70, 81), outputTwo = every(90, 101);
        const belt2 = proposalFor(12, every(41, 58), output(outputOne, 70));
        const belt5 = proposalFor(2, every(14, 41), output(outputOne, 70));
        const belt5Other = proposalFor(2, every(14, 41), output(outputTwo, 90));
        const start: SerializableClockWindows = { "inserter:1": whole, "inserter:2": whole, "inserter:12": whole };

        /** Each group has the one proposal it is given, judged against the clock at its turn: `seen[n]` is what the judge says of group n's proposal */
        function choose(proposals: readonly StaggerProposal[], bases: readonly number[], seen: readonly Seen[]) {
            let turn = 0;
            return chooseStaggeredGroups(proposals.map((proposal, i) => ({ belt: `belt:${i}`, proposals: [proposal] })), start, () => {
                const n = turn++;
                return judge(proposals, { ...now, wake_ups: bases[n] }, Object.fromEntries(proposals.map((proposal, i) => [proposal.reference, i === n ? seen[n] : {}])));
            });
        }

        /** For every id: staggered exactly where a taken proposal holds it, by the last such proposal, which also gave the clock its windows */
        function expectTheLastTaken(result: ReturnType<typeof choose>, proposals: readonly StaggerProposal[], taken: readonly StaggerProposal[]) {
            for (const id of new Set(proposals.flatMap(proposal => Object.keys(proposal.changes)))) {
                const last = taken.filter(proposal => id in proposal.changes).at(-1);
                if (last === undefined) {
                    expect(result.decisions[id]).toBeDefined();
                    expect(result.decisions[id].kind).not.toBe("staggered");
                    expect(result.clock[id]).toEqual(start[id]);
                } else {
                    expect(result.decisions[id]).toEqual(last.staggered[id]);
                    expect(result.clock[id]).toEqual(last.changes[id]);
                }
            }
        }

        it("keeps the staggered decision of an output that the first group took and the second refused", () => {
            const result = choose([belt2, belt5], [964.77, 565.39], [{ wake_ups: 565.39 }, { wake_ups: 600 }]);
            expect(result.clock).toEqual({ "inserter:1": outputOne, "inserter:2": whole, "inserter:12": every(41, 58) });
            expect(result.decisions["inserter:1"]).toEqual(belt2.staggered["inserter:1"]);
            expect(result.decisions["inserter:12"]).toEqual(belt2.staggered["inserter:12"]);
            expect(result.decisions["inserter:2"]).toEqual({ kind: "retained", reason: "no_fewer_wake_ups" });
            expectTheLastTaken(result, [belt2, belt5], [belt2]);
        });

        it("gives the output to the second group where the first refused and the second took", () => {
            const result = choose([belt2, belt5], [964.77, 964.77], [{ wake_ups: 964.77 }, { wake_ups: 565.39 }]);
            expect(result.clock).toEqual({ "inserter:1": outputOne, "inserter:2": every(14, 41), "inserter:12": whole });
            expect(result.decisions["inserter:1"]).toEqual(belt5.staggered["inserter:1"]);
            expect(result.decisions["inserter:2"]).toEqual(belt5.staggered["inserter:2"]);
            expect(result.decisions["inserter:12"]).toEqual({ kind: "retained", reason: "no_fewer_wake_ups" });
            expectTheLastTaken(result, [belt2, belt5], [belt5]);
        });

        it("gives the output to the second group where both took it with different windows, as the clock has them", () => {
            const result = choose([belt2, belt5Other], [964.77, 565.39], [{ wake_ups: 565.39 }, { wake_ups: 500 }]);
            expect(result.clock).toEqual({ "inserter:1": outputTwo, "inserter:2": every(14, 41), "inserter:12": every(41, 58) });
            expect(result.decisions["inserter:1"]).toEqual(belt5Other.staggered["inserter:1"]);
            expect(result.decisions["inserter:12"]).toEqual(belt2.staggered["inserter:12"]);
            expect(result.decisions["inserter:2"]).toEqual(belt5Other.staggered["inserter:2"]);
            expectTheLastTaken(result, [belt2, belt5Other], [belt2, belt5Other]);
        });

        it("gives the output the code of the last group where both refused", () => {
            const result = choose([belt2, belt5], [964.77, 964.77], [{ wake_ups: 964.77 }, { holds: false, stage: "first_window_cycle" }]);
            expect(result.clock).toEqual(start);
            expect(result.decisions["inserter:1"]).toEqual({ kind: "retained", reason: "joint_check_failed", stage: "first_window_cycle" });
            expect(result.decisions["inserter:12"]).toEqual({ kind: "retained", reason: "no_fewer_wake_ups" });
            expect(result.decisions["inserter:2"]).toEqual({ kind: "retained", reason: "joint_check_failed", stage: "first_window_cycle" });
            expectTheLastTaken(result, [belt2, belt5], []);
        });
    });
});
