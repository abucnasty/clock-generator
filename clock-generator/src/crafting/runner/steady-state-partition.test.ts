import { GameFixturePaths } from "../../../tests/game/helpers/fixture-paths";
import { beforeAll, describe, expect, it } from "vitest";
import { Config } from "../../config";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { EnableControl } from "../../control-logic/enable-control";
import { Duration, OpenRange } from "../../data-types";
import { handSizeFor } from "../../entities";
import { DrillStatus, EntityState, InserterState, MachineState } from "../../state";
import { SupplyGate } from "../../state/supply-gate";
import type { InserterArchetype } from "../../simulation/archetypes/inserter";
import type { TransportBelt } from "../../simulation/archetypes/transport-belt";
import type { BeltLane } from "../../simulation/components/belt-lane";
import { BurnerEnergy } from "../../simulation/components/burner-energy";
import { ContainerStorage } from "../../simulation/components/container-storage";
import type { Hand } from "../../simulation/components/hand";
import { drillStatusOf, inserterStatusOf, machineStatusOf } from "../../simulation/status-codes";
import { SimulationContext } from "../sequence";
import { SimulationTick } from "./simulation-tick";
import { simulationStateKey } from "./steady-state";

// A migration oracle for R18 only: R19 deletes this file with the old framework. It pins the old key and reads component
// internals (the mining bars, the burner's fields, the hand's scratch, the lanes' drops, the carry), so a later round that
// rightly changes what a key tells apart, or moves those fields, deletes it rather than updating it. The lasting guards
// are the key test and the FIELDS pins of steady-state.test.ts.
//
// The simulation's key as it was composed before each component wrote its own (e41363f1): a line for each state of the
// registry (its inventory, its supply gate and its own key by kind), then a line for each machine, inserter and drill
// with the text of its mode state machine. Test code only, copied as it was and reading the same fields through the
// components; the texts no commit since changed (an inventory's export, a port's key, a lane's, the carry's, the arm's)
// are read through their own methods. The key that replaced it must tell apart exactly the states this one told apart.

function oldSimulationStateKey(context: SimulationContext): string {
    const tick = context.tick_provider.getCurrentTick();
    return [
        ...context.state_registry.getAllStates().map(it => oldEntityStateKey(it, tick)),
        ...context.machines.map(it => `${machineStatusOf(it.machine_state.crafting.status)}||||||||`),
        ...context.inserters.map(it => oldHandKey(it.hand, tick)),
        ...context.drills.map(it => `${drillStatusOf(it.status)}|${it.mining.mining_progress};${it.mining.bonus_progress}|||`),
    ].join("\n");
}

function oldEntityStateKey(state: EntityState, tick: number): string {
    const inventory = Object.entries(state.inventoryState.export()).sort(([a], [b]) => a.localeCompare(b));
    return `${JSON.stringify(inventory)};${oldSupplyKey(state)};${oldOwnStateKey(state, tick)}`;
}

function oldSupplyKey(state: EntityState): string {
    const supply = (state as { supply?: SupplyGate }).supply;
    if (supply === undefined || supply.isOpen()) {
        return "";
    }
    return `W:${Array.from(supply.withheld).sort().join(",")};R:${Array.from(supply.refused).sort().join(",")}`;
}

function oldOwnStateKey(state: EntityState, tick: number): string {
    if (EntityState.isMachine(state)) {
        return oldMachineStateKey(state);
    }
    if (EntityState.isInserter(state)) {
        return oldInserterStateKey(state, tick);
    }
    if (EntityState.isDrill(state)) {
        return state.status;
    }
    if (EntityState.isBelt(state)) {
        return oldBeltKey(state, tick);
    }
    if (ContainerStorage.isMixed(state)) {
        return state.inventoryState.slotKey();
    }
    return "";
}

function oldMachineStateKey(machineState: MachineState): string {
    const crafting = machineState.crafting;
    const wakes = machineState.wakes;
    const energy = machineState.energy;
    return [
        machineStatusOf(crafting.status),
        machineState.yield.pendingOutput,
        wakes.outputBlockedAfterLastTick,
        wakes.finishedCraftInLastTick,
        wakes.startedCraftInLastTick,
        JSON.stringify(machineState.selfIngredients.export()),
        crafting.craftingProgress.progress,
        machineState.yield.bonusProgress.progress,
        energy instanceof BurnerEnergy ? `${energy.energy_remaining_mj};${energy.energy_buffer_mj}` : "0;0",
        JSON.stringify(Object.entries(machineState.fuelInventory.export()).sort(([a], [b]) => a.localeCompare(b))),
        machineState.yield.carryKey(),
    ].join(";");
}

function oldInserterStateKey(state: InserterState, tick: number): string {
    const held = state.held_item;
    const arm = held && held.quantity < handSizeFor(state.inserter, held.item_name) ? state.pickup_arm?.stateKey(tick) : undefined;
    return [state.status, state.waits_for_sink, state.enabled, JSON.stringify(held), arm].join(";");
}

function oldHandKey(hand: Hand, tick: number): string {
    const scratch = hand.scratch;
    const entered = scratch.swing_entered_tick;
    const from = scratch.swing_from;
    return `${inserterStatusOf(hand.phase)}||${scratch.saw_sink_blocked},${scratch.window_opens}`
        + `||${entered === null ? null : entered - tick},${from === null ? null : inserterStatusOf(from)}`
        + `|${hand.drop.key()}||${hand.pickup.key()}|||||||`;
}

function oldBeltKey(belt: TransportBelt, tick: number): string {
    const lanes = belt.lanes;
    const traffic = lanes.map(lane => lane.trafficKey(tick)).join("|");
    const ids = (of: (lane: BeltLane) => IterableIterator<string>) => lanes.length === 0 ? [] : [...of(lanes[0])];
    const drops = ids(lane => lane.dropIds())
        .map(id => `${id}:${lanes.map(lane => lane.dropOf(id)!.stateKey(tick)).join("|")}`);
    const pickups = ids(lane => lane.pickupIds())
        .map(id => `${id}:${lanes.map(lane => lane.pickupOf(id)!.stock.stateKey(tick)).join("|")}`);
    return traffic + ";" + drops.join(";") + ";" + pickups.join(";");
}

/**
 * The keys of the ticks of runs, paired old with new: a state with two new keys, or two states with one new key, is a
 * difference. Two ticks have equal new keys iff they had equal old keys when the pairing is one to one.
 */
class Pairing {
    private readonly new_of = new Map<string, { key: string; at: string }>();
    private readonly old_of = new Map<string, { key: string; at: string }>();
    public readonly differences: string[] = [];
    public ticks = 0;

    public add(old_key: string, new_key: string, at: string): void {
        this.ticks += 1;
        const paired_new = this.new_of.get(old_key);
        const paired_old = this.old_of.get(new_key);
        if (paired_new !== undefined && paired_new.key !== new_key) {
            this.differences.push(`${at}: a state the old key had seen (${paired_new.at}) has another new key`);
        }
        if (paired_old !== undefined && paired_old.key !== old_key) {
            this.differences.push(`${at}: two states the old key told apart (the other at ${paired_old.at}) have one new key`);
        }
        this.new_of.set(old_key, { key: new_key, at });
        this.old_of.set(new_key, { key: old_key, at });
    }

    /** Ticks whose state an earlier tick had too */
    public get repeats(): number {
        return this.ticks - this.new_of.size;
    }
}

/** Ticks of the clocks of the runs, and between two comparisons of what changes each key */
const PERIOD = 120;

/** Every component of every archetype of a context, with the inserter it belongs to where it is an inserter's (as steady-state.test.ts walks them) */
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

const ownerOf = (component: object): string => component.constructor === Object ? "inserter" : component.constructor.name;

/** Every field that holds a plain value: references left null too, which neither key reads */
const plainFields = (component: object): string[] => Object.entries(component)
    .filter(([, value]) => value === null || (typeof value !== "object" && typeof value !== "function"))
    .map(([name]) => name);

/** Another value of the field's kind: for an empty hand, one of what it carries; else the next number, the other flag, another text, a number for none */
function changed(owner: string, field: string, value: unknown, inserter: InserterArchetype | undefined): unknown {
    if (owner === "inserter" && field === "held_item") {
        return { item_name: [...inserter!.inserter_state.inserter.filtered_items][0], quantity: 1 };
    }
    switch (typeof value) {
        case "number": return value + 1;
        case "boolean": return !value;
        case "string": return `${value}-changed`;
        default: return 1;
    }
}

/**
 * At the state a run is in: every field with a plain value of every component changed in turn, and what the components
 * keep in objects (inventories, bars, the carry, a hand, the pickup arm, the supply gates), each set back after: the old
 * key and the new one change together or not at all, so they depend on the same fields. `DrillState.status` is left
 * out: the old key read it and the new one does not, and nothing writes it (P4 D14), which `run` checks at every tick.
 */
function differencesAt(context: SimulationContext, at: string, into: string[]): void {
    const old_base = oldSimulationStateKey(context);
    const new_base = simulationStateKey(context);
    const compare = (what: string, change: () => void, restore: () => void) => {
        change();
        const old_changed = oldSimulationStateKey(context) !== old_base;
        const new_changed = simulationStateKey(context) !== new_base;
        restore();
        if (old_changed !== new_changed) {
            into.push(`${at}: ${what} changes the ${old_changed ? "old" : "new"} key only`);
        }
    };
    /** One more of an item an inventory has a record of, then taken out again */
    const oneMore = (what: string, inventory: { export(): Record<string, number>; addQuantity(item: string, n: number): void; removeQuantity(item: string, n: number): void }) => {
        const [item] = Object.keys(inventory.export());
        if (item !== undefined) {
            compare(what, () => inventory.addQuantity(item, 1), () => inventory.removeQuantity(item, 1));
        }
    };
    /** A number in a record changed, then set back; one below 0 (a carry slot never written) to a carry */
    const nudged = (what: string, record: Record<string, number>, field: string) => {
        const before = record[field];
        compare(what, () => { record[field] = before < 0 ? 0.25 : before + 0.125; }, () => { record[field] = before; });
    };

    for (const { component, inserter } of componentsOf(context)) {
        const owner = ownerOf(component);
        const record = component as Record<string, unknown>;
        for (const field of plainFields(component)) {
            if (owner === "DrillState" && field === "status") {
                continue;
            }
            const before = record[field];
            compare(`${owner}.${field}`, () => { record[field] = changed(owner, field, before, inserter); }, () => { record[field] = before; });
        }
    }
    for (const machine of context.machines) {
        const state = machine.machine_state;
        const id = state.entity_id.id;
        oneMore(`${id} ingredients and output`, state.inventoryState);
        oneMore(`${id} ingredients kept apart`, state.selfIngredients);
        oneMore(`${id} fuel slot`, state.fuelInventory);
        nudged(`${id} craft progress`, state.crafting.craftingProgress as unknown as Record<string, number>, "progress");
        nudged(`${id} productivity bar`, state.yield.bonusProgress as unknown as Record<string, number>, "progress");
        const carry = (state.yield as unknown as { carry: number[] }).carry;
        carry.forEach((_, slot) => nudged(`${id} carry ${slot}`, carry as unknown as Record<string, number>, String(slot)));
    }
    for (const inserter of context.inserters) {
        const state = inserter.inserter_state;
        const id = state.entity_id.id;
        oneMore(`${id} hand's totals`, state.inventoryState);
        const held = state.held_item;
        if (held !== null) {
            const quantity = held.quantity;
            compare(`${id} hand`, () => { held.quantity = quantity + 1; }, () => { held.quantity = quantity; });
        }
        const arm = state.pickup_arm;
        if (arm !== undefined) {
            const other = arm.clone();
            other.tryCollect(context.tick_provider.getCurrentTick() + 1, 1_000, true);
            compare(`${id} pickup arm`, () => { state.pickup_arm = other; }, () => { state.pickup_arm = arm; });
        }
    }
    for (const drill of context.drills) {
        const id = drill.drill_state.entity_id.id;
        oneMore(`${id} held`, drill.drill_state.held.inventoryState);
        nudged(`${id} bonus bar`, (drill.mining as unknown as { bonus: Record<string, number> }).bonus, "bar");
    }
    const states = context.state_registry.getAllStates();
    for (const gated of [...states.filter(EntityState.isBelt), ...states.filter(ContainerStorage.is)]) {
        const [item] = Object.keys(gated.inventoryState.export());
        if (item !== undefined) {
            compare(`${gated.entity_id.id} withholds`, () => gated.supply.withheld.add(item), () => gated.supply.withheld.delete(item));
        }
    }
    if (oldSimulationStateKey(context) !== old_base || simulationStateKey(context) !== new_base) {
        into.push(`${at}: a change was not set back`);
    }
}

/**
 * Runs `ticks` ticks of the context, pairing the old key and the new one before each tick, and every `PERIOD` ticks
 * comparing what changes each (`differencesAt`)
 */
function run(context: SimulationContext, ticks: number, pairing: Pairing, run_name: string): void {
    const simulation = new SimulationTick(context);
    for (let count = 0; count < ticks; count++) {
        const at = `${run_name}, tick ${context.tick_provider.getCurrentTick()}`;
        pairing.add(oldSimulationStateKey(context), simulationStateKey(context), at);
        if (count % PERIOD === PERIOD - 1) {
            differencesAt(context, at, pairing.differences);
        }
        for (const drill of context.drills) {
            if (drill.drill_state.status !== DrillStatus.WORKING) {
                pairing.differences.push(`${at}: ${drill.drill_state.entity_id.id}'s state has a status written`);
            }
        }
        simulation.executeForTick();
    }
}

/** A clock of the game of `PERIOD` ticks, the `index`th entity's window a third of the period, started at its own tick */
function clockOf(context: SimulationContext, index: number): EnableControl {
    const start = (index * 23) % PERIOD;
    return EnableControl.clocked({
        periodDuration: Duration.ofTicks(PERIOD),
        enabledRanges: start + PERIOD / 3 < PERIOD
            ? [OpenRange.from(start, start + PERIOD / 3)]
            : [OpenRange.from(start, PERIOD - 1), OpenRange.from(0, start + PERIOD / 3 - PERIOD)],
        tickProvider: context.tick_provider,
        is_game_clock: true,
        decider_build_order: index,
    });
}

const NEVER: EnableControl = { isEnabled: () => false, isEnabledIn: () => false, is_game_clock: true };

const SAMPLES = {
    AGRICULTURAL_SCIENCE: ConfigPaths.AGRICULTURAL_SCIENCE,
    REAL_OWNER_CAR: ConfigPaths.REAL_OWNER_CAR,
    LOW_DENSITY_STRUCTURE: ConfigPaths.LOW_DENSITY_STRUCTURE,
    RECYCLING_SCRAP_SILO: ConfigPaths.RECYCLING_SCRAP_SILO,
    ELECTRIC_FURNACE: ConfigPaths.ELECTRIC_FURNACE,
    SAME_ITEM: GameFixturePaths.SAME_ITEM_CONFIG,
} as const;
type Sample = keyof typeof SAMPLES;

const configs = {} as Record<Sample, Config>;
beforeAll(async () => {
    for (const [sample, path] of Object.entries(SAMPLES)) {
        configs[sample as Sample] = await loadConfigFromFile(path);
    }
});

describe("the simulation's key, against the key it replaced", () => {
    // every tick of a run, of a run on clocks of the game that stop everything for good at the end, and of a run with
    // everything always enabled: the states the old key told apart and no others
    it.each(Object.keys(SAMPLES) as Sample[])("tells apart the same states in every tick of runs of %s", sample => {
        // one pairing across both contexts on purpose: they come from one config and have the same lines, so a key of one
        // is compared with the keys of the other too; a difference names its run and tick and the run and tick it was
        // paired with, so one across the two contexts shows as two run names
        const pairing = new Pairing();

        const always = SimulationContext.fromConfig(structuredClone(configs[sample]));
        run(always, 1_200, pairing, "always enabled");

        const clocked = SimulationContext.fromConfig(structuredClone(configs[sample]));
        clocked.useControls({ inserter: state => clockOf(clocked, state.inserter.entity_id.number), drill: state => clockOf(clocked, 100 + state.drill.entity_id.number) });
        run(clocked, 20 * PERIOD, pairing, "on clocks");
        // every hand finishes what it does, every machine its craft: the states repeat from there on
        clocked.useControls({ inserter: () => NEVER, drill: () => NEVER });
        run(clocked, 2 * PERIOD, pairing, "all disabled");

        expect(pairing.differences).toEqual([]);
        expect(pairing.ticks).toBe(1_200 + 22 * PERIOD);
        expect(pairing.repeats, "states seen again").toBeGreaterThan(0);
    });
});
