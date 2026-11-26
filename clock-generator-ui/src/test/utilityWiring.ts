import { combinatorLetters } from 'clock-generator/light';
import type { ClockInstallFacts } from '../worker/installFacts';
import { wiringRowKey } from '../utils/installSteps';

/**
 * The sets of inserters of utility science 320/s that share a combinator, as the generator's record held them when this
 * fixture was written (11 sets; the live clock may group them otherwise once the output line or the regions are planned
 * another way): a typed fixture, not the record
 */
export const UTILITY_320_WIRING: number[][] = [[1, 11], [2, 12], [3, 20], [4, 18], [5, 14], [6, 16], [7], [8, 15], [9, 17], [10, 21], [13, 19]];

/**
 * The install facts of a clock with these combinators: the first line of each as the generator writes it, ending in its
 * letter, and the letters the generator's rule gives them
 */
export function installOf(wiring: number[][], drills: number[][] = []): ClockInstallFacts {
    const letters = combinatorLetters({ inserters: wiring, drills });
    const lines: Record<string, string> = {};
    for (const [kind, groups] of [['inserter', wiring], ['drill', drills]] as const) {
        for (const ids of groups) {
            const key = wiringRowKey(kind, ids);
            lines[key] = `${ids.length} ${kind}${ids.length > 1 ? 's' : ''} [item=${kind === 'drill' ? 'iron-ore' : 'iron-plate'}] (${[...ids].sort((a, b) => a - b).join(', ')}) (${letters.get(key)!.letter})`;
        }
    }
    return { book: false, wiring, drills, lines, letters: Object.fromEntries(letters) };
}
