import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { Config, ConfigSchema } from "../config/schema";
import { buildLanesOf, CheckedLanes, checkedLanesOf, CheckedLanesInput, withOtherClocks } from "./checked-lanes";
import type { CopiesTrialVerdict } from "./shared-lane-trial";
import type { SharedLaneJudgement, SharedLaneLoss, SharedLaneLossFacts } from "./shared-lane-verdict";

type Parts = Partial<Pick<Config, "machines" | "inserters" | "belts" | "overrides">> & { copies?: number };

function configOf(parts: Parts): Config {
    const { copies = 3, ...rest } = parts;
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: copies, copies, copy_offset: { x: 4, y: 0 } },
        machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }], belts: [], inserters: [], ...rest,
    }) as Config;
}

const lane = (ingredient: string, more: object = {}) => ({ ingredient, stack_size: 4, ...more });
const take = (id: number, belt_id: number) => ({ id, source: { type: "belt" as const, id: belt_id }, sink: { type: "machine" as const, id: 1 } });
const put = (id: number, belt_id: number) => ({ id, source: { type: "machine" as const, id: 1 }, sink: { type: "belt" as const, id: belt_id } });

// three copies take iron plate off a shared lane and drop gears onto a plain belt
const gears = (more: Parts = {}) => configOf({
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: [lane("iron-plate", { lane_end: { kind: "dead_end" } })] },
        { id: 2, type: "turbo-transport-belt", lanes: [lane("iron-gear-wheel")] }] as Config["belts"],
    inserters: [take(1, 1), put(2, 2)], ...more,
});

/** A loss of copy `copy`'s inserter `inserter_id` on lane 1 of belt 1 */
function lossOf(copy: number, missed: number, swings: number, more: Partial<SharedLaneLoss> = {}): SharedLaneLoss {
    return { belt_id: 1, lane: 1, lane_end: "dead_end", run_as: "dead_end", item: "iron-plate", copies: 3, copy, inserter_id: 1, items: (swings - missed) * 4,
        alone_items: swings * 4, swings: swings - missed, alone_swings: swings, short_swings: 0, window_cycles: swings, flow: { x: 1, y: 0 }, text: "", ...more };
}

const facts: SharedLaneLossFacts = { hand: 4, step_tiles: 4, travel_ticks: 32 };

function judged(losses: SharedLaneLoss[], more: Partial<SharedLaneJudgement> = {}): SharedLaneJudgement {
    return { losses, loss_facts: losses.map(() => facts), fast_check_passes: true, simulated: true, longer_run: false, lanes: ["1/1"], ...more };
}

const checked = (input: Partial<CheckedLanesInput> & { config: Config }): CheckedLanes =>
    checkedLanesOf({ holds: true, judged: judged([]), window_cycle_ticks: 60, copies_trial: null, fewer: null, ...input })!;

const rows = (lanes: CheckedLanes) => lanes.rows.map(row => [`${row.belt_id}/${row.lane}`, row.state.kind, row.label, row.sentence]);

describe("the lanes of the build", () => {
    it("are listed for a build of one copy too, with an end the lane states and one its role gives", () => {
        const one = gears({ copies: 1 });
        expect(buildLanesOf(one)).toEqual([
            { belt_id: 1, lane: 1, item: "iron-plate", role: "input", end: "dead_end", end_given_by: "lane", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
            { belt_id: 2, lane: 1, item: "iron-gear-wheel", role: "output", end: "infinite", end_given_by: "role", sharing: "shared", supply_rate: 120, supply_rate_by_default: true, capacity: 120 },
        ]);
        // a build of one copy has no row
        expect(checkedLanesOf({ config: one, holds: true, judged: judged([]), window_cycle_ticks: 60, copies_trial: null, fewer: null })).toBeNull();
    });

    it("give the switch as where the end comes from where the config states it", () => {
        expect(buildLanesOf(gears({ overrides: { backed_up_belts: true } })).map(it => it.end_given_by)).toEqual(["lane", "switch"]);
    });
});

describe("the rows of a clock", () => {
    it("hold where no copy loses swings, and a plain output belt is checked by rate", () => {
        const lanes = checked({ config: gears() });
        expect(rows(lanes)).toEqual([
            ["1/1", "holds", "Holds", "Every copy gets its items."],
            ["2/1", "rate_fits", "Rate fits", "The 3 copies together drop no more than this lane carries. Not simulated: a copy that drops onto a belt that already carries the other copies' items."],
        ]);
        expect(lanes.rows[0].together).toEqual({ kind: "take", items_per_second: 6, lanes: [1] });
        expect(lanes.line.sentence).toBe("Checked with all 3 copies on the lanes they share. Every copy gets its items. On the output belt, only the sum of the drops is checked.");
        expect(lanes.cause).toBeNull();
    });

    it("are short on a lane a copy loses swings on, first, and the others not the cause", () => {
        const lanes = checked({ config: gears(), judged: judged([lossOf(2, 3, 65)]) });
        expect(rows(lanes)[0]).toEqual(["1/1", "short", "Short on copy 2", "Copy 2 misses 3 of 65 swings."]);
        expect(lanes.rows[0].state).toEqual({ kind: "short", copies: [{ copy: 2, missed: 3, swings: 65 }] });
        expect(lanes.line.sentence).toBe("Checked with all 3 copies on the lanes they share. Copy 2 does not get all its items. On the output belt, only the sum of the drops is checked.");
        expect(lanes.cause!.headline.text).toBe("Copy 2 misses 3 of 65 swings");
    });

    it("sum the swings of two takers of one copy on one lane, and name each taker in where and how much", () => {
        const two = gears({ inserters: [take(1, 1), take(3, 1), put(2, 2)] });
        const lanes = checked({ config: two, judged: judged([lossOf(2, 3, 65), lossOf(2, 2, 60, { inserter_id: 3 })]) });
        expect(lanes.rows[0].state).toEqual({ kind: "short", copies: [{ copy: 2, missed: 5, swings: 125 }] });
        expect(lanes.cause!.where.text).toBe("The inserter (inserter 1) of copy 2 that takes iron plate misses 3 of its 65 swings in 65 window cycles. Each swing is a hand of 4. "
            + "The inserter (inserter 3) of copy 2 that takes iron plate misses 2 of its 60 swings in 60 window cycles. Each swing is a hand of 4.");
    });

    it("hold in the steady run where the copies do not get back after a trial and lose no swings", () => {
        const trial = { survives: false, lanes: ["1/1"], expected_output_items: 4, recovered_after_window_cycles: null, text: "Iron plate stops arriving." } as CopiesTrialVerdict;
        const lanes = checked({ config: gears(), copies_trial: trial });
        expect(rows(lanes)[0]).toEqual(["1/1", "holds", "Holds", "Every copy gets its items in the steady run."]);
        expect(lanes.line.sentence).toBe("Checked with all 3 copies on the lanes they share. Every copy gets its items in the steady run. "
            + "On the output belt, only the sum of the drops is checked. Iron plate stops arriving.");
    });

    it("are not run with the copies where the clock does not hold on one copy, output rows included", () => {
        const lanes = checked({ config: gears(), holds: false, judged: null });
        expect(lanes.rows.map(row => row.state.kind)).toEqual(["not_run", "not_run"]);
        expect(lanes.rows[0].sentence).toBe("The clock does not hold its output on one copy, so the copies are not run.");
        expect(lanes.line).toMatchObject({ run_with_copies: false, sentence: "Not run with the copies: the clock does not hold its output on one copy." });
        expect(lanes.rows.some(row => row.state.kind === "holds")).toBe(false);
    });

    it("are not checked on a lane taken from a belt the build drops onto, with a line of one copy", () => {
        const buffer = configOf({
            belts: [{ id: 1, type: "turbo-transport-belt", lanes: [lane("iron-plate"), lane("iron-gear-wheel")] }] as Config["belts"],
            machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }],
            inserters: [take(1, 1), put(2, 1)],
        });
        const lanes = checked({ config: buffer, judged: judged([], { simulated: false, lanes: [], loss_facts: [] }) });
        expect(rows(lanes)[0]).toEqual(["1/1", "not_checked", "Not checked", "The build drops items onto this belt, and the check of a shared lane does not run those drops yet."]);
        expect(lanes.line.sentence).toContain("Checked on one copy. No lane the copies take from is run with every copy on it.");
    });

    it("have no row for a lane that is one per copy", () => {
        const per_copy = gears({ belts: [{ id: 1, type: "turbo-transport-belt", lanes: [lane("iron-plate", { sharing: "per_copy" })] },
            { id: 2, type: "turbo-transport-belt", lanes: [lane("iron-gear-wheel")] }] as Config["belts"] });
        expect(checked({ config: per_copy, judged: judged([], { lanes: [] }) }).rows.map(row => `${row.belt_id}/${row.lane}`)).toEqual(["2/1"]);
    });
});

describe("the rows of a build that states its output belt", () => {
    const join = (copy: number) => lossOf(copy, 21, 189, { item: "iron-gear-wheel", join_full: { held_hands: 84, hands: 336, target_swings: 378 } });

    it("are a full join on the output belt and take less on the input lane, with the copy also short there without the output belt", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240) as Config;
        const losses = [join(4), join(8)];
        const judgement = judged(losses, { lanes: ["1/1", "1/2"], loss_facts: [{ ...facts, without_output_belt: { swings: 178, alone_swings: 189 } }, facts] });
        const lanes = checked({ config, judged: judgement });
        expect(rows(lanes)).toEqual([
            ["2/1", "join_full", "Join full on copies 4 and 8", "42 of 378 swings missed, on each."],
            ["1/1", "takes_less", "Copies 4 and 8 take less", "They wait for the output belt. Without the output belt, copy 4 still misses 11 of 189 swings here."],
            ["1/2", "holds", "Not the cause", "Every copy gets its items."],
        ]);
        expect(lanes.line.output_belt).toBe("misses");
        expect(lanes.cause!.cause!.text).toBe("The side belts of copies 4 and 8 are full where they join the automation science pack output belt.");
        // a full join has no reason beside the status
        expect(lanes.cause).not.toHaveProperty("reason");
        // fewer copies are fewer on the output belt too: what changes it names no lane
        const fewer = checked({ config, judged: judgement, fewer: { copies: 3 } });
        expect(fewer.cause!.changes!.text).toBe("With 3 copies, every copy makes every swing.");
    });

    it("hold at the output belt and count the waits at a join that misses no swing", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240) as Config;
        const waits = [{ copy: 1, held_hands: 0, hands: 390 }, { copy: 4, held_hands: 130, hands: 390 }, { copy: 8, held_hands: 130, hands: 390 }];
        const lanes = checked({ config, judged: judged([], { lanes: ["1/1", "1/2"], join_waits: waits }) });
        expect(rows(lanes)[2]).toEqual(["2/1", "holds", "Holds", "Copies 4 and 8 wait for room at their join in 130 of their 390 swings. No swing is missed."]);
        expect(lanes.line.sentence).toBe("Checked with all 9 copies on the lanes they share. Every copy gets its items, and no copy misses a swing at the output belt.");
        const none = checked({ config, judged: judged([], { lanes: ["1/1", "1/2"], join_waits: [{ copy: 1, held_hands: 0, hands: 390 }] }) });
        expect(rows(none)[2][3]).toBe("No copy waits at its join.");
        expect(none.line.sentence).toBe("Checked with all 9 copies on the lanes they share. Every copy gets its items, and no copy is held back at the output belt.");
    });
});

describe("the line of a build that drops into a chest of each copy", () => {
    it("names the chest by its kind and item", async () => {
        const config = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330) as Config;
        const lanes = checked({ config, judged: judged([], { lanes: ["1/1", "1/2"] }) });
        expect(lanes.rows.map(row => `${row.belt_id}/${row.lane}`)).toEqual(["1/1", "1/2"]);
        expect(lanes.line.sentence).toBe("Checked with all 11 copies on the lanes they share. Every copy gets its items. "
            + "The output goes into a chest of each copy: the infinity chest that holds electromagnetic science pack.");
    });
});

describe("the parts of the cause", () => {
    it("say what changes it with fewer copies only where their run holds, and where one copy alone on the lanes is short, say so", () => {
        const loss = lossOf(2, 3, 65);
        const holds = checked({ config: gears(), judged: judged([loss]), fewer: { copies: 2 } });
        expect(holds.cause!.changes!.text).toBe("With 2 copies on the iron plate lane, every copy makes every swing.");
        expect(holds.cause!.alone.text).toBe("The same inserter makes all 65 swings. The clock is right for one copy.");
        const none = checked({ config: gears(), judged: judged([loss]), fewer: { copies: null, one_copy_short: [{ inserter_id: 1, missed: 5, swings: 65 }] } });
        expect(none.cause!.changes).toBeNull();
        expect(none.cause!.alone).toEqual({ text: "With one copy alone on the lanes, the same inserter misses 5 of 65 swings.", data: { makes_all: false, missed: 5, swings: 65 } });
    });

    it("write the cause only where the run shows it: the copy before's gap, the full output, both, with their counts", () => {
        const stops = { missed: 6, lane_empty: 3, gap_from_copy_before: 3, machine_full: 5, both: 2, neither: 0, lane_items: ["iron-plate"], gap_items: ["iron-plate"] };
        const lanes = checked({ config: gears(), judged: judged([lossOf(2, 6, 130)], { loss_facts: [{ ...facts, stops }] }) });
        expect(lanes.cause!.cause!.text).toBe("In 3 of the 6 missed swings, the gap that copy 1 leaves on the iron plate lane reaches copy 2 when its inserter must pick up. "
            + "In 5 of the 6 missed swings, the machine of copy 2 that makes iron gear wheel has its output full and takes no more items. 2 of the 6 show both.");
        expect(lanes.cause!.spacing!.text).toMatch(/^The copies stand 4 tiles apart\. An item takes 32 ticks from one copy to the next, and the window cycle is 60 ticks\./);
        // no record of the stops, or a count that does not add up to the swings missed: no cause and no reason from the spacing
        const unknown = checked({ config: gears(), judged: judged([lossOf(2, 6, 130)]) });
        expect(unknown.cause!.cause).toBeNull();
        expect(unknown.cause!.spacing).toBeNull();
        const other = checked({ config: gears(), judged: judged([lossOf(2, 5, 130)], { loss_facts: [{ ...facts, stops }] }) });
        expect(other.cause!.cause).toBeNull();
    });

    it("give the reason of belt gaps only where at least one missed swing shows the copy before's gap, with its counts", () => {
        const stops = { missed: 6, lane_empty: 3, gap_from_copy_before: 3, machine_full: 5, both: 2, neither: 0, lane_items: ["iron-plate"], gap_items: ["iron-plate"] };
        const gaps = checked({ config: gears(), judged: judged([lossOf(2, 6, 130)], { loss_facts: [{ ...facts, stops }] }) });
        expect(gaps.cause!.reason).toEqual({ text: "Missed pickups due to belt gaps", data: { missed: 6, with_gap: 3 } });
        // the run shows the missed swings, and none of them shows the gap: no reason
        const no_gap = { ...stops, lane_empty: 0, gap_from_copy_before: 0, machine_full: 6, both: 0, gap_items: [] };
        const full = checked({ config: gears(), judged: judged([lossOf(2, 6, 130)], { loss_facts: [{ ...facts, stops: no_gap }] }) });
        expect(full.cause!.cause).not.toBeNull();
        expect(full.cause).not.toHaveProperty("reason");
        // no record of the stops: no reason
        const unknown = checked({ config: gears(), judged: judged([lossOf(2, 6, 130)]) });
        expect(unknown.cause).not.toHaveProperty("reason");
    });

    it("name another clock of the result that holds with all the copies", () => {
        const short = checked({ config: gears(), judged: judged([lossOf(2, 3, 65)]) });
        const holding = checked({ config: gears() });
        const clocks = [
            { id: "a", label: "Euclidean Swings: 1 output swing each output cycle", verdict: "unstable", checked_lanes: short, result: { simulation_duration: { ticks: 72 } } },
            { id: "b", label: "Time-Study Windows: 3 output swings each output cycle", verdict: "stable", checked_lanes: holding, result: { simulation_duration: { ticks: 216 } } },
        ];
        const [first] = withOtherClocks(clocks, 1, 3);
        expect(first.checked_lanes!.cause!.changes).toEqual({ text: "Another clock of this build holds with all 3: Time-Study Windows, window cycle 216 ticks.",
            data: { fewer_copies: null, other_clock: { id: "b", label: "Time-Study Windows: 3 output swings each output cycle", window_cycle_ticks: 216 } } });
    });
});
