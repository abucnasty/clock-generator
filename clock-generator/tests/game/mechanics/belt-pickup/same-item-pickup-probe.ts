/** Raw positions sampled by the same-item fixture's probe.lua. Empty Lua arrays serialize as {}. */
interface ProbeStack { at: number; count: number; item: string }
interface ProbeLane { length: number; stacks: ProbeStack[] | Record<string, never> }
interface ProbeSample { tick: number; held: number; held_item?: string; enabled?: boolean; lanes: ProbeLane[] }
export interface SameItemPickupProbe { endpoint: string; stack_size: number; samples: ProbeSample[] }

const stacksOf = (lane: ProbeLane): ProbeStack[] => Array.isArray(lane.stacks) ? lane.stacks : [];
const modSpacing = (value: number) => (value % 8 + 8) % 8;
type Stack = { at: number; count: number };
const observed = (sample: ProbeSample): Stack[][] => sample.lanes.map(lane =>
    stacksOf(lane).map(stack => ({ at: Math.round(stack.at * 32), count: stack.count })));
const signature = (lanes: Stack[][]) => JSON.stringify(lanes.map(lane => lane.filter(stack => stack.count > 0)
    .map(stack => [stack.at, stack.count]).sort(([a], [b]) => a - b)));

/**
 * Test the physical rule independently of the simulator. Observe the first grab, phase and remaining stacks of
 * each uninterrupted hand, then predict every later grab and lane snapshot without resynchronizing to the game.
 * This does not claim to predict the arm's arrival, first-grab delay, or interrupted-hand resumption.
 * Ordinary runs discard the first 60 ticks; a staged first-hand experiment can explicitly include its startup.
 */
export function assessSameItemPickups(probe: SameItemPickupProbe, speed: number, nearLane: 1 | 2, minimumFirstGrabTick = 60,
    matchingLane?: 1 | 2) {
    const samples = probe.samples;
    const phases = [0, 1].map(lane => {
        const sample = samples.find(sample => stacksOf(sample.lanes[lane]).length > 0);
        if (!sample) throw new Error(`No observed stacks on lane ${lane + 1}`);
        return modSpacing(Math.round(stacksOf(sample.lanes[lane])[0].at * 32) + sample.tick * speed);
    });
    const replay = (first: number, last: number, order: number[]) => {
        const start = samples[first];
        const length = start.lanes[0].length * 32;
        let lanes = observed(start), held = start.held, farGrabs = 0, laneMismatches = 0;
        const grabs = [0];
        for (let step = 1; step < 100 && held < probe.stack_size; step++) {
            const tick = start.tick + step;
            lanes = lanes.map((lane, index) => {
                const moved = lane.map(stack => ({ ...stack, at: stack.at - speed })).filter(stack => stack.at >= 0);
                for (let at = length - speed; at < length; at++) {
                    if (modSpacing(at + tick * speed) === phases[index]) moved.push({ at, count: 4 });
                }
                return moved;
            });
            for (const index of order) {
                const stack = lanes[index].filter(stack => stack.count > 0).sort((a, b) => b.at - a.at)[0];
                if (!stack) continue;
                const quantity = Math.min(stack.count, probe.stack_size - held);
                stack.count -= quantity;
                held += quantity;
                grabs.push(step);
                if (index !== nearLane - 1) farGrabs++;
                break; // one stack total per tick, even when both lanes can supply the item
            }
            if (first + step <= last && signature(lanes) !== signature(observed(samples[first + step]))) laneMismatches++;
        }
        return { grabs, farGrabs, laneMismatches };
    };
    const result = {
        hands: 0, far_grabs: 0, legacy_missed_hands: 0, hand_patterns: new Set<string>(),
        differences: [] as { tick: number; actual: number[]; predicted: number[]; lane_mismatches: number }[],
    };
    let first: number | null = null, grabs: number[] = [];
    for (let index = 1; index < samples.length; index++) {
        const previous = samples[index - 1], current = samples[index];
        if (current.held === 0) { first = null; grabs = []; }
        if (current.held <= previous.held) continue;
        if (previous.held === 0) { first = index; grabs = []; }
        if (first === null) continue;
        grabs.push(current.tick - samples[first].tick);
        if (current.held !== probe.stack_size || samples[first].tick < minimumFirstGrabTick) continue;
        if (samples.slice(first - 1, index + 1).some(sample => sample.enabled === false)) continue;
        const predicted = replay(first, index, [nearLane - 1, 2 - nearLane].filter(lane => matchingLane === undefined || lane === matchingLane - 1));
        const legacy = replay(first, index, [0]);
        result.hands++;
        result.hand_patterns.add(grabs.join(","));
        result.far_grabs += predicted.farGrabs;
        if (JSON.stringify(grabs) !== JSON.stringify(legacy.grabs)) result.legacy_missed_hands++;
        if (JSON.stringify(grabs) !== JSON.stringify(predicted.grabs) || predicted.laneMismatches) {
            result.differences.push({ tick: samples[first].tick, actual: grabs, predicted: predicted.grabs, lane_mismatches: predicted.laneMismatches });
        }
        first = null;
        grabs = [];
    }
    return result;
}
