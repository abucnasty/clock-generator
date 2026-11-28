import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { Add, CenterFocusStrong, Remove } from '@mui/icons-material';
import type { FoundOrbit } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { machineIconName, chestTypeIcon } from '../utils/configForm/formData';
import { chestLabel, entityLabel, nameInSentence, type LabelKind } from '../utils/entityLabel';
import { boundsOf, LAYOUT_TILE_PX } from '../utils/layoutBounds';
import { beltColour, LAYOUT_GROUND, regionColour } from '../utils/layoutColours';
import { layoutOf, type EntityRef, type Layout } from '../utils/layoutOf';
import { regionTintsOf } from '../utils/layoutRegions';
import { tileSizeOf } from '../utils/layoutSizes';
import type { EntityClickType } from './ConfigFlowDiagram';
import type { LaneEditor } from '../utils/layoutLanes';
import { LayoutGround, LayoutPicture, type BoxName } from './LayoutPicture';
import { LayoutLanePopover } from './LayoutLanePopover';
import { FactorioIcon } from './FactorioIcon';
import { CombinatorTag } from './CombinatorTag';
import type { ClockInstallFacts } from '../worker/installFacts';
import { combinatorOfEntity, layoutCombinatorsOf, switchesText, type LayoutCombinator } from '../utils/layoutCombinators';

/** What a build with no position at all says, in place of a picture */
const NO_POSITIONS = 'This build has no positions; paste a Sidecar export';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

interface LayoutViewProps {
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    drills: DrillFormData[];
    /** What the engine found of the copied regions: null while it loads, where there is none and where it could not tell */
    orbits: FoundOrbit[] | null;
    selection: { kind: EntityClickType; id: number } | null;
    onSelectionChange(selection: { kind: EntityClickType; id: number } | null): void;
    /**
     * What the install steps know of the selected clock, given only while that clock is current for the build: the letter and
     * colour of each combinator go on its inserters and drills, in the legend and on the selected line. Null (or without
     * letters): the view is as it is with no clock
     */
    install?: ClockInstallFacts | null;
    height?: number;
    /**
     * The lane editor mode, off where it is null or absent: each belt it has lanes for is drawn with its two lanes, and the
     * selected one shows an editor for them. An edit goes to its `onEdit`; the view changes no list
     */
    laneEditor?: LaneEditor | null;
}

interface Transform { x: number; y: number; zoom: number }

const labelOf = (chests: readonly ChestFormData[], { kind, id }: { kind: LabelKind; id: number }) =>
    kind === 'chest' ? chestLabel(chests.find(chest => chest.id === id) ?? { id }) : entityLabel(kind, id);

/** The entities the picture could not draw, and the ones standing at the same place, in words */
function Notes({ layout, chests }: { layout: Layout; chests: readonly ChestFormData[] }) {
    const marked = [...layout.boxes, ...layout.inserters].filter(entity => entity.samePlace.length > 0);
    const kindOf = (entity: (typeof marked)[number]): EntityRef['kind'] => 'kind' in entity ? entity.kind : 'inserter';
    const idOf = (entity: (typeof marked)[number]) => entity.id;
    return (
        <>
            {layout.leftOut.length > 0 && (
                <Typography variant="body2" sx={{ mt: 1 }} data-layout-left-out>
                    Not drawn, no position: {layout.leftOut.map(it => labelOf(chests, it)).join(', ')}.
                </Typography>
            )}
            {marked.length > 0 && (
                <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }} data-layout-same-place>
                    {marked.map(entity => (
                        <Typography component="li" variant="body2" key={`${kindOf(entity)}:${idOf(entity)}:${entity.x}:${entity.y}:${entity.samePlace.map(it => it.id).join(',')}`}>
                            {labelOf(chests, { kind: kindOf(entity), id: idOf(entity) })}: same place as {entity.samePlace.map(it => nameInSentence(labelOf(chests, it))).join(', ')}
                        </Typography>
                    ))}
                </Box>
            )}
        </>
    );
}

/** The colour of a region or a belt, with an edge that holds 3 to 1 on the panel in both themes (the text colour) */
function Swatch({ colour }: { colour: string }) {
    return <Box component="span" sx={{ display: 'inline-block', width: 14, height: 14, bgcolor: colour, border: '1px solid', borderColor: 'text.primary', borderRadius: '2px', verticalAlign: 'text-bottom', mr: 0.75 }} />;
}

interface LegendProps {
    layout: Layout;
    regions: ReturnType<typeof regionTintsOf>;
    belts: readonly BeltFormData[];
    combinators: readonly LayoutCombinator[];
    selectedCombinator: LayoutCombinator | undefined;
    onSelectCombinator(combinator: LayoutCombinator): void;
}

function Legend({ layout, regions, belts, combinators, selectedCombinator, onSelectCombinator }: LegendProps) {
    const regionNumbers = regions === null ? [] : Array.from({ length: regions.count }, (_, index) => index + 1);
    const machinesIn = (region: number) => [...(regions?.of ?? [])].flatMap(([key, number]) => number === region && key.startsWith('machine:') ? [Number(key.slice('machine:'.length))] : []).sort((a, b) => a - b);
    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5, mt: 1 }} data-layout-legend>
            {regionNumbers.map(region => (
                <Typography variant="caption" key={`region-${region}`}><Swatch colour={regionColour(region)} />Region {region}: machines {machinesIn(region).join(', ')}</Typography>
            ))}
            {regions !== null && <Typography variant="caption"><Swatch colour={regionColour(0)} />Between the regions</Typography>}
            {combinators.length === 0 && regions !== null && regions.twins.size > 0 && <Typography variant="caption">=N: the matching inserter of another region</Typography>}
            {combinators.map(combinator => (
                <Typography variant="caption" key={`combinator-${combinator.key}`} component="button" type="button" onClick={() => onSelectCombinator(combinator)}
                    aria-pressed={selectedCombinator === combinator} data-layout-combinator={combinator.letter.letter}
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, border: 0, p: 0, bgcolor: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left',
                        fontWeight: selectedCombinator === combinator ? 700 : undefined }}>
                    <CombinatorTag letter={combinator.letter} />
                    <FactorioIcon name="decider-combinator" size={16} titled />
                    {combinator.items.map(item => <FactorioIcon key={item} name={item} size={16} titled />)}
                    {switchesText(combinator)}
                </Typography>
            ))}
            {layout.belts.filter(belt => belt.tiles > 0).map(belt => (
                <Typography variant="caption" key={`belt-${belt.id}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    <Swatch colour={beltColour(belt.id)} />{entityLabel('belt', belt.id)}
                    {/* the items its lanes carry, as pictures; their names are the pictures' own text */}
                    {[...new Set((belts.find(it => it.id === belt.id)?.lanes ?? []).map(lane => lane.ingredient).filter(item => item !== ''))].map(item => <FactorioIcon key={item} name={item} size={16} titled />)}
                </Typography>
            ))}
            <Typography variant="caption" sx={{ flexBasis: '100%' }}>
                Number: the inserter's number, as in the List. The number of a machine, drill or chest is in the dark corner of its box. Each inserter is drawn from the side it picks from (dot) to the side it drops on (arrow).
                A belt tile is one an inserter reaches; the arrow on it is the way the belt runs at a drop.
            </Typography>
        </Box>
    );
}

/**
 * The Layout view of the Build panel: the build drawn from above from the positions its config holds, north up, with the
 * numbers of its inserters and the belts they reach. It only reads: a click selects, as in the diagram, and nothing is edited.
 */
export function LayoutView({ machines, inserters, belts, chests, drills, orbits, selection, onSelectionChange, install = null, height = 640, laneEditor = null }: LayoutViewProps) {
    const { recipeLabel, itemLabel } = useGameNames();
    const layout = useMemo(() => layoutOf({ machines, drills, inserters, belts, chests }, tileSizeOf), [machines, drills, inserters, belts, chests]);
    const tints = useMemo(() => regionTintsOf(orbits), [orbits]);
    const bounds = useMemo(() => boundsOf(layout), [layout]);
    const combinatorList = useMemo(() => layoutCombinatorsOf(install), [install]);
    // null with no clock: the view is then exactly the view of the build alone
    const combinators = useMemo(() => combinatorList.length === 0 ? null : combinatorOfEntity(combinatorList), [combinatorList]);
    const selectedCombinator = selection === null || combinators === null ? undefined : combinators.get(`${selection.kind}:${selection.id}`);
    const names = useMemo(() => new Map<string, BoxName>([
        // a machine is its recipe's picture, a drill its ore's, a chest its type's; the words stay as the name and the hover text
        ...machines.map(machine => [`machine:${machine.id}`, { title: entityLabel('machine', machine.id), id: machine.id, icon: machine.recipe,
            corner: machineIconName(machine), detail: machine.recipe ? recipeLabel(machine.recipe) : undefined }] as const),
        ...drills.map(drill => [`drill:${drill.id}`, { title: entityLabel('drill', drill.id), id: drill.id, icon: drill.mined_item_name,
            corner: drill.type, detail: itemLabel(drill.mined_item_name) }] as const),
        ...chests.map(chest => [`chest:${chest.id}`, { title: chestLabel(chest), id: chest.id, icon: chestTypeIcon(chest.type) }] as const),
    ]), [machines, drills, chests, recipeLabel, itemLabel]);

    // the lane editor: the selected belt's tile that its editor stands beside
    const [anchor, setAnchor] = useState<SVGGElement | null>(null);
    const editedBelt = laneEditor !== null && selection?.kind === 'belt' ? selection.id : null;
    const laneBelts = laneEditor?.belts ?? null;
    const editedLanes = editedBelt === null ? undefined : laneBelts?.get(editedBelt);
    const lanes = useMemo(() => laneBelts === null ? null : { belts: laneBelts, anchorBelt: editedLanes === undefined ? null : editedBelt, onAnchor: setAnchor }, [laneBelts, editedBelt, editedLanes]);

    const [frame, setFrame] = useState<SVGSVGElement | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    // what the user has panned or zoomed to, for the extent and the measured canvas it was made for; else the fit
    const [moved, setMoved] = useState<{ key: string; transform: Transform } | null>(null);
    const drag = useRef<{ x: number; y: number; moved: boolean; down: boolean } | null>(null);

    useEffect(() => {
        if (!frame || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(frame);
        return () => observer.disconnect();
    }, [frame]);

    const fitted = useMemo((): Transform => {
        if (bounds === null) return { x: 0, y: 0, zoom: 1 };
        const width = size.width || 800, high = size.height || height;
        const boundsWidth = (bounds.maxX - bounds.minX) * LAYOUT_TILE_PX, boundsHeight = (bounds.maxY - bounds.minY) * LAYOUT_TILE_PX;
        const zoom = clampZoom(Math.min(width / boundsWidth, high / boundsHeight));
        return { zoom, x: (width - boundsWidth * zoom) / 2 - bounds.minX * LAYOUT_TILE_PX * zoom, y: (high - boundsHeight * zoom) / 2 - bounds.minY * LAYOUT_TILE_PX * zoom };
    }, [bounds, size.width, size.height, height]);
    // a pan or zoom holds until the build's extent changes or the canvas is first measured, not on every resize
    const fitKey = `${bounds?.minX},${bounds?.minY},${bounds?.maxX},${bounds?.maxY}|${size.width > 0}`;
    const transform = moved?.key === fitKey ? moved.transform : fitted;
    const setTransform = useCallback((change: (before: Transform) => Transform) => setMoved(before => ({ key: fitKey, transform: change(before?.key === fitKey ? before.transform : fitted) })), [fitKey, fitted]);
    const fit = () => setMoved(null);

    // the wheel zooms about the pointer; a listener of its own, as React's is passive and the page would scroll
    useEffect(() => {
        if (!frame) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = frame.getBoundingClientRect();
            const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            setTransform(before => {
                const zoom = clampZoom(before.zoom * Math.exp(-event.deltaY * 0.0015));
                const ratio = zoom / before.zoom;
                return { zoom, x: at.x - (at.x - before.x) * ratio, y: at.y - (at.y - before.y) * ratio };
            });
        };
        frame.addEventListener('wheel', onWheel, { passive: false });
        return () => frame.removeEventListener('wheel', onWheel);
    }, [frame, setTransform]);

    const onSelect = useCallback((kind: EntityClickType, id: number) => onSelectionChange({ kind, id }), [onSelectionChange]);
    const zoomBy = (factor: number) => setTransform(before => {
        const zoom = clampZoom(before.zoom * factor);
        const centre = { x: (size.width || 800) / 2, y: (size.height || height) / 2 };
        const ratio = zoom / before.zoom;
        return { zoom, x: centre.x - (centre.x - before.x) * ratio, y: centre.y - (centre.y - before.y) * ratio };
    });
    const onPointerDown = (event: PointerEvent<SVGSVGElement>) => { drag.current = { x: event.clientX, y: event.clientY, moved: false, down: true }; };
    const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
        const start = drag.current;
        if (!start?.down) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 4) return;
        start.moved = true;
        drag.current = { ...start, x: event.clientX, y: event.clientY, moved: true };
        setTransform(before => ({ ...before, x: before.x + dx, y: before.y + dy }));
    };
    const onPointerEnd = () => { if (drag.current) drag.current = { ...drag.current, down: false }; };

    if (bounds === null) {
        return <Typography variant="body2" sx={{ fontStyle: 'italic', mb: 3 }} data-layout-empty>{NO_POSITIONS}</Typography>;
    }
    return (
        <Box sx={{ mb: 3 }}>
            {selection && (
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                    Selected: {labelOf(chests, selection)}.{selectedCombinator !== undefined && ` Combinator ${selectedCombinator.letter.letter}: ${switchesText(selectedCombinator)}.`}
                </Typography>
            )}
            <Box sx={{ position: 'relative', height, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                <svg ref={setFrame} width="100%" height="100%" role="group" aria-label="The layout of the build" style={{ display: 'block', touchAction: 'none', cursor: 'grab', background: LAYOUT_GROUND }}
                    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerLeave={onPointerEnd}
                    // a drag that panned is not a click on what was under it
                    onClickCapture={event => { if (drag.current?.moved) event.stopPropagation(); }}>
                    <LayoutGround x={transform.x} y={transform.y} zoom={transform.zoom} />
                    <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.zoom})`}>
                        <LayoutPicture layout={layout} names={names} tints={tints} selection={selection} onSelect={onSelect} combinators={combinators} lanes={lanes} />
                    </g>
                </svg>
                <Box sx={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <IconButton size="small" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Add fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Remove fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label="Fit View" title="Fit View" onClick={fit}><CenterFocusStrong fontSize="small" /></IconButton>
                </Box>
            </Box>
            {laneEditor !== null && editedBelt !== null && editedLanes !== undefined && anchor !== null && (
                <LayoutLanePopover beltId={editedBelt} belt={editedLanes} editor={laneEditor} anchor={anchor} followed={transform} onClose={() => onSelectionChange(null)} />
            )}
            <Legend layout={layout} regions={tints} belts={belts} combinators={combinatorList} selectedCombinator={selectedCombinator}
                onSelectCombinator={combinator => onSelectionChange({ kind: combinator.kind, id: combinator.ids[0] })} />
            <Notes layout={layout} chests={chests} />
        </Box>
    );
}
