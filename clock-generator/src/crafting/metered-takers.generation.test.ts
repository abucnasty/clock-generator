import path from "path";
import { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import { InserterPhase } from "../simulation/status-codes";
import { World } from "../simulation/world";
import { runTick } from "../simulation/tick-phases";
import { coldControlledTrialBuild } from "./plan/unclocked-run";
import { buildAsBuiltConfig } from "./trial";
import { beforeAll, describe, expect, it } from "vitest";
import { generateClockAlternatives, planClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { ConfigSchema, type Config } from "../config/schema";
import { runClockAlternativeTask } from "./alternatives";
import { meteredTakersClock } from "./candidates/metered-takers";
import type { MakerLogEvent } from "./maker-log";
import { quiet } from "./generate-blueprint-test-helpers";
import { combineClockAlternativeRuns, coordinatedSourcesInputOf, runCoordinatedSourcesTask, type BlueprintGenerationResult } from "./generate-blueprint";
import { CIRCUIT_LATENCY_TICKS } from "../common/rule-constants";

/** Read the enabling deciders as the circuit sees them with the lock off. The counter starts at one;
 * a modulo computed from the previous count also receives the counter's constant one. */
function checkScienceExport(config: Config, clock: BlueprintGenerationResult) {
    const period = clock.simulation_duration.ticks;
    const windows = new Map(Object.entries(clock.clock_windows).map(([id, ranges]) =>
        [id, ranges.map(range => OpenRange.from(range.start, range.end))]));
    const built = buildAsBuiltConfig(config, windows, period);
    const forms = [{ blueprint: clock.blueprint, schedule: clock.schedule }];
    expect(clock.modulo_blueprint).toBeDefined();
    if (clock.modulo_blueprint && clock.modulo_schedule) forms.push({ blueprint: clock.modulo_blueprint, schedule: clock.modulo_schedule });
    // This fixture has a whole counter and offers no fractional export.
    expect(clock.subtick).toBeUndefined();
    for (const { blueprint, schedule } of forms) {
        expect(schedule.counted_ticks).toBe(period);
        const counter = blueprint.entities.find(entity => entity.tags?.clock_generator.generator)?.control_behavior?.decider_conditions;
        expect(counter?.conditions).toContainEqual(expect.objectContaining({ first_signal: expect.objectContaining({ name: "signal-clock" }), comparator: "<", constant: period }));
        const moduli = new Map(blueprint.entities.flatMap(entity => {
            const arithmetic = entity.control_behavior?.arithmetic_conditions;
            if (!arithmetic) return [];
            expect([arithmetic.first_signal.name, arithmetic.operation]).toEqual(["signal-clock", "%"]);
            expect(counter?.outputs).toContainEqual(expect.objectContaining({ signal: arithmetic.output_signal, constant: 1, copy_count_from_input: false }));
            return [[arithmetic.output_signal.name, arithmetic.second_constant] as const];
        }));
        for (const id of [1, 4, 11, 13, 18, 19]) {
            const groups = schedule.inserter_combinators.filter(group => group.inserter_ids.includes(id));
            expect(groups).toHaveLength(1);
            const entity = blueprint.entities.find(entity => entity.entity_number === groups[0].entity_number)!;
            expect(entity.tags?.clock_generator.inserters).toContain(id);
            const decider = entity.control_behavior!.decider_conditions!;
            expect(decider.outputs).toContainEqual(expect.objectContaining({ signal: expect.objectContaining({ name: "utility-science-pack" }), copy_count_from_input: false, constant: 1 }));
            expect(decider.else_outputs ?? []).toHaveLength(0);
            const control = built.inserters.find(arm => arm.id === id)!.overrides!.enable_control!;
            expect(control.mode).toBe("CLOCKED");
            if (control.mode !== "CLOCKED") throw new Error(`Missing clock for inserter ${id}`);
            const signal: boolean[] = [], expected: boolean[] = [];
            for (let tick = 0; tick < period; tick++) {
                const raw = (tick + period - CIRCUIT_LATENCY_TICKS) % period;
                let prior = false, term = false;
                for (const condition of decider.conditions!) {
                    const name = condition.first_signal.name;
                    const value = name === "signal-clock" ? raw + 1 : raw % moduli.get(name)! + 1;
                    if (!Number.isFinite(value)) throw new Error(`Unknown circuit signal ${name}`);
                    const bound = condition.constant ?? 0;
                    let holds: boolean;
                    switch (condition.comparator) {
                        case "=": holds = value === bound; break;
                        case "≥": holds = value >= bound; break;
                        case "≤": holds = value <= bound; break;
                        default: throw new Error(`Unexpected output predicate ${condition.comparator}`);
                    }
                    if (condition.compare_type === "and") term = term && holds;
                    else { prior ||= term; term = holds; }
                }
                signal.push(prior || term);
                expected.push(control.ranges.some(range => range.start <= tick && tick <= range.end));
            }
            expect(signal, `export of inserter ${id}`).toEqual(expected);
            expect(signal).toContain(true);
            expect(signal).toContain(false);
        }
    }
}

// A utility science build at 320 a second with 3 copies: two foundries each hand low density structure to three of the six
// assemblers, and no clock made before Round-Robin Polling with metered takers is stable. A fixture, not a job of the record.
describe("Round-Robin Polling with metered takers on a build whose foundries each feed three assemblers", () => {
    let configuration: Config;
    let generated: ClockAlternativesResult;
    beforeAll(async () => {
        configuration = await loadConfigFromFile(path.join(__dirname, "fixtures", "utility-science-320-metered-takers.json"));
        generated = generateClockAlternatives(configuration, { logger: quiet });
    });
    const alternative = (id: string) => generated.alternatives.find(it => it.id === id);

    it("lists the metered clock stable at the target rate on 324 ticks, 6 output swings", () => {
        const metered = alternative("round_robin_polling_metered_takers");
        expect(metered, generated.alternatives.map(it => it.id).join(", ")).toBeDefined();
        expect([metered!.maker, metered!.verdict, metered!.assessment.items_per_second.toFixed(2), metered!.result.simulation_duration.ticks, metered!.result.used_terminal_swing_count])
            .toEqual(["metered-takers", "stable", "320.00", 324, 6]);
        expect(metered!.strategy).toMatchObject({ id: "round_robin_polling", settings: { shared_windows: "metered_takers" } });
    });

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

    it("selects Coordinated Sources, made from it, stable at the target rate", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect([selected.id, selected.verdict, selected.assessment.items_per_second.toFixed(2), selected.result.simulation_duration.ticks])
            .toEqual(["coordinated_sources", "stable", "320.00", 324]);
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
        checkScienceExport(configuration, clock);
    });

    it("carries the metered turns through the worker tasks to the selected clock and its two exports", () => {
        const plan = planClockAlternatives(configuration, { logger: quiet });
        const runs = [plan.primary, ...plan.tasks.filter(task => !task.coordinated_sources && !task.explored)
            .map(task => runClockAlternativeTask(configuration, plan.context, task.id, { logger: quiet }))];
        const before = combineClockAlternativeRuns(runs, alternative => alternative.ranking);
        const ids = before.order.map(index => before.alternatives[index].id);
        const input = structuredClone(coordinatedSourcesInputOf(runs, ids));
        expect(input.parts.some(part => part.metered_takers?.length === 6)).toBe(true);
        const composed = runCoordinatedSourcesTask(configuration, input, { logger: quiet });
        const final = combineClockAlternativeRuns([...runs, composed], alternative => alternative.ranking);
        const selected = final.alternatives[final.selected_index];
        expect([selected.id, selected.verdict, selected.assessment.items_per_second.toFixed(2)]).toEqual(["coordinated_sources", "stable", "320.00"]);
        expect(selected.result.clock_windows).toEqual(generated.alternatives[generated.selected_index].result.clock_windows);
        checkScienceExport(configuration, selected.result);
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
