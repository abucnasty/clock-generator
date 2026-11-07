import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config/schema";
import { quiet } from "../generate-blueprint-test-helpers";
import { unclockedRun } from "../plan/unclocked-run";
import { dropSpacing, dropTieBreak } from "../../config/drop-spacing";
import { RoundRobinPollingNotApplicable, roundRobinPollingCycles, roundRobinPollingPlan, roundRobinPollingWindows, heldAtTurn, perHandWindows, roomAtTurn, TurnWithoutRoom } from "./round-robin-polling";
import { outputAtWindow, turnOffsets } from "./taker-turns";
import { EntityId, Inserter, Machine } from "../../entities";

// The grenade build (GRENADE_240_FILLS_BELT_EXACTLY), one copy: a foundry (3) fills four assembling machines (1, 2, 4, 5) with iron
// plates through inserters 4, 3, 6 and 5, five hands of 16 a period each; a drill into each machine brings the coal; inserters 1,
// 2, 7 and 8 take 16 grenades from the machines onto a belt. The period is 112 ticks, the hand cycle 8.
const windowsOf = (config: Config, by_drops = false) => {
    const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, terminal_swing_count: 1 } }, { logger: quiet });
    const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
    const drops = by_drops ? dropTieBreak(config, duration.ticks) : null;
    return () => roundRobinPollingWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true, undefined, drops);
};
/** The ticks at which each output inserter of a window set starts its hand */
const outputStarts = (windows: Map<string, { start_inclusive: number }[]>) =>
    new Map([1, 2, 7, 8].map(id => [id, [windows.get(`inserter:${id}`)![0].start_inclusive]] as const));
const ranges = (windows: Map<string, { start_inclusive: number; end_inclusive: number }[]>, id: string) =>
    windows.get(id)!.map(range => [range.start_inclusive, range.end_inclusive]);

describe("hands in groups", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
    });

    it("splits the four takers of the foundry into two groups half a period apart, each taker one window for its five hands", () => {
        const windows = windowsOf(config)();
        // 4 x 80 plates in a window of 42 ticks are more than the foundry holds (100) and makes (3.74 a tick); 2 x 80 are not
        expect(ranges(windows, "inserter:4")).toEqual([[2, 43]]);
        expect(ranges(windows, "inserter:6")).toEqual([[2, 43]]);
        expect(ranges(windows, "inserter:3")).toEqual([[58, 99]]);
        expect(ranges(windows, "inserter:5")).toEqual([[58, 99]]);
        // one tick for the hand of grenades, at the start of the machine's group
        expect(ranges(windows, "inserter:1")).toEqual([[0, 0]]);
        expect(ranges(windows, "inserter:7")).toEqual([[0, 0]]);
        expect(ranges(windows, "inserter:2")).toEqual([[56, 56]]);
        expect(ranges(windows, "inserter:8")).toEqual([[56, 56]]);
        // a drill's window opens with its machine's inputs
        expect(ranges(windows, "drill:1")[0][0]).toBe(2);
        expect(ranges(windows, "drill:2")[0][0]).toBe(58);
    });

    it("names the groups that take turns: each starts where its output swings open, with its outputs, then its inputs, then its drills", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const turnsOf = (drops: ReturnType<typeof dropTieBreak> | null) =>
            roundRobinPollingPlan(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true, undefined, drops).turns;
        // dealt out by ids: the machines alternate between the two groups
        expect(turnsOf(null)).toEqual([
            { start: 0, entity_ids: ["inserter:1", "inserter:7", "inserter:4", "inserter:6", "drill:1", "drill:3"] },
            { start: 56, entity_ids: ["inserter:2", "inserter:8", "inserter:3", "inserter:5", "drill:2", "drill:4"] },
        ]);
        // dealt out by the belt the hands drop on: the machines of one row of it are a group
        expect(turnsOf(dropTieBreak(config, duration.ticks))).toEqual([
            { start: 0, entity_ids: ["inserter:1", "inserter:2", "inserter:3", "inserter:4", "drill:1", "drill:2"] },
            { start: 56, entity_ids: ["inserter:7", "inserter:8", "inserter:5", "inserter:6", "drill:3", "drill:4"] },
        ]);
    });

    it("gives the drills of one group one window, as long as the ticks the slowest of them needs to mine its machine's coal", () => {
        // 160 coal a period for a machine against 125 a tick mined (drills 1 and 3, speed bonus 17.725) or 134 (drills 2 and 4, 19.0575):
        // two ticks, which is also the least a drop needs; the drills of a group have the same window though their speeds differ
        const windows = windowsOf(config, true)();
        const [first, second] = [ranges(windows, "drill:1"), ranges(windows, "drill:2")];
        const [third, fourth] = [ranges(windows, "drill:3"), ranges(windows, "drill:4")];
        expect(first).toEqual(second);
        expect(third).toEqual(fourth);
        expect([first, third]).toEqual([[[2, 3]], [[58, 59]]]);
    });

    it("lengthens the window of a group to the longest need of its drills", () => {
        // drill 1 at a speed bonus of 1 mines 13.35 coal a tick, so its machine's 160 take 12 ticks; drill 2 still needs 2, and has the 12 too
        const slow = { ...config, drills: { ...config.drills!, configs: config.drills!.configs.map(drill => drill.id === 1 ? { ...drill, speed_bonus: 1 } : drill) } };
        const windows = windowsOf(slow, true)();
        expect(ranges(windows, "drill:1")).toEqual(ranges(windows, "drill:2"));
        expect(ranges(windows, "drill:1")).toEqual([[2, 13]]);
        expect(ranges(windows, "drill:3")).toEqual([[58, 59]]);
        expect(ranges(windows, "drill:4")).toEqual([[58, 59]]);
    });

    it("puts the machines whose hands drop side by side on a shared belt in a group, where the places of the inserters are known", () => {
        // the machines of inserters 1 and 2 stand in one row of the belt and 7 and 8 in the other: dealt out in the order of
        // their ids, a group has one of each row and the second hand of every copy lands on the first one's tile
        const by_ids = windowsOf(config)();
        expect(dropSpacing(config, outputStarts(by_ids), 112)!.lines.map(line => line.pairs)).toEqual([7, 7]);
        const by_belt = windowsOf(config, true)();
        expect(dropSpacing(config, outputStarts(by_belt), 112)!.lines.map(line => line.pairs)).toEqual([0, 0]);
        for (const id of [1, 2]) expect(ranges(by_belt, `inserter:${id}`)).toEqual([[0, 0]]);
        for (const id of [7, 8]) expect(ranges(by_belt, `inserter:${id}`)).toEqual([[56, 56]]);
        // the input windows follow their machines: the group of the first row is served first, each window of 42 ticks
        for (const id of [4, 3, 6, 5].map(it => `inserter:${it}`)) expect([[2, 43], [58, 99]]).toContainEqual(ranges(by_belt, id)[0]);
        expect(new Set([4, 3, 6, 5].map(id => ranges(by_belt, `inserter:${id}`)[0][0]))).toEqual(new Set([2, 58]));
    });

    it("keeps the dealing by ids where no other dealing puts fewer hands on each other", () => {
        // copies 11 tiles apart: two pairs of hands land on each other for either dealing
        const gapped = { ...config, target_output: { ...config.target_output, copy_offset: { x: 11, y: 0 } } };
        const by_ids = windowsOf(gapped)();
        const by_belt = windowsOf(gapped, true)();
        const pairs = (windows: typeof by_ids) => dropSpacing(gapped, outputStarts(windows), 112)!.lines.reduce((sum, line) => sum + line.pairs, 0);
        expect(pairs(by_ids)).toBe(2);
        expect(pairs(by_belt)).toBe(2);
        expect(Array.from(by_belt)).toEqual(Array.from(by_ids));
    });

    it("has nothing to choose by where the inserters have no places", () => {
        const placeless = { ...config, inserters: config.inserters.map(({ position: _position, ...inserter }) => inserter) };
        expect(dropTieBreak(placeless, 112)).toBeNull();
    });

    it("is one group where the foundry can serve every taker at once", () => {
        const fast = { ...config, machines: config.machines.map(machine => machine.recipe === "casting-iron" ? { ...machine, crafting_speed: machine.crafting_speed * 2 } : machine) };
        const windows = windowsOf(fast)();
        for (const id of [3, 4, 5, 6]) expect(ranges(windows, `inserter:${id}`)).toEqual([[2, 43]]);
        for (const id of [1, 2, 7, 8]) expect(ranges(windows, `inserter:${id}`)).toEqual([[0, 0]]);
    });

    it("does not apply to a build of machines that hand products on by several hands a period", async () => {
        const accumulator = await loadConfigFromFile(ConfigPaths.ACCUMULATOR_640);
        expect(windowsOf(accumulator)).toThrow(RoundRobinPollingNotApplicable);
    });
});

// the utility science 480 build (UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN): thirteen machines in a chain, a cryogenic plant (7) fills four foundries' worth of plastic
// through inserters 10, 12, 19 and 20 and has coal from a belt (11); foundries (3, 4, 10, 11) fill the eight assemblers with low
// density structure; units and frames come off two belts; eight inserters take the packs out onto belts. The cycle is 168 ticks.
describe("hands in a chain of machines", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_480_LDS_FOUNDRY_CHAIN);
    });

    it("asks for one cycle: the hands of the inserters that fill a machine are rounded up, only the output's must be whole", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        // the plan itself needs 8 cycles for the coal inserter's 15/8 hands
        expect(plan.run.recipe_lcm).toBe(8);
        expect(roundRobinPollingCycles(plan.run.simulation_context.entity_registry, plan.run.swing_counts)).toBe(1);
    });

    it("puts the windows in the order of the chain: output, units, low density structure, plastic and coal a tick behind", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        expect(duration.ticks).toBe(168);
        // the way the sample's clock is made: a hand's worth for the plastic, whose foundries would keep a surplus hand, and the compact order
        const windows = roundRobinPollingWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
            { surplus_guard: true, feeder_offset: 1, share_windows: false });
        // three hands of 12 ticks onto the belt; then, as the last of them starts, the units and frames (two hands of 11, a third start the
        // limit refuses, and the belt pickup slack of 4); the low density structure behind them (two hands of 8 and a third start); the plastic
        // a tick after it (four hands of 8: no more than four) and the coal after that (two hands of 11 and a third start, and the slack)
        for (const id of [3, 4, 9, 13, 18, 21, 24, 27]) expect(ranges(windows, `inserter:${id}`)).toEqual([[0, 36]]);
        for (const id of [1, 2, 14, 15, 16, 17, 28, 29]) expect(ranges(windows, `inserter:${id}`)).toEqual([[26, 53]]);
        for (const id of [5, 6, 7, 8, 22, 23, 25, 26]) expect(ranges(windows, `inserter:${id}`)).toEqual([[54, 71]]);
        for (const id of [10, 12, 19, 20]) expect(ranges(windows, `inserter:${id}`)).toEqual([[55, 80]]);
        expect(ranges(windows, "inserter:11")).toEqual([[56, 83]]);
    });

    it("has no groups that take turns: one group serves the chain", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const made = roundRobinPollingPlan(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
            { surplus_guard: true, feeder_offset: 1, share_windows: false });
        expect(made.windows.size).toBeGreaterThan(0);
        expect(made.turns).toEqual([]);
    });

    it("keeps the extra start per taker where it leaves no taker busy: the plastic's four hands and a start are 34 of 168 ticks", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const windows = roundRobinPollingWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
            { surplus_guard: false, per_taker_guard: true, feeder_offset: 1, share_windows: false });
        // the guard for every taker gives the plastic 26 ticks (above); per taker it is not busy with the fifth start, so it keeps it
        for (const id of [10, 12, 19, 20]) expect(ranges(windows, `inserter:${id}`)).toEqual([[55, 88]]);
    });
});

// Cell 02 (PROCESSING_UNIT_80_CIRCUIT_EXPORT): two processing unit machines (2, 3) are filled with circuits by four
// inserters (3, 4, 7, 8) and with advanced circuits by 2 and 9 from two advanced circuit machines (4, 7); two circuit machines (5, 6) are
// filled by a foundry (1) and three cable foundries each, and export onto a belt through 16 and 17. The cycle is 24 ticks, the hand cycle 8.
describe("hands that fill the cycle", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
    });

    it("asks for one cycle: an export onto a belt of two lanes is one hand, not two halves", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        expect(roundRobinPollingCycles(plan.run.simulation_context.entity_registry, plan.run.swing_counts)).toBe(1);
    });

    it("leaves an inserter enabled whose hands take the cycle, and gives the others a window for their hands", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        expect(duration.ticks).toBe(24);
        const windows = roundRobinPollingWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
            { surplus_guard: false, feeder_offset: 1, share_windows: false });
        // three hands of 8 ticks and a start more are 26 ticks: the circuits into the processing unit machines (3, 4, 7, 8), the iron and
        // the cable into the circuit machines (5, 6, 13, 14, 15, 18, 19, 20) are busy all the time
        for (const id of [3, 4, 5, 6, 7, 8, 13, 14, 15, 18, 19, 20]) expect(windows.has(`inserter:${id}`)).toBe(false);
        // the advanced circuits: one hand and a start more (10 ticks), after the circuits' place in the order; the plastic a hand of 11, a start more, and the pickup slack
        for (const id of [2, 9]) expect(ranges(windows, `inserter:${id}`)).toEqual([[4, 13]]);
        // the cable and circuits into the advanced circuit machines, in the same place a tick later
        for (const id of [11, 12, 21, 22]) expect(ranges(windows, `inserter:${id}`)).toEqual([[5, 14]]);
        for (const id of [1, 10]) expect(ranges(windows, `inserter:${id}`)).toEqual([[5, 21]]);
        // one tick for each hand out
        for (const id of [16, 17, 23, 24]) expect(ranges(windows, `inserter:${id}`)).toEqual([[0, 0]]);
    });
    it("guards per taker only the takers the extra start leaves busy: the circuits, the iron and the cable into the circuit machines", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const made = (guard: { surplus_guard: boolean; per_taker_guard?: boolean }) => roundRobinPollingPlan(simulation_context.entity_registry,
            swing_counts, recipe_lcm, duration.ticks, true, { ...guard, feeder_offset: 1, share_windows: false });
        const length = (windows: Map<string, { start_inclusive: number; end_inclusive: number }[]>, id: number) =>
            windows.get(`inserter:${id}`)!.reduce((sum, range) => sum + range.end_inclusive - range.start_inclusive + 1, 0);
        const per_taker = made({ surplus_guard: false, per_taker_guard: true });
        // three hands and a start (26 ticks) and the offset reach the 24-tick cycle; three hands alone are 18 ticks, so each gets a window
        expect(per_taker.busy).toEqual([]);
        for (const id of [3, 4, 5, 6, 7, 8, 13, 14, 15, 18, 19, 20]) expect(length(per_taker.windows, id)).toBe(18);
        // the advanced circuits and the cable into the advanced circuit machines would keep a surplus hand but are not busy: they keep
        // their start more (10 ticks), where the guard for every taker cuts them to one hand (2 ticks)
        const every_taker = made({ surplus_guard: true });
        for (const id of [2, 9, 11, 22]) {
            expect(length(per_taker.windows, id)).toBe(10);
            expect(length(every_taker.windows, id)).toBe(2);
        }
        // the circuits into the advanced circuit machines have room for a hand over theirs only (2): no surplus, no guard either way
        for (const id of [12, 21]) {
            expect(length(per_taker.windows, id)).toBe(10);
            expect(length(every_taker.windows, id)).toBe(10);
        }
        // the plastic comes from a belt: never guarded (one hand of 11, a start more and the pickup slack)
        for (const id of [1, 10]) expect(length(per_taker.windows, id)).toBe(length(every_taker.windows, id));
    });

    it("leaves the takers into the machines it is told enabled as before: the remake for the processing unit machines (2, 3)", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const made = roundRobinPollingPlan(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
            { surplus_guard: false, per_taker_guard: true, unguarded_sinks: new Set(["machine:2", "machine:3"]), feeder_offset: 16, share_windows: false });
        // the circuits into the processing unit machines keep their extra start, which leaves them busy all the time
        expect(made.busy).toEqual(["inserter:3", "inserter:4", "inserter:7", "inserter:8"]);
        // the iron and the cable into the circuit machines are guarded still: three hands of 8 in 18 ticks
        for (const id of [5, 6, 13, 14, 15, 18, 19, 20]) {
            expect(made.windows.get(`inserter:${id}`)!.reduce((sum, range) => sum + range.end_inclusive - range.start_inclusive + 1, 0)).toBe(18);
        }
    });

    it("names the guarded takers with the tick their window opens, and splits each into a tick at each of its three picks", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const made = roundRobinPollingPlan(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
            { surplus_guard: false, per_taker_guard: true, unguarded_sinks: new Set(["machine:2", "machine:3"]), feeder_offset: 16, share_windows: false });
        // the iron and the cable into the circuit machines: three hands of 8 ticks; the circuits into the processing unit machines are not
        // guarded (busy), nor the takers that keep their start more
        expect(made.guarded.map(it => it.inserter_id).sort()).toEqual([5, 6, 13, 14, 15, 18, 19, 20].map(id => `inserter:${id}`).sort());
        for (const taker of made.guarded) {
            expect(taker).toMatchObject({ hands: 3, cycle_ticks: 8 });
            expect(made.windows.get(taker.inserter_id)!.some(range => range.start_inclusive === taker.start)).toBe(true);
        }
        const split = perHandWindows(made.windows, made.guarded, duration.ticks);
        for (const taker of made.guarded) {
            expect(ranges(split, taker.inserter_id)).toEqual([0, 1, 2].map(j => (taker.start + j * 8) % 24).sort((a, b) => a - b).map(tick => [tick, tick]));
        }
        // every other window as it was
        for (const [id, window] of made.windows) if (!made.guarded.some(it => it.inserter_id === id)) expect(split.get(id)).toBe(window);
        // a taker of one hand has nothing to split: its window stays
        const one_hand = { ...made.guarded[0], hands: 1 };
        expect(perHandWindows(made.windows, [one_hand], duration.ticks).get(one_hand.inserter_id)).toBe(made.windows.get(one_hand.inserter_id));
    });

    it("names no guarded taker where the windows are shared, or where the guard is one switch for every taker and leaves none busy", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const made = (options: { surplus_guard: boolean; per_taker_guard?: boolean; share_windows: boolean }) => roundRobinPollingPlan(
            simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true, { ...options, feeder_offset: 1 });
        expect(made({ surplus_guard: false, share_windows: false }).guarded).toEqual([]);
        // the guard for every taker: the ones it gives a window of their hands alone are named; shared windows run longer than their hands
        expect(made({ surplus_guard: true, share_windows: false }).guarded.length).toBeGreaterThan(0);
        const shared = made({ surplus_guard: false, per_taker_guard: true, share_windows: true });
        for (const taker of shared.guarded) {
            expect(shared.windows.get(taker.inserter_id)!.reduce((sum, range) => sum + range.end_inclusive - range.start_inclusive + 1, 0)).toBe(2 * 8 + 2);
        }
    });

    it("gives the inserters that open on the same tick one window, the longest of them, where windows are shared", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false, lcm: 1, terminal_swing_count: 1 } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        const windows = roundRobinPollingWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
            { surplus_guard: false, feeder_offset: 1, share_windows: true });
        // the cable and circuits (10 ticks) and the plastic and iron (17) open together, and are one window of 17
        for (const id of [1, 10, 11, 12, 21, 22]) expect(ranges(windows, `inserter:${id}`)).toEqual([[5, 21]]);
        // the advanced circuits open a tick before them and stay as they were; the hands out are not takers
        for (const id of [2, 9]) expect(ranges(windows, `inserter:${id}`)).toEqual([[4, 13]]);
        for (const id of [16, 17, 23, 24]) expect(ranges(windows, `inserter:${id}`)).toEqual([[0, 0]]);
        // those left enabled all the time stay so
        for (const id of [3, 4, 5, 6, 7, 8, 13, 14, 15, 18, 19, 20]) expect(windows.has(`inserter:${id}`)).toBe(false);
    });
});

// One supercapacitor plant (3) fills two electromagnetic science plants (1, 2) through inserters 7 and 6, each a hand of 16 a
// period: the original electromagnetic science sample (ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED) as a chain of its own, without the recycler (4,
// with inserters 9 and 10, its belts 2 and 3) and the buffer chests (3 and 4, with inserters 1 and 2): the science goes straight into the
// infinity chests, the plant's circuits come from a chest of their own (5, inserter 13), and every inserter is clocked. The period is
// 40 ticks.
describe("takers of one machine that it cannot serve together", () => {
    let config: Config;
    beforeAll(async () => {
        const sample = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED);
        config = {
            ...sample,
            overrides: { ...sample.overrides, terminal_swing_count: 1, lcm: 1 },
            machines: sample.machines.filter(it => it.id !== 4),
            chests: [...sample.chests!.filter(it => ![3, 4].includes(it.id)),
                { type: "infinity-chest", id: 5, item_filter: [{ item_name: "electronic-circuit", request_count: 100 }] }],
            belts: sample.belts!.filter(it => ![2, 3].includes(it.id)),
            inserters: [...sample.inserters.filter(it => ![1, 2, 9, 10].includes(it.id!)).map(it =>
                it.id === 4 ? { ...it, sink: { type: "chest", id: 1 } } : it.id === 3 ? { ...it, sink: { type: "chest", id: 2 } } : it),
                { id: 13, source: { type: "chest", id: 5 }, sink: { type: "machine", id: 3 }, prototype: "stack-inserter", quality: "legendary", stack_size: 16 }],
        } as Config;
    });

    it("gives them turns half a period apart, in the order of the machines they fill", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        expect(duration.ticks).toBe(40);
        const plant = simulation_context.entity_registry.getEntityByIdOrThrow(EntityId.forMachine(3)) as Machine;
        // at a window of 10 ticks the plant holds what it made in the 30 before (8.77, under its block of 9) and makes 2.92 more:
        // 11.69, against two hands of 16
        expect(outputAtWindow(plant, "supercapacitor", 30, 10)).toBeCloseTo(11.6875, 3);
        for (const feeder_offset of [16, 1]) {
            const windows = roundRobinPollingWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
                { surplus_guard: false, feeder_offset, share_windows: false });
            // both fill a science plant whose output (4, 3) swings at 0, so the chain would open them in the same ticks; the one into machine 1 keeps
            // its place and the one into machine 2 opens 20 ticks after it
            expect(ranges(windows, "inserter:7")).toEqual([[19, 28]]);
            expect(ranges(windows, "inserter:6")).toEqual([[39, 39], [0, 8]]);
            // the hand out of each science plant keeps its place in its plant's turn: machine 2's (3) swings 20 ticks after machine 1's (4)
            expect(ranges(windows, "inserter:4")).toEqual([[0, 0]]);
            expect(ranges(windows, "inserter:3")).toEqual([[20, 20]]);
            for (const id of [5, 8]) expect(ranges(windows, `inserter:${id}`)).toEqual([[2, 18]]);
        }
    });

    it("takes turns by the turn rule: a share of the slot apart where the plant cannot give both hands in one window", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        const registry = plan.run.simulation_context.entity_registry;
        const plant = registry.getEntityByIdOrThrow(EntityId.forMachine(3)) as Machine;
        const [into_1, into_2] = [7, 6].map(id => registry.getEntityByIdOrThrow(EntityId.forInserter(id)) as Inserter);
        // 11.69 supercapacitors at a window of 10 ticks a slot of 40, against two hands of 16: turns 20 ticks apart
        expect(turnOffsets(plant, "supercapacitor", [[into_1], [into_2]], 40, 10)).toEqual([0, 20]);
        // one machine filled by both is one turn: nothing to take turns with
        expect(turnOffsets(plant, "supercapacitor", [[into_1, into_2]], 40, 10)).toBeNull();
        // turns 20 ticks apart would meet windows of 21 ticks
        expect(turnOffsets(plant, "supercapacitor", [[into_1], [into_2]], 40, 21)).toBeNull();
    });

    it("gives each science plant room when its turn opens: what it made since its hand out started is under its block less one pack", () => {
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        const registry = plan.run.simulation_context.entity_registry;
        const science = registry.getEntityByIdOrThrow(EntityId.forMachine(2)) as Machine;
        // 0.41 packs a tick (89.625 / 600 x 2.75); it takes no ingredients from 12 packs, so a turn needs it under 11
        expect(science.output.outputBlock.ingredients_blocked_at).toBe(12);
        // machine 2's turn opens at 39, its hand out (3) started at 20: 19 ticks, 7.80 packs
        expect(heldAtTurn(science, 39, [20], 40)).toBeCloseTo(7.8048, 3);
        expect(roomAtTurn(science, heldAtTurn(science, 39, [20], 40))).toBe(true);
        // left at 0 with machine 1's, the hand out would have started 39 ticks before the turn: 16.02 packs, the plant at its block
        expect(heldAtTurn(science, 39, [0], 40)).toBeCloseTo(16.0205, 3);
        expect(roomAtTurn(science, heldAtTurn(science, 39, [0], 40))).toBe(false);
        // the margin of one pack: 11 is not under the block less one pack, 10.99 is
        expect(roomAtTurn(science, 11)).toBe(false);
        expect(roomAtTurn(science, 10.99)).toBe(true);
    });

    it("does not offer a way whose turns open while their plants hold their block: at 300% productivity 19 ticks make 11.35 packs", () => {
        const faster = { ...config, machines: config.machines.map(it => it.recipe === "electromagnetic-science-pack" ? { ...it, productivity: 300 } : it) };
        const plan = unclockedRun({ ...faster, overrides: { ...faster.overrides, derive_clock_windows: false } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        for (const feeder_offset of [16, 1]) {
            const made = () => roundRobinPollingWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks, true,
                { surplus_guard: false, feeder_offset, share_windows: false });
            expect(made).toThrow(TurnWithoutRoom);
            expect(made).toThrow("machine:2 would still hold about 11.4 electromagnetic-science-pack when its turn to take supercapacitor "
                + "from machine:3 begins, and it takes no ingredients from 12 electromagnetic-science-pack: that turn would bring it nothing");
        }
    });
});

// The accumulator build (ACCUMULATOR_640): the iron foundry (3) fills the accumulator plants (1, 2) through inserters 3 and 4 and the
// battery plants (4, 5) through inserters 5 and 7, a hand of 16 each. In its batched swings clock of 54 ticks each pair has a window
// of 18 ticks a period.
describe("the takers of a machine into machines of other recipes", () => {
    it("are reported beside the turn decision, which they do not change", async () => {
        const config = await loadConfigFromFile(ConfigPaths.ACCUMULATOR_640);
        const plan = unclockedRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        const registry = plan.run.simulation_context.entity_registry;
        const foundry = registry.getEntityByIdOrThrow(EntityId.forMachine(3)) as Machine;
        const [into_1, into_2] = [3, 4].map(id => registry.getEntityByIdOrThrow(EntityId.forInserter(id)) as Inserter);
        const lines: string[] = [];
        // the battery plants' two hands of 16 every 27 ticks: 1.19 plates a tick
        const offsets = turnOffsets(foundry, "iron-plate", [[into_1], [into_2]], 54, 18, { per_tick: 32 / 27, log: line => lines.push(line) });
        // 93.52 plates against two hands of 16: together, as without the report
        expect(offsets).toBeNull();
        expect(turnOffsets(foundry, "iron-plate", [[into_1], [into_2]], 54, 18)).toBeNull();
        expect(lines).toEqual(["Turns at machine:3 (iron-plate, 2 turns, a window of 18 ticks every 54): 32 against 93.52 it can give, together; "
            + "29.52 with the 1.19 a tick the takers into other recipes take, in turns (the decision would flip; reported only)"]);
    });
});

