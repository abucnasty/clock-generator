import { expandChangeList, Recording } from "../../../src/verification/recording";

/** Which of the inserters that take one product from one machine the game served first, counted over a recording */
export interface ServedFirst {
    /** The machine's id in the recording */
    machine_id: number;
    /** The unit numbers of its takers, in the order of the recording */
    takers: number[];
    /**
     * Ticks on which two or more takers waited at the machine with room in their hands after the tick before and the tick
     * shows who was served first, by the unit number of that one: one gained while another waiting with room did not, or
     * both gained and one filled its hand (the other took what was left)
     */
    first: Record<number, number>;
    /** Ticks on which every waiting taker filled its hand: it shows no order */
    undecided: number;
}

/**
 * What a recording shows of the order the game serves the takers of one machine in, machine by machine (only machines
 * two or more inserters take from). An inserter waits at the machine when its status in the sample before was
 * "waiting_for_source_items" and its hand had room.
 */
export function servedFirst(recording: Recording): ServedFirst[] {
    const n = recording.sample_count;
    const by_machine = new Map<number, Recording["inserters"]>();
    for (const inserter of recording.inserters) {
        if (inserter.source.type !== "machine") continue;
        by_machine.set(inserter.source.id, [...(by_machine.get(inserter.source.id) ?? []), inserter]);
    }
    const found: ServedFirst[] = [];
    for (const [machine_id, takers] of by_machine) {
        if (takers.length < 2) continue;
        const status = takers.map(it => expandChangeList(it.samples.status, n, ""));
        const held = takers.map(it => it.samples.held_count);
        const unit = takers.map(it => it.unit_number ?? it.id);
        const first: Record<number, number> = {};
        let undecided = 0;
        for (let tick = 1; tick < n; tick++) {
            const waiting = takers.flatMap((it, at) => status[at][tick - 1] === "waiting_for_source_items" && held[at][tick - 1] < it.stack_size ? [at] : []);
            if (waiting.length < 2) continue;
            const gained = waiting.filter(at => held[at][tick] > held[at][tick - 1]);
            let server: number | null = null;
            if (gained.length === 1) {
                server = gained[0];
            } else if (gained.length > 1) {
                const filled = gained.filter(at => held[at][tick] >= takers[at].stack_size);
                if (filled.length === 1) server = filled[0];
                else if (filled.length === gained.length) undecided++;
            }
            if (server !== null) first[unit[server]] = (first[unit[server]] ?? 0) + 1;
        }
        found.push({ machine_id, takers: unit, first, undecided });
    }
    return found;
}
