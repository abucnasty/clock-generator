import { GameFixturePaths } from "../../../tests/game/helpers/fixture-paths";
import { beforeAll, describe, expect, it } from "vitest";
import { Config } from "../../config";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { handSizeFor } from "../../entities";
import { EntityState, InserterState } from "../../state";
import { BeltPickupArm } from "../../state/belt-pickup-arm";
import type { InserterArchetype } from "../../simulation/archetypes/inserter";
import { BeltHandPickup } from "../../simulation/components/belt-hand-pickup";
import { BurnerEnergy } from "../../simulation/components/burner-energy";
import { ContainerHandDrop } from "../../simulation/components/container-hand-drop";
import { ContainerHandPickup } from "../../simulation/components/container-hand-pickup";
import { ContainerStorage } from "../../simulation/components/container-storage";
import { MachineHandDrop } from "../../simulation/components/machine-hand-drop";
import { MachineHandPickup } from "../../simulation/components/machine-hand-pickup";
import { SimulationContext } from "../sequence";
import { simulationStateKey } from "./steady-state";

/**
 * Samples that between them hold every kind of component: burners, a loop of pentapod eggs, an infinity chest and hands
 * from a belt with the pickup arm (agricultural science), a drill into a car and hands from a car (the car), buffer
 * chests (low density structure), a recycler placing results by chance into a rocket silo (the scrap silo), drills into
 * machines (the electric furnace) and hands from a belt of one item on both lanes (the same-item fixture)
 */
const SAMPLES = {
    AGRICULTURAL_SCIENCE: ConfigPaths.AGRICULTURAL_SCIENCE,
    REAL_OWNER_CAR: ConfigPaths.REAL_OWNER_CAR,
    LOW_DENSITY_STRUCTURE: ConfigPaths.LOW_DENSITY_STRUCTURE,
    RECYCLING_SCRAP_SILO: ConfigPaths.RECYCLING_SCRAP_SILO,
    ELECTRIC_FURNACE: ConfigPaths.ELECTRIC_FURNACE,
    SAME_ITEM: GameFixturePaths.SAME_ITEM_CONFIG,
} as const;
type Sample = keyof typeof SAMPLES;

const BUILD = "bound at build, the same in every tick";
const TOTAL = "a running total: it only grows, so it never repeats";
const CONTROL = "what kind of control it is: written at build and at a control swap, which comes between runs";
const PICKUP_START = "set by a pickup's enter step and read in that tick's step only (whether its take marks a window's first tick)";
const REASON = "written by a rule and read at the change it gives, in the same call";
const MEMO = "a memo of what the inventories answer, which asking again gives";

/**
 * Every field with a plain value that a component of the simulation keeps, by the component's class (the record of an
 * inserter's hand, `InserterState`, by its kind): in a key (`keyed`) or out of every key (`excluded`, with why). A field
 * added to a component fails the pin below until it is put in one of the two, and the key test after it holds both to
 * what they say: changing a keyed field changes the simulation's key, changing an excluded one does not. `references`
 * are what a component is bound to at build (null for none), never state of its own.
 */
const FIELDS: Record<string, { keyed: readonly string[]; excluded: Readonly<Record<string, string>>; references?: readonly string[] }> = {
    // the inserter's state: its Hand keys what it holds, its status as written and its wait flag; its Wakes whether it
    // shows enabled
    inserter: {
        keyed: ["status", "held_item", "waits_for_sink", "enabled"],
        excluded: { items_picked_up: TOTAL, items_dropped: TOTAL },
    },
    Hand: { keyed: ["phase"], excluded: { swings_part_hands: BUILD, from_belt: BUILD, swing_ticks: BUILD }, references: ["sink_wakes", "sink_ingress"] },
    // the idle rule's two flags and the swing's start in the Hand's key; the pickup ticks of a machine or a container,
    // a belt's decision and the drop ticks of a machine or a container in the ports' keys (see KEYED_WHERE)
    HandScratch: {
        keyed: ["saw_sink_blocked", "window_opens", "swing_entered_tick", "swing_from", "pickup_ticks", "belt_grab_decided", "drop_ticks"],
        excluded: {
            window_opened: PICKUP_START, ticks_in_pickup: PICKUP_START, reason: REASON, reason_item: REASON, reason_quantity: REASON,
            spare_hand: "the record of the hand last emptied: the next hand fills it, so it holds nothing",
        },
    },
    BeltHandDrop: { keyed: [], excluded: { at_spot: BUILD, spot_ticks: BUILD } },
    BeltHandPickup: { keyed: [], excluded: { layout: BUILD, near_lane: BUILD }, references: ["sink_wakes"] },
    Control: { keyed: [], excluded: { is_game_clock: CONTROL, looks_ahead: CONTROL, decider_build_order: CONTROL } },
    // its craft underway is a field of its ProgressState: changed in the test of what is no plain field
    Crafting: { keyed: ["status"], excluded: { craftCount: TOTAL, craftsStarted: TOTAL, totalCrafted: TOTAL, crafts_per_tick: BUILD } },
    MachineWakes: {
        keyed: ["outputBlockedAfterLastTick", "finishedCraftInLastTick", "startedCraftInLastTick"],
        excluded: {
            windowOpeningTakeDecider: "cleared at the end of every tick of the machine: null whenever a key is taken (same-tick rule 3)",
            crafts_seen: TOTAL, starts_seen: TOTAL,
        },
    },
    // its productivity bar and its carry are no plain fields: changed in the test of what is no plain field
    Yield: {
        keyed: ["pendingOutput"],
        excluded: {
            productsFinished: TOTAL, places_results: BUILD, output_name: BUILD, output_amount: BUILD, output_by_chance: BUILD,
            output_stack_size: BUILD, amount_per_bonus: BUILD, bonus_per_craft: BUILD, ingredients_blocked_at: BUILD, main_carry_slot: BUILD,
        },
    },
    BurnerEnergy: { keyed: ["energy_remaining_mj", "energy_buffer_mj"], excluded: { energy_per_tick: BUILD } },
    Placement: { keyed: [], excluded: { results_placed: TOTAL, counts_own_output: BUILD, places_results_itself: BUILD }, references: ["target"] },
    Ingress: {
        keyed: [],
        excluded: { fuel_item: BUILD, fuel_limit: BUILD, nothing_inv: MEMO, nothing_fuel: MEMO, nothing_self: MEMO, nothing_answer: MEMO },
        references: ["fuel_quantity", "placer_stops"],
    },
    CraftingMachineArchetype: { keyed: [], excluded: {}, references: ["result_target"] },
    MiningDrillArchetype: { keyed: ["status"], excluded: {} },
    DrillState: { keyed: [], excluded: { status: "never written (P4 D14): the drill's status is its archetype's, in the key; the game's state of the drill reads this one" } },
    // its bonus bar is in a record of its own: changed in the test of what is no plain field
    Mining: { keyed: ["progress"], excluded: { mining_time: BUILD, step: BUILD, bonus_step: BUILD, item: BUILD } },
    BeltLane: { keyed: [], excluded: { item: BUILD, stack_size: BUILD, belt_speed: BUILD } },
};

/** Where a field of a hand's scratch is keyed: by the port of the inserter that writes it, not by every inserter's */
const KEYED_WHERE: Record<string, (inserter: InserterArchetype) => boolean> = {
    "HandScratch.pickup_ticks": it => it.hand.pickup instanceof MachineHandPickup || it.hand.pickup instanceof ContainerHandPickup,
    "HandScratch.belt_grab_decided": it => it.hand.pickup instanceof BeltHandPickup,
    "HandScratch.drop_ticks": it => it.hand.drop instanceof MachineHandDrop || it.hand.drop instanceof ContainerHandDrop,
};

/** Every component of every archetype of a context, with the inserter it belongs to where it is an inserter's */
function* componentsOf(context: SimulationContext): Generator<{ component: object; inserter?: InserterArchetype }> {
    const states = context.state_registry.getAllStates();
    for (const belt of states.filter(EntityState.isBelt)) {
        for (const component of [belt, belt.supply, ...belt.lanes]) yield { component };
    }
    for (const container of states.filter(ContainerStorage.is)) {
        for (const component of [container, container.supply]) yield { component };
    }
    for (const machine of context.machines) {
        const state = machine.machine_state;
        for (const component of [machine, state, state.crafting, state.wakes, state.yield, state.energy, state.placement, state.ingress, state.output]) {
            yield { component };
        }
    }
    for (const inserter of context.inserters) {
        const hand = inserter.hand;
        for (const component of [inserter.inserter_state, inserter, inserter.wakes, inserter.control, hand, hand.scratch, hand.pickup, hand.drop]) {
            yield { component, inserter };
        }
    }
    for (const drill of context.drills) {
        const state = drill.drill_state;
        for (const component of [drill, state, state.held, state.placement, drill.mining, drill.control]) yield { component };
    }
}

/** The name the pins know a component by: its class; the record of an inserter's hand by its kind */
const ownerOf = (component: object): string => component.constructor === Object ? "inserter" : component.constructor.name;

/** Its fields that hold a plain value, but what it is bound to at build */
function plainFields(component: object): string[] {
    const references = FIELDS[ownerOf(component)]?.references ?? [];
    return Object.entries(component)
        .filter(([name, value]) => !references.includes(name) && (value === null || (typeof value !== "object" && typeof value !== "function")))
        .map(([name]) => name);
}

/** The first item a hand carries */
const carriedBy = (state: InserterState) => [...state.inserter.filtered_items][0];

/** Another value of the field's kind: for a hand, one of what it carries; else the next number, the other flag, another text, a number for none */
function changed(owner: string, field: string, value: unknown, inserter: InserterArchetype | undefined): unknown {
    if (owner === "inserter" && field === "held_item") {
        return { item_name: carriedBy(inserter!.inserter_state), quantity: 1 };
    }
    switch (typeof value) {
        case "number": return value + 1;
        case "boolean": return !value;
        case "string": return `${value}-changed`;
        default: return 1;
    }
}

const configs = {} as Record<Sample, Config>;
beforeAll(async () => {
    for (const [sample, path] of Object.entries(SAMPLES)) {
        configs[sample as Sample] = await loadConfigFromFile(path);
    }
});

const contextOf = (sample: Sample) => SimulationContext.fromConfig(structuredClone(configs[sample]));
const beltsOf = (context: SimulationContext) => context.state_registry.getAllStates().filter(EntityState.isBelt);
const statesOf = (context: SimulationContext) => context.state_registry.getAllStates();
/** An inserter that takes from a belt with the pickup arm, holding a part hand */
function armWithPartHand(context: SimulationContext): InserterState {
    const state = context.inserters.find(it => it.inserter_state.pickup_arm !== undefined)!.inserter_state;
    state.held_item = { item_name: carriedBy(state), quantity: 1 };
    return state;
}

describe("simulationStateKey", () => {
    it("knows every field with a plain value of every component, in a key or out of every key, and no other", () => {
        const found: Record<string, Set<string>> = {};
        for (const sample of Object.keys(SAMPLES) as Sample[]) {
            for (const { component } of componentsOf(contextOf(sample))) {
                for (const field of plainFields(component)) {
                    (found[ownerOf(component)] ??= new Set()).add(field);
                }
            }
        }
        const listed = Object.entries(FIELDS)
            .map(([owner, fields]) => [owner, [...fields.keyed, ...Object.keys(fields.excluded)].sort()] as const)
            .filter(([, fields]) => fields.length > 0);
        expect(Object.fromEntries(Object.entries(found).map(([owner, fields]) => [owner, [...fields].sort()]))).toEqual(Object.fromEntries(listed));
    });

    // P4 3.4: a key that loses a field ends warm-ups early, one that gains a field that varies delays repeats
    it("changes with each field in a key, of every component of every sample, and with none of the fields out of every key", () => {
        for (const sample of Object.keys(SAMPLES) as Sample[]) {
            const context = contextOf(sample);
            const base = simulationStateKey(context);
            let keyed_changes = 0;
            for (const { component, inserter } of componentsOf(context)) {
                const owner = ownerOf(component);
                const record = component as Record<string, unknown>;
                for (const field of plainFields(component)) {
                    const keyed = FIELDS[owner].keyed.includes(field) && (KEYED_WHERE[`${owner}.${field}`]?.(inserter!) ?? true);
                    const before = record[field];
                    record[field] = changed(owner, field, before, inserter);
                    expect(simulationStateKey(context) !== base, `${sample}: ${owner}.${field} ${keyed ? "in" : "out of"} the key`).toBe(keyed);
                    record[field] = before;
                    keyed_changes += keyed ? 1 : 0;
                }
            }
            expect(simulationStateKey(context), sample).toBe(base);
            expect(keyed_changes, sample).toBeGreaterThan(0);
        }
    });

    it("changes with what the components keep that is no plain field: inventories, bars, carry, lanes, gates, the pickup arm", () => {
        const changes: { sample: Sample; what: string; before?: (context: SimulationContext) => void; change: (context: SimulationContext) => void }[] = [
            { sample: "AGRICULTURAL_SCIENCE", what: "a machine's ingredients and output (its Storage)",
                change: context => context.machines[0].machine_state.inventoryState.addQuantity("bioflux", 1) },
            { sample: "AGRICULTURAL_SCIENCE", what: "the ingredients a machine keeps apart from its products (its Storage)",
                change: context => context.machines.find(it => it.machine_state.machine.self_ingredients.size > 0)!
                    .machine_state.selfIngredients.addQuantity("pentapod-egg", 1) },
            { sample: "AGRICULTURAL_SCIENCE", what: "a burner's fuel slot (its Storage)",
                change: context => context.machines.find(it => it.machine_state.energy instanceof BurnerEnergy)!
                    .machine_state.fuelInventory.addQuantity("nutrients", 1) },
            { sample: "AGRICULTURAL_SCIENCE", what: "the craft underway (Crafting)",
                change: context => { context.machines[0].machine_state.crafting.craftingProgress.progress = 0.5; } },
            { sample: "AGRICULTURAL_SCIENCE", what: "the productivity bar (Yield)",
                change: context => { context.machines[0].machine_state.yield.bonusProgress.progress = 0.25; } },
            { sample: "RECYCLING_SCRAP_SILO", what: "a fraction of a result by chance carried (Yield)",
                change: context => { (context.machines[0].machine_state.yield as unknown as { carry: number[] }).carry[1] = 0.5; } },
            { sample: "AGRICULTURAL_SCIENCE", what: "what a hand has carried (the inserter's Storage)",
                change: context => context.inserters[0].inserter_state.inventoryState.addQuantity("bioflux", 1) },
            { sample: "AGRICULTURAL_SCIENCE", what: "the pickup arm's reach while a part hand fills (Hand)", before: armWithPartHand,
                change: context => {
                    const arm = new BeltPickupArm(64);
                    arm.tryCollect(0, 196, true);
                    context.inserters.find(it => it.inserter_state.pickup_arm !== undefined)!.inserter_state.pickup_arm = arm;
                } },
            { sample: "REAL_OWNER_CAR", what: "what a drill holds (its Storage)", change: context => context.drills[0].drill_state.held.insert("iron-ore", 1) },
            { sample: "REAL_OWNER_CAR", what: "a drill's bonus bar (Mining)",
                change: context => { (context.drills[0].mining as unknown as { bonus: { bar: number } }).bonus.bar = 0.5; } },
            { sample: "REAL_OWNER_CAR", what: "a stack put down on a lane at a spot (BeltLane)",
                change: context => {
                    const lane = beltsOf(context)[0].lanes[0];
                    lane.insert(lane.sharedDrop(0), 0, 0);
                } },
            { sample: "REAL_OWNER_CAR", what: "a stack put down on a hand's own local tile of a lane (BeltLane)",
                change: context => {
                    const lane = beltsOf(context)[0].lanes[0];
                    const [id] = lane.dropIds();
                    lane.insert(lane.ownDrop(id, 0), 0, 0);
                } },
            { sample: "AGRICULTURAL_SCIENCE", what: "the stock a hand reaches on a lane (BeltLane)",
                change: context => {
                    const lane = beltsOf(context)[0].lanes[1];
                    const [id] = lane.pickupIds();
                    expect(lane.take(lane.pickupOf(id)!, 0, 1)).toBe(1);
                } },
            { sample: "AGRICULTURAL_SCIENCE", what: "what a belt withholds (its SupplyGate)",
                change: context => beltsOf(context)[0].supply.withheld.add("nutrients") },
            { sample: "AGRICULTURAL_SCIENCE", what: "what an infinity chest refuses (its SupplyGate)",
                change: context => statesOf(context).filter(ContainerStorage.isConstant)[0].supply.refused.add("agricultural-science-pack") },
            { sample: "LOW_DENSITY_STRUCTURE", what: "what a buffer chest holds (its Storage)",
                change: context => {
                    const chest = statesOf(context).filter(ContainerStorage.isSingleItem)[0];
                    chest.insert(chest.chest.item_filter, 1);
                } },
            { sample: "REAL_OWNER_CAR", what: "what a car holds (its Storage)",
                change: context => statesOf(context).filter(ContainerStorage.isSlots)[0].insert("iron-ore", 1) },
            { sample: "RECYCLING_SCRAP_SILO", what: "what a rocket silo holds (its Storage)",
                change: context => statesOf(context).filter(ContainerStorage.isWeight)[0].insert("iron-gear-wheel", 1) },
        ];
        for (const { sample, what, before, change } of changes) {
            const context = contextOf(sample);
            before?.(context);
            const base = simulationStateKey(context);
            change(context);
            expect(simulationStateKey(context), `${sample}: ${what}`).not.toBe(base);
        }
    });

    it("tells apart where a container of mixed items holds its items, at the same totals", () => {
        const car = contextOf("REAL_OWNER_CAR");
        const storage = statesOf(car).filter(ContainerStorage.isSlots)[0];
        storage.insert("iron-ore", 5);
        const totals = storage.inventoryState.export();
        const in_first = simulationStateKey(car);
        // the ore moved to another of the car's slots, none of which is filtered
        const slots = storage.inventoryState.slots;
        const from = slots.findIndex(slot => slot.item === "iron-ore");
        const to = slots.findIndex((slot, index) => index !== from && slot.item === null);
        slots[to] = { ...slots[to], item: slots[from].item, count: slots[from].count };
        slots[from] = { ...slots[from], item: null, count: 0 };
        expect(storage.inventoryState.export()).toEqual(totals);
        expect(simulationStateKey(car)).not.toBe(in_first);

        const silo = contextOf("RECYCLING_SCRAP_SILO");
        const weight = statesOf(silo).filter(ContainerStorage.isWeight)[0];
        const before = simulationStateKey(silo);
        // what its input slots hold, apart from the rocket inventory: the totals untouched
        weight.inventoryState.input.addQuantity("iron-gear-wheel", 1);
        expect(simulationStateKey(silo)).not.toBe(before);
    });

    it("keeps the pickup arm's reach out of the key while the hand is empty or full: the next hand starts its own", () => {
        const context = contextOf("AGRICULTURAL_SCIENCE");
        const state = context.inserters.find(it => it.inserter_state.pickup_arm !== undefined)!.inserter_state;
        const item = carriedBy(state);
        const reach = (radius: number) => {
            const arm = new BeltPickupArm(64);
            arm.tryCollect(0, radius, true);
            return arm;
        };
        for (const held of [null, { item_name: item, quantity: handSizeFor(state.inserter, item) }]) {
            state.held_item = held;
            state.pickup_arm = reach(196);
            const base = simulationStateKey(context);
            state.pickup_arm = reach(316);
            expect(simulationStateKey(context), JSON.stringify(held)).toBe(base);
        }
    });
});
