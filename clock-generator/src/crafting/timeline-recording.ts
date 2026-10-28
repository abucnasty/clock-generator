import { Entity, handSizeFor } from "../entities";
import { EntityState } from "../state";
import { factorioInserterState, factorioMachineState } from "../state/factorio-entity-state";
import { BurnerEnergy } from "../simulation/components/burner-energy";
import type { SimulationContext } from "./sequence/simulation-context";
import { ContainerStorage } from "../simulation/components/container-storage";

export type TimelineValue = number | string;
/** Step changes, including the initial value at tick 0. Values hold until the next change. */
export interface TimelineSeries {
    id: string;
    label: string;
    group: "inventory" | "progress" | "hand" | "state" | "fuel" | "production";
    unit: "items" | "items/s" | "%" | "MJ" | "count" | "state" | "enabled";
    item?: string;
    /** Insertion/block threshold, rather than necessarily the physical capacity of the inventory. */
    limit?: number;
    ticks: number[];
    values: TimelineValue[];
}
export interface TimelineEntity {
    id: string;
    type: "machine" | "inserter" | "drill" | "belt" | "chest";
    recipe?: string;
    items: string[];
    source?: string;
    sink?: string;
    signals: TimelineSeries[];
    note?: string;
}
export interface TimelineEvent {
    tick: number;
    entity_id: string;
    kind: "pickup" | "drop" | "craft-start" | "craft-complete" | "productivity-payout" | "produce";
    amount: number;
    item?: string;
    source?: string;
    sink?: string;
}
export interface TimelineRecording {
    version: 1;
    mode: "clock" | "plan";
    /** Tick 0 is the baseline immediately after preparation/warm-up (and the settling asked for); tick n is after simulated tick n. */
    start_tick: 0;
    end_tick: number;
    period_ticks: number;
    requested_ticks: number;
    ticks_before_recording: number;
    ticks_per_second: 60;
    copies: number;
    truncated: boolean;
    entities: TimelineEntity[];
    events: TimelineEvent[];
}
export interface TimelineRecordingOptions {
    period_ticks: number;
    max_ticks?: number;
    max_points?: number;
    /**
     * Periods the build runs from its cold start before the recorded period, where more than its warm-up: the recording
     * then shows a settled period (the long run of the clock judges the build from one), not the first after warm-up.
     */
    settle_periods?: number;
}

type ReadSignal = { signal: TimelineSeries; read: () => TimelineValue };
type WatchCounter = { read: () => number; before: number; event: Omit<TimelineEvent, "tick" | "amount">; item?: () => string | undefined };

/** Optional observer only: no changes to inventory, controls, counters or simulation order. */
export class TimelineRecorder {
    private readonly reads: ReadSignal[] = [];
    private readonly counters: WatchCounter[] = [];
    private readonly entities: TimelineEntity[] = [];
    private readonly events: TimelineEvent[] = [];
    private readonly hands = new Map<string, string>();
    private points = 0;
    private tick = 0;
    private clipped = false;

    constructor(private readonly context: SimulationContext, private readonly options: TimelineRecordingOptions) {
        for (const state of context.state_registry.getAllStates()) this.addEntity(state);
        // The initial snapshot is not a simulated event; counters are measured relative to this baseline.
        this.sample(0);
    }

    private signal(entity: TimelineEntity, details: Omit<TimelineSeries, "ticks" | "values">, read: () => TimelineValue): void {
        const signal = { ...details, ticks: [], values: [] };
        entity.signals.push(signal);
        this.reads.push({ signal, read });
    }

    private count(read: () => number, event: WatchCounter["event"], item?: WatchCounter["item"]): void {
        this.counters.push({ read, before: read(), event, item });
    }

    private addEntity(state: EntityState): void {
        const id = state.entity_id.id;
        const model = this.context.entity_registry.getEntityByIdOrThrow(state.entity_id);
        const type = EntityState.isMachine(state) ? "machine" : EntityState.isInserter(state) ? "inserter"
            : EntityState.isDrill(state) ? "drill" : EntityState.isBelt(state) ? "belt" : "chest";
        const entity: TimelineEntity = { id, type, items: [], signals: [] };
        this.entities.push(entity);
        const add = (details: Omit<TimelineSeries, "ticks" | "values">, read: () => TimelineValue) => this.signal(entity, details, read);
        if (EntityState.isMachine(state)) {
            const machine = state.machine;
            entity.recipe = machine.metadata.recipe.name;
            entity.items = machine.outputs.map(output => output.item_name);
            for (const input of machine.inputs.values()) add({ id: `input:${input.item_name}`, label: "Ingredient", group: "inventory", unit: "items", item: input.item_name, limit: input.automated_insertion_limit.quantity }, () => state.ingress.ingredientQuantity(input.item_name));
            for (const output of machine.outputs) add({ id: `output:${output.item_name}`, label: "Output", group: "inventory", unit: "items", item: output.item_name, limit: output.outputBlock.ingredients_blocked_at }, () => state.inventoryState.getQuantity(output.item_name));
            add({ id: "state", label: "Machine state", group: "state", unit: "state" }, () => factorioMachineState(state));
            add({ id: "craft", label: "Craft progress", group: "progress", unit: "%", limit: 100 }, () => state.craftingProgress.progress * 100);
            add({ id: "bonus", label: "Productivity progress", group: "progress", unit: "%", limit: 100 }, () => state.bonusProgress.progress * 100);
            const madeBeforeRecording = state.totalCrafted;
            add({ id: "produced", label: "Main product made since tick 0", group: "production", unit: "items", item: machine.output.item_name }, () => state.totalCrafted - madeBeforeRecording);
            add({ id: "pending", label: "Products awaiting output room", group: "production", unit: "items", item: machine.output.item_name }, () => state.pendingOutput);
            const energy = state.energy;
            if (energy instanceof BurnerEnergy) {
                const fuel = energy.fuel_slot;
                add({ id: "fuel", label: "Fuel slot", group: "fuel", unit: "items", item: fuel.fuel.item_name, limit: fuel.automated_insertion_limit }, () => state.fuelInventory.getQuantity(fuel.fuel.item_name));
                add({ id: "burning", label: "Burning fuel remaining", group: "fuel", unit: "MJ" }, () => energy.energy_remaining_mj);
            }
            this.count(() => state.craftsStarted, { entity_id: id, kind: "craft-start" });
            this.count(() => state.craftCount, { entity_id: id, kind: "craft-complete" });
            this.count(() => state.productsFinished - state.craftCount, { entity_id: id, kind: "productivity-payout" });
            this.count(() => state.totalCrafted, { entity_id: id, kind: "produce", item: machine.output.item_name });
        } else if (EntityState.isInserter(state)) {
            const inserter = state.inserter;
            entity.source = inserter.source.entity_id.id;
            entity.sink = inserter.sink.entity_id.id;
            entity.items = [...inserter.filtered_items];
            this.hands.set(id, state.held_item?.item_name ?? "");
            add({ id: "state", label: "Inserter state", group: "state", unit: "state" }, () => factorioInserterState(state, this.context.state_registry.getSinkStateOrThrow(state.entity_id)));
            add({ id: "enabled", label: "Circuit enabled", group: "state", unit: "enabled" }, () => state.enabled ? 1 : 0);
            add({ id: "hand", label: "Items in hand", group: "hand", unit: "items", limit: Math.max(inserter.metadata.stack_size, ...entity.items.map(item => handSizeFor(inserter, item))) }, () => state.held_item?.quantity ?? 0);
            add({ id: "hand-item", label: "Item in hand", group: "hand", unit: "state" }, () => state.held_item?.item_name ?? "");
            this.count(() => state.items_picked_up, { entity_id: id, kind: "pickup", source: entity.source, sink: entity.sink }, () => state.held_item?.item_name);
            this.count(() => state.items_dropped, { entity_id: id, kind: "drop", source: entity.source, sink: entity.sink }, () => this.hands.get(id));
        } else if (EntityState.isDrill(state)) {
            entity.items = [state.drill.item.name];
            entity.sink = state.drill.sink_id.id;
            add({ id: "state", label: "Drill state", group: "state", unit: "state" }, () => state.status);
            add({ id: "buffer", label: "Mined items in buffer", group: "inventory", unit: "items", item: state.drill.item.name }, () => state.inventoryState.getQuantity(state.drill.item.name));
            entity.note = "The drill model does not simulate a mining-progress bar. Inspect its target inventory and enable windows.";
        } else if (ContainerStorage.is(state)) {
            entity.items = state.chest.getItemFilters();
            const constant = ContainerStorage.isConstant(state);
            for (const item of entity.items) add({ id: `stock:${item}`, label: constant ? "Configured supply" : "Contents", group: "inventory", unit: "items", item, ...(constant ? {} : { limit: state.getCapacity(item) }) }, () => state.getCurrentQuantity(item));
            if (ContainerStorage.isConstant(state)) entity.note = state.chest.remove_unfiltered_items
                ? (entity.items.length ? "Configured items are a constant supply. Unfiltered incoming items are removed." : "All incoming items are removed. This chest supplies no items.")
                : "Infinity chest contents are a configured supply, not a finite inventory.";
        } else if (Entity.isBelt(model)) {
            entity.items = model.lanes.map(lane => lane.ingredient_name);
            entity.note = "Input belts model a constant supply. Physical belt occupancy is not recorded; inspect connected pickups and deliveries.";
        }
    }

    private sample(tick: number): void {
        for (const { signal, read } of this.reads) {
            const value = read();
            if (signal.values.length === 0 || signal.values[signal.values.length - 1] !== value) {
                signal.ticks.push(tick);
                signal.values.push(value);
                this.points++;
            }
        }
    }

    public record(): void {
        if (this.clipped) return;
        // Reserve a whole tick, so clipping never leaves signals with different end times.
        if (this.tick >= (this.options.max_ticks ?? 24_000) || this.points + this.reads.length + this.counters.length > (this.options.max_points ?? 400_000)) {
            this.clipped = true;
            return;
        }
        this.tick++;
        this.sample(this.tick);
        for (const counter of this.counters) {
            const now = counter.read();
            const amount = now - counter.before;
            if (amount > 0) {
                this.events.push({ ...counter.event, tick: this.tick, amount, ...(counter.item ? { item: counter.item() } : {}) });
                this.points++;
            }
            counter.before = now;
        }
        for (const inserter of this.context.inserters) this.hands.set(inserter.inserter_state.entity_id.id, inserter.inserter_state.held_item?.item_name ?? "");
    }

    public recording(mode: "clock" | "plan", requested_ticks: number, ticks_before_recording: number, copies: number): TimelineRecording {
        return { version: 1, mode, start_tick: 0, end_tick: this.tick, period_ticks: this.options.period_ticks, requested_ticks,
            ticks_before_recording, ticks_per_second: 60, copies, truncated: this.clipped, entities: this.entities, events: this.events };
    }
}
