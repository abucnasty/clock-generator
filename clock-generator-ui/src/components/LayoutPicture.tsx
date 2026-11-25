import type { KeyboardEvent, ReactNode } from 'react';
import type { Layout, LayoutBeltTile, LayoutBox, LayoutInserter } from '../utils/layoutOf';
import { LAYOUT_TILE_PX as PX } from '../utils/layoutBounds';
import { beltColour, LAYOUT_GROUND, regionColour } from '../utils/layoutColours';
import type { RegionTints } from '../utils/layoutRegions';
import { entityLabel } from '../utils/entityLabel';
import type { EntityClickType } from './ConfigFlowDiagram';

/** The colours of the picture: it is drawn on its own light ground, so they hold in either theme */
const INK = '#1a1a1a';
const GRID = '#eeeeee';
const SELECTED = '#d35400';
const WARNING = '#c0392b';
const HAND = '#f5c400';
const BOX_COLOURS = { machine: '#8fbf8f', drill: '#c9b48a', chest: '#b9b9c9' } as const;
const DIRECTION_VECTOR: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };

interface LayoutPictureProps {
    layout: Layout;
    /** The name of each entity box, by key "machine:3": its label and, under it, what it makes */
    names: ReadonlyMap<string, { title: string; detail?: string }>;
    tints: RegionTints | null;
    selection: { kind: EntityClickType; id: number } | null;
    onSelect(kind: EntityClickType, id: number): void;
}

const px = (tiles: number) => tiles * PX;

/** An entity of the picture that a click or Enter selects */
function Pickable({ label, selected, onPick, children }: { label: string; selected: boolean; onPick(): void; children: ReactNode }) {
    const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(); }
    };
    return (
        <g role="button" tabIndex={0} aria-label={label} aria-pressed={selected} onClick={onPick} onKeyDown={onKeyDown} style={{ cursor: 'pointer', outline: 'none' }}>
            {children}
        </g>
    );
}

function Rect({ x, y, width, height, ...props }: { x: number; y: number; width: number; height: number } & React.SVGProps<SVGRectElement>) {
    return <rect x={px(x - width / 2)} y={px(y - height / 2)} width={px(width)} height={px(height)} {...props} />;
}

function Footprint({ box, tint, selected }: { box: LayoutBox; tint: number | undefined; selected: boolean }) {
    const outline = selected ? { stroke: SELECTED, strokeWidth: 3 } : { stroke: INK, strokeWidth: 1.5 };
    const halo = tint === undefined ? null : <Rect x={box.x} y={box.y} width={box.width + 1} height={box.height + 1} fill={regionColour(tint)} rx={6} />;
    if (box.freeFacing) {
        // no orientation in the config: both footprints, drawn as outlines, and the place of its middle
        return (
            <>
                {halo && <Rect x={box.x} y={box.y} width={Math.max(box.width, box.height) + 1} height={Math.max(box.width, box.height) + 1} fill={regionColour(tint!)} rx={6} />}
                <Rect x={box.x} y={box.y} width={box.width} height={box.height} fill={BOX_COLOURS.chest} fillOpacity={0.25} strokeDasharray="4 3" {...outline} />
                {box.width !== box.height && <Rect x={box.x} y={box.y} width={box.height} height={box.width} fill={BOX_COLOURS.chest} fillOpacity={0.25} strokeDasharray="4 3" {...outline} />}
                <Rect x={box.x} y={box.y} width={0.8} height={0.8} fill={BOX_COLOURS.chest} {...outline} />
            </>
        );
    }
    return (
        <>
            {halo}
            <Rect x={box.x} y={box.y} width={box.width} height={box.height} fill={BOX_COLOURS[box.kind]} {...outline} />
        </>
    );
}

function BoxLabel({ box, title, detail }: { box: LayoutBox; title: string; detail?: string }) {
    // text is cut at the box's own edge, so a long recipe name stays in its machine
    const span = box.freeFacing || box.unsized ? Math.max(box.width, box.height, 1) : box.width;
    const spanHeight = box.freeFacing || box.unsized ? Math.max(box.width, box.height, 1) : box.height;
    const x = px(box.x - span / 2), y = px(box.y - spanHeight / 2);
    return (
        <svg x={x} y={y} width={px(span)} height={px(spanHeight)} overflow="hidden" pointerEvents="none">
            <text x="50%" y={detail ? '45%' : '52%'} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{title}</text>
            {detail && (
                // a name longer than the box is squeezed to it, not cut
                <text x="50%" y="45%" dy={13} textAnchor="middle" fontSize={9.5} fill={INK}
                    {...(detail.length * 5.2 > px(span) - 6 ? { textLength: px(span) - 6, lengthAdjust: 'spacingAndGlyphs' as const } : {})}>{detail}</text>
            )}
        </svg>
    );
}

function Arrow({ direction, size, fill }: { direction: number; size: number; fill: string }) {
    return <polygon points={`0,${-size} ${size * 0.8},${size * 0.7} ${-size * 0.8},${size * 0.7}`} transform={`rotate(${direction * 22.5})`} fill={fill} stroke={INK} strokeWidth={1} />;
}

function BeltTile({ tile, onPick, selected }: { tile: LayoutBeltTile; onPick(): void; selected: boolean }) {
    const colour = beltColour(tile.beltId);
    return (
        <Pickable label={entityLabel('belt', tile.beltId)} selected={selected} onPick={onPick}>
            <Rect x={tile.x} y={tile.y} width={1} height={1} fill={colour} stroke={selected ? SELECTED : INK} strokeWidth={selected ? 3 : 1} />
            {tile.direction !== null && (
                <g transform={`translate(${px(tile.x)} ${px(tile.y)})`}><Arrow direction={tile.direction} size={PX * 0.3} fill="#ffffff" /></g>
            )}
            <text x={px(tile.x - 0.46)} y={px(tile.y + 0.42)} fontSize={8.5} fontWeight={700} fill="#ffffff" stroke={INK} strokeWidth={2} paintOrder="stroke" pointerEvents="none">
                {`b${tile.beltId}`}
            </text>
        </Pickable>
    );
}

/** The hand of an inserter: from the side it picks from to the side it drops on, inside its own tile */
function InserterBody({ inserter }: { inserter: LayoutInserter }) {
    const vector = inserter.direction === null ? null : DIRECTION_VECTOR[inserter.direction];
    return (
        <g transform={`translate(${px(inserter.x)} ${px(inserter.y)})`}>
            <rect x={-PX * 0.22} y={-PX * 0.22} width={PX * 0.44} height={PX * 0.44} rx={3} fill="#444444" stroke={INK} strokeWidth={1} />
            {vector !== null && (
                <>
                    <line x1={vector[0] * PX * 0.42} y1={vector[1] * PX * 0.42} x2={-vector[0] * PX * 0.3} y2={-vector[1] * PX * 0.3} stroke={HAND} strokeWidth={3} />
                    <circle cx={vector[0] * PX * 0.42} cy={vector[1] * PX * 0.42} r={3} fill={HAND} stroke={INK} strokeWidth={1} />
                    <g transform={`translate(${-vector[0] * PX * 0.38} ${-vector[1] * PX * 0.38})`}><Arrow direction={inserter.direction! + 8} size={4.5} fill={HAND} /></g>
                </>
            )}
        </g>
    );
}

function InserterBadge({ inserter, twins, selected }: { inserter: LayoutInserter; twins: readonly number[] | undefined; selected: boolean }) {
    const text = String(inserter.number);
    const width = 8 + text.length * 7;
    const x = px(inserter.x) - PX * 0.5 - width * 0.45, y = px(inserter.y) - PX * 0.5 - 6;
    return (
        <g pointerEvents="none">
            <rect x={x} y={y} width={width} height={15} rx={5} fill="#ffffff" stroke={selected ? SELECTED : INK} strokeWidth={selected ? 3 : 1.5} />
            <text x={x + width / 2} y={y + 11.5} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{text}</text>
            {twins !== undefined && twins.length > 0 && (
                <text x={x + width + 2} y={y + 11} fontSize={9.5} fontWeight={600} fill="#333333">{`=${twins.join(',')}`}</text>
            )}
        </g>
    );
}

/**
 * The build from above, in tiles of PX pixels, north up, as the config gives its positions: machines, drills and chests as
 * boxes, belts as the tiles inserters reach, each inserter as a hand from the side it picks from to the side it drops on,
 * with its number. It draws what the config holds and no more.
 */
export function LayoutPicture({ layout, names, tints, selection, onSelect }: LayoutPictureProps) {
    const isSelected = (kind: EntityClickType, id: number) => selection?.kind === kind && selection.id === id;
    const tintOf = (kind: string, id: number) => tints?.of.get(`${kind}:${id}`);
    const marked = (samePlace: readonly unknown[]) => samePlace.length > 0;
    return (
        <g>
            {/* halos first, so no region tint covers an entity */}
            {tints && layout.inserters.map((inserter, index) => {
                const tint = tintOf('inserter', inserter.id);
                return tint === undefined ? null : <Rect key={`halo-${index}`} x={inserter.x} y={inserter.y} width={1.5} height={1.5} fill={regionColour(tint)} rx={6} />;
            })}
            {layout.boxes.map(box => {
                const key = `${box.kind}:${box.id}`;
                const name = names.get(key) ?? { title: entityLabel(box.kind, box.id) };
                return (
                    <Pickable key={key} label={name.title} selected={isSelected(box.kind, box.id)} onPick={() => onSelect(box.kind, box.id)}>
                        <Footprint box={box} tint={tintOf(box.kind, box.id)} selected={isSelected(box.kind, box.id)} />
                        <BoxLabel box={box} title={name.title} detail={box.unsized ? box.name : name.detail} />
                        {marked(box.samePlace) && <Rect x={box.x} y={box.y} width={Math.min(box.width, 1.2) + 0.2} height={Math.min(box.height, 1.2) + 0.2} fill="none" stroke={WARNING} strokeWidth={2} strokeDasharray="3 2" data-same-place />}
                    </Pickable>
                );
            })}
            {layout.beltTiles.map(tile => (
                <BeltTile key={`${tile.beltId}|${tile.x}|${tile.y}`} tile={tile} selected={isSelected('belt', tile.beltId)} onPick={() => onSelect('belt', tile.beltId)} />
            ))}
            {layout.inserters.map((inserter, index) => (
                <Pickable key={`inserter-${index}`} label={entityLabel('inserter', inserter.id)} selected={isSelected('inserter', inserter.id)} onPick={() => onSelect('inserter', inserter.id)}>
                    <rect x={px(inserter.x) - PX * 0.5} y={px(inserter.y) - PX * 0.5} width={PX} height={PX} fill="transparent" />
                    <InserterBody inserter={inserter} />
                    {marked(inserter.samePlace) && <Rect x={inserter.x} y={inserter.y} width={1} height={1} fill="none" stroke={WARNING} strokeWidth={2} strokeDasharray="3 2" data-same-place />}
                </Pickable>
            ))}
            {layout.inserters.map((inserter, index) => (
                <InserterBadge key={`badge-${index}`} inserter={inserter} twins={tints?.twins.get(inserter.id)} selected={isSelected('inserter', inserter.id)} />
            ))}
        </g>
    );
}

/** The ground and the tile grid under the picture, over `bounds` */
export function LayoutGround({ minX, minY, maxX, maxY }: { minX: number; minY: number; maxX: number; maxY: number }) {
    const columns = Array.from({ length: Math.max(0, Math.floor(maxX) - Math.ceil(minX) + 1) }, (_, i) => Math.ceil(minX) + i);
    const rows = Array.from({ length: Math.max(0, Math.floor(maxY) - Math.ceil(minY) + 1) }, (_, i) => Math.ceil(minY) + i);
    return (
        <g pointerEvents="none">
            <rect x={px(minX)} y={px(minY)} width={px(maxX - minX)} height={px(maxY - minY)} fill={LAYOUT_GROUND} />
            {columns.map(x => <line key={`x${x}`} x1={px(x)} x2={px(x)} y1={px(minY)} y2={px(maxY)} stroke={GRID} />)}
            {rows.map(y => <line key={`y${y}`} x1={px(minX)} x2={px(maxX)} y1={px(y)} y2={px(y)} stroke={GRID} />)}
        </g>
    );
}
