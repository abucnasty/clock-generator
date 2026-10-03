import { BeltConfig } from "../../config";
import { ItemName } from "../../data";
import assert from "../../common/assert";
import { BeltStackSize, isValidBeltStackSize } from "./belt-stack-size";
import { EntityId } from "../entity-id";
import { Entity } from "../entity";
import { Duration } from "../../data-types";
import Fraction, { fraction } from "fractionability";
import { BeltStrategy } from "../../common/entity-types";

export interface Lane {
    ingredient_name: ItemName;
    stack_size: BeltStackSize;
    /** Export belts only: items per second taken off this lane by consumers outside the config */
    consumption_per_second?: number;
}

export interface Belt extends Entity{
    readonly lanes: readonly Lane[]
    readonly belt_speed: BeltSpeed
    readonly strategy: BeltStrategy
}

export const BeltSpeed = {
    TRANSPORT_BELT: 15,
    FAST_TRANSPORT_BELT: 30,
    EXPRESS_TRANSPORT_BELT: 45,
    TURBO_TRANSPORT_BELT: 60
} as const;

export type BeltSpeed = typeof BeltSpeed[keyof typeof BeltSpeed];


function tilesPerSecond(belt_speed: BeltSpeed): Fraction {
    const ratio = fraction(belt_speed).divide(BeltSpeed.TRANSPORT_BELT)
    return fraction(1.875).multiply(ratio);
}

function secondsPerTile(belt_speed: BeltSpeed): Fraction {
    const tiles_per_second = tilesPerSecond(belt_speed);

    return fraction(1).divide(tiles_per_second)
}

function ticksPerTile(belt_speed: BeltSpeed): Fraction {
    const seconds_per_tile = secondsPerTile(belt_speed);
    return seconds_per_tile.multiply(60);
}

function ticksPerDrop(belt_speed: BeltSpeed): Fraction {
    // 4 item positions per belt tile
    return ticksPerTile(belt_speed).divide(4);
}

function initialBurstLength(belt_speed: BeltSpeed): number {
    // The number of consecutive drops at the start before regular spacing kicks in
    // When dropInterval < 4, we can fit 3 initial drops; otherwise 2 (by observation in factorio)
    const drop_interval = ticksPerDrop(belt_speed);
    return drop_interval.toDecimal() < 4 ? 3 : 2;
}

const drop_amount_cache = new Map<string, number>();

function amountToDropAtTick(belt_speed: BeltSpeed, stackSize: BeltStackSize, tick_index: number): number {
    const key = `${belt_speed}:${stackSize}:${tick_index}`;
    let amount = drop_amount_cache.get(key);
    if (amount === undefined) {
        amount = computeAmountToDropAtTick(belt_speed, stackSize, tick_index);
        drop_amount_cache.set(key, amount);
    }
    return amount;
}

function computeAmountToDropAtTick(belt_speed: BeltSpeed, stackSize: BeltStackSize, tick_index: number): number {
    const drop_interval = ticksPerDrop(belt_speed);
    const burst_length = initialBurstLength(belt_speed);
    
    // Initial burst phase: consecutive drops at ticks 0, 1, ..., burst_length-1
    if (tick_index < burst_length) {
        return stackSize;
    }
    
    // Regular phase: after the burst, drops continue at regular intervals
    // The burst handled burst_length drops at ticks 0..burst_length-1
    // 
    // After burst, we need to find the regular drop pattern.
    // Drop n (0-indexed) in a pure regular pattern would be at tick floor(n * drop_interval).
    // But the burst shifts everything.
    //
    // After the burst ends at tick (burst_length - 1), the next drops
    // follow a pattern where drop #(burst_length + k) for k >= 0 occurs at:
    //   first_aligned_tick + floor(k * drop_interval)
    // where first_aligned_tick is the first tick >= burst_length that aligns with the interval grid.
    //
    // The interval grid is defined by: tick is on grid if tick / drop_interval is an integer.
    // For fractional intervals, we check if tick_index equals floor(n * drop_interval) for some n.
    
    // Find the first "grid point" at or after burst_length
    // Grid point n is at tick floor(n * drop_interval)
    // We want smallest n such that floor(n * drop_interval) >= burst_length
    // This is: n = ceil(burst_length / drop_interval)
    
    const first_regular_n_fraction = fraction(burst_length).divide(drop_interval);
    const first_regular_n = Math.ceil(first_regular_n_fraction.toDecimal());
    
    // The first regular drop tick
    const first_regular_tick = Math.floor(fraction(first_regular_n).multiply(drop_interval).toDecimal());
    
    if (tick_index < first_regular_tick) {
        return 0;
    }
    
    // For tick_index >= first_regular_tick, check if it's a drop tick
    // Drop tick at grid point n is floor(n * drop_interval)
    // We check if there exists n >= first_regular_n such that floor(n * drop_interval) == tick_index
    
    // Find the approximate n for this tick
    const approx_n = fraction(tick_index).divide(drop_interval).toDecimal();
    
    // Check n values around approx_n
    for (let n = Math.floor(approx_n); n <= Math.ceil(approx_n) + 1; n++) {
        if (n >= first_regular_n) {
            const drop_tick = Math.floor(fraction(n).multiply(drop_interval).toDecimal());
            if (drop_tick === tick_index) {
                return stackSize;
            }
        }
    }
    
    return 0;
}

function durationToDropItemAmount(belt_speed: BeltSpeed, belt_stack_size: BeltStackSize, item_amount: number): Duration {
    let current_amount = item_amount;

    let ticks = 0;

    while(current_amount > 0) {
        const amount_dropped = amountToDropAtTick(belt_speed, belt_stack_size, ticks);
        current_amount -= amount_dropped;
        ticks += 1;
    }

    return Duration.ofTicks(ticks);
}


export class BeltBuilder {
    private lanes: Lane[] = [];
    private belt_speed?: BeltSpeed;
    private strategy: BeltStrategy = BeltStrategy.NORMAL;
    private id?: EntityId;

    constructor() { }

    setId(id: number): BeltBuilder {
        this.id = EntityId.forBelt(id);
        return this;
    }

    addLane(ingredient_name: ItemName, stack_size: BeltStackSize, consumption_per_second?: number): BeltBuilder {
        this.lanes.push(consumption_per_second === undefined
            ? { ingredient_name, stack_size }
            : { ingredient_name, stack_size, consumption_per_second });
        return this;
    }

    setBeltSpeed(belt_speed: BeltSpeed): BeltBuilder {
        this.belt_speed = belt_speed;
        return this;
    }

    setStrategy(strategy: BeltStrategy): BeltBuilder {
        this.strategy = strategy;
        return this;
    }

    build(): Belt {
        assert(this.belt_speed !== undefined, "Belt speed must be set before building a Belt");
        assert(this.lanes.length > 0, "At least one lane must be added before building a Belt");
        assert(this.id !== undefined, "Belt id must be set before building a Belt");
        return {
            entity_id: this.id!,
            lanes: this.lanes,
            belt_speed: this.belt_speed!,
            strategy: this.strategy,
        };
    }
}

function fromConfig(config: BeltConfig): Belt {
    const builder = new BeltBuilder().setId(config.id).setStrategy(config.strategy ?? BeltStrategy.NORMAL)

    switch(config.type) {
        case "express-transport-belt":
            builder.setBeltSpeed(BeltSpeed.EXPRESS_TRANSPORT_BELT);
            break;
        case "fast-transport-belt":
            builder.setBeltSpeed(BeltSpeed.FAST_TRANSPORT_BELT);
            break;
        case "turbo-transport-belt":
            builder.setBeltSpeed(BeltSpeed.TURBO_TRANSPORT_BELT);
            break;
        case "transport-belt":
            builder.setBeltSpeed(BeltSpeed.TRANSPORT_BELT);
            break;
    }

    for (const lane of config.lanes) {
        assert(isValidBeltStackSize(lane.stack_size), `Invalid stack size: ${lane.stack_size}`);
        builder.addLane(lane.ingredient, lane.stack_size as BeltStackSize, "consumption_per_second" in lane ? lane.consumption_per_second : undefined);
    }
    return builder.build();
}

function createSingleLaneBelt(beltSpeed: BeltSpeed, ingredient: ItemName, stackSize: BeltStackSize): BeltBuilder {
    return new BeltBuilder()
        .setBeltSpeed(beltSpeed)
        .addLane(ingredient, stackSize)
}

function createDoubleLaneBelt(beltSpeed: BeltSpeed, ingredient: ItemName, stackSize: BeltStackSize): BeltBuilder {
    const builder = new BeltBuilder().setBeltSpeed(beltSpeed);
    builder.addLane(ingredient, stackSize);
    builder.addLane(ingredient, stackSize);
    return builder
}

function createSplitLaneBelt(beltSpeed: BeltSpeed, ingredientA: ItemName, ingredientB: ItemName, stackSize: BeltStackSize): BeltBuilder {
    const builder = new BeltBuilder().setBeltSpeed(beltSpeed);
    builder.addLane(ingredientA, stackSize);
    builder.addLane(ingredientB, stackSize);
    return builder
}

export const buildersForBeltSpeed = (beltSpeed: BeltSpeed) => ({
    createSingleLaneBelt: (
        ingredient: ItemName,
        stackSize: BeltStackSize = BeltStackSize.FOUR,
    ) => createSingleLaneBelt(beltSpeed, ingredient, stackSize),
    createDoubleLaneBelt: (
        ingredient: ItemName,
        stackSize: BeltStackSize = BeltStackSize.FOUR,
    ) => createDoubleLaneBelt(beltSpeed, ingredient, stackSize),
    createSplitLaneBelt: (
        ingredientA: ItemName,
        ingredientB: ItemName,
        stackSize: BeltStackSize = BeltStackSize.FOUR,
    ) => createSplitLaneBelt(beltSpeed, ingredientA, ingredientB, stackSize),
});


export const Belt = {
    turbo_transport_belt: buildersForBeltSpeed(BeltSpeed.TURBO_TRANSPORT_BELT),
    express_transport_belt: buildersForBeltSpeed(BeltSpeed.EXPRESS_TRANSPORT_BELT),
    fast_transport_belt: buildersForBeltSpeed(BeltSpeed.FAST_TRANSPORT_BELT),
    transport_belt: buildersForBeltSpeed(BeltSpeed.TRANSPORT_BELT),
    fromConfig: fromConfig,
    amountToDropAtTick: amountToDropAtTick,
    ticksPerTile: ticksPerTile,
    dropDuration: durationToDropItemAmount
}