import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { TakerOrder } from "../control-logic/inserter/competing-takers";
import { SimulateStep } from "../crafting/runner/steps/simulate-step";
import { SimulationContext } from "../crafting/sequence/simulation-context";
import { Duration } from "../data-types/duration";
import { EntityState } from "../state";
import { RULES_OUTSIDE_THE_TICK, SAME_TICK_RULES, SameTickRule, TICK_PHASES, TickPhaseRow, TickTracer } from "./tick-phases";
import { World } from "./world";

/**
 * The order of a tick as this test knows it: a change of the phase table changes this copy in the same commit. Each
 * step with the method of today's state machines that runs it.
 */
const EXPECTED: readonly { name: string; entities: TickPhaseRow["entities"]; run_by: TickPhaseRow["run_by"]; steps: [string, string][] }[] = [
    { name: "tick", entities: null, run_by: "loop", steps: [["increment", "incrementTick"]] },
    { name: "drills", entities: "drills", run_by: "loop",
        steps: [["control_rule", "ruleStep"], ["mode", "modeStep"], ["tick_observers", "tickObservers"]] },
    { name: "inserters", entities: "inserters", run_by: "loop",
        steps: [["control_tick", "tickControl"], ["phase_rule", "ruleStep"], ["phase_step", "modeStep"], ["tick_observers", "tickObservers"],
            ["shown_enabled", "writeShownEnabled"]] },
    { name: "machines", entities: "machines", run_by: "loop",
        steps: [["place_before", "placeResults"], ["held_to_output", "putHeldProductsInOutput"], ["status_rule", "ruleStep"],
            ["status_step", "modeStep"], ["place_after", "placeResults"], ["end_of_tick", "tickObservers"]] },
    { name: "after_tick", entities: null, run_by: "caller", steps: [["recorders", "after_tick"], ["stop_early", "stop_early"]] },
];

/**
 * A drill into a car, a gear assembler fed from an infinity chest whose gears two inserters take into a recycler, which
 * places the plates it gives back into another car, the assembler fast enough for both takers: drills, the takers and the
 * feeders of one machine, a machine that places its results, containers.
 */
const BUILD: Config = ConfigSchema.parse({
    target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [
        { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 30 },
        { id: 2, recipe: "iron-gear-wheel-recycling", productivity: 0, crafting_speed: 0.5, prototype: "recycler", result_target: { type: "chest", id: 2 } },
    ],
    inserters: [
        { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, filters: ["iron-plate"],
            prototype: "stack-inserter", quality: "legendary", stack_size: 16 },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, filters: ["iron-gear-wheel"] },
        { id: 3, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 }, filters: ["iron-gear-wheel"] },
    ],
    belts: [],
    chests: [
        { type: "infinity-chest", id: 1, item_filter: [{ item_name: "iron-plate", request_count: 100 }] },
        { type: "car", id: 2 },
        { type: "car", id: 3 },
    ],
    drills: { configs: [{ id: 1, type: "electric-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0, productivity: 0,
        target: { type: "chest", id: 3 } }] },
}) as Config;

const TICKS = 600;

/** The entities of each phase in the order a tick runs them, written out rather than read from a World */
type EntityOrder = Record<NonNullable<TickPhaseRow["entities"]>, readonly string[]>;

/**
 * The orders of the build for each taker order: drills and machines in config order, the takers of machine 1 in the
 * taker order before its feeder. These literals are the only pin on the World's orders; the trace tests compare the
 * run with them, so a change of the World's order or of takers before feeders fails them.
 */
const ORDERS: readonly { taker_order: TakerOrder; order: EntityOrder }[] = [
    { taker_order: "descending", order: { drills: ["drill:1"], inserters: ["inserter:3", "inserter:2", "inserter:1"], machines: ["machine:1", "machine:2"] } },
    { taker_order: "ascending", order: { drills: ["drill:1"], inserters: ["inserter:2", "inserter:3", "inserter:1"], machines: ["machine:1", "machine:2"] } },
];

function idOf(world: World, entities: TickPhaseRow["entities"], index: number): string {
    switch (entities) {
        case "drills": return world.drills[index].drill_state.entity_id.id;
        case "inserters": return world.inserters[index].inserter_state.entity_id.id;
        case "machines": return world.machines[index].machine_state.entity_id.id;
        case null: return "-";
    }
}

/** Every step of `ticks` ticks as the table orders them, as "tick phase entity step"; `method` names the step by its method */
function expectedSteps(order: EntityOrder, ticks: number, method: boolean): string[] {
    const steps: string[] = [];
    for (let tick = 1; tick <= ticks; tick++) {
        TICK_PHASES.forEach((row, phase) => {
            for (const id of row.entities === null ? ["-"] : order[row.entities]) {
                for (const step of row.steps) {
                    const name = method ? EXPECTED[phase].steps[step.step][1] : step.name;
                    steps.push(`${tick} ${row.name} ${id} ${name}`);
                }
            }
        });
    }
    return steps;
}

/** Where two lists of steps first part, with a few steps either side; null where they agree */
function firstDifference(actual: readonly string[], expected: readonly string[]): object | null {
    const at = expected.findIndex((step, index) => actual[index] !== step);
    if (at === -1 && actual.length === expected.length) return null;
    const from = Math.max(0, (at === -1 ? expected.length : at) - 3);
    return { at, actual: actual.slice(from, from + 8), expected: expected.slice(from, from + 8) };
}

/**
 * A run of the build with a tracer, and with every step method of every state machine recording its calls. The tracer
 * is told an index into the run's own World, which this names through a second World built the same way; the calls
 * name the state machine that was called, so they show the run's order whatever World it ran.
 */
function tracedRun(taker_order: TakerOrder) {
    const context = SimulationContext.fromConfig(BUILD);
    context.competing_takers_order = taker_order;
    const world = World.of(context);
    const traced: string[] = [];
    const called: string[] = [];
    const now = () => context.tick_provider.getCurrentTick();
    const tracer: TickTracer = {
        step(phase, entity, step) {
            const row = TICK_PHASES[phase];
            traced.push(`${now()} ${row.name} ${idOf(world, row.entities, entity)} ${row.steps.find(it => it.step === step)?.name}`);
        },
    };
    for (const row of EXPECTED) {
        if (row.entities === null) continue;
        world[row.entities].forEach((state_machine, index) => {
            const methods = state_machine as unknown as Record<string, () => void>;
            for (const name of new Set(row.steps.map(([, method]) => method))) {
                const original = methods[name].bind(state_machine);
                methods[name] = () => {
                    called.push(`${now()} ${row.name} ${idOf(world, row.entities, index)} ${name}`);
                    original();
                };
            }
        });
    }
    const increment = context.tick_provider.incrementTick.bind(context.tick_provider);
    context.tick_provider.incrementTick = () => {
        increment();
        called.push(`${now()} tick - incrementTick`);
    };
    new SimulateStep(context, Duration.ofTicks(TICKS),
        () => { called.push(`${now()} after_tick - after_tick`); },
        () => { called.push(`${now()} after_tick - stop_early`); return false; },
        tracer,
    ).execute();
    return { context, world, traced, called };
}

describe("the phase table", () => {
    it("has the phases and steps of its copy in this test, each step's code its place in its phase", () => {
        expect(TICK_PHASES.map(row => ({ name: row.name, entities: row.entities, run_by: row.run_by, steps: row.steps.map(step => step.name) })))
            .toEqual(EXPECTED.map(row => ({ name: row.name, entities: row.entities, run_by: row.run_by, steps: row.steps.map(([name]) => name) })));
        TICK_PHASES.forEach((row, phase) => {
            expect(row.phase).toBe(phase);
            expect(row.steps.map(step => step.step)).toEqual(row.steps.map((_, index) => index));
        });
    });

    // Only that every rule is named somewhere: which step upholds which rule is checked by review, not by a run
    it("names every same-tick rule at a step or an order of entities, or as outside the tick", () => {
        const named = new Set<SameTickRule>([...RULES_OUTSIDE_THE_TICK,
            ...TICK_PHASES.flatMap(row => [...row.order_upholds, ...row.steps.flatMap(step => step.upholds)])]);
        expect([...named].sort((a, b) => a - b)).toEqual(Object.keys(SAME_TICK_RULES).map(Number));
    });
});

describe.each(ORDERS)("a traced run with the takers $taker_order", ({ taker_order, order }) => {
    const run = tracedRun(taker_order);

    it("builds the World in the table's orders: drills and machines in config order, takers before feeders", () => {
        const { world } = run;
        expect(world.drills.map(it => it.drill_state.entity_id.id)).toEqual(order.drills);
        expect(world.machines.map(it => it.machine_state.entity_id.id)).toEqual(order.machines);
        expect(world.containers.map(it => it.entity_id.id)).toEqual(["chest:1", "chest:2", "chest:3"]);
        expect(world.belts).toEqual([]);
        expect(world.inserters.map(it => it.inserter_state.entity_id.id)).toEqual(order.inserters);
        world.inserters.forEach((taker, before) => world.inserters.forEach((feeder, after) => {
            if (taker.inserter_state.inserter.source.entity_id.id === feeder.inserter_state.inserter.sink.entity_id.id) {
                expect(before).toBeLessThan(after);
            }
        }));
    });

    it("runs every step of every entity in the order of the table, as the tracer is told", () => {
        expect(firstDifference(run.traced, expectedSteps(order, TICKS, false))).toBeNull();
    });

    it("runs every step of every entity in the order of the table, as the state machines are called", () => {
        expect(firstDifference(run.called, expectedSteps(order, TICKS, true))).toBeNull();
    });

    it("is a run in which every kind of step does something: mining, both takers, placing, a status change", () => {
        const states = run.context.state_registry.getAllStates();
        const car = (id: string) => states.filter(EntityState.isChest).find(it => it.entity_id.id === id)!;
        expect(car("chest:3").getCurrentQuantity("iron-ore")).toBeGreaterThan(0);
        expect(car("chest:2").getCurrentQuantity("iron-plate")).toBeGreaterThan(0);
        for (const taker of run.world.inserters.slice(0, 2)) {
            expect(taker.inserter_state.items_picked_up).toBeGreaterThan(0);
        }
        // both machines start short of ingredients, so a craft means a change of status
        for (const machine of run.world.machines) {
            expect(machine.machine_state.craftCount).toBeGreaterThan(0);
        }
    });
});
