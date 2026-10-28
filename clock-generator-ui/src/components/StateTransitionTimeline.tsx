import { BeltChartFrame, ChartSwatch, TimelineAxis } from './BeltChart';
import { canvasChartFill, statusPattern, type ChartPattern } from '../theme/beltCharts';
import { axisTicks } from '../utils/wakeWindows';
import { FilterList, Sort, Visibility, Palette } from '@mui/icons-material';
import {
    Box,
    Button,
    Checkbox,
    Divider,
    FormControlLabel,
    IconButton,
    Menu,
    MenuItem,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import type {
    PortableStateTransitionHistory,
    SerializableClockWindows,
    SerializableEntityStateTransitions,
    SerializableFactorioState,
    SerializableStateTransition,
    StatusCategory,
} from 'clock-generator/browser';
import { expandStateTransitionHistory, statusToCategory } from 'clock-generator/light';
import { useGameNames } from '../hooks/useGameNames';
import { CHART_NAMES, SCROLL_REGION_NAMES } from '../utils/a11yLabels';
import { MIN_MARK_PX, markSpan, paintableCanvas, paintLayer, snapSpan } from '../utils/timelineGeometry';
import { useElementWidth } from '../hooks/useElementWidth';
import { HistoricalTimelineRow } from './HistoricalTimelineRow';
import { CHART_MIN_WIDTH, ScrollX } from './ScrollX';
import {
    chartColorsFor,
    getStatusLabel,
    getFactorioStateLabel,
    getCategoryLabel,
    formatTransitionReason,
    factorioStatesIn,
} from './colors';
import { sortByRelationship, sortByType } from './topological-sort';
import type { TimelineViewContext } from '../utils/buildViewContext';

/** Plot hues stay fixed on black, while labels and controls use the app theme. */
const PLOT_COLORS = chartColorsFor('dark');

interface StateTransitionTimelineProps {
    options: TimelineViewContext;
    onOptionsChange(options: TimelineViewContext): void;
    /** The history in columns, read into a transition object each when the timeline opens */
    stateTransitionHistory: PortableStateTransitionHistory;
    /** Decider windows in the blueprint per entity id, drawn as a band along the top of each row */
    clockWindows?: SerializableClockWindows;
    fullscreen?: boolean;
}

const CLOCK_WINDOW_LABEL = 'Wake window (decider on; the inserter reacts 2 ticks later)';

/** The thin strip under each row that shows the state the entity would show in Factorio */
const FACTORIO_STATE_STRIP_HEIGHT = 6;

type ViewMode = 'detailed' | 'simplified';
type SortMode = 'byType' | 'byRelationship';

interface EntityFilters {
    inserter: boolean;
    machine: boolean;
    drill: boolean;
}

type EntityKind = SerializableEntityStateTransitions['entity_type'];
const ENTITY_GROUPS: { kind: EntityKind; name: string; title: string; filterLabel: string; colors: Record<string, string> }[] = [
    { kind: 'machine', name: 'Machine', title: 'Machines', filterLabel: 'Machines', colors: PLOT_COLORS.machine },
    { kind: 'inserter', name: 'Inserter', title: 'Inserters', filterLabel: 'Inserters', colors: PLOT_COLORS.inserter },
    { kind: 'drill', name: 'Drill', title: 'Mining Drills', filterLabel: 'Drills', colors: PLOT_COLORS.drill },
];
const ALL_CATEGORIES: StatusCategory[] = ['ACTIVE', 'WAITING', 'BLOCKED', 'DISABLED', 'IDLE'];
type StatusFilters = Record<EntityKind | 'categories', Set<string>>;

function statusVisible(entityType: EntityKind, status: string, viewMode: ViewMode, filters: StatusFilters): boolean {
    return viewMode === 'simplified'
        ? filters.categories.has(statusToCategory(entityType, status))
        : filters[entityType].has(status);
}

interface TimelineBarProps {
    transitions: SerializableStateTransition[];
    totalDuration: number;
    height: number;
    entityType: 'inserter' | 'machine' | 'drill';
    viewMode: ViewMode;
    isFiltered: (transition: SerializableStateTransition) => boolean;
    /** The row's name, for the canvas's accessible name */
    label: string;
}

/** Drawn on a canvas: an element per transition does not scale to tens of thousands of transitions */
function TimelineBar({ transitions, totalDuration, height, entityType, viewMode, isFiltered, label }: TimelineBarProps) {
    const { status: getStatusColor, categoryColor: getCategoryColor, clock: CLOCK_WINDOW_COLOR } = PLOT_COLORS;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const width = useElementWidth(canvasRef);
    const [hovered, setHovered] = useState<SerializableStateTransition | null>(null);
    const sorted = useMemo(() => [...transitions].sort((a, b) => a.tick - b.tick), [transitions]);

    // Wide marks first, then narrow ones, Blocked last so a narrow Blocked mark is never the one covered.
    // Built once per width, not per hover: a build can have tens of thousands of transitions.
    const marks = useMemo(() => sorted
        .map(transition => {
            const span = markSpan(transition.tick, transition.duration_ticks, totalDuration, width);
            const layer = paintLayer(span, statusToCategory(entityType, transition.to_status) === 'BLOCKED');
            return { transition, span, layer };
        })
        .sort((a, b) => a.layer - b.layer), [sorted, totalDuration, width, entityType]);

    const colorOf = useCallback((transition: SerializableStateTransition) => viewMode === 'detailed'
        ? getStatusColor(entityType, transition.to_status)
        : getCategoryColor(statusToCategory(entityType, transition.to_status)), [entityType, viewMode, getStatusColor, getCategoryColor]);

    useEffect(() => {
        const paintable = paintableCanvas(canvasRef.current, width, height);
        if (!paintable) return;
        const { context, ratio } = paintable;
        const fills = new Map<string, string | CanvasPattern>();
        for (const { transition, span } of marks) {
            context.globalAlpha = isFiltered(transition) ? 0.15 : 1;
            const color = colorOf(transition);
            const pattern = statusPattern(statusToCategory(entityType, transition.to_status));
            const key = `${color}:${pattern}`;
            if (!fills.has(key)) fills.set(key, canvasChartFill(context, { color, pattern }));
            context.fillStyle = fills.get(key)!;
            // whole device pixels, so a 3px mark is three solid pixels and not two solid and two half-covered
            const snapped = snapSpan(span, ratio);
            context.fillRect(snapped.x, 0, snapped.width, height);
        }
        if (hovered) {
            const span = markSpan(hovered.tick, hovered.duration_ticks, totalDuration, width);
            context.globalAlpha = 1;
            context.strokeStyle = CLOCK_WINDOW_COLOR;
            const snapped = snapSpan(span, ratio);
            context.strokeRect(snapped.x + 0.5, 0.5, snapped.width - 1, height - 1);
        }
    }, [marks, totalDuration, width, height, colorOf, isFiltered, hovered, CLOCK_WINDOW_COLOR, entityType]);

    const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const tick = ((event.clientX - rect.left) / rect.width) * totalDuration;
        let low = 0;
        let high = sorted.length - 1;
        let found: SerializableStateTransition | null = null;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (sorted[mid].tick <= tick) {
                found = sorted[mid];
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        // narrow transitions are drawn at least MIN_MARK_PX wide
        const min_ticks = (MIN_MARK_PX / Math.max(rect.width, 1)) * totalDuration;
        const hit = found && tick <= found.tick + Math.max(found.duration_ticks, min_ticks) ? found : null;
        if (hit !== hovered) {
            setHovered(hit);
        }
    };

    const statusLabel = (transition: SerializableStateTransition) => viewMode === 'detailed'
        ? getStatusLabel(transition.to_status)
        : getCategoryLabel(statusToCategory(entityType, transition.to_status));

    return (
        <Tooltip
            open={hovered !== null}
            followCursor
            arrow
            placement="top"
            title={hovered ? (
                <Box>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                        {statusLabel(hovered)}
                    </Typography>
                    <Typography variant="caption" display="block">
                        From: {getStatusLabel(hovered.from_status)}
                    </Typography>
                    <Typography variant="caption" display="block">
                        Tick {hovered.tick} ({hovered.duration_ticks} ticks)
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                        {formatTransitionReason(hovered.reason).icon} {formatTransitionReason(hovered.reason).text}
                    </Typography>
                </Box>
            ) : ''}
        >
            <canvas
                ref={canvasRef}
                role="img"
                aria-label={CHART_NAMES.stateTimeline(label, transitions.length)}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHovered(null)}
                style={{ position: 'absolute', left: 0, top: 2, width: '100%', height, cursor: 'pointer' }}
            />
        </Tooltip>
    );
}

interface FactorioStateStripProps {
    states: SerializableFactorioState[];
    totalDuration: number;
    height: number;
    /** The row's name, for the canvas's accessible name */
    label: string;
}

/** The state the entity would show in Factorio, under the simulator's phases: the shared language with a recording */
function FactorioStateStrip({ states, totalDuration, height, label }: FactorioStateStripProps) {
    const { factorio: getFactorioStateColor } = PLOT_COLORS;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const width = useElementWidth(canvasRef);
    const [hovered, setHovered] = useState<SerializableFactorioState | null>(null);
    const sorted = useMemo(() => [...states].sort((a, b) => a.tick - b.tick), [states]);
    // wide marks first, then the narrow ones, so a narrow mark is not buried under a wide neighbour
    const marks = useMemo(() => sorted
        .map(state => {
            const span = markSpan(state.tick, state.duration_ticks, totalDuration, width);
            return { state, span, layer: paintLayer(span, false) };
        })
        .sort((a, b) => a.layer - b.layer), [sorted, totalDuration, width]);

    useEffect(() => {
        const paintable = paintableCanvas(canvasRef.current, width, height);
        if (!paintable) return;
        const { context, ratio } = paintable;
        for (const { state, span } of marks) {
            context.fillStyle = getFactorioStateColor(state.state);
            const snapped = snapSpan(span, ratio);
            context.fillRect(snapped.x, 0, snapped.width, height);
        }
    }, [marks, width, height, getFactorioStateColor]);

    const stateAt = useCallback((clientX: number): SerializableFactorioState | null => {
        const canvas = canvasRef.current;
        if (!canvas || width === 0) {
            return null;
        }
        const tick = ((clientX - canvas.getBoundingClientRect().left) / width) * totalDuration;
        let current: SerializableFactorioState | null = null;
        for (const state of sorted) {
            if (state.tick <= tick) {
                current = state;
            } else {
                break;
            }
        }
        return current;
    }, [sorted, totalDuration, width]);

    return (
        <Tooltip
            open={hovered !== null}
            title={hovered ? `Factorio: ${getFactorioStateLabel(hovered.state)}, tick ${hovered.tick} for ${hovered.duration_ticks} ticks` : ''}
            placement="bottom"
            arrow
        >
            <canvas
                ref={canvasRef}
                role="img"
                aria-label={CHART_NAMES.factorioStrip(label, states.length)}
                style={{ width: '100%', height, display: 'block' }}
                onMouseMove={event => setHovered(stateAt(event.clientX))}
                onMouseLeave={() => setHovered(null)}
            />
        </Tooltip>
    );
}

interface EntityRowProps {
    entity: SerializableEntityStateTransitions;
    totalDuration: number;
    rowHeight: number;
    viewMode: ViewMode;
    statusFilters: StatusFilters;
    clockWindows?: { start: number; end: number }[];
}

function EntityRow({ entity, totalDuration, rowHeight, viewMode, statusFilters, clockWindows = [] }: EntityRowProps) {
    const { clock: CLOCK_WINDOW_COLOR } = PLOT_COLORS;
    const { nameIdsIn } = useGameNames();
    const isTransitionFiltered = (transition: SerializableStateTransition) =>
        !statusVisible(entity.entity_type, transition.to_status, viewMode, statusFilters);

    const totalTransitionCount = entity.transitions.length;
    const visibleTransitionCount = entity.transitions.filter(t => !isTransitionFiltered(t)).length;

    return (
        <HistoricalTimelineRow variant="state" entity={entity} items={entity.items} duration={totalDuration} height={rowHeight}
            count={visibleTransitionCount !== totalTransitionCount ? `${visibleTransitionCount}/${totalTransitionCount}` : totalTransitionCount}
            details={<>
                <Typography variant="caption" display="block">Transitions: {visibleTransitionCount}/{totalTransitionCount}</Typography>
                <Typography variant="caption" display="block">Initial: {getStatusLabel(entity.initial_status)}</Typography>
            </>}>
            <TimelineBar
                transitions={entity.transitions}
                totalDuration={totalDuration}
                height={rowHeight - 4 - FACTORIO_STATE_STRIP_HEIGHT}
                entityType={entity.entity_type}
                viewMode={viewMode}
                isFiltered={isTransitionFiltered}
                label={nameIdsIn(entity.label)}
            />
            <FactorioStateStrip
                label={nameIdsIn(entity.label)}
                states={entity.factorio_states ?? []}
                totalDuration={totalDuration}
                height={FACTORIO_STATE_STRIP_HEIGHT}
            />
            {clockWindows.map(window => (
                <Box
                    key={`${window.start}-${window.end}`}
                    sx={{
                        position: 'absolute',
                        top: 0,
                        height: 3,
                        left: `${(window.start / totalDuration) * 100}%`,
                        width: `${((window.end - window.start + 1) / totalDuration) * 100}%`,
                        bgcolor: CLOCK_WINDOW_COLOR,
                        pointerEvents: 'none',
                    }}
                />
            ))}
        </HistoricalTimelineRow>
    );
}

interface EntitySectionProps {
    title: string;
    entities: SerializableEntityStateTransitions[];
    counts: { visible: number; total: number };
    mb?: number;
    totalDuration: number;
    rowHeight: number;
    viewMode: ViewMode;
    statusFilters: StatusFilters;
    clockWindows?: SerializableClockWindows;
}

/** One entity type's rows in the "by type" view, under a header with its transition count */
function EntitySection({ title, entities, counts, mb, totalDuration, rowHeight, viewMode, statusFilters, clockWindows }: EntitySectionProps) {
    if (entities.length === 0) {
        return null;
    }
    return (
        <Box sx={{ mb }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                {title} ({entities.length}) · {counts.visible !== counts.total 
                    ? `${counts.visible}/${counts.total} transitions` 
                    : `${counts.total} transitions`}
            </Typography>
            {entities.map(entity => (
                <EntityRow
                    key={entity.entity_id}
                    entity={entity}
                    totalDuration={totalDuration}
                    rowHeight={rowHeight}
                    viewMode={viewMode}
                    statusFilters={statusFilters}
                    clockWindows={clockWindows?.[entity.entity_id]}
                />
            ))}
        </Box>
    );
}

interface LegendProps {
    viewMode: ViewMode;
    entities: SerializableEntityStateTransitions[];
    statusFilters: StatusFilters;
    showClockWindows: boolean;
    /** The Factorio states in the data, for the legend of the strip under each row */
    factorioStates: string[];
}

/** A swatch and its label, the swatch on the same surface as the marks it names */
function LegendChip({ label, color, pattern = 'solid', active = true, swatch = { width: 12, height: 12 } }: {
    label: string;
    color: string;
    active?: boolean;
    pattern?: ChartPattern;
    swatch?: { width: number; height: number };
}) {
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: 0,
                color: active ? 'text.primary' : 'text.secondary',
            }}
        >
            <ChartSwatch color={color} pattern={pattern} sx={{ width: swatch.width < 12 ? swatch.width : 22, height: swatch.height }} />
            <Typography variant="caption">{label}{!active && ' (hidden)'}</Typography>
        </Box>
    );
}

function Legend({ viewMode, entities, statusFilters, showClockWindows, factorioStates }: LegendProps) {
    const { category: CATEGORY_COLORS, factorio: getFactorioStateColor, clock: CLOCK_WINDOW_COLOR } = PLOT_COLORS;
    const items: { label: string; color: string; active: boolean; pattern: ChartPattern }[] = [];

    if (viewMode === 'simplified') {
        // Category legend
        Object.entries(CATEGORY_COLORS).forEach(([category, color]) => {
            items.push({ 
                label: getCategoryLabel(category as StatusCategory), 
                color,
                active: statusFilters.categories.has(category as StatusCategory),
                pattern: statusPattern(category),
            });
        });
    } else {
        for (const { kind, name, colors } of ENTITY_GROUPS) {
            if (!entities.some(entity => entity.entity_type === kind)) continue;
            for (const [status, color] of Object.entries(colors)) {
                items.push({ label: `${name}: ${getStatusLabel(status)}`, color,
                    active: statusFilters[kind].has(status), pattern: statusPattern(statusToCategory(kind, status)) });
            }
        }
    }

    return (
        <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {items.map(({ label, color, active, pattern }) => (
                    <LegendChip key={label} label={label} color={color} active={active} pattern={pattern} />
                ))}
                {showClockWindows && (
                    <LegendChip label={CLOCK_WINDOW_LABEL} color={CLOCK_WINDOW_COLOR} swatch={{ width: 12, height: 3 }} />
                )}
            </Box>
            {factorioStates.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">Bottom strip: the state the game shows</Typography>
                    {factorioStates.map(state => (
                        <LegendChip key={state} label={getFactorioStateLabel(state)} color={getFactorioStateColor(state)} />
                    ))}
                </Box>
            )}
        </Box>
    );
}

function StateTransitionTimelineComponent({ stateTransitionHistory: columns, clockWindows, options, onOptionsChange, fullscreen = false }: StateTransitionTimelineProps) {
    const stateTransitionHistory = useMemo(() => expandStateTransitionHistory(columns), [columns]);
    const { categoryColor: getCategoryColor, status: getStatusColor } = PLOT_COLORS;
    const factorioStates = useMemo(
        () => factorioStatesIn(stateTransitionHistory.entities.flatMap(entity => (entity.factorio_states ?? []).map(state => state.state))),
        [stateTransitionHistory.entities],
    );
    const { viewMode, sortMode, filters } = options;
    const setViewMode = (viewMode: ViewMode) => onOptionsChange({ ...options, viewMode });
    const setSortMode = (sortMode: SortMode) => onOptionsChange({ ...options, sortMode });
    const setFilters = (update: (filters: EntityFilters) => EntityFilters) => onOptionsChange({ ...options, filters: update(filters) });
    const statusFilters = useMemo<StatusFilters>(() => ({
        machine: new Set(options.statuses.machine), inserter: new Set(options.statuses.inserter),
        drill: new Set(options.statuses.drill), categories: new Set(options.statuses.categories),
    }), [options.statuses]);
    const setStatusFilters = (update: StatusFilters | ((filters: StatusFilters) => StatusFilters)) => {
        const value = typeof update === 'function' ? update(statusFilters) : update;
        onOptionsChange({ ...options, statuses: { machine: [...value.machine], inserter: [...value.inserter], drill: [...value.drill], categories: [...value.categories] } });
    };
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const [statusFilterAnchorEl, setStatusFilterAnchorEl] = useState<null | HTMLElement>(null);

    const rowHeight = 30;
    const totalDuration = stateTransitionHistory.total_duration_ticks;

    const filteredEntities = useMemo(() => stateTransitionHistory.entities.filter(entity => filters[entity.entity_type]),
        [stateTransitionHistory.entities, filters]);

    // Sort entities
    const sortedEntities = useMemo(() => {
        return sortMode === 'byRelationship'
            ? sortByRelationship(filteredEntities)
            : sortByType(filteredEntities);
    }, [filteredEntities, sortMode]);

    const groups = useMemo(() => ENTITY_GROUPS.map(group => {
        const entities = sortedEntities.filter(entity => entity.entity_type === group.kind);
        const counts = entities.reduce((counts, entity) => ({
            visible: counts.visible + entity.transitions.filter(transition => statusVisible(group.kind, transition.to_status, viewMode, statusFilters)).length,
            total: counts.total + entity.transitions.length,
        }), { visible: 0, total: 0 });
        return { ...group, entities, counts };
    }), [sortedEntities, viewMode, statusFilters]);

    const tickMarkers = axisTicks(totalDuration, 7);

    const handleViewModeChange = (_: React.MouseEvent, newMode: ViewMode | null) => {
        if (newMode) setViewMode(newMode);
    };

    const handleSortModeChange = (_: React.MouseEvent, newMode: SortMode | null) => {
        if (newMode) setSortMode(newMode);
    };

    const handleFilterClick = (event: React.MouseEvent<HTMLElement>) => {
        setFilterAnchorEl(event.currentTarget);
    };

    const handleFilterClose = () => {
        setFilterAnchorEl(null);
    };

    const handleFilterChange = (entityType: keyof EntityFilters) => {
        setFilters(prev => ({ ...prev, [entityType]: !prev[entityType] }));
    };

    const handleStatusFilterClick = (event: React.MouseEvent<HTMLElement>) => {
        setStatusFilterAnchorEl(event.currentTarget);
    };

    const handleStatusFilterClose = () => {
        setStatusFilterAnchorEl(null);
    };

    const toggleStatus = (key: keyof StatusFilters, status: string) => {
        setStatusFilters(prev => {
            const selected = new Set(prev[key]);
            if (selected.has(status)) selected.delete(status);
            else selected.add(status);
            return { ...prev, [key]: selected };
        });
    };

    const selectAllStatuses = (all: boolean) => setStatusFilters({
        machine: new Set(all ? Object.keys(PLOT_COLORS.machine) : []),
        inserter: new Set(all ? Object.keys(PLOT_COLORS.inserter) : []),
        drill: new Set(all ? Object.keys(PLOT_COLORS.drill) : []),
        categories: new Set(all ? ALL_CATEGORIES : []),
    });

    const timelineContent = (isFullscreen: boolean) => (
        <>
            {/* Controls */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* View Mode */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Visibility sx={{ fontSize: 18, color: 'text.secondary' }} />
                    <ToggleButtonGroup
                        value={viewMode}
                        exclusive
                        onChange={handleViewModeChange}
                        size="small"
                    >
                        <ToggleButton value="simplified">Simplified</ToggleButton>
                        <ToggleButton value="detailed">Detailed</ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                {/* Sort Mode */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Sort sx={{ fontSize: 18, color: 'text.secondary' }} />
                    <ToggleButtonGroup
                        value={sortMode}
                        exclusive
                        onChange={handleSortModeChange}
                        size="small"
                    >
                        <ToggleButton value="byType">By Type</ToggleButton>
                        <ToggleButton value="byRelationship">By Flow</ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                {/* Filter */}
                <Box>
                    <Tooltip title="Filter entity types">
                        <IconButton onClick={handleFilterClick} size="small">
                            <FilterList />
                        </IconButton>
                    </Tooltip>
                    <Menu
                        anchorEl={filterAnchorEl}
                        open={Boolean(filterAnchorEl)}
                        onClose={handleFilterClose}
                    >
                        {ENTITY_GROUPS.map(({ kind, filterLabel }) => (
                            <MenuItem key={kind} onClick={() => handleFilterChange(kind)}>
                                <FormControlLabel control={<Checkbox checked={filters[kind]} />} label={filterLabel} />
                            </MenuItem>
                        ))}
                    </Menu>
                </Box>

                {/* Status Filter */}
                <Box>
                    <Tooltip title="Filter by status">
                        <IconButton onClick={handleStatusFilterClick} size="small">
                            <Palette />
                        </IconButton>
                    </Tooltip>
                    <Menu
                        anchorEl={statusFilterAnchorEl}
                        open={Boolean(statusFilterAnchorEl)}
                        onClose={handleStatusFilterClose}
                        PaperProps={{ sx: { maxHeight: 400 } }}
                    >
                        {/* Select All / Clear All */}
                        <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1 }}>
                            <Button size="small" onClick={() => selectAllStatuses(true)}>All</Button>
                            <Button size="small" onClick={() => selectAllStatuses(false)}>None</Button>
                        </Box>
                        <Divider />

                        {viewMode === 'simplified' ? (
                            // Category filters
                            ALL_CATEGORIES.map(category => (
                                <MenuItem key={category} onClick={() => toggleStatus('categories', category)}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Checkbox checked={statusFilters.categories.has(category)} size="small" />
                                        <Box
                                            sx={{
                                                width: 12,
                                                height: 12,
                                                bgcolor: getCategoryColor(category),
                                                borderRadius: 0.25,
                                            }}
                                        />
                                        <Typography variant="body2">{getCategoryLabel(category)}</Typography>
                                    </Box>
                                </MenuItem>
                            ))
                        ) : (
                            ENTITY_GROUPS.filter(group => filters[group.kind]).flatMap(({ kind, name, colors }) => [
                                <Typography key={`${kind}-heading`} variant="caption" sx={{ px: 2, py: 0.5, color: 'text.secondary', display: 'block' }}>
                                    {name} Statuses
                                </Typography>,
                                ...Object.keys(colors).map(status => (
                                    <MenuItem key={`${kind}-${status}`} onClick={() => toggleStatus(kind, status)}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Checkbox checked={statusFilters[kind].has(status)} size="small" />
                                            <Box sx={{ width: 12, height: 12, bgcolor: getStatusColor(kind, status), borderRadius: 0.25 }} />
                                            <Typography variant="body2">{getStatusLabel(status)}</Typography>
                                        </Box>
                                    </MenuItem>
                                )),
                            ])
                        )}
                    </Menu>
                </Box>
            </Box>

            {/* Legend */}


            <Box sx={{ mb: 1.5 }}>
            <Legend viewMode={viewMode} entities={filteredEntities} statusFilters={statusFilters} showClockWindows={clockWindows !== undefined} factorioStates={factorioStates} />
            </Box>
            <ScrollX label={SCROLL_REGION_NAMES.stateTimeline} minWidth={CHART_MIN_WIDTH} tickRoom>
            <Box sx={{ display: 'flex', mb: 1 }}>
                <Box sx={{ width: 220, flexShrink: 0 }} />
                <Box sx={{ flex: 1 }}><TimelineAxis duration={totalDuration} marks={tickMarkers} /></Box>
            </Box>

            {/* Timeline content */}
            {sortMode === 'byType' ? (
                groups.filter(group => filters[group.kind]).map(({ kind, title, entities, counts }) => (
                    <EntitySection key={kind} title={title} entities={entities} counts={counts}
                        mb={kind === 'drill' ? undefined : 2} totalDuration={totalDuration}
                        rowHeight={isFullscreen ? 32 : rowHeight} viewMode={viewMode}
                        statusFilters={statusFilters} clockWindows={clockWindows} />
                ))
            ) : (
                // By relationship - show all sorted entities together
                <Box>
                    {sortedEntities.map(entity => (
                        <EntityRow
                            key={entity.entity_id}
                            entity={entity}
                            totalDuration={totalDuration}
                            rowHeight={isFullscreen ? 32 : rowHeight}
                            viewMode={viewMode}
                            statusFilters={statusFilters}
                            clockWindows={clockWindows?.[entity.entity_id]}
                        />
                    ))}
                </Box>
            )}
            </ScrollX>

        </>
    );

    return <BeltChartFrame title="Entity states" subtitle={`${totalDuration.toLocaleString()} ticks · ${(totalDuration / 60).toFixed(1)} s · ${filteredEntities.length} entities`}>
        {timelineContent(fullscreen)}
    </BeltChartFrame>;
}

export const StateTransitionTimeline = memo(function StateTransitionTimeline(props: StateTransitionTimelineProps) {
    return <StateTransitionTimelineComponent {...props} />;
});
