import { useState } from 'react';
import type { ClockAlternativeView } from '../worker/types';
import { heldOrderOf } from '../utils/recommendedClock';

/**
 * The order the rows of a list of clocks hold while a run adds clocks (heldOrderOf), kept from the render before; none
 * once the run has ended, so that the rows are sorted by rank. Undefined when nothing is held.
 */
export function useHeldOrder(alternatives: Pick<ClockAlternativeView, 'id' | 'ranking'>[], running: boolean): readonly string[] | undefined {
    const [held, setHeld] = useState<readonly string[]>([]);
    const next = running ? heldOrderOf(held, alternatives) : [];
    if (next.length !== held.length || next.some((id, at) => id !== held[at])) {
        setHeld(next);
    }
    return running ? next : undefined;
}
