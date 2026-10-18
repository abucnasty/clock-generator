import assert from "../common/assert";

export interface SplitterStack {
    id: number;
    position: number;
    item: string;
    count: number;
}

/** Finite routing kernel for the calibrated north-input, right-priority turbo splitter.
 * The north output drains freely; the south pickup port has no continuation.
 * Positions use 1/256 tile units. Feeders and consumers are explicit external boundaries.
 * Config/capture support must remain disabled until those boundaries are modeled and verified too. */
export class TurboSplitterSupply {
    private readonly lines: SplitterStack[][];

    constructor(initial: readonly (readonly SplitterStack[])[]) {
        assert(initial.length === 8, "A turbo splitter has eight transport lines");
        assert(initial[2].length === 0 && initial[3].length === 0, "South-input splitter routing is not calibrated");
        const ids = new Set<number>();
        initial.forEach((line, index) => {
            let previous = -64;
            for (const stack of line) {
                assert(Number.isInteger(stack.position) && stack.position >= 0 && stack.position < (index < 4 ? 179 : 128),
                    "Splitter stock must lie on its calibrated transport line");
                assert(stack.position - previous >= 64, "Splitter stock must preserve stack spacing");
                assert(Number.isInteger(stack.count) && stack.count > 0 && stack.count <= 4, "Splitter stacks hold at most four items");
                assert(!ids.has(stack.id), "Splitter stock identities must be unique");
                ids.add(stack.id);
                previous = stack.position;
            }
        });
        this.lines = initial.map(line => line.map(stack => ({...stack})));
    }

    /** Advance once before inserters withdraw. Rejected feeder heads remain upstream.
     * Accepted IDs and departures allow a network to conserve stock at these boundaries. */
    public advance(upstream: readonly (readonly SplitterStack[])[]): {accepted: number[]; departed: SplitterStack[][]} {
        assert(upstream.length === 2, "North input supply needs two upstream lanes");
        const departed: SplitterStack[][] = [[], []];
        for (let index = 4; index < 8; index++) {
            moveLine(this.lines[index], index < 6);
            if (index < 6) departed[index - 4] = this.lines[index].filter(stack => stack.position < 0).map(stack => ({...stack}));
            this.lines[index] = this.lines[index].filter(stack => stack.position >= 0);
        }
        const accepted: number[] = [];
        for (let lane = 0; lane < 2; lane++) {
            const input = this.lines[lane];
            if (input[0]?.position < 32) {
                const preferred = this.lines[lane + 6];
                if (!this.route(input, preferred, input[0].position + 45) && input[1]?.position < 96) {
                    this.route(input, this.lines[lane + 4], input[1].position - 19);
                }
            }
            moveLine(input, false);
            const incoming = upstream[lane][0];
            if (incoming && incoming.position < 32) {
                assert(Number.isInteger(incoming.position) && incoming.position >= 0, "Upstream position must be a nonnegative integer");
                const position = Math.max(179 + incoming.position - 32, (input.at(-1)?.position ?? -Infinity) + 64);
                if (position < 179) {
                    assert(!this.lines.some(line => line.some(stack => stack.id === incoming.id)), "An upstream stack cannot already be in the splitter");
                    assert(Number.isInteger(incoming.count) && incoming.count > 0 && incoming.count <= 4, "Splitter arrivals hold at most four items");
                    input.push({...incoming, position});
                    accepted.push(incoming.id);
                }
            }
        }
        return {accepted, departed};
    }

    /** Preferred physical lane first, upstream-most reachable items first within each lane. */
    public availableItems(preferredLane: 1 | 2): string[] {
        return [...new Set(this.pickupLines(preferredLane).flatMap(line => [...line].reverse().map(stack => stack.item)))];
    }

    /** One stack per call. The inserter controls its action budget and destination eligibility. */
    public take(item: string, capacity: number, preferredLane: 1 | 2): number {
        if (capacity <= 0) return 0;
        for (const line of this.pickupLines(preferredLane)) {
            let index = line.length - 1;
            while (index >= 0 && line[index].item !== item) index--;
            if (index < 0) continue;
            const stack = line[index];
            const quantity = Math.min(stack.count, capacity);
            stack.count -= quantity;
            if (stack.count === 0) line.splice(index, 1);
            return quantity;
        }
        return 0;
    }

    public snapshot(): SplitterStack[][] {
        return this.lines.map(line => line.map(stack => ({...stack})));
    }

    /** Observation IDs do not affect future routing, selection or stock movement. */
    public stateKey(): string {
        return this.lines.map(line => line.map(stack => `${stack.position}:${stack.item}:${stack.count}`).join(",")).join("|");
    }

    private pickupLines(preferredLane: 1 | 2): SplitterStack[][] {
        return preferredLane === 1 ? [this.lines[6], this.lines[7]] : [this.lines[7], this.lines[6]];
    }

    private route(input: SplitterStack[], output: SplitterStack[], entry: number): boolean {
        const position = Math.max(entry, (output.at(-1)?.position ?? -Infinity) + 64);
        if (position >= 128) return false;
        output.push({...input.shift()!, position});
        return true;
    }
}

function moveLine(stacks: SplitterStack[], open: boolean): void {
    let ahead = open ? -Infinity : -64;
    for (const stack of stacks) {
        stack.position = Math.min(stack.position, Math.max(stack.position - 32, ahead + 64));
        ahead = stack.position;
    }
}
