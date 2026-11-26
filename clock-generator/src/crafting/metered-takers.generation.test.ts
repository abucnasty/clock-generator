import { createHash } from "crypto";
import path from "path";
import { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import { InserterPhase } from "../simulation/status-codes";
import { World } from "../simulation/world";
import { runTick } from "../simulation/tick-phases";
import { coldControlledTrialBuild } from "./plan/unclocked-run";
import { buildAsBuiltConfig } from "./trial";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateClockAlternatives, planClockAlternatives, type ClockAlternativesResult, type ClockAlternativeRun } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { ConfigSchema, type Config } from "../config/schema";
import { runClockAlternativeTask } from "./alternatives";
import { meteredTakersClock } from "./candidates/metered-takers";
import type { MakerLogEvent } from "./maker-log";
import { quiet } from "./generate-blueprint-test-helpers";
import { combineClockAlternativeRuns, coordinatedSourcesInputOf, runCoordinatedSourcesTask, type BlueprintGenerationResult } from "./generate-blueprint";
import { CircuitReplay } from "./circuit-replay";

/** The six science outputs, which #877's output windows clock */
const SCIENCE_OUTPUTS = [1, 4, 11, 13, 18, 19];

/** Replay both exported circuits from the wires of their blueprints and compare what each enable combinator puts out, tick
 * by tick over one window cycle once the counter runs, with the command the clock was planned to give its inserters. The
 * combinator that holds the clock on the filter's output answers the count two ticks late, as the planned command does. */
function checkScienceExport(config: Config, clock: BlueprintGenerationResult, ids: readonly number[]) {
    const period = clock.simulation_duration.ticks;
    const windows = new Map(Object.entries(clock.clock_windows).map(([id, ranges]) =>
        [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const built = buildAsBuiltConfig(config, windows, period);
    // This fixture has a whole counter and offers both the floor and the modulo export.
    expect(clock.subtick).toBeUndefined();
    expect(clock.modulo_blueprint).toBeDefined();
    expect(clock.modulo_schedule).toBeDefined();
    const forms = [{ name: "floor", blueprint: clock.blueprint, schedule: clock.schedule },
        { name: "modulo", blueprint: clock.modulo_blueprint!, schedule: clock.modulo_schedule! }];
    for (const { name, blueprint, schedule } of forms) {
        expect(schedule.counted_ticks, name).toBe(period);
        const replay = new CircuitReplay(blueprint);
        const seen = new Map(schedule.inserter_combinators.map(group => [group.entity_number, [] as boolean[]]));
        for (let step = 0; step < 3 * period; step++) {
            replay.step();
            // the first two window cycles let the counter and the modulo settle
            if (step < 2 * period) continue;
            for (const [entity_number, ticks] of seen) ticks.push([...replay.output(entity_number).values()].some(count => count > 0));
        }
        const clocked = new Set<number>();
        // each arm of `ids` has its own enable combinator and a window that is neither always on nor always off
        for (const id of ids) {
            const groups = schedule.inserter_combinators.filter(group => group.inserter_ids.includes(id));
            expect(groups, `${name} export of inserter ${id}`).toHaveLength(1);
            expect(blueprint.entities.find(entity => entity.entity_number === groups[0].entity_number)?.tags?.clock_generator.inserters).toContain(id);
            clocked.add(id);
        }
        for (const group of schedule.inserter_combinators) {
            for (const id of group.inserter_ids) {
                const control = built.inserters.find(arm => arm.id === id)?.overrides?.enable_control;
                if (control?.mode !== "CLOCKED") {
                    expect(clocked.has(id), `inserter ${id} is clocked`).toBe(false);
                    continue;
                }
                const expected = Array.from({ length: period }, (_, tick) => control.ranges.some(range => range.start <= tick && tick <= range.end));
                const replayed = seen.get(group.entity_number)!;
                expect(replayed, `${name} export of inserter ${id}`).toEqual(expected);
                if (clocked.has(id)) {
                    expect(replayed).toContain(true);
                    expect(replayed).toContain(false);
                }
            }
        }
    }
}

// A utility science build at 320 a second with 3 copies: two foundries each hand low density structure to three of the six
// assemblers, and no clock made before Round-Robin Polling with metered takers is stable. The record job UTILITY_SCIENCE_320_METERED_TAKERS is
// the same build with the directions of its shared belts stated: the record pins the verdicts, rates and window cycles of its clocks and the
// selected clock, and its per-job checks (tests/game/builds/job-checks/samples.ts) the metered clock's maker, strategy and output swings. The
// tests here are of the mechanism, on the fixture.
describe("Round-Robin Polling with metered takers on a build whose foundries each feed three assemblers", () => {
    let configuration: Config;
    let generated: ClockAlternativesResult;
    beforeAll(async () => {
        configuration = await loadConfigFromFile(path.join(__dirname, "fixtures", "utility-science-320-metered-takers.json"));
        generated = generateClockAlternatives(configuration, { logger: quiet });
    });
    const alternative = (id: string) => generated.alternatives.find(it => it.id === id);

    it("clocks only the takers of the foundries, with the full pickup and the following swing entry both enabled, in turn; every other inserter is always enabled", () => {
        const metered = alternative("round_robin_polling_metered_takers")!;
        const enable_windows = metered.result.clock_windows;
        const source = (id: string) => configuration.inserters.find(inserter => `inserter:${inserter.id}` === id)!.source;
        const takers = Object.keys(enable_windows).filter(id => id.startsWith("inserter:") && !(enable_windows[id].length === 1 && enable_windows[id][0].start === 0 && enable_windows[id][0].end === 323));
        expect(takers.sort()).toEqual(["inserter:14", "inserter:16", "inserter:17", "inserter:5", "inserter:6", "inserter:9"]);
        for (const id of takers) {
            expect(source(id).type, id).toBe("machine");
            expect(enable_windows[id].map(range => range.end - range.start + 1), id).toEqual([2, 2, 2]);
            expect(enable_windows[id].map(range => range.start - enable_windows[id][0].start), id).toEqual([0, 108, 216]);
        }
        const first = (id: string) => enable_windows[id][0].start;
        // foundry 3's takers 36 apart, foundry 7's the same, 18 after foundry 3's
        expect(["inserter:5", "inserter:6", "inserter:9"].map(first)).toEqual([0, 36, 72]);
        expect(["inserter:14", "inserter:16", "inserter:17"].map(first)).toEqual([18, 54, 90]);
        const others = Object.keys(enable_windows).filter(id => id.startsWith("inserter:") && !takers.includes(id));
        expect(others).toHaveLength(15);
        for (const id of others) expect(enable_windows[id], id).toEqual([{ start: 0, end: 323 }]);
    });

    // Use the same six turn placements together from the cold start. Only the width differs.
    function coldTurns(width: number) {
        const { result } = alternative("round_robin_polling_metered_takers")!;
        const enable_windows = new Map(Object.entries(result.clock_windows).map(([id, ranges]) => [id,
            ranges.map(range => OpenRange.from(range.start, ranges.length === 3 ? range.start + width - 1 : range.end))]));
        const on = buildAsBuiltConfig(configuration, enable_windows, 324);
        const context = coldControlledTrialBuild(on, result.output_cycle_plan, result.used_lcm, {}, quiet);
        const world = World.of(context);
        let tick = 0;
        return {
            advance(to: number) {
                for (; tick < to; tick++) runTick(world, null);
            },
            arm: (id: number) => world.inserters.find(it => it.entity_id.number === id)!,
            stock: (id: number) => context.state_registry.getStateByEntityIdOrThrow(EntityId.forMachine(id))
                .inventoryState.getQuantity("low-density-structure"),
        };
    }

    it.each([8, 9])("tests the first return against the inclusive end of a %i-tick enable window", width => {
        const turn = coldTurns(width);
        const arm = turn.arm(6);
        turn.advance(38);
        expect(arm.inserter_state.held_item?.quantity).toBe(16);
        turn.advance(42);
        expect([arm.inserter_state.items_dropped, turn.stock(2)]).toEqual([16, 13]); // one craft used three
        turn.advance(46);
        expect(arm.inserter_state.items_picked_up).toBe(width === 8 ? 16 : 25);
    });

    it.each([1, 2])("keeps the cold partial until the next opening at width %i", width => {
        const turn = coldTurns(width);
        const arm = turn.arm(14);
        turn.advance(20);
        expect(arm.inserter_state.held_item?.quantity).toBe(4);
        turn.advance(127);
        expect([arm.inserter_state.items_picked_up, arm.inserter_state.items_dropped]).toEqual([4, 0]);
        turn.advance(128);
        expect(arm.inserter_state.held_item?.quantity).toBe(16);
        turn.advance(129);
        expect([arm.hand.phase, arm.control.enabledIn(0)]).toEqual([InserterPhase.SWING, width === 2]);
        turn.advance(136);
        expect([arm.inserter_state.items_picked_up, arm.inserter_state.items_dropped]).toEqual([16, 16]);
    });

    it("uses the compatible requested count and LCM even with a different primary count", () => {
        const context = { swings: 6, primary_stable: false, window_cycle_ticks: 324,
            secondary_planning: { source: "primitive-primary" as const, terminal_swing_count: 1 } };
        const result = runClockAlternativeTask({ ...configuration, overrides: { ...configuration.overrides, terminal_swing_count: 6, lcm: 1 } },
            context, "metered-takers", { logger: quiet });
        const clock = result?.alternatives[0]?.result;
        expect([clock?.used_terminal_swing_count, clock?.used_lcm]).toEqual([6, 1]);
    });

    it("recommends a clock with a proper enable window on each science output", () => {
        const clock = generated.alternatives[generated.selected_index].result;
        const period = clock.simulation_duration.ticks;
        for (const id of [1, 4, 11, 13, 18, 19]) {
            const ranges = clock.clock_windows[`inserter:${id}`];
            const width = Array.from({ length: period }, (_, tick) =>
                ranges?.some(range => range.start <= tick && tick <= range.end)).filter(Boolean).length;
            expect(width, `inserter ${id}`).toBeGreaterThan(0);
            expect(width, `inserter ${id}`).toBeLessThan(period);
        }
        checkScienceExport(configuration, clock, SCIENCE_OUTPUTS);
    });

    // The worker's runs before the composition, made once for the tests below
    let worker: { runs: (ClockAlternativeRun | null)[]; input: ReturnType<typeof coordinatedSourcesInputOf> } | undefined;
    function workerRuns(): NonNullable<typeof worker> {
        if (worker === undefined) {
            const plan = planClockAlternatives(configuration, { logger: quiet });
            const runs = [plan.primary, ...plan.tasks.filter(task => !task.coordinated_sources && !task.explored)
                .map(task => runClockAlternativeTask(configuration, plan.context, task.id, { logger: quiet }))];
            const before = combineClockAlternativeRuns(runs, alternative => alternative.ranking);
            const ids = before.order.map(index => before.alternatives[index].id);
            worker = { runs, input: coordinatedSourcesInputOf(runs, ids) };
        }
        return worker;
    }
    function compose() {
        const { runs, input } = workerRuns();
        const composed = runCoordinatedSourcesTask(configuration, structuredClone(input), { logger: quiet });
        const final = combineClockAlternativeRuns([...runs, composed], alternative => alternative.ranking);
        return final.alternatives[final.selected_index];
    }

    // The copy step after the stagger, silenced (its candidates emptied) where a case tests the refusals of an earlier step. The
    // generation project loads the CommonJS build: replace the copy step's proposal where the composition reads it.
    function composeWithoutCopies() {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const owner: typeof import("./candidates/region-copies") = require("../../dist/crafting/candidates/region-copies");
        const propose = owner.regionCopies;
        const spy = vi.spyOn(owner, "regionCopies").mockImplementation((...args) => {
            const proposed = propose(...args);
            return proposed && { orbits: proposed.orbits.map(orbit => ({ ...orbit, proposals: { ...orbit.proposals, candidates: [], unmade: [] } })) };
        });
        try {
            return compose();
        } finally {
            spy.mockRestore();
        }
    }

    it("carries the metered turns through the worker tasks to the selected clock and its two exports", () => {
        expect(workerRuns().input.parts.some(part => part.metered_takers?.length === 6)).toBe(true);
        const selected = compose();
        expect([selected.id, selected.verdict, selected.assessment.items_per_second.toFixed(2)]).toEqual(["coordinated_sources", "stable", "320.00"]);
        expect(selected.result.clock_windows).toEqual(generated.alternatives[generated.selected_index].result.clock_windows);
        checkScienceExport(configuration, selected.result, SCIENCE_OUTPUTS);
    });

    it("keeps the selected and exported controls when the whole clock refuses a proposed output window", () => {
        // The generation project loads the CommonJS build: replace the maker's proposal where the composition reads it.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const owner: typeof import("./candidates/metered-output-windows") = require("../../dist/crafting/candidates/metered-output-windows");
        const propose = owner.meteredOutputWindows;
        // the three science outputs whose clock covers the whole window cycle without the proposal; the other three have windows already
        const outputs = [1, 4, 13].map(id => `inserter:${id}`);
        // Alter only what the maker proposes: nothing for the reference, and for the refusal one tick of each turn, which no output can be served in.
        // The stagger step after it is silenced (its proposals emptied) on both runs: it tests its own refusals below.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const stagger: typeof import("./candidates/staggered-input-windows") = require("../../dist/crafting/candidates/staggered-input-windows");
        const staggers = stagger.staggeredInputWindows;
        const composeWith = (alter: (proposed: ReturnType<typeof propose>) => ReturnType<typeof propose>) => {
            const proposals: string[][] = [];
            const spy = vi.spyOn(owner, "meteredOutputWindows").mockImplementation((...args) => {
                const proposed = propose(...args);
                proposals.push(Object.keys(proposed.changes));
                return alter(proposed);
            });
            const silenced = vi.spyOn(stagger, "staggeredInputWindows").mockImplementation((...args) => {
                const proposed = staggers(...args);
                return proposed && { ...proposed, groups: proposed.groups.map(group => ({ ...group, proposals: [] })) };
            });
            try {
                return { selected: composeWithoutCopies(), proposals };
            } finally {
                spy.mockRestore();
                silenced.mockRestore();
            }
        };
        const reference = composeWith(proposed => ({ ...proposed, changes: {} }));
        const refused = composeWith(proposed => ({ ...proposed, changes: Object.fromEntries(Object.entries(proposed.changes)
            .map(([id, ranges]) => [id, ranges.map(range => ({ start: range.start, end: range.start }))])) }));
        // the real composition made its proposal for all three outputs on both runs, and the refusal tried the narrowed windows
        for (const { proposals } of [reference, refused]) expect(proposals.some(ids => outputs.every(id => ids.includes(id)))).toBe(true);

        const exported = (clock: BlueprintGenerationResult) => createHash("sha256")
            .update(JSON.stringify([clock.clock_windows, clock.blueprint, clock.schedule, clock.modulo_blueprint, clock.modulo_schedule])).digest("hex");
        const [kept, unchanged] = [refused.selected, reference.selected];
        expect([kept.id, kept.verdict, kept.assessment.items_per_second.toFixed(2)]).toEqual([unchanged.id, unchanged.verdict, "320.00"]);
        expect(kept.result.clock_windows).toEqual(unchanged.result.clock_windows);
        expect(exported(kept.result)).toBe(exported(unchanged.result));
        for (const id of outputs) {
            const ticks = new Set(kept.result.clock_windows[id].flatMap(range => Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i)));
            expect(ticks.size, id).toBe(kept.result.simulation_duration.ticks);
        }
        const decisions = kept.result.metered_output_windows!;
        expect(Object.values(decisions).filter(decision => decision.kind === "bounded")).toEqual([]);
        for (const id of outputs) expect(decisions[id], id).toEqual({ kind: "retained", reason: "joint_check_failed" });
        // the unchanged controls are the all-cycle ones, not the bounded windows the unaltered maker proposes and the clock accepts
        expect(unchanged.result.clock_windows).not.toEqual(generated.alternatives[generated.selected_index].result.clock_windows);
    });

    // The belt-fed inputs of the assemblers the second foundry's takers feed: PU and FRF from turbo belt 2
    const BELT_INPUTS = [12, 20, 21];
    // The modeled wake-ups of the selected clock on master after #877 (1,620.45 a minute a copy), and the most the screen of the
    // padded one-window form held at on #877's windows (964.77)
    const BEFORE_WAKE_UPS = 1620.45;
    const SCREENED_WAKE_UPS = 964.77;
    const SERVICE_TICKS = 108;

    it("keeps the belt-fed inputs of metered assemblers in one window each service interval", () => {
        const selected = generated.alternatives[generated.selected_index];
        const clock = selected.result;
        expect([selected.id, selected.verdict, selected.assessment.items_per_second.toFixed(2), clock.simulation_duration.ticks])
            .toEqual(["coordinated_sources", "stable", "320.00", 324]);
        for (const id of BELT_INPUTS) {
            const ranges = clock.clock_windows[`inserter:${id}`];
            const on = Array.from({ length: clock.simulation_duration.ticks }, (_, tick) => ranges.some(range => range.start <= tick && tick <= range.end));
            for (let from = 0; from < on.length; from += SERVICE_TICKS) {
                const interval = on.slice(from, from + SERVICE_TICKS);
                // one circular window: the ticks it is on open once, the wrap of the interval counted
                const openings = interval.filter((enabled, tick) => enabled && !interval[(tick - 1 + SERVICE_TICKS) % SERVICE_TICKS]).length;
                expect(openings, `inserter ${id} from ${from}`).toBe(1);
                expect(interval.filter(Boolean).length, `inserter ${id} from ${from}`).toBeLessThan(SERVICE_TICKS);
            }
        }
        const decisions = (clock as { metered_input_windows?: Record<string, { kind: string }> }).metered_input_windows;
        for (const id of BELT_INPUTS) expect(decisions?.[`inserter:${id}`]?.kind, `inserter ${id}`).toBe("bounded");
        const wake_ups = clock.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
        expect(wake_ups).toBeDefined();
        expect(Number(wake_ups!.toFixed(2))).toBeLessThan(BEFORE_WAKE_UPS);
        expect(Number(wake_ups!.toFixed(2))).toBeLessThanOrEqual(SCREENED_WAKE_UPS);
        checkScienceExport(configuration, clock, [...SCIENCE_OUTPUTS, ...BELT_INPUTS]);
    });

    // The belt-fed inputs of the assemblers the first foundry's takers feed (PU and FRF from belt 5), the outputs of those
    // assemblers, and for each arm the metered taker of its assembler; output 11 and its taker are of the second foundry
    const SHARED_INPUTS = [2, 3, 10];
    const STAGGERED_OUTPUTS = [1, 4, 13];
    const TAKER_OF: Record<number, number> = { 2: 5, 3: 6, 10: 9, 1: 5, 4: 6, 13: 9, 11: 14 };
    // the wake-ups of the clock with the stagger and the output windows, as its screen gave them before the step was built
    const STAGGERED_WAKE_UPS = 565.39;

    /** The ticks of one service interval an arm is enabled at, after checking each interval is the same and opens once */
    function intervalOf(clock: BlueprintGenerationResult, id: number): boolean[] {
        const ranges = clock.clock_windows[`inserter:${id}`];
        const on = Array.from({ length: clock.simulation_duration.ticks }, (_, tick) => ranges.some(range => range.start <= tick && tick <= range.end));
        const first = on.slice(0, SERVICE_TICKS);
        for (let from = 0; from < on.length; from += SERVICE_TICKS) {
            const interval = on.slice(from, from + SERVICE_TICKS);
            expect(interval, `inserter ${id} from ${from}`).toEqual(first);
        }
        const openings = first.filter((enabled, tick) => enabled && !first[(tick - 1 + SERVICE_TICKS) % SERVICE_TICKS]).length;
        expect(openings, `inserter ${id}`).toBe(1);
        expect(first.filter(Boolean).length, `inserter ${id}`).toBeLessThan(SERVICE_TICKS);
        return first;
    }
    const turnOf = (clock: BlueprintGenerationResult, id: number) => clock.clock_windows[`inserter:${TAKER_OF[id]}`][0].start % SERVICE_TICKS;
    /** The interval moved back by `ticks`: tick t of the result is tick t + ticks of the interval */
    const movedBack = (interval: boolean[], ticks: number) => interval.map((_, tick) => interval[(tick + ticks) % SERVICE_TICKS]);

    it("staggers a shared belt-input window to each assembler's turn and windows its outputs", () => {
        const selected = generated.alternatives[generated.selected_index];
        const clock = selected.result;
        expect([selected.id, selected.verdict, selected.assessment.items_per_second.toFixed(2), clock.simulation_duration.ticks])
            .toEqual(["coordinated_sources", "stable", "320.00", 324]);
        // the inputs: one window each service interval, not all at the same ticks, the same once each is moved back by its taker's turn
        const inputs = SHARED_INPUTS.map(id => intervalOf(clock, id));
        expect(inputs.every(interval => JSON.stringify(interval) === JSON.stringify(inputs[0]))).toBe(false);
        const relative = SHARED_INPUTS.map((id, i) => movedBack(inputs[i], turnOf(clock, id)));
        for (const [i, id] of SHARED_INPUTS.entries()) expect(relative[i], `inserter ${id}`).toEqual(relative[0]);
        // the outputs: one window each service interval, output 11's moved by the difference of their takers' turns
        const sibling = movedBack(intervalOf(clock, 11), turnOf(clock, 11));
        for (const id of STAGGERED_OUTPUTS) expect(movedBack(intervalOf(clock, id), turnOf(clock, id)), `inserter ${id}`).toEqual(sibling);
        // which field governs: the output step's decision stays as it made it; the new step's windows are the clock's
        const fields = clock as { metered_output_windows?: Record<string, { kind: string }>;
            staggered_input_windows?: Record<string, { kind: string; role?: string; reference?: string }> };
        for (const id of STAGGERED_OUTPUTS) {
            expect(fields.metered_output_windows?.[`inserter:${id}`]?.kind, `inserter ${id}`).toBe("bounded");
            expect(fields.staggered_input_windows?.[`inserter:${id}`], `inserter ${id}`).toMatchObject({ kind: "staggered", role: "output" });
        }
        for (const id of SHARED_INPUTS) {
            expect(fields.staggered_input_windows?.[`inserter:${id}`], `inserter ${id}`)
                .toMatchObject({ kind: "staggered", role: "input", reference: "inserter:2" });
        }
        const wake_ups = clock.stability_check.as_built?.wake_ups?.wake_ups_per_minute;
        expect(wake_ups).toBeDefined();
        expect(Number(wake_ups!.toFixed(2))).toBeLessThan(SCREENED_WAKE_UPS);
        expect(Number(wake_ups!.toFixed(2))).toBeLessThanOrEqual(STAGGERED_WAKE_UPS);
        checkScienceExport(configuration, clock, [...SCIENCE_OUTPUTS, ...SHARED_INPUTS, ...BELT_INPUTS]);
    });

    // The two halves of the build about the cryogenic plant: assemblers 1, 2, 5 with foundry 3, and 6, 8, 9 with foundry 7. Each arm of the
    // first half and its turn partner in the second
    const REGION_ARMS: [number, number][] = [[1, 11], [2, 12], [3, 20], [4, 18], [5, 14], [6, 16], [9, 17], [10, 21], [13, 19]];

    it("gives copied regions one clock at the same turns only where it recovers no slower", () => {
        // On this fixture the second half's windows, moved to the first half's turns and copied onto it, hold every check at fewer
        // wake-ups and deciders, but recover in 16 window cycles on one copy and 20 on the copies, against 19 and 19: the copy step
        // judges recovery by the worse of the two readings and keeps the clock as it is
        const selected = generated.alternatives[generated.selected_index];
        const clock = selected.result;
        expect([selected.id, selected.verdict, selected.assessment.items_per_second.toFixed(2), clock.simulation_duration.ticks])
            .toEqual(["coordinated_sources", "stable", "320.00", 324]);
        expect(Number(clock.stability_check.as_built?.wake_ups?.wake_ups_per_minute?.toFixed(2))).toBe(STAGGERED_WAKE_UPS);
        expect(selected.deciders).toBe(clock.schedule.inserter_combinators.length);
        expect(selected.deciders).toBe(20);
        const decisions = (clock as { region_copies?: Record<string, unknown> }).region_copies;
        for (const [a, b] of REGION_ARMS) {
            for (const id of [a, b]) expect(decisions?.[`inserter:${id}`], `inserter ${id}`).toEqual({ kind: "retained", reason: "recovery_worse" });
        }
        for (const id of [7, 8, 15]) expect(decisions?.[`inserter:${id}`], `inserter ${id}`).toEqual({ kind: "retained", reason: "no_orbit" });
    });
});

// ADVANCED_CIRCUIT_240, a job of the record: a machine there hands an ingredient to two or more of the machines that make the
// target, and the clock made before the fallbacks is stable, so the metered takers clock is planned and never made
describe("Round-Robin Polling with metered takers where a clock made before it is stable", () => {
    it("is planned as a fallback and not made", async () => {
        const configuration = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240);
        const fallbacks = planClockAlternatives(configuration, { logger: quiet }).tasks.filter(task => task.fallback === true).map(task => task.id);
        expect(fallbacks).toContain("metered-takers");
        const events: MakerLogEvent[] = [];
        const generated = generateClockAlternatives(configuration, { logger: quiet, maker_log: event => { events.push(event); } });
        expect(generated.alternatives[generated.selected_index].verdict).toBe("stable");
        expect(generated.alternatives.filter(it => it.maker === "metered-takers")).toEqual([]);
        expect(generated.not_made.filter(it => it.id === "metered-takers")).toEqual([]);
        const seconds = events.find(event => event.event === "seconds")!;
        expect(Object.keys(seconds.makers as Record<string, number>)).not.toContain("metered-takers");
    });
});

/** Two direct takers feed the same recipe. A drill or a recycler also places its result directly. */
function placementConfiguration(
    source: { recipe: string; prototype: string; crafting_speed: number; ingredients: string[]; result: string },
    target: { recipe: string; prototype: string; crafting_speed: number },
    output_swings: number,
    drill?: { item: string; targets: number[] },
    buffer_item?: string,
) {
    const machine = (id: number) => ({ type: "machine", id });
    const chest = (id: number) => ({ type: "chest", id });
    const { ingredients, result, ...source_machine } = source;
    const target_ids = [2, 3];
    return ConfigSchema.parse({
        setpoint: { item: target.recipe, items_per_second: 40, copies: 1 },
        machines: [{ id: 1, ...source_machine, productivity: 0, result_target: buffer_item === undefined ? undefined : chest(3) },
            ...target_ids.map(id => ({ id, ...target, productivity: 0 }))],
        inserters: [...ingredients.map((item, index) => ({ id: index + 1, source: chest(1), sink: machine(1), filters: [item] })),
            ...target_ids.map(id => ({ id: id + 1, source: machine(1), sink: machine(id), filters: [result] })),
            ...target_ids.map(id => ({ id: id + 3, source: machine(id), sink: chest(2), filters: [target.recipe] }))],
        drills: drill === undefined ? undefined : { configs: drill.targets.map(id => ({
            id: id - 1, type: "big-mining-drill", mined_item_name: drill.item, speed_bonus: 8, productivity: 0, target: machine(id),
        })) },
        chests: [{ id: 1, type: "infinity-chest", item_filter: ingredients.map(item_name => ({ item_name, request_count: 100 })) },
            { id: 2, type: "infinity-chest", remove_unfiltered_items: true },
            ...(buffer_item === undefined ? [] : [{ id: 3, type: "buffer-chest", item_filter: buffer_item, storage_size: 1 }])],
        belts: [], overrides: { terminal_swing_count: output_swings, lcm: 1 },
    });
}

describe("source and target placement on a metered route", () => {
    const recycler = { recipe: "iron-gear-wheel-recycling", prototype: "recycler", crafting_speed: 16,
        ingredients: ["iron-gear-wheel"], result: "iron-plate" };
    const sticks = { recipe: "iron-stick", prototype: "assembling-machine-3", crafting_speed: 5 };
    const shared_route = expect.objectContaining({ reason: { code: "metered_window_unproved", inserter: 3, cause: "shared_route" } });

    it("refuses when a mining drill supplies the same coal as a metered taker", () => {
        const configuration = placementConfiguration({ recipe: "coal-synthesis", prototype: "chemical-plant", crafting_speed: 40,
            ingredients: ["carbon", "sulfur"], result: "coal" }, { recipe: "plastic-bar", prototype: "chemical-plant", crafting_speed: 10 }, 2, { item: "coal", targets: [2] });
        expect(() => meteredTakersClock(configuration, quiet)).toThrow(shared_route);
    });

    it("refuses when the recycler also places the metered iron plate into an accepting chest", () => {
        const configuration = placementConfiguration(recycler, sticks, 2, undefined, "iron-plate");
        expect(() => meteredTakersClock(configuration, quiet)).toThrow(shared_route);
    });

    it("keeps the brick takers when the drills supply iron ore to the same concrete machines", () => {
        const configuration = placementConfiguration({ recipe: "stone-brick", prototype: "electric-furnace", crafting_speed: 96,
            ingredients: ["stone"], result: "stone-brick" }, { recipe: "concrete", prototype: "assembling-machine-3", crafting_speed: 20 }, 10, { item: "iron-ore", targets: [2, 3] });
        const clock = meteredTakersClock(configuration, quiet);
        expect([clock.used_terminal_swing_count, clock.used_lcm, clock.stability_check.as_built?.holds]).toEqual([10, 1, true]);
    });
});
