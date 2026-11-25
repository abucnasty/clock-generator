import type { Layout } from './layoutOf';

/** Pixels the Layout view draws one tile in, at zoom 1 */
export const LAYOUT_TILE_PX = 24;

interface LayoutBounds { minX: number; minY: number; maxX: number; maxY: number }

/** The tiles the picture covers, with a margin; null where it draws nothing */
export function boundsOf(layout: Layout, margin = 1.5): LayoutBounds | null {
    const extents: LayoutBounds[] = [
        // an entity with no orientation in the config covers its longer side both ways
        ...layout.boxes.map(box => {
            const half = (box.freeFacing ? Math.max(box.width, box.height) : 0) / 2;
            const halfWidth = box.freeFacing ? half : box.width / 2, halfHeight = box.freeFacing ? half : box.height / 2;
            return { minX: box.x - halfWidth, maxX: box.x + halfWidth, minY: box.y - halfHeight, maxY: box.y + halfHeight };
        }),
        ...layout.inserters.map(it => ({ minX: it.x - 0.5, maxX: it.x + 0.5, minY: it.y - 0.5, maxY: it.y + 0.5 })),
        ...layout.beltTiles.map(tile => ({ minX: tile.x - 0.5, maxX: tile.x + 0.5, minY: tile.y - 0.5, maxY: tile.y + 0.5 })),
    ];
    if (extents.length === 0) return null;
    return {
        minX: Math.min(...extents.map(it => it.minX)) - margin, maxX: Math.max(...extents.map(it => it.maxX)) + margin,
        minY: Math.min(...extents.map(it => it.minY)) - margin, maxY: Math.max(...extents.map(it => it.maxY)) + margin,
    };
}
