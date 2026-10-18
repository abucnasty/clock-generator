import {SplitterStack, TurboSplitterSupply} from "../../../../src/state/turbo-splitter-supply";
export type {SplitterStack} from "../../../../src/state/turbo-splitter-supply";

export interface SplitterBoundary {
    upstream: SplitterStack[][];
    take?: {item: string; count: number};
}

/** Adapter for native boundary observations; production stock movement and withdrawal are predicted. */
export function advanceRightPrioritySplitter(previous: SplitterStack[][], boundary: SplitterBoundary): SplitterStack[][] {
    const supply = new TurboSplitterSupply(previous);
    supply.advance(boundary.upstream);
    if (boundary.take) {
        const taken = supply.take(boundary.take.item, boundary.take.count, 1);
        if (taken !== boundary.take.count) throw new Error("Supply cannot satisfy the observed withdrawal");
    }
    return supply.snapshot();
}
