import { Recording } from "../verification/recording";

/** A few lines per recording that show whether the build ran: what each machine finished and each inserter moved */
export function summarizeRecording(recording: Recording): string[] {
    const lines: string[] = [];
    const period = recording.clock ? recording.clock.values.reduce((max, value) => Math.max(max, value), 0) + 1 : null;
    lines.push(`${recording.sample_count} ticks from game tick ${recording.start_game_tick}`
        + (period ? `, clock counts to ${period}` : ", no clock")
        + (recording.stop_reason ? ` (${recording.stop_reason})` : ""));

    for (const machine of recording.machines) {
        const finished = machine.samples.products_finished;
        const products = finished.length > 0 ? finished[finished.length - 1] - finished[0] : 0;
        const statuses = Array.from(new Set(machine.samples.status.map(([, status]) => status)));
        lines.push(`machine ${machine.id} ${machine.recipe}: ${products} products finished, status ${statuses.join(", ")}`);
    }

    for (const inserter of recording.inserters) {
        const held = inserter.samples.held_count;
        let swings = 0;
        let moved = 0;
        for (let i = 1; i < held.length; i++) {
            // the hand empties at the drop; a partial drop into a full sink still counts as items moved
            if (held[i] < held[i - 1]) {
                moved += held[i - 1] - held[i];
                swings += held[i] === 0 ? 1 : 0;
            }
        }
        const items = Array.from(new Set(inserter.samples.held_item.map(([, item]) => item).filter(Boolean)));
        lines.push(`inserter ${inserter.id} ${inserter.source.type} ${inserter.source.id} -> ${inserter.sink.type} ${inserter.sink.id}: `
            + `${moved} items in ${swings} swings` + (items.length > 0 ? ` (${items.join(", ")})` : ""));
    }
    return lines;
}
