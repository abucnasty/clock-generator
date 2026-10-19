/** Experimental observation replay only; this is not the generator's backed-up supply model. */
interface ObservedStack {at: number; count: number; item: string}
interface ObservedLane {length: number; stacks: ObservedStack[] | Record<string, never>}
interface JammedSample {tick: number; held: number; held_item?: string; lanes: ObservedLane[]}
export interface JammedPickupReport {
    item: string; belt_speed: number; stack_size: number; samples: JammedSample[];
}
interface QueueStack {position: number; count: number; item: string}

/**
 * Seed two fully jammed trains once at the closed gate. Advance them continuously, including between hands.
 * Native arm arrival/drop boundaries are inputs; later stock and held quantities are independently predicted.
 * A finite look-ahead train extends past the maximum possible travel during the observed interval.
 */
export function replayJammedPickups(report: JammedPickupReport, seedTick = 64, preferredLane: 1 | 2 = 1) {
    const samples = report.samples.filter(sample => sample.tick >= seedTick);
    if (!samples.length || samples[0].tick !== seedTick) throw new Error("Missing closed-gate seed sample");
    if (samples[0].held) throw new Error("Closed-gate seed must have an empty hand");
    const speed = report.belt_speed * 256;
    const lookAhead = Math.ceil((samples[samples.length - 1].tick - seedTick) * speed / 64) + 16;
    const queues = samples[0].lanes.map(lane => {
        const stock = Array.isArray(lane.stacks) ? lane.stacks : [];
        const expected = Array.from({length: lane.length * 4}, (_, index) => index * 64);
        if (JSON.stringify(stock.map(stack => Math.round(stack.at * 256))) !== JSON.stringify(expected)) {
            throw new Error("Seed must be a fully compressed ordinary exposed lane");
        }
        if (!stock.length || stock.some(stack => stack.count !== 4 || stack.item !== stock[0].item)) {
            throw new Error("Replay assumes one item per lane in full four-item stacks");
        }
        return Array.from({length: lookAhead}, (_, index): QueueStack => ({position: index * 64, count: 4, item: stock[0].item}));
    });
    const visible = (lane: number) => queues[lane].filter(stack => stack.position < samples[0].lanes[lane].length * 256)
        .map(stack => [stack.position, stack.count, stack.item]);
    let held = 0, attempting = false, hands = 0;
    const differences: {tick: number; actual: number; predicted: number; lane_mismatches: number}[] = [];
    for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1], current = samples[index];
        if (current.tick !== previous.tick + 1) throw new Error("Replay needs consecutive native samples");
        for (const lane of queues) {
            for (let stack = 0; stack < lane.length; stack++) {
                lane[stack].position = Math.max(lane[stack].position - speed, stack ? lane[stack - 1].position + 64 : 0);
            }
        }
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
                const available = queues[lane].filter(stack => stack.item === report.item
                    && stack.position < current.lanes[lane].length * 256);
                const stack = available[available.length - 1];
                if (!stack) continue;
                const quantity = Math.min(stack.count, report.stack_size - held);
                stack.count -= quantity;
                held += quantity;
                if (!stack.count) queues[lane].splice(queues[lane].indexOf(stack), 1);
                break;
            }
        }
        let laneMismatches = 0;
        for (const [lane, observed] of current.lanes.entries()) {
            const stock = Array.isArray(observed.stacks) ? observed.stacks : [];
            const actual = stock.map(stack => [Math.round(stack.at * 256), stack.count, stack.item]);
            if (JSON.stringify(visible(lane)) !== JSON.stringify(actual)) laneMismatches++;
        }
        if (held !== current.held || laneMismatches) differences.push({tick: current.tick, actual: current.held,
            predicted: held, lane_mismatches: laneMismatches});
    }
    // hands counts observed first-grab windows, including a final partial hand at the capture boundary.
    return {hands, samples: samples.length - 1, differences};
}
