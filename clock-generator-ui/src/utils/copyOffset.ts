// Where the next copy of a build stands, as the form shows it (tiles and a side) and the config keeps it (a step)

export interface CopyOffset { x: number; y: number }

export const SIDES = ['east', 'west', 'north', 'south'] as const;
export type Side = typeof SIDES[number];

/** The tiles and side a straight offset shows as; null when the offset runs off the four sides */
export function copyOffsetShown(offset: CopyOffset | undefined): { tiles: number | null; side: Side } | 'diagonal' {
    if (offset === undefined) return { tiles: null, side: 'east' };
    if (offset.y === 0) return { tiles: Math.abs(offset.x), side: offset.x < 0 ? 'west' : 'east' };
    if (offset.x === 0) return { tiles: Math.abs(offset.y), side: offset.y < 0 ? 'north' : 'south' };
    return 'diagonal';
}

/** The offset that tiles and a side make; undefined when there are no tiles */
export function copyOffsetOf(tiles: number | null, side: Side): CopyOffset | undefined {
    if (tiles === null || !(tiles > 0)) return undefined;
    return side === 'east' ? { x: tiles, y: 0 } : side === 'west' ? { x: -tiles, y: 0 } : side === 'north' ? { x: 0, y: -tiles } : { x: 0, y: tiles };
}
