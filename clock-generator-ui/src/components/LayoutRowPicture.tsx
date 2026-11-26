import { useMemo } from 'react';
import type { Layout } from '../utils/layoutOf';
import { boundsOf } from '../utils/layoutBounds';
import { LAYOUT_GROUND } from '../utils/layoutColours';
import { COMBINATOR_INK } from '../utils/combinatorColours';

/** The picture's longer side, in pixels */
const ROW_PICTURE_PX = 200;
/** No bigger than this a tile, so that a small build is not drawn huge */
const MAX_TILE_PX = 12;
const DIM = 0.3;

interface LayoutRowPictureProps {
    layout: Layout;
    /** What the row's combinator switches on, by kind and config id: ringed in its colour; everything else is dimmed */
    kind: 'inserter' | 'drill';
    ids: readonly number[];
    colour: string;
    /** The accessible name, such as "Where inserters 5, 14 are" */
    label: string;
}

/**
 * A small picture of the build for one row of the wiring list: the places only, with no icons, no numbers and no pan or
 * zoom. The inserters or drills of the row's combinator are ringed in its colour, on a dark casing; the rest is dimmed.
 * Null where the build has no positions.
 */
export function LayoutRowPicture({ layout, kind, ids, colour, label }: LayoutRowPictureProps) {
    const bounds = useMemo(() => boundsOf(layout, 0.75), [layout]);
    if (bounds === null) return null;
    const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
    const tile = Math.min(MAX_TILE_PX, ROW_PICTURE_PX / Math.max(width, height));
    const at = (x: number, y: number) => ({ x: (x - bounds.minX) * tile, y: (y - bounds.minY) * tile });
    const ringed = new Set(ids);
    const ring = (key: string, x: number, y: number, radius: number) => {
        const centre = at(x, y);
        return (
            <g key={key} data-ring={key}>
                <circle cx={centre.x} cy={centre.y} r={radius} fill="none" stroke={COMBINATOR_INK} strokeWidth={5} />
                <circle cx={centre.x} cy={centre.y} r={radius} fill={colour} fillOpacity={0.35} stroke={colour} strokeWidth={2.5} />
            </g>
        );
    };
    return (
        <svg role="img" aria-label={label} width={width * tile} height={height * tile} viewBox={`0 0 ${width * tile} ${height * tile}`} data-row-picture style={{ display: 'block', flexShrink: 0 }}>
            <rect width="100%" height="100%" fill={LAYOUT_GROUND} />
            {layout.boxes.map(box => {
                const place = at(box.x - box.width / 2, box.y - box.height / 2);
                const drilled = kind === 'drill' && box.kind === 'drill' && ringed.has(box.id);
                return (
                    <rect key={`${box.kind}:${box.id}`} x={place.x} y={place.y} width={box.width * tile} height={box.height * tile}
                        fill={drilled ? colour : '#9a9a9a'} fillOpacity={drilled ? 0.8 : DIM} stroke={drilled ? COMBINATOR_INK : 'none'} strokeWidth={1.5} data-row-box={`${box.kind}:${box.id}`} />
                );
            })}
            {layout.beltTiles.map(beltTile => {
                const place = at(beltTile.x - 0.5, beltTile.y - 0.5);
                return <rect key={`${beltTile.beltId}|${beltTile.x}|${beltTile.y}`} x={place.x} y={place.y} width={tile} height={tile} fill="#c8c8c8" fillOpacity={DIM} />;
            })}
            {layout.inserters.filter(inserter => !(kind === 'inserter' && ringed.has(inserter.number))).map(inserter => {
                const centre = at(inserter.x, inserter.y);
                return <circle key={`inserter:${inserter.number}`} cx={centre.x} cy={centre.y} r={Math.max(1.5, tile * 0.3)} fill="#c8c8c8" fillOpacity={DIM} />;
            })}
            {kind === 'inserter' && layout.inserters.filter(inserter => ringed.has(inserter.number)).map(inserter => ring(`inserter:${inserter.number}`, inserter.x, inserter.y, Math.max(5, tile * 0.9)))}
            {kind === 'drill' && layout.boxes.filter(box => box.kind === 'drill' && ringed.has(box.id)).map(box => ring(`drill:${box.id}`, box.x, box.y, Math.max(5, tile * 0.9 + Math.max(box.width, box.height) * tile / 2 - tile * 0.5)))}
        </svg>
    );
}
