/** A candidate rule for the turbo two-stream case; express is a falsification check, not production simulator support. */
interface MergeStack { id: number; at: number; count: number; item: string }
interface Lane { stacks: MergeStack[] | Record<string, never>; length: number }
interface MergeSample {
    tick: number; held: number; held_item?: string; lanes: Lane[]; downstream: Lane[];
    outlet_open?: boolean;
    feed: { lanes: (Lane & {count: number; full: boolean})[] };
}
interface Stock { id: number; position: number; item?: string }
const stacks = (lane: Lane): MergeStack[] => Object.values(lane.stacks);
const positions = (lane: Lane, offset = 0): Stock[] => stacks(lane).map(stack => ({id: stack.id, position: Math.round(stack.at * 256) + offset, item: stack.item}));
const ordered = (stock: Stock[]) => [...stock].sort((a, b) => a.position - b.position);

/** Try entry against the stock from the preceding observation. The one-spacing limit is a hypothesis. */
function shiftedMergeEntry(receiving: readonly number[], entry: number): number {
    let position = entry;
    for (const ahead of [...receiving].sort((a, b) => a - b)) {
        if (ahead <= position && position - ahead < 64) position = ahead + 64;
    }
    return position;
}

export function candidateMergeEntry(receiving: readonly number[], entry: number): number | undefined {
    const position = shiftedMergeEntry(receiving, entry);
    return position <= entry + 64 ? position : undefined;
}

/** Turbo calibration accepts integer shifts 89–95 and rejects 96 in this side-loading geometry. */
export function candidateTurboMergeEntry(receiving: readonly number[], entry: number): number | undefined {
    const position = shiftedMergeEntry(receiving, entry);
    return position < entry + 96 ? position : undefined;
}

/** Existing stock moves before arrivals join. Compressed followers may wait, but never move backwards. */
export function advanceMergeStock(stock: Stock[], speed = 32, end = -256, blocked = false): Stock[] {
    let ahead: number | undefined = blocked ? end - 64 : undefined;
    return ordered(stock).map(stack => {
        const position = Math.min(stack.position, Math.max(stack.position - speed, ahead === undefined ? -Infinity : ahead + 64));
        ahead = position;
        return {...stack, position};
    }).filter(stack => stack.position >= end);
}

/** Attribute actual withdrawals by ID conservation, independently of candidate acceptance decisions. */
export function observedMergeGrabs(samples: MergeSample[], receivingLane = 1) {
    const origins = new Map(samples.flatMap(sample => sample.feed.lanes.flatMap((lane, index) =>
        stacks(lane).map(stack => [stack.id, index + 1] as const))));
    return samples.slice(1).flatMap((sample, index) => {
        const previous = samples[index];
        if (sample.held <= previous.held) return [];
        const before = new Set([...stacks(previous.lanes[receivingLane]), ...previous.feed.lanes.flatMap(stacks)].map(stack => stack.id));
        const after = new Set([...stacks(sample.lanes[receivingLane]), ...stacks(sample.downstream[receivingLane]), ...sample.feed.lanes.flatMap(stacks)].map(stack => stack.id));
        const removed = [...before].filter(id => !after.has(id));
        if (removed.length !== 1 || sample.held - previous.held !== 4) throw new Error(`ambiguous withdrawal at ${sample.tick}`);
        return [{tick: sample.tick, id: removed[0], origin: origins.get(removed[0])}];
    });
}

export function assessTwoStreamMerge(samples: MergeSample[], speed = 32, entryRule = candidateMergeEntry, receivingLane = 1) {
    if (samples.length < 2) throw new Error("merge replay needs at least two observations");
    let stock = [...positions(samples[0].lanes[receivingLane]), ...positions(samples[0].downstream[receivingLane], -256)];
    const feeds = samples[0].feed.lanes.map(lane => positions(lane));
    const origins = new Map(feeds.flatMap((feed, index) => feed.map(stack => [stack.id, index + 1] as const)));
    // Arm arrival and destination handling are supplied observations, not inferred merge timing.
    const starts = new Set(samples.filter((sample, index) => index > 0 && sample.held > 0 && samples[index - 1].held === 0).map(sample => sample.tick));
    const drops = new Set(samples.filter((sample, index) => index > 0 && sample.held === 0 && samples[index - 1].held > 0).map(sample => sample.tick));
    let held = samples[0].held, active = false;
    let heldItem = samples[0].held_item;
    const errors: string[] = [];
    const grabs: {tick: number; id: number; origin: number | undefined; position: number}[] = [];
    const transfers: {tick: number; origin: number; id: number; position: number}[] = [];
    let attempts = 0, compressedGaps = 0, matchingPrefix = 0;
    let firstMismatch: {tick: number; receivingBefore: number[]; predictedReceiving: number[]; observedReceiving: number[]} | undefined;
    for (const sample of samples.slice(1)) {
        const errorsBefore = errors.length;
        const receiving = stock.filter(stack => stack.position >= 0).map(stack => stack.position);
        const end = -256 * sample.downstream[receivingLane].length;
        const advanced = advanceMergeStock(stock, speed, end, sample.outlet_open === false);
        const arrivals: Stock[] = [];
        for (const [index, feed] of feeds.entries()) {
            const lead = ordered(feed)[0];
            let entry: number | undefined;
            if (lead.position < speed) {
                attempts++;
                entry = entryRule(receiving, (index !== receivingLane ? 188 : 67) + lead.position);
                if (sample.outlet_open !== undefined && entry !== undefined && entry >= 256) entry = undefined;
            }
            const accepted = entry !== undefined;
            if (accepted) {
                // With a finite blocked outlet, an arrival cannot move through its downstream neighbor.
                const ahead = sample.outlet_open === undefined ? [] : stock.filter(stack => stack.position <= entry!)
                    .map(stack => advanced.find(moved => moved.id === stack.id)?.position ?? -Infinity);
                arrivals.push({id: lead.id, position: Math.max(entry! - speed, ...ahead.map(position => position + 64)), item: lead.item});
                transfers.push({tick: sample.tick, origin: index + 1, id: lead.id, position: entry!});
                feed.splice(feed.findIndex(stack => stack.id === lead.id), 1);
            }
            if (accepted || lead.position >= speed) for (const stack of feed) stack.position -= speed;
            const actualFeed = positions(sample.feed.lanes[index]);
            // Only external stack identities are supplied. Their refill positions and the number of slots
            // to refill come from the full-input assumption and this replay's own transfer decision.
            const refill = actualFeed.filter(stack => stack.id !== lead.id && !feed.some(known => known.id === stack.id));
            if (refill.length !== (accepted ? 1 : 0)) errors.push(`refill count at ${sample.tick}, lane ${index + 1}`);
            for (const stack of refill) {
                const position = Math.max(...feed.map(known => known.position)) + 64;
                feed.push({id: stack.id, position, item: lead.item});
                origins.set(stack.id, index + 1);
            }
            if (JSON.stringify(ordered(feed)) !== JSON.stringify(ordered(actualFeed))) errors.push(`feed at ${sample.tick}, lane ${index + 1}`);
        }
        if (sample.outlet_open !== undefined) {
            let ahead: number | undefined;
            for (const arrival of ordered(arrivals)) {
                arrival.position = Math.max(arrival.position, ahead === undefined ? -Infinity : ahead + 64);
                ahead = arrival.position;
            }
        }
        stock = [...advanced, ...arrivals];
        if (drops.has(sample.tick)) { held = 0; heldItem = undefined; active = false; }
        if (starts.has(sample.tick)) active = true;
        if (active && held < 16) {
            const reachable = stock.filter(stack => stack.position >= 0 && (!heldItem || stack.item === heldItem));
            if (reachable.length) {
                const taken = ordered(reachable).at(-1)!;
                stock.splice(stock.findIndex(stack => stack.id === taken.id), 1);
                grabs.push({tick: sample.tick, id: taken.id, origin: origins.get(taken.id), position: taken.position});
                heldItem = taken.item;
                held += 4;
            }
        }
        if (held !== sample.held) errors.push(`hand at ${sample.tick}`);
        if (held > 0 && heldItem !== sample.held_item) errors.push(`held item at ${sample.tick}`);
        const actualStock = [...positions(sample.lanes[receivingLane]), ...positions(sample.downstream[receivingLane], -256)];
        if (JSON.stringify(ordered(stock)) !== JSON.stringify(ordered(actualStock))) errors.push(`receiving/downstream stock at ${sample.tick}`);
        if (errors.length === 0) matchingPrefix++;
        if (errors.length > errorsBefore && !firstMismatch) firstMismatch = {
            tick: sample.tick, receivingBefore: [...receiving].sort((a, b) => a - b),
            predictedReceiving: ordered(stock).filter(stack => stack.position >= 0).map(stack => stack.position),
            observedReceiving: ordered(actualStock).filter(stack => stack.position >= 0).map(stack => stack.position),
        };
        const sorted = ordered(actualStock);
        compressedGaps += sorted.filter((stack, index) => index > 0 && stack.position - sorted[index - 1].position < 64).length;
    }
    return {errors, grabs, transfers, attempts, compressedGaps, matchingPrefix, firstMismatch, transitions: samples.length - 1};
}
