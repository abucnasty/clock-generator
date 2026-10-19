import {BeltSpeed} from "../entities/belt";
import {BeltPickupSupplyProfile} from "../config/schema";
import {BeltPickupStock} from "./belt-pickup-stock";
import {BeltSideFeedTraffic} from "./belt-side-feed-traffic";

/** A backed-up receiving tile replenished through one perpendicular lane, rather than through its upstream end. */
export class SideFedPickupLane implements BeltPickupStock {
    public readonly traffic: BeltSideFeedTraffic;

    constructor(belt_speed: BeltSpeed, stack_size: number, profile: Exclude<BeltPickupSupplyProfile, "through">) {
        const origin = profile === "side-inner" ? "inner" : "outer";
        this.traffic = new BeltSideFeedTraffic({belt_speed, streams: {[origin]: {ingredient: "stock", stack_size}},
            downstream_tiles: 0, outlet: "closed"}, true);
    }

    public peek(tick: number): {position: number; count: number} | undefined {
        const stack = this.snapshot(tick).at(-1);
        return stack && {position: stack[0], count: stack[1]};
    }

    public take(tick: number, capacity: number): number {return this.traffic.take(tick, "stock", capacity);}
    public hasTakenAt(tick: number): boolean {return this.traffic.hasTakenAt(tick);}
    public stateKey(tick: number): string {
        this.traffic.advanceTo(tick);
        return this.traffic.stateKey(tick);
    }
    public snapshot(tick: number): readonly (readonly [number, number])[] {
        this.traffic.advanceTo(tick);
        return this.traffic.snapshot().stock.filter(stack => stack.position >= 0 && stack.position < 256)
            .map(stack => [stack.position, stack.count] as const);
    }
}
