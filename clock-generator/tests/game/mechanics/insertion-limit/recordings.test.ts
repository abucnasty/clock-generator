import {describe, expect, test} from "vitest";
import {Inserter, Machine, RecipeMetadata} from "../../../../src/entities";
import {CarriedItems, HandScratch} from "../../../../src/simulation/components/hand";
import {MachineHandDrop} from "../../../../src/simulation/components/machine-hand-drop";
import {InserterState, MachineState} from "../../../../src/state";
import {SIMULATOR_LIMITS} from "./cases";
import {LimitRecording, LimitScenarioInfo, loadRecording, Trial} from "./recording";

/**
 * The retained recordings of the insertion limit runs (limit.game.test.ts, probe.lua), read offline: an inserter dropping
 * into an assembling machine or a furnace from a chosen stock of the ingredient, and how that compares with the simulator's
 * rule (the limit is the amount a craft takes times the overload multiplier; the pickup waits while the stock is at it; the
 * drop puts in the whole hand). See README.md.
 */
const RUNS = ["hand-large", "hand-mid", "hand-small"] as const;
const recordings: Record<string, LimitRecording> = Object.fromEntries(RUNS.map(run => [run, loadRecording(run)]));

/** The recipe a furnace of the scenarios makes from its ingredient */
const FURNACE_RECIPE: Record<string, string> = {"iron-ore": "iron-plate", "stone": "stone-brick", "iron-plate": "steel-plate"};

/** The hand of an inserter in a run: the prototype's capacity with the force's bonuses */
function capacityOf(recording: LimitRecording, scenario: LimitScenarioInfo): number {
    return scenario.inserter === "stack-inserter"
        ? 5 + recording.info.force.bulk_inserter_capacity_bonus
        : 1 + recording.info.force.inserter_stack_size_bonus;
}

/**
 * The machine as the simulator makes it from what the game says of it: its crafting speed, its recipe, its prototype
 * (whose class makes a furnace a furnace)
 */
function simulatorMachine(scenario: LimitScenarioInfo): Machine {
    const furnace = scenario.entity.endsWith("furnace");
    return Machine.createMachine(-1, {
        crafting_speed: scenario.crafting_speed,
        productivity: 0,
        recipe: RecipeMetadata.fromRecipeName(furnace ? FURNACE_RECIPE[scenario.ingredient] : scenario.recipe!),
        prototype: scenario.entity,
    });
}

const simulatorLimit = (scenario: LimitScenarioInfo) => simulatorMachine(scenario).inputs.getOrThrow(scenario.ingredient).automated_insertion_limit.quantity;

const plain = (trials: Trial[]) => trials.filter(trial => trial.bump === undefined);
const bumped = (trials: Trial[]) => trials.filter(trial => trial.bump !== undefined);

for (const run of RUNS) describe(`${run}: ${(() => { const f = recordings[run].info.force; return `basic hand ${1 + f.inserter_stack_size_bonus}, stack hand ${5 + f.bulk_inserter_capacity_bonus}`; })()}`, () => {
    const recording = recordings[run];

    test("the probe finished every trial and the inserters were wired chest to machine", () => {
        expect(recording.finished).toBe(true);
        for (const scenario of recording.info.scenarios) {
            expect(scenario.inserter_pickup, scenario.name).toBe("steel-chest");
            expect(scenario.inserter_drop, scenario.name).toBe(scenario.entity);
        }
    });

    describe.each(recording.info.scenarios.map(scenario => scenario.name))("%s", name => {
        const scenario = recording.info.scenarios.find(it => it.name === name)!;
        const trials = recording.trials[name];
        const capacity = capacityOf(recording, scenario);
        const limit = simulatorLimit(scenario);

        test("the limit the game works to is the simulator's", () => {
            const full = plain(trials).filter(trial => trial.n === 0);
            // the first stock the inserter does not pick up at is the limit, and every stock above it is the same
            const first_refused = Math.min(...full.filter(trial => !trial.dropped).map(trial => trial.s0));
            expect(first_refused).toBe(limit);
            expect(SIMULATOR_LIMITS[name.replace(/-(stack-)?inserter$/, "")]).toBe(limit);
            for (const trial of full) expect(trial.dropped, `stock ${trial.s0}`).toBe(trial.s0 < limit);
        });

        test("at the limit the inserter does not pick up at all", () => {
            for (const trial of plain(trials).filter(it => !it.dropped)) {
                expect(trial.held, `stock ${trial.s0}, chest ${trial.n}`).toBe(0);
                expect(trial.after).toBe(trial.s0);
            }
        });

        test("under the limit the whole hand goes in, even past the limit", () => {
            for (const trial of plain(trials).filter(it => it.dropped)) {
                const hand = trial.n === 0 ? capacity : Math.min(trial.n, capacity);
                expect(trial.held, `stock ${trial.s0}, chest ${trial.n}`).toBe(hand);
                expect(trial.after, `stock ${trial.s0}, chest ${trial.n}`).toBe(trial.s0 + hand);
            }
            // the most a stock can reach: one under the limit and a hand
            const dropped = plain(trials).filter(it => it.dropped && it.n === 0);
            expect(Math.max(...dropped.map(trial => trial.after))).toBe(limit - 1 + capacity);
        });

        test("a hand already picked up goes in whole whatever the stock became after the pickup", () => {
            expect(bumped(trials).length).toBeGreaterThan(0);
            for (const trial of bumped(trials)) {
                const hand = trial.n === 0 ? capacity : Math.min(trial.n, capacity);
                expect(trial.dropped, `bumped to ${trial.bump}`).toBe(true);
                expect(trial.held, `bumped to ${trial.bump}`).toBe(hand);
                expect(trial.after, `bumped to ${trial.bump}`).toBe(trial.bump! + hand);
            }
            // among them stocks at the limit and above it
            expect(bumped(trials).some(trial => trial.bump! >= limit)).toBe(true);
        });

        test("the simulator takes a hand while the stock is under the limit and drops all of it", () => {
            const machine = simulatorMachine(scenario);
            for (const stock of [0, limit - 1, limit, limit + 1].filter(it => it >= 0)) {
                const state = MachineState.forMachine(machine);
                state.ingress.insert(scenario.ingredient, stock);
                expect(state.ingress.blocked(scenario.ingredient), `stock ${stock}`).toBe(stock >= limit);
            }
            const state = MachineState.forMachine(machine);
            state.ingress.insert(scenario.ingredient, limit - 1);
            // an inserter with no filter, which carries any item
            const unfiltered = {entity_id: {id: "inserter:1", type: "inserter"}, filtered_items: new Set<string>()} as unknown as Inserter;
            const inserter = {...InserterState.createIdle(unfiltered),
                held_item: {item_name: scenario.ingredient, quantity: capacity}};
            inserter.inventoryState.addQuantity(scenario.ingredient, capacity);
            new MachineHandDrop(inserter, new HandScratch(), new CarriedItems(unfiltered), state.ingress).drop();
            expect(state.ingress.ingredientQuantity(scenario.ingredient)).toBe(limit - 1 + capacity);
            expect(inserter.held_item).toBeNull();
        });
    });
});

describe("what sets the limit", () => {
    const scenarioOf = (name: string) => recordings["hand-large"].info.scenarios.find(it => it.name === name)!;
    const lowest = (name: string) => Math.min(...plain(recordings["hand-large"].trials[name]).filter(trial => trial.n === 0 && !trial.dropped).map(trial => trial.s0));

    // the limit is ceil(amount x multiplier), the multiplier ceil(1.166 / (craft time / speed)) + 1 and at least 2
    test.each([
        // name, ingredient amount a craft, craft time (s), crafting speed, multiplier, limit
        ["am1-gear-inserter", 2, 0.5, 0.5, 3, 6],
        ["am3-gear-inserter", 2, 0.5, 1.25, 4, 8],
        ["am3-engine-pipe-inserter", 2, 10, 1.25, 2, 4],
        ["am2-circuit-inserter", 1, 0.5, 0.75, 3, 3],
        ["am1-landfill-inserter", 50, 0.5, 0.5, 3, 150],
        ["am3-gear-speed-inserter", 2, 0.5, 3.75, 10, 20],
        ["am3-gear-legendary-speed-inserter", 2, 0.5, 7.5, 19, 38],
        ["am3-pipe-legendary-speed-inserter", 1, 0.5, 7.5, 19, 19],
    ])("%s: %i an item, %f s at speed %f is a multiplier of %i and a limit of %i", (name, amount, seconds, speed, multiplier, limit) => {
        const scenario = scenarioOf(name as string);
        expect(scenario.crafting_speed).toBe(speed);
        if (scenario.energy_required !== undefined) expect(scenario.energy_required).toBe(seconds);
        expect(Math.max(2, Math.ceil(1.166 / ((seconds as number) / (speed as number))) + 1)).toBe(multiplier);
        expect((amount as number) * (multiplier as number)).toBe(limit);
        expect(lowest(name as string)).toBe(limit);
    });

    // furnaces: the recipe is the one the item smelts to
    test.each([
        ["stone-furnace-ore-inserter", 1, 3.2, 1, 2, 2],
        ["electric-furnace-ore-inserter", 1, 3.2, 2, 2, 2],
        ["steel-furnace-stone-inserter", 2, 3.2, 2, 2, 4],
        ["stone-furnace-steel-inserter", 5, 16, 1, 2, 10],
    ])("%s: %i an item, %f s at speed %f is a multiplier of %i and a limit of %i", (name, amount, seconds, speed, multiplier, limit) => {
        expect(scenarioOf(name as string).crafting_speed).toBe(speed);
        expect(Math.max(2, Math.ceil(1.166 / ((seconds as number) / (speed as number))) + 1)).toBe(multiplier);
        expect((amount as number) * (multiplier as number)).toBe(limit);
        expect(lowest(name as string)).toBe(limit);
    });

    test("a machine disabled by script takes items to the same limit as one that is not", () => {
        for (const run of RUNS) {
            const disabled = lowest("am2-circuit-inactive-inserter"), enabled = lowest("am2-circuit-inserter");
            expect(disabled).toBe(enabled);
            expect(Math.min(...plain(recordings[run].trials["stone-furnace-ore-inserter"]).filter(trial => trial.n === 0 && !trial.dropped).map(trial => trial.s0)))
                .toBe(Math.min(...plain(recordings[run].trials["stone-furnace-ore-active-inserter"]).filter(trial => trial.n === 0 && !trial.dropped).map(trial => trial.s0)));
        }
    });
});
