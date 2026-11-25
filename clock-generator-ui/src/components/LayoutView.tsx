import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { Add, CenterFocusStrong, Remove } from '@mui/icons-material';
import type { FoundOrbit } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import { chestLabel, entityLabel, nameInSentence, type LabelKind } from '../utils/entityLabel';
import { boundsOf, LAYOUT_TILE_PX } from '../utils/layoutBounds';
import { beltColour, regionColour } from '../utils/layoutColours';
import { layoutOf, type EntityRef, type Layout } from '../utils/layoutOf';
import { regionTintsOf } from '../utils/layoutRegions';
import { tileSizeOf } from '../utils/layoutSizes';
import type { EntityClickType } from './ConfigFlowDiagram';
import { LayoutGround, LayoutPicture } from './LayoutPicture';

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
    height?: number;
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

function Swatch({ colour }: { colour: string }) {
    return <Box component="span" sx={{ display: 'inline-block', width: 14, height: 14, bgcolor: colour, border: '1px solid #1a1a1a', borderRadius: '2px', verticalAlign: 'text-bottom', mr: 0.75 }} />;
}

function Legend({ layout, regions }: { layout: Layout; regions: ReturnType<typeof regionTintsOf> }) {
    const regionNumbers = regions === null ? [] : Array.from({ length: regions.count }, (_, index) => index + 1);
    const machinesIn = (region: number) => [...(regions?.of ?? [])].flatMap(([key, number]) => number === region && key.startsWith('machine:') ? [Number(key.slice('machine:'.length))] : []).sort((a, b) => a - b);
    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5, mt: 1 }} data-layout-legend>
            {regionNumbers.map(region => (
                <Typography variant="caption" key={`region-${region}`}><Swatch colour={regionColour(region)} />Region {region}: machines {machinesIn(region).join(', ')}</Typography>
            ))}
            {regions !== null && <Typography variant="caption"><Swatch colour={regionColour(0)} />Between the regions</Typography>}
            {regions !== null && regions.twins.size > 0 && <Typography variant="caption">=N: the matching inserter of another region</Typography>}
            {layout.belts.filter(belt => belt.tiles > 0).map(belt => (
                <Typography variant="caption" key={`belt-${belt.id}`}><Swatch colour={beltColour(belt.id)} />{entityLabel('belt', belt.id)}</Typography>
            ))}
            <Typography variant="caption" sx={{ flexBasis: '100%' }}>
                Number: the inserter's number, as in the List. Each inserter is drawn from the side it picks from (dot) to the side it drops on (arrow).
                A belt tile is one an inserter reaches; the arrow on it is the way the belt runs at a drop.
            </Typography>
        </Box>
    );
}

/**
 * The Layout view of the Build panel: the build drawn from above from the positions its config holds, north up, with the
 * numbers of its inserters and the belts they reach. It only reads: a click selects, as in the diagram, and nothing is edited.
 */
export function LayoutView({ machines, inserters, belts, chests, drills, orbits, selection, onSelectionChange, height = 520 }: LayoutViewProps) {
    const { recipeLabel, itemLabel } = useGameNames();
    const layout = useMemo(() => layoutOf({ machines, drills, inserters, belts, chests }, tileSizeOf), [machines, drills, inserters, belts, chests]);
    const tints = useMemo(() => regionTintsOf(orbits), [orbits]);
    const bounds = useMemo(() => boundsOf(layout), [layout]);
    const names = useMemo(() => new Map<string, { title: string; detail?: string }>([
        ...machines.map(machine => [`machine:${machine.id}`, { title: entityLabel('machine', machine.id), detail: machine.recipe ? recipeLabel(machine.recipe) : undefined }] as const),
        ...drills.map(drill => [`drill:${drill.id}`, { title: entityLabel('drill', drill.id), detail: itemLabel(drill.mined_item_name) }] as const),
        ...chests.map(chest => [`chest:${chest.id}`, { title: chestLabel(chest) }] as const),
    ]), [machines, drills, chests, recipeLabel, itemLabel]);

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
            {selection && <Typography variant="body2" sx={{ mb: 0.5 }}>Selected: {labelOf(chests, selection)}.</Typography>}
            <Box sx={{ position: 'relative', height, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                <svg ref={setFrame} width="100%" height="100%" role="group" aria-label="The layout of the build" style={{ display: 'block', touchAction: 'none', cursor: 'grab' }}
                    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerLeave={onPointerEnd}
                    // a drag that panned is not a click on what was under it
                    onClickCapture={event => { if (drag.current?.moved) event.stopPropagation(); }}>
                    <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.zoom})`}>
                        <LayoutGround {...bounds} />
                        <LayoutPicture layout={layout} names={names} tints={tints} selection={selection} onSelect={(kind, id) => onSelectionChange({ kind, id })} />
                    </g>
                </svg>
                <Box sx={{ position: 'absolute', left: 8, bottom: 8, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <IconButton size="small" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Add fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Remove fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label="Fit View" title="Fit View" onClick={fit}><CenterFocusStrong fontSize="small" /></IconButton>
                </Box>
            </Box>
            <Legend layout={layout} regions={tints} />
            <Notes layout={layout} chests={chests} />
        </Box>
    );
}
