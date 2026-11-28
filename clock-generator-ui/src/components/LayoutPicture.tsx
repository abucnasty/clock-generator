import { memo, useId, useMemo, useState, type KeyboardEvent, type ReactNode, type Ref, type SVGProps } from 'react';
import type { Layout, LayoutBeltTile, LayoutBox, LayoutInserter } from '../utils/layoutOf';
import { TILE_GRID_SHADE } from '../theme/tileGrid';
import { LAYOUT_TILE_PX as PX } from '../utils/layoutBounds';
import { badgeBox, layoutMarks, MARK_HEIGHT, px, type Box } from '../utils/layoutMarks';
import { combinatorColour, COMBINATOR_INK } from '../utils/combinatorColours';
import type { LayoutCombinator } from '../utils/layoutCombinators';
import { beltColour, LAYOUT_GROUND, regionColour } from '../utils/layoutColours';
import type { RegionTints } from '../utils/layoutRegions';
import { entityLabel } from '../utils/entityLabel';
import { tileKey, type LaneEditorBelt } from '../utils/layoutLanes';
import { FactorioIcon } from './FactorioIcon';
import type { EntityClickType } from './ConfigFlowDiagram';

/** The colours of the picture: it is drawn on its own dark ground, so they hold in either theme */
const INK = '#1a1a1a';
/** The selection and the keyboard focus, each in a colour no belt, region or box has */
const SELECTED = '#e6007e';
const FOCUS = '#ffffff';
const WARNING = '#ff6b5e';
const HAND = '#f5c400';
/** An outline that shows on the dark ground */
const RIM = '#e4e4e4';
const BOX_COLOURS = { machine: '#8fbf8f', drill: '#c9b48a', chest: '#b9b9c9' } as const;
const DIRECTION_VECTOR: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };

interface LayoutPictureProps {
    layout: Layout;
    /** The name of each entity box, by key "machine:3": its label and, under it, what it makes */
    names: ReadonlyMap<string, BoxName>;
    tints: RegionTints | null;
    selection: { kind: EntityClickType; id: number } | null;
    onSelect(kind: EntityClickType, id: number): void;
    /**
     * The combinators of a clock that is current for the build, by "inserter:5" or "drill:2": each carries its tag after the
     * number, and the one the selection is in joins its entities by a line. Null: no tag, and the inserters carry the matching
     * inserter's number of another region
     */
    combinators?: ReadonlyMap<string, LayoutCombinator> | null;
    /**
     * The lane editor mode: the belts drawn with their two lanes, and the tile of the belt in `anchorBelt` that hands its
     * element to `onAnchor`. Null: every belt is drawn as it is without the mode
     */
    lanes?: LaneDrawing | null;
}

/** What the picture draws of the lanes of the belts of a lane editor */
interface LaneDrawing {
    belts: ReadonlyMap<number, LaneEditorBelt>;
    anchorBelt: number | null;
    onAnchor(element: SVGGElement | null): void;
}

/** An entity of the picture that a click or Enter selects */
function Pickable({ label, selected, onPick, anchorRef, children }: { label: string; selected: boolean; onPick(): void; anchorRef?: Ref<SVGGElement>; children: ReactNode }) {
    const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(); }
    };
    // a ring for a keyboard user only: a pointer click focuses the entity too, and the selection shows that
    const [focused, setFocused] = useState(false);
    return (
        <g ref={anchorRef} role="button" tabIndex={0} aria-label={label} aria-pressed={selected} onClick={onPick} onKeyDown={onKeyDown}
            onFocus={event => setFocused(event.currentTarget.matches(':focus-visible'))} onBlur={() => setFocused(false)}
            data-focused={focused ? '' : undefined}
            style={{ cursor: 'pointer', outline: focused ? `3px solid ${FOCUS}` : 'none', outlineOffset: 3 }}>
            {children}
        </g>
    );
}

function Rect({ x, y, width, height, ...props }: { x: number; y: number; width: number; height: number } & SVGProps<SVGRectElement>) {
    return <rect x={px(x - width / 2)} y={px(y - height / 2)} width={px(width)} height={px(height)} {...props} />;
}

function Footprint({ box, tint, selected }: { box: LayoutBox; tint: number | undefined; selected: boolean }) {
    const outline = selected ? { stroke: SELECTED, strokeWidth: 3.5 } : { stroke: INK, strokeWidth: 1.5 };
    const halo = tint === undefined ? null : <Rect x={box.x} y={box.y} width={box.width + 1} height={box.height + 1} fill={regionColour(tint)} rx={6} />;
    if (box.freeFacing) {
        // no orientation in the config: both footprints, drawn as outlines, and the place of its middle
        return (
            <>
                {halo && <Rect x={box.x} y={box.y} width={Math.max(box.width, box.height) + 1} height={Math.max(box.width, box.height) + 1} fill={regionColour(tint!)} rx={6} />}
                <Rect x={box.x} y={box.y} width={box.width} height={box.height} fill={BOX_COLOURS.chest} fillOpacity={0.25} strokeDasharray="4 3" {...outline} stroke={selected ? SELECTED : RIM} />
                {box.width !== box.height && <Rect x={box.x} y={box.y} width={box.height} height={box.width} fill={BOX_COLOURS.chest} fillOpacity={0.25} strokeDasharray="4 3" {...outline} stroke={selected ? SELECTED : RIM} />}
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

/** What a box is called, as a number and as pictures; the words are its accessible name and its hover text */
export interface BoxName {
    /** "Machine 3": the accessible name */
    title: string;
    /** The number badge */
    id: number;
    /** The picture in the middle: a machine's recipe, a drill's ore, a chest's type */
    icon: string;
    /** The small picture in the corner: what the machine or the drill is */
    corner?: string;
    /** The words of the picture, shown where the game has no icon for it, and on hover */
    detail?: string;
}

function BoxLabel({ box, name }: { box: LayoutBox; name: BoxName }) {
    // a marker has no box of its own: its label is one tile around it
    const small = box.freeFacing || box.unsized;
    const span = small ? 1 : box.width, spanHeight = small ? 1 : box.height;
    const side = Math.min(span, spanHeight) * PX;
    const iconSize = Math.min(40, Math.round(side * 0.52)), cornerSize = Math.round(Math.min(24, side * 0.3));
    return (
        <foreignObject x={px(box.x - span / 2)} y={px(box.y - spanHeight / 2)} width={px(span)} height={px(spanHeight)} pointerEvents="none" style={{ overflow: 'hidden' }}>
            <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FactorioIcon name={name.icon} size={iconSize} fallback={name.detail ? <span style={{ fontSize: 9.5, color: INK, textAlign: 'center', lineHeight: 1.1 }}>{name.detail}</span> : null} />
                {name.corner && !small && <span style={{ position: 'absolute', right: 2, bottom: 2, display: 'flex' }}><FactorioIcon name={name.corner} size={cornerSize} alt="" /></span>}
                <span style={{ position: 'absolute', left: 2, top: 2, minWidth: 12, padding: '0 3px', boxSizing: 'border-box', background: INK, color: '#ffffff', border: `1px solid ${RIM}`,
                    font: '700 10px/13px sans-serif', textAlign: 'center' }}>{name.id}</span>
            </div>
        </foreignObject>
    );
}

function Arrow({ direction, size, fill }: { direction: number; size: number; fill: string }) {
    return <polygon points={`0,${-size} ${size * 0.8},${size * 0.7} ${-size * 0.8},${size * 0.7}`} transform={`rotate(${direction * 22.5})`} fill={fill} stroke={INK} strokeWidth={1} />;
}

/** The two lanes of a belt tile, each half of the tile on its side of the way the belt runs, with its item's picture where it has one */
function BeltLanes({ belt, direction }: { belt: LaneEditorBelt; direction: number }) {
    const vector = DIRECTION_VECTOR[direction];
    if (vector === undefined) return null;
    // the left of the way of travel, on a picture with north up
    const left: [number, number] = [vector[1], -vector[0]];
    const horizontal = vector[0] !== 0;
    const along = PX - 4, across = PX / 2 - 2;
    return (
        <g pointerEvents="none">
            {belt.lanes.map(lane => {
                const sign = lane.side === 'left' ? 1 : -1;
                const cx = left[0] * sign * PX * 0.25, cy = left[1] * sign * PX * 0.25;
                const width = horizontal ? along : across, height = horizontal ? across : along;
                return (
                    <g key={lane.id}>
                        <rect x={cx - width / 2} y={cy - height / 2} width={width} height={height} data-lane={lane.id} data-lane-side={lane.side}
                            fill={lane.item ? '#f1f1f1' : '#2e2e2e'} fillOpacity={0.9} stroke={INK} strokeWidth={0.8} strokeDasharray={lane.item ? undefined : '2 2'} />
                        {lane.item
                            ? <foreignObject x={cx - 6} y={cy - 6} width={12} height={12}><FactorioIcon name={lane.item} size={12} alt="" /></foreignObject>
                            : <text x={cx} y={cy + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ffffff">{lane.id}</text>}
                    </g>
                );
            })}
            <g transform={`translate(${vector[0] * PX * 0.42} ${vector[1] * PX * 0.42})`}><Arrow direction={direction} size={3.5} fill="#ffffff" /></g>
        </g>
    );
}

function BeltTile({ tile, onPick, selected, lanes, anchorRef }: { tile: LayoutBeltTile; onPick(): void; selected: boolean; lanes?: LaneEditorBelt; anchorRef?: Ref<SVGGElement> }) {
    const colour = beltColour(tile.beltId);
    // a tile is drawn with its lanes where the mode knows the way the belt runs there
    const direction = lanes === undefined ? null : (lanes.directions.get(tileKey(tile.x, tile.y)) ?? tile.direction);
    return (
        <Pickable label={entityLabel('belt', tile.beltId)} selected={selected} onPick={onPick} anchorRef={anchorRef}>
            <Rect x={tile.x} y={tile.y} width={1} height={1} fill={colour} stroke={selected ? SELECTED : RIM} strokeWidth={selected ? 3.5 : 1.5} />
            {lanes !== undefined && direction !== null ? (
                <g transform={`translate(${px(tile.x)} ${px(tile.y)})`}><BeltLanes belt={lanes} direction={direction} /></g>
            ) : tile.direction !== null && (
                <g transform={`translate(${px(tile.x)} ${px(tile.y)})`}><Arrow direction={tile.direction} size={PX * 0.3} fill="#ffffff" /></g>
            )}
        </Pickable>
    );
}

/** The hand of an inserter: from the side it picks from to the side it drops on, inside its own tile */
function InserterBody({ inserter }: { inserter: LayoutInserter }) {
    const vector = inserter.direction === null ? null : DIRECTION_VECTOR[inserter.direction];
    return (
        <g transform={`translate(${px(inserter.x)} ${px(inserter.y)})`}>
            <rect x={-PX * 0.22} y={-PX * 0.22} width={PX * 0.44} height={PX * 0.44} rx={3} fill="#6b6b6b" stroke={INK} strokeWidth={1} />
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
    const { x, y, badgeWidth: width } = badgeBox(inserter, twins);
    return (
        <g pointerEvents="none">
            <rect x={x} y={y} width={width} height={15} rx={5} fill="#ffffff" stroke={selected ? SELECTED : INK} strokeWidth={selected ? 3.5 : 1.5} data-inserter-badge />
            <text x={x + width / 2} y={y + 11.5} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{text}</text>
            {twins !== undefined && twins.length > 0 && (
                <text x={x + width + 2} y={y + 11} fontSize={9.5} fontWeight={700} fill="#f4f4f4" stroke={INK} strokeWidth={2.5} paintOrder="stroke" data-twin-label>{`=${twins.join(',')}`}</text>
            )}
        </g>
    );
}

/**
 * The tag of a combinator: its letter on its colour, in a square, or in a round tag past the eleventh combinator, which
 * uses a colour a second time. A dark rim keeps it apart from the build under it.
 */
function CombinatorTagMark({ box, entity, combinator, selected }: { box: Box; entity: string; combinator: LayoutCombinator; selected: boolean }) {
    const { letter, round } = combinator.letter;
    return (
        <g pointerEvents="none" data-combinator-tag={letter} data-tag-for={entity} data-tag-shape={round ? 'round' : 'square'}>
            <title>{`Combinator ${letter}`}</title>
            <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={round ? MARK_HEIGHT / 2 : 3} fill={combinatorColour(combinator.letter)}
                stroke={selected ? SELECTED : COMBINATOR_INK} strokeWidth={selected ? 3.5 : 1.5} />
            <text x={box.x + box.width / 2} y={box.y + 11.5} textAnchor="middle" fontSize={11} fontWeight={700} fill={COMBINATOR_INK}>{letter}</text>
        </g>
    );
}

/** The line that joins the entities of a combinator, in its colour on a dark casing: dashed, so a belt under it shows */
function JoinLine({ layout, combinator }: { layout: Layout; combinator: LayoutCombinator }) {
    const points = combinator.ids.flatMap(id => {
        const place = combinator.kind === 'inserter' ? layout.inserters.find(inserter => inserter.number === id) : layout.boxes.find(box => box.kind === 'drill' && box.id === id);
        return place === undefined ? [] : [`${px(place.x)},${px(place.y)}`];
    });
    if (points.length < 2) return null;
    return (
        <g pointerEvents="none" data-combinator-join={combinator.letter.letter}>
            <polyline points={points.join(' ')} fill="none" stroke={COMBINATOR_INK} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={points.join(' ')} fill="none" stroke={combinatorColour(combinator.letter)} strokeWidth={3} strokeDasharray="7 5" strokeLinejoin="round" />
        </g>
    );
}

/**
 * The build from above, in tiles of PX pixels, north up, as the config gives its positions: machines, drills and chests as
 * boxes, belts as the tiles inserters reach, each inserter as a hand from the side it picks from to the side it drops on,
 * with its number. It draws what the config holds and no more. Of a clock that is current for the build it also draws the
 * letter and colour of each combinator on the inserters and drills it switches on.
 */
function LayoutPictureComponent({ layout, names, tints, selection, onSelect, combinators = null, lanes = null }: LayoutPictureProps) {
    const isSelected = (kind: EntityClickType, id: number) => selection?.kind === kind && selection.id === id;
    const tintOf = (kind: string, id: number) => tints?.of.get(`${kind}:${id}`);
    const marked = (samePlace: readonly unknown[]) => samePlace.length > 0;
    const marks = useMemo(
        () => layoutMarks(layout, tints?.twins, combinators === null ? null : new Map([...combinators].map(([key, combinator]) => [key, combinator.letter.letter]))),
        [layout, tints, combinators],
    );
    const selected = selection === null || combinators === null ? undefined : combinators.get(`${selection.kind}:${selection.id}`);
    // the editor of a belt is anchored on its first tile
    const anchorTile = lanes?.anchorBelt == null ? undefined : layout.beltTiles.find(tile => tile.beltId === lanes.anchorBelt);
    return (
        <g>
            {/* halos first, so no region tint covers an entity */}
            {tints && layout.inserters.map((inserter, index) => {
                const tint = tintOf('inserter', inserter.id);
                return tint === undefined ? null : <Rect key={`halo-${index}`} x={inserter.x} y={inserter.y} width={1.5} height={1.5} fill={regionColour(tint)} rx={6} />;
            })}
            {layout.boxes.map(box => {
                const key = `${box.kind}:${box.id}`;
                const name: BoxName = names.get(key) ?? { title: entityLabel(box.kind, box.id), id: box.id, icon: box.name };
                return (
                    <Pickable key={key} label={name.title} selected={isSelected(box.kind, box.id)} onPick={() => onSelect(box.kind, box.id)}>
                        <title>{name.detail ? `${name.title}: ${name.detail}` : name.title}</title>
                        <Footprint box={box} tint={tintOf(box.kind, box.id)} selected={isSelected(box.kind, box.id)} />
                        <BoxLabel box={box} name={name} />
                        {marked(box.samePlace) && <Rect x={box.x} y={box.y} width={Math.min(box.width, 1.2) + 0.2} height={Math.min(box.height, 1.2) + 0.2} fill="none" stroke={WARNING} strokeWidth={2} strokeDasharray="3 2" data-same-place />}
                    </Pickable>
                );
            })}
            {layout.beltTiles.map(tile => (
                <BeltTile key={`${tile.beltId}|${tile.x}|${tile.y}`} tile={tile} selected={isSelected('belt', tile.beltId)} onPick={() => onSelect('belt', tile.beltId)}
                    lanes={lanes?.belts.get(tile.beltId)} anchorRef={tile === anchorTile ? lanes?.onAnchor : undefined} />
            ))}
            {layout.inserters.map((inserter, index) => (
                <Pickable key={`inserter-${index}`} label={entityLabel('inserter', inserter.id)} selected={isSelected('inserter', inserter.id)} onPick={() => onSelect('inserter', inserter.id)}>
                    <rect x={px(inserter.x) - PX * 0.5} y={px(inserter.y) - PX * 0.5} width={PX} height={PX} fill="transparent" />
                    <InserterBody inserter={inserter} />
                    {marked(inserter.samePlace) && <Rect x={inserter.x} y={inserter.y} width={1} height={1} fill="none" stroke={WARNING} strokeWidth={2} strokeDasharray="3 2" data-same-place />}
                </Pickable>
            ))}
            {selected !== undefined && <JoinLine layout={layout} combinator={selected} />}
            {layout.inserters.map((inserter, index) => (
                <InserterBadge key={`badge-${index}`} inserter={inserter} twins={combinators === null ? tints?.twins.get(inserter.id) : undefined} selected={isSelected('inserter', inserter.id)} />
            ))}
            {/* the belt labels, each at a corner of its tile that no number covers */}
            {layout.beltTiles.map((tile, index) => {
                const label = { x: marks.beltLabels[index].x, y: marks.beltLabels[index].y + 8 };
                return (
                    <text key={`label-${tile.beltId}|${tile.x}|${tile.y}`} x={label.x} y={label.y} fontSize={8.5} fontWeight={700} fill="#ffffff" stroke={INK} strokeWidth={2} paintOrder="stroke" pointerEvents="none" data-belt-label>
                        {`b${tile.beltId}`}
                    </text>
                );
            })}
            {/* the tags last, each after its number, clear of the numbers, the belt labels and the other tags */}
            {combinators !== null && [...marks.tags].map(([key, box]) => {
                const combinator = combinators.get(key);
                return combinator === undefined ? null : <CombinatorTagMark key={`tag-${key}`} box={box} entity={key} combinator={combinator} selected={selected === combinator} />;
            })}
        </g>
    );
}

/**
 * The ground under the picture: the checker the entity icons and the diagram use, one square to a game tile, so it is
 * drawn in the picture's own units and follows the pan and zoom. A tile is the square from a whole number to the next in
 * the config's coordinates; the lighter square is where the tile's two numbers add to an odd one.
 */
export function LayoutGround({ x, y, zoom }: { x: number; y: number; zoom: number }) {
    const id = useId();
    return (
        <g pointerEvents="none" data-layout-ground="">
            <defs>
                <pattern id={id} width={2 * PX} height={2 * PX} patternUnits="userSpaceOnUse" patternTransform={`translate(${x} ${y}) scale(${zoom})`}>
                    <rect width={2 * PX} height={2 * PX} fill={LAYOUT_GROUND} />
                    <rect x={PX} width={PX} height={PX} fill={TILE_GRID_SHADE} shapeRendering="crispEdges" />
                    <rect y={PX} width={PX} height={PX} fill={TILE_GRID_SHADE} shapeRendering="crispEdges" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id})`} />
        </g>
    );
}

// a pan or a zoom changes the view's transform only: the picture draws again when its own data changes
export const LayoutPicture = memo(LayoutPictureComponent);
