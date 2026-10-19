import {BeltSpeed} from "../../../../src/entities/belt";
import {BackedUpPickupLane} from "../../../../src/state/backed-up-pickup-lane";
interface ObservedStack {at: number; count: number; item: string}
interface ObservedLane {length: number; stacks: ObservedStack[] | Record<string, never>}
interface JammedSample {tick: number; held: number; held_item?: string; lanes: ObservedLane[]}
export interface JammedPickupReport {
    item: string; belt_speed: number; stack_size: number; samples: JammedSample[];
}

/**
 * Seed two fully jammed trains once at the closed gate. Advance them continuously, including between hands.
 * Native arm arrival/drop boundaries are inputs; later stock and held quantities are independently predicted.
 * Uses the production bounded queue; no later observed stock is fed back into that queue.
 */
export function replayJammedPickups(report: JammedPickupReport, seedTick = 64, preferredLane: 1 | 2 = 1) {
    const samples = report.samples.filter(sample => sample.tick >= seedTick);
    if (!samples.length || samples[0].tick !== seedTick) throw new Error("Missing closed-gate seed sample");
    if (samples[0].held) throw new Error("Closed-gate seed must have an empty hand");
    const speed = report.belt_speed * 480 as BeltSpeed;
    const laneItems: string[] = [];
    const queues = samples[0].lanes.map(lane => {
        const stock = Array.isArray(lane.stacks) ? lane.stacks : [];
        const expected = Array.from({length: lane.length * 4}, (_, index) => index * 64);
        if (JSON.stringify(stock.map(stack => Math.round(stack.at * 256))) !== JSON.stringify(expected)) {
            throw new Error("Seed must be a fully compressed ordinary exposed lane");
        }
        if (!stock.length || stock.some(stack => stack.count !== 4 || stack.item !== stock[0].item)) {
            throw new Error("Replay assumes one item per lane in full four-item stacks");
        }
        laneItems.push(stock[0].item);
        return new BackedUpPickupLane(speed, lane.length, 4);
    });
    const visible = (lane: number, tick: number) => queues[lane].snapshot(tick)
        .map(([position, count]) => [position, count, laneItems[lane]]);
    let held = 0, attempting = false, hands = 0;
    const differences: {tick: number; actual: number; predicted: number; lane_mismatches: number}[] = [];
    for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1], current = samples[index];
        if (current.tick !== previous.tick + 1) throw new Error("Replay needs consecutive native samples");
        if (current.held < previous.held) {
            held = Math.max(0, held - previous.held + current.held);
            attempting = false;
        }
        if (current.held > previous.held && previous.held === 0) {
            attempting = true;
            hands++;
        }
        if (attempting && held < report.stack_size) {
            for (const lane of [preferredLane - 1, 2 - preferredLane]) {
                if (laneItems[lane] !== report.item) continue;
                const quantity = queues[lane].take(current.tick, report.stack_size - held);
                if (!quantity) continue;
                held += quantity;
                break;
            }
        }
        let laneMismatches = 0;
        for (const [lane, observed] of current.lanes.entries()) {
            const stock = Array.isArray(observed.stacks) ? observed.stacks : [];
            const actual = stock.map(stack => [Math.round(stack.at * 256), stack.count, stack.item]);
            if (JSON.stringify(visible(lane, current.tick)) !== JSON.stringify(actual)) laneMismatches++;
        }
        if (held !== current.held || laneMismatches) differences.push({tick: current.tick, actual: current.held,
            predicted: held, lane_mismatches: laneMismatches});
    }
    // hands counts observed first-grab windows, including a final partial hand at the capture boundary.
    return {hands, samples: samples.length - 1, differences};
}
