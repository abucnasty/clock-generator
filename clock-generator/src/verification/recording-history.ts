import { MachineStatus } from "../state";
import { CLOCK_TO_WINDOW_TICKS, expandChangeList, RecordedInserter, RecordedMachine, Recording, recordedClockPeriod } from "./recording";

export interface RecordedTransfer {
    item_name: string;
    /** Sample index of the first tick the hand held items */
    start_index: number;
    /** Sample index where the final pickup burst began (later than start_index when a partial stack was held across a disabled period) */
    pickup_index: number;
    /** Sample index of the first tick the hand was empty again */
    end_index: number;
    /** Clock value at pickup_index (sample index when there is no clock) */
    start_clock: number;
    /** Largest hand count during the transfer */
    amount: number;
    /** The hand was already holding items when the recording started */
    truncated_start: boolean;
    /** The hand was still holding items when the recording ended */
    truncated_end: boolean;
}

/** Clock value per sample, or the sample index itself without a clock */
export function clockValues(recording: Recording): number[] {
    return recording.clock?.values ?? Array.from({ length: recording.sample_count }, (_, i) => i);
}

/**
 * Position per sample in the period of the windows of the generator: the clock position of the sample less the ticks
 * the combinators of the windows are behind the clock (CLOCK_TO_WINDOW_TICKS), around the period. A swing at the
 * position a window opens in is at the tick that window enables its inserter. The sample index without a clock.
 */
export function windowPositions(recording: Recording): number[] {
    const positions = clockValues(recording);
    const period = recordedClockPeriod(recording);
    if (period === null) {
        return positions;
    }
    return positions.map(position => ((position - CLOCK_TO_WINDOW_TICKS) % period + period) % period);
}

/** Max ticks between hand count increases that still belong to the same pickup (belt pickups fill over several ticks) */
const PICKUP_BURST_GAP_TICKS = 2;

/** Start of the last run of hand count increases before the swing, skipping a partial stack held while disabled */
function findPickupIndex(counts: number[], start: number, end: number): number {
    let last_increase = start;
    for (let i = start + 1; i < end; i++) {
        if (counts[i] > counts[i - 1]) last_increase = i;
    }
    let pickup = last_increase;
    for (let i = last_increase - 1; i > start && pickup - i <= PICKUP_BURST_GAP_TICKS; i--) {
        if (counts[i] > counts[i - 1]) pickup = i;
    }
    return pickup - start <= PICKUP_BURST_GAP_TICKS ? start : pickup;
}

/** Splits an inserter's hand count samples into transfers: hand goes non-empty, then empty again */
export function extractTransfers(inserter: RecordedInserter, clock: number[]): RecordedTransfer[] {
    const counts = inserter.samples.held_count;
    const items = expandChangeList(inserter.samples.held_item, counts.length, "");
    const transfers: RecordedTransfer[] = [];
    let current: RecordedTransfer | null = null;

    const close = (transfer: RecordedTransfer, end: number) => {
        transfer.end_index = end;
        transfer.pickup_index = findPickupIndex(counts, transfer.start_index, end);
        transfer.start_clock = clock[transfer.pickup_index];
        transfer.truncated_start = transfer.pickup_index === 0;
        transfers.push(transfer);
    };

    for (let i = 0; i < counts.length; i++) {
        const count = counts[i];
        if (count > 0 && current === null) {
            current = {
                item_name: items[i],
                start_index: i,
                pickup_index: i,
                end_index: i,
                start_clock: clock[i],
                amount: count,
                truncated_start: false,
                truncated_end: false,
            };
        } else if (count > 0 && current !== null) {
            current.amount = Math.max(current.amount, count);
        } else if (count === 0 && current !== null) {
            close(current, i);
            current = null;
        }
    }

    if (current !== null) {
        current.truncated_end = true;
        close(current, counts.length);
    }
    return transfers;
}

