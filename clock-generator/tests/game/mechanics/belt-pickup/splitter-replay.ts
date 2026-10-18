/** Experimental replay, not a supported production model. Positions are in 1/256 tile units.
 * Only the measured eastbound, north-input, right-priority turbo layout is represented here.
 * Feeder arrivals and consumer withdrawals are external boundary events, not routing predictions. */
export interface SplitterStack {id: number; position: number; item: string; count: number}
export interface SplitterBoundary {
    upstream: SplitterStack[][];
    take?: {item: string; count: number};
}

export function advanceRightPrioritySplitter(previous: SplitterStack[][], boundary: SplitterBoundary): SplitterStack[][] {
    const lines = structuredClone(previous);
    // Output movement precedes routing. The north output drains; the south endpoint is locally blocked.
    for (let index = 4; index < 8; index++) {
        moveLine(lines[index], index < 6);
        lines[index] = lines[index].filter(stack => stack.position >= 0);
    }
    for (let lane = 0; lane < 2; lane++) {
        const input = lines[lane];
        if (input[0]?.position < 32) {
            for (const output of [lines[lane + 6], lines[lane + 4]]) {
                if (output.length === 0 || output.at(-1)!.position <= 0) {
                    output.push({...input.shift()!, position: 64});
                    break;
                }
            }
        }
        moveLine(input, false);
        const incoming = boundary.upstream[lane][0];
        if (incoming && incoming.position < 32) {
            const position = 179 + incoming.position - 32;
            if (!input.length || position - input.at(-1)!.position >= 64) input.push({...incoming, position});
        }
    }
    // Withdraw from the upstream-most stack. The tested ingredients occupy distinct output lanes.
    const take = boundary.take;
    if (take) {
        const line = lines.slice(6).find(line => line.at(-1)?.item === take.item);
        const stack = line?.at(-1);
        if (!stack || stack.count < take.count) throw new Error("Replay cannot supply the observed withdrawal");
        stack.count -= take.count;
        if (!stack.count) line!.pop();
    }
    return lines;
}

function moveLine(stacks: SplitterStack[], open: boolean): void {
    let ahead = open ? -Infinity : -64;
    for (const stack of stacks) {
        stack.position = Math.min(stack.position, Math.max(stack.position - 32, ahead + 64));
        ahead = stack.position;
    }
}
