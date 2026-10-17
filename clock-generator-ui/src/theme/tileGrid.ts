/** Shared checker tiles for entity identities and the Factorio-style diagram canvas. */
export const TILE_GRID_SHADE = 'rgba(127,127,127,0.16)';
export function tileGridBackground(size: number) {
    return {
        backgroundImage: `conic-gradient(from 90deg, transparent 25%, ${TILE_GRID_SHADE} 0 50%, transparent 0 75%, ${TILE_GRID_SHADE} 0)`,
        backgroundSize: `${size}px ${size}px`,
    };
}
