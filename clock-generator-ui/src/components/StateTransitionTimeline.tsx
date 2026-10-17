import { useChartColors } from '../hooks/useChartColors';
import { Close, Fullscreen, FilterList, Sort, Visibility, Palette } from '@mui/icons-material';
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    IconButton,
    Menu,
    MenuItem,
    Paper,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import type {
    SerializableClockWindows,
    SerializableStateTransitionHistory,
    SerializableEntityStateTransitions,
    SerializableFactorioState,
    SerializableStateTransition,
    StatusCategory,
} from 'clock-generator/browser';
import { statusToCategory } from 'clock-generator/light';
import { useGameNames } from '../hooks/useGameNames';
import { BUTTON_NAMES, CHART_NAMES, SCROLL_REGION_NAMES } from '../utils/a11yLabels';
import { MIN_MARK_PX, markSpan, paintLayer, snapSpan } from '../utils/timelineGeometry';
import { FactorioIcon } from './FactorioIcon';
import { CHART_MIN_WIDTH, ScrollX } from './ScrollX';
import {
    getStatusLabel,
    getFactorioStateLabel,
    getCategoryLabel,
    formatTransitionReason,
    INSERTER_STATUS_COLORS,
    MACHINE_STATUS_COLORS,
    DRILL_STATUS_COLORS,
    factorioStatesIn,
} from './colors';
import { sortByRelationship, sortByType } from './topological-sort';
import type { TimelineViewContext } from '../utils/buildViewContext';

interface StateTransitionTimelineProps {
    options: TimelineViewContext;
    onOptionsChange(options: TimelineViewContext): void;
    stateTransitionHistory: SerializableStateTransitionHistory;
    /** Decider windows in the blueprint per entity id, drawn as a band along the top of each row */
    clockWindows?: SerializableClockWindows;
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

// All possible detailed statuses by entity type
const ALL_INSERTER_STATUSES = Object.keys(INSERTER_STATUS_COLORS);
const ALL_MACHINE_STATUSES = Object.keys(MACHINE_STATUS_COLORS);
const ALL_DRILL_STATUSES = Object.keys(DRILL_STATUS_COLORS);
const ALL_CATEGORIES: StatusCategory[] = ['ACTIVE', 'WAITING', 'BLOCKED', 'DISABLED', 'IDLE'];

interface StatusFilters {
    // Detailed mode filters
    inserterStatuses: Set<string>;
    machineStatuses: Set<string>;
    drillStatuses: Set<string>;
    // Simplified mode filters
    categories: Set<StatusCategory>;
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
    const { status: getStatusColor, categoryColor: getCategoryColor, clock: CLOCK_WINDOW_COLOR } = useChartColors();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = useState(0);
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
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || width === 0) {
            return;
        }
        const ratio = window.devicePixelRatio || 1;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        for (const { transition, span } of marks) {
            context.globalAlpha = isFiltered(transition) ? 0.15 : 1;
            context.fillStyle = colorOf(transition);
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
    }, [marks, totalDuration, width, height, colorOf, isFiltered, hovered, CLOCK_WINDOW_COLOR]);

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
    const { factorio: getFactorioStateColor } = useChartColors();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [width, setWidth] = useState(0);
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
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || width === 0) {
            return;
        }
        const ratio = window.devicePixelRatio || 1;
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
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
    const { track: TIMELINE_TRACK_COLOR, clock: CLOCK_WINDOW_COLOR, palette: COLOR_BLIND_PALETTE } = useChartColors();
    const { nameIdsIn } = useGameNames();
    // Determine if a transition is filtered out
    const isTransitionFiltered = (transition: SerializableStateTransition): boolean => {
        if (viewMode === 'simplified') {
            const category = statusToCategory(entity.entity_type, transition.to_status);
            return !statusFilters.categories.has(category);
        } else {
            // Detailed mode
            if (entity.entity_type === 'inserter') {
                return !statusFilters.inserterStatuses.has(transition.to_status);
            } else if (entity.entity_type === 'machine') {
                return !statusFilters.machineStatuses.has(transition.to_status);
            } else {
                return !statusFilters.drillStatuses.has(transition.to_status);
            }
        }
    };

    const totalTransitionCount = entity.transitions.length;
    const visibleTransitionCount = entity.transitions.filter(t => !isTransitionFiltered(t)).length;

    // Get icon name based on entity type
    const iconName = entity.entity_type === 'inserter' 
        ? 'stack-inserter' 
        : entity.entity_type === 'drill'
        ? 'electric-mining-drill'
        : 'assembling-machine-3';

    // Get entity type color
    const entityTypeColor = entity.entity_type === 'machine' 
        ? 'success.main' 
        : entity.entity_type === 'drill'
        // a drill is not a warning: a fixed orange, not the theme's warning colour
        ? COLOR_BLIND_PALETTE.orange
        : 'info.main';

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', height: rowHeight, mb: 0.5 }}>
            {/* Entity label */}
            <Box sx={{ width: 200, flexShrink: 0, pr: 1 }}>
                <Tooltip
                    title={
                        <Box>
                            <Typography variant="body2">{nameIdsIn(entity.label)}</Typography>
                            {entity.source && (
                                <Typography variant="caption" display="block">
                                    From: {nameIdsIn(entity.source.label)}
                                </Typography>
                            )}
                            {entity.sink && (
                                <Typography variant="caption" display="block">
                                    To: {nameIdsIn(entity.sink.label)}
                                </Typography>
                            )}
                            <Typography variant="caption" display="block">
                                Transitions: {visibleTransitionCount}/{totalTransitionCount}
                            </Typography>
                            <Typography variant="caption" display="block">
                                Initial: {getStatusLabel(entity.initial_status)}
                            </Typography>
                        </Box>
                    }
                    arrow
                    placement="left"
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <FactorioIcon name={iconName} size={18} alt="" />
                        <Typography
                            variant="body2"
                            noWrap
                            sx={{
                                fontSize: '0.75rem',
                                color: entityTypeColor,
                            }}
                        >
                            {nameIdsIn(entity.label)}
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{
                                fontSize: '0.65rem',
                                color: 'text.secondary',
                                bgcolor: 'action.selected',
                                px: 0.5,
                                borderRadius: 0.5,
                            }}
                        >
                            {visibleTransitionCount !== totalTransitionCount 
                                ? `${visibleTransitionCount}/${totalTransitionCount}` 
                                : totalTransitionCount}
                        </Typography>
                        {/* Show item icons for associated items */}
                        {entity.items.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 0.25, ml: 0.5 }}>
                                {entity.items.map(item => (
                                    <FactorioIcon key={item} name={item} size={14} />
                                ))}
                            </Box>
                        )}
                    </Box>
                </Tooltip>
            </Box>

            {/* Timeline bar */}
            <Box
                sx={{
                    flex: 1,
                    height: rowHeight,
                    position: 'relative',
                    bgcolor: TIMELINE_TRACK_COLOR,
                    borderRadius: 0.5,
                }}
            >
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
            </Box>
        </Box>
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
    filters: EntityFilters;
    statusFilters: StatusFilters;
    showClockWindows: boolean;
    /** The Factorio states in the data, for the legend of the strip under each row */
    factorioStates: string[];
}

/** A swatch and its label, the swatch on the same surface as the marks it names */
function LegendChip({ label, color, active = true, swatch = { width: 12, height: 12 } }: {
    label: string;
    color: string;
    active?: boolean;
    swatch?: { width: number; height: number };
}) {
    const { track: TIMELINE_TRACK_COLOR } = useChartColors();
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.25,
                bgcolor: TIMELINE_TRACK_COLOR,
                borderRadius: 1,
                opacity: active ? 1 : 0.4,
            }}
        >
            <Box sx={{ width: swatch.width, height: swatch.height, bgcolor: color, borderRadius: 0.25 }} />
            <Typography variant="caption">{label}</Typography>
        </Box>
    );
}

function Legend({ viewMode, filters, statusFilters, showClockWindows, factorioStates }: LegendProps) {
    const { category: CATEGORY_COLORS, machine: MACHINE_STATUS_COLORS, inserter: INSERTER_STATUS_COLORS, drill: DRILL_STATUS_COLORS, factorio: getFactorioStateColor, clock: CLOCK_WINDOW_COLOR } = useChartColors();
    const items: { label: string; color: string; active: boolean }[] = [];

    if (viewMode === 'simplified') {
        // Category legend
        Object.entries(CATEGORY_COLORS).forEach(([category, color]) => {
            items.push({ 
                label: getCategoryLabel(category as StatusCategory), 
                color,
                active: statusFilters.categories.has(category as StatusCategory),
            });
        });
    } else {
        // Detailed status legend - show relevant statuses based on filters
        if (filters.machine) {
            Object.entries(MACHINE_STATUS_COLORS).forEach(([status, color]) => {
                items.push({ 
                    label: `Machine: ${getStatusLabel(status)}`, 
                    color,
                    active: statusFilters.machineStatuses.has(status),
                });
            });
        }
        if (filters.inserter) {
            Object.entries(INSERTER_STATUS_COLORS).forEach(([status, color]) => {
                items.push({ 
                    label: `Inserter: ${getStatusLabel(status)}`, 
                    color,
                    active: statusFilters.inserterStatuses.has(status),
                });
            });
        }
        if (filters.drill) {
            Object.entries(DRILL_STATUS_COLORS).forEach(([status, color]) => {
                items.push({ 
                    label: `Drill: ${getStatusLabel(status)}`, 
                    color,
                    active: statusFilters.drillStatuses.has(status),
                });
            });
        }
    }

    return (
        <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {items.map(({ label, color, active }) => (
                    <LegendChip key={label} label={label} color={color} active={active} />
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

function StateTransitionTimelineComponent({ stateTransitionHistory, clockWindows, options, onOptionsChange }: StateTransitionTimelineProps) {
    const { categoryColor: getCategoryColor, status: getStatusColor } = useChartColors();
    const factorioStates = useMemo(
        () => factorioStatesIn(stateTransitionHistory.entities.flatMap(entity => (entity.factorio_states ?? []).map(state => state.state))),
        [stateTransitionHistory.entities],
    );
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { viewMode, sortMode, filters } = options;
    const setViewMode = (viewMode: ViewMode) => onOptionsChange({ ...options, viewMode });
    const setSortMode = (sortMode: SortMode) => onOptionsChange({ ...options, sortMode });
    const setFilters = (update: (filters: EntityFilters) => EntityFilters) => onOptionsChange({ ...options, filters: update(filters) });
    const statusFilters = useMemo<StatusFilters>(() => ({
        machineStatuses: new Set(options.statuses.machine), inserterStatuses: new Set(options.statuses.inserter),
        drillStatuses: new Set(options.statuses.drill), categories: new Set(options.statuses.categories as StatusCategory[]),
    }), [options.statuses]);
    const setStatusFilters = (update: StatusFilters | ((filters: StatusFilters) => StatusFilters)) => {
        const value = typeof update === 'function' ? update(statusFilters) : update;
        onOptionsChange({ ...options, statuses: { machine: [...value.machineStatuses], inserter: [...value.inserterStatuses], drill: [...value.drillStatuses], categories: [...value.categories] } });
    };
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const [statusFilterAnchorEl, setStatusFilterAnchorEl] = useState<null | HTMLElement>(null);

    const rowHeight = 30;
    const totalDuration = stateTransitionHistory.total_duration_ticks;

    // Filter entities
    const filteredEntities = useMemo(() => {
        return stateTransitionHistory.entities.filter(entity => {
            if (entity.entity_type === 'inserter' && !filters.inserter) return false;
            if (entity.entity_type === 'machine' && !filters.machine) return false;
            if (entity.entity_type === 'drill' && !filters.drill) return false;
            return true;
        });
    }, [stateTransitionHistory.entities, filters]);

    // Sort entities
    const sortedEntities = useMemo(() => {
        return sortMode === 'byRelationship'
            ? sortByRelationship(filteredEntities)
            : sortByType(filteredEntities);
    }, [filteredEntities, sortMode]);

    // Group entities by type for "by type" view
    const { machines, inserters, drills } = useMemo(() => {
        const machines = sortedEntities.filter(e => e.entity_type === 'machine');
        const inserters = sortedEntities.filter(e => e.entity_type === 'inserter');
        const drills = sortedEntities.filter(e => e.entity_type === 'drill');
        return { machines, inserters, drills };
    }, [sortedEntities]);

    // Helper to check if a transition is filtered for a given entity type
    const isTransitionVisible = useCallback((entityType: 'inserter' | 'machine' | 'drill', status: string): boolean => {
        if (viewMode === 'simplified') {
            const category = statusToCategory(entityType, status);
            return statusFilters.categories.has(category);
        } else {
            if (entityType === 'inserter') {
                return statusFilters.inserterStatuses.has(status);
            } else if (entityType === 'machine') {
                return statusFilters.machineStatuses.has(status);
            } else {
                return statusFilters.drillStatuses.has(status);
            }
        }
    }, [viewMode, statusFilters]);

    // Calculate visible transition counts for section headers
    const transitionCounts = useMemo(() => {
        const countForEntities = (entities: SerializableEntityStateTransitions[]) => {
            let visible = 0;
            let total = 0;
            for (const entity of entities) {
                total += entity.transitions.length;
                visible += entity.transitions.filter(t => 
                    isTransitionVisible(entity.entity_type, t.to_status)
                ).length;
            }
            return { visible, total };
        };

        return {
            machines: countForEntities(machines),
            inserters: countForEntities(inserters),
            drills: countForEntities(drills),
        };
    }, [machines, inserters, drills, isTransitionVisible]);

    // Calculate tick markers
    const tickMarkers: number[] = [];
    const markerInterval = Math.ceil(totalDuration / 10 / 100) * 100;
    for (let tick = 0; tick <= totalDuration; tick += markerInterval) {
        tickMarkers.push(tick);
    }

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

    const handleStatusFilterChange = (entityType: 'inserter' | 'machine' | 'drill', status: string) => {
        setStatusFilters(prev => {
            const key = `${entityType}Statuses` as 'inserterStatuses' | 'machineStatuses' | 'drillStatuses';
            const newSet = new Set(prev[key]);
            if (newSet.has(status)) {
                newSet.delete(status);
            } else {
                newSet.add(status);
            }
            return { ...prev, [key]: newSet };
        });
    };

    const handleCategoryFilterChange = (category: StatusCategory) => {
        setStatusFilters(prev => {
            const newSet = new Set(prev.categories);
            if (newSet.has(category)) {
                newSet.delete(category);
            } else {
                newSet.add(category);
            }
            return { ...prev, categories: newSet };
        });
    };

    const handleSelectAllStatuses = () => {
        setStatusFilters({
            inserterStatuses: new Set(ALL_INSERTER_STATUSES),
            machineStatuses: new Set(ALL_MACHINE_STATUSES),
            drillStatuses: new Set(ALL_DRILL_STATUSES),
            categories: new Set(ALL_CATEGORIES),
        });
    };

    const handleClearAllStatuses = () => {
        setStatusFilters({
            inserterStatuses: new Set(),
            machineStatuses: new Set(),
            drillStatuses: new Set(),
            categories: new Set(),
        });
    };

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
                        <MenuItem onClick={() => handleFilterChange('machine')}>
                            <FormControlLabel
                                control={<Checkbox checked={filters.machine} />}
                                label="Machines"
                            />
                        </MenuItem>
                        <MenuItem onClick={() => handleFilterChange('inserter')}>
                            <FormControlLabel
                                control={<Checkbox checked={filters.inserter} />}
                                label="Inserters"
                            />
                        </MenuItem>
                        <MenuItem onClick={() => handleFilterChange('drill')}>
                            <FormControlLabel
                                control={<Checkbox checked={filters.drill} />}
                                label="Drills"
                            />
                        </MenuItem>
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
                            <Button size="small" onClick={handleSelectAllStatuses}>All</Button>
                            <Button size="small" onClick={handleClearAllStatuses}>None</Button>
                        </Box>
                        <Divider />

                        {viewMode === 'simplified' ? (
                            // Category filters
                            ALL_CATEGORIES.map(category => (
                                <MenuItem key={category} onClick={() => handleCategoryFilterChange(category)}>
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
                            // Detailed status filters
                            <>
                                {filters.machine && (
                                    <>
                                        <Typography variant="caption" sx={{ px: 2, py: 0.5, color: 'text.secondary', display: 'block' }}>
                                            Machine Statuses
                                        </Typography>
                                        {ALL_MACHINE_STATUSES.map(status => (
                                            <MenuItem key={`machine-${status}`} onClick={() => handleStatusFilterChange('machine', status)}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Checkbox checked={statusFilters.machineStatuses.has(status)} size="small" />
                                                    <Box
                                                        sx={{
                                                            width: 12,
                                                            height: 12,
                                                            bgcolor: getStatusColor('machine', status),
                                                            borderRadius: 0.25,
                                                        }}
                                                    />
                                                    <Typography variant="body2">{getStatusLabel(status)}</Typography>
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </>
                                )}
                                {filters.inserter && (
                                    <>
                                        <Typography variant="caption" sx={{ px: 2, py: 0.5, color: 'text.secondary', display: 'block' }}>
                                            Inserter Statuses
                                        </Typography>
                                        {ALL_INSERTER_STATUSES.map(status => (
                                            <MenuItem key={`inserter-${status}`} onClick={() => handleStatusFilterChange('inserter', status)}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Checkbox checked={statusFilters.inserterStatuses.has(status)} size="small" />
                                                    <Box
                                                        sx={{
                                                            width: 12,
                                                            height: 12,
                                                            bgcolor: getStatusColor('inserter', status),
                                                            borderRadius: 0.25,
                                                        }}
                                                    />
                                                    <Typography variant="body2">{getStatusLabel(status)}</Typography>
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </>
                                )}
                                {filters.drill && (
                                    <>
                                        <Typography variant="caption" sx={{ px: 2, py: 0.5, color: 'text.secondary', display: 'block' }}>
                                            Drill Statuses
                                        </Typography>
                                        {ALL_DRILL_STATUSES.map(status => (
                                            <MenuItem key={`drill-${status}`} onClick={() => handleStatusFilterChange('drill', status)}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Checkbox checked={statusFilters.drillStatuses.has(status)} size="small" />
                                                    <Box
                                                        sx={{
                                                            width: 12,
                                                            height: 12,
                                                            bgcolor: getStatusColor('drill', status),
                                                            borderRadius: 0.25,
                                                        }}
                                                    />
                                                    <Typography variant="body2">{getStatusLabel(status)}</Typography>
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                    </Menu>
                </Box>
            </Box>

            {/* Legend */}
            <Legend viewMode={viewMode} filters={filters} statusFilters={statusFilters} showClockWindows={clockWindows !== undefined} factorioStates={factorioStates} />

            <ScrollX label={SCROLL_REGION_NAMES.stateTimeline} minWidth={CHART_MIN_WIDTH} tickRoom>
            {/* Tick markers */}
            <Box sx={{ display: 'flex', mb: 0.5 }}>
                <Box sx={{ width: 200, flexShrink: 0 }} />
                <Box sx={{ flex: 1, position: 'relative', height: 20 }}>
                    {tickMarkers.map(tick => (
                        <Typography
                            key={tick}
                            variant="caption"
                            sx={{
                                position: 'absolute',
                                left: `${(tick / totalDuration) * 100}%`,
                                transform: 'translateX(-50%)',
                                color: 'text.secondary',
                                fontSize: '0.65rem',
                            }}
                        >
                            {tick}
                        </Typography>
                    ))}
                </Box>
            </Box>

            {/* Timeline content */}
            {sortMode === 'byType' ? (
                <>
                    {filters.machine && (
                        <EntitySection
                            title="Machines"
                            entities={machines}
                            counts={transitionCounts.machines}
                            mb={2}
                            totalDuration={totalDuration}
                            rowHeight={isFullscreen ? 32 : rowHeight}
                            viewMode={viewMode}
                            statusFilters={statusFilters}
                            clockWindows={clockWindows}
                        />
                    )}
                    {filters.inserter && (
                        <EntitySection
                            title="Inserters"
                            entities={inserters}
                            counts={transitionCounts.inserters}
                            mb={2}
                            totalDuration={totalDuration}
                            rowHeight={isFullscreen ? 32 : rowHeight}
                            viewMode={viewMode}
                            statusFilters={statusFilters}
                            clockWindows={clockWindows}
                        />
                    )}
                    {filters.drill && (
                        <EntitySection
                            title="Mining Drills"
                            entities={drills}
                            counts={transitionCounts.drills}
                            totalDuration={totalDuration}
                            rowHeight={isFullscreen ? 32 : rowHeight}
                            viewMode={viewMode}
                            statusFilters={statusFilters}
                            clockWindows={clockWindows}
                        />
                    )}
                </>
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

    return (
        <>
            <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6" component="h3">
                        State Transition Timeline
                    </Typography>
                    <Tooltip title="Open fullscreen">
                        <IconButton onClick={() => setIsModalOpen(true)} size="small">
                            <Fullscreen />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Total simulation duration: {totalDuration} ticks ({(totalDuration / 60).toFixed(1)} seconds)
                </Typography>

                {timelineContent(false)}
            </Paper>

            {/* Fullscreen Modal */}
            <Dialog
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                maxWidth={false}
                fullScreen
                slotProps={{
                    paper: {
                        sx: {
                            bgcolor: 'background.default',
                        },
                    }
                }}
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        <Typography variant="h5" component="span">
                            State Transition Timeline
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }} component="span">
                            {totalDuration} ticks ({(totalDuration / 60).toFixed(1)} seconds)
                        </Typography>
                    </Box>
                    <IconButton onClick={() => setIsModalOpen(false)} edge="end" aria-label={BUTTON_NAMES.closeFullscreen}>
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{ overflow: 'auto' }}>
                    {timelineContent(true)}
                </DialogContent>
            </Dialog>
        </>
    );
}

export const StateTransitionTimeline = memo(StateTransitionTimelineComponent);
