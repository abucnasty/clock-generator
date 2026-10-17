import { Box, Tooltip, Typography } from '@mui/material';
import { memo, useMemo } from 'react';
import type { SerializableEntityTransferHistory, SerializableTransferEntry, SerializableTransferHistory } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { SCROLL_REGION_NAMES } from '../utils/a11yLabels';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { CHART_MIN_WIDTH, ScrollX } from './ScrollX';
import { BeltChartFrame, ChartSwatch, TimelineAxis, chartGridSx } from './BeltChart';
import { itemChartStyles, patternBackground, type ItemChartStyle } from '../theme/beltCharts';
import { MIN_MARK_PX } from '../utils/timelineGeometry';

interface TransferHistoryVisualizationProps {
    transferHistory: SerializableTransferHistory;
    fullscreen?: boolean;
}

interface TransferBarProps {
    transfer: SerializableTransferEntry;
    totalDuration: number;
    rowHeight: number;
    colorMap: Map<string, ItemChartStyle>;
}

function TransferBar({ transfer, totalDuration, rowHeight, colorMap }: TransferBarProps) {
    const startPercent = (transfer.start_tick / totalDuration) * 100;
    const widthPercent = ((transfer.end_tick - transfer.start_tick) / totalDuration) * 100;
    const style = colorMap.get(transfer.item_name) ?? { color: '#ffffff', pattern: 'solid' as const }; // unreachable: the map is built from these same transfers

    return (
        <Tooltip
            title={
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <FactorioIcon name={transfer.item_name} size={16} alt="" />
                        <Typography variant="body2"><GameName id={transfer.item_name} /></Typography>
                    </Box>
                    <Typography variant="caption" display="block">
                        Amount: {transfer.amount}
                    </Typography>
                    <Typography variant="caption" display="block">
                        Tick {transfer.start_tick} → {transfer.end_tick}
                    </Typography>
                    <Typography variant="caption" display="block">
                        Duration: {transfer.end_tick - transfer.start_tick} ticks
                    </Typography>
                </Box>
            }
            arrow
            placement="top"
        >
            <Box
                sx={{
                    position: 'absolute',
                    left: `min(${startPercent}%, calc(100% - ${MIN_MARK_PX}px))`,
                    width: `max(${widthPercent}%, ${MIN_MARK_PX}px)`,
                    height: rowHeight - 4,
                    top: 2,
                    background: patternBackground(style),
                    borderRadius: 0,
                    cursor: 'pointer',
                    transition: 'opacity 0.2s, transform 0.1s',
                    '&:hover': {
                        opacity: 0.8,
                        transform: 'scaleY(1.1)',
                        zIndex: 1,
                    },
                }}
            />
        </Tooltip>
    );
}

interface EntityRowProps {
    entity: SerializableEntityTransferHistory;
    totalDuration: number;
    rowHeight: number;
    colorMap: Map<string, ItemChartStyle>;
}

function EntityRow({ entity, totalDuration, rowHeight, colorMap }: EntityRowProps) {
    const { nameIdsIn } = useGameNames();
    // Collect unique items transferred by this entity
    const transferredItems = Array.from(new Set(entity.transfers.map(t => t.item_name))).sort();

    // Calculate total amount transferred
    const totalAmount = entity.transfers.reduce((sum, t) => sum + t.amount, 0);

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', height: rowHeight, mb: 0.5 }}>
            {/* Entity label */}
            <Box sx={{ width: 220, flexShrink: 0, pr: 1 }}>
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
                                Total transferred: {totalAmount}
                            </Typography>
                        </Box>
                    }
                    arrow
                    placement="left"
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <FactorioIcon
                            name={entity.entity_type === 'inserter' ? 'stack-inserter' : 'electric-mining-drill'}
                            size={18}
                        />
                        <Typography
                            variant="body2"
                            noWrap
                            sx={{
                                fontSize: '0.75rem',
                                color: 'text.primary',
                            }}
                        >
                            {nameIdsIn(entity.label)}
                        </Typography>
                        {/* Show total amount transferred */}
                        <Typography
                            variant="caption"
                            sx={{
                                fontSize: '0.65rem',
                                color: 'text.secondary',
                                bgcolor: 'action.selected',
                                px: 0.5,
                                borderRadius: 0,
                                fontWeight: 'medium',
                            }}
                        >
                            {totalAmount}
                        </Typography>
                        {/* Show item icons for transferred items */}
                        <Box sx={{ display: 'flex', gap: 0.25, ml: 0.5 }}>
                            {transferredItems.map(item => (
                                <FactorioIcon key={item} name={item} size={14} />
                            ))}
                        </Box>
                    </Box>
                </Tooltip>
            </Box>

            {/* Timeline bar */}
            <Box
                sx={{
                    flex: 1,
                    height: rowHeight,
                    position: 'relative',
                    ...chartGridSx(totalDuration),
                    borderRadius: 0,
                }}
            >
                {entity.transfers.map((transfer, idx) => (
                    <TransferBar
                        key={`${entity.entity_id}-${idx}`}
                        transfer={transfer}
                        totalDuration={totalDuration}
                        rowHeight={rowHeight}
                        colorMap={colorMap}
                    />
                ))}
            </Box>
        </Box>
    );
}

function TransferHistoryVisualizationComponent({ transferHistory, fullscreen = false }: TransferHistoryVisualizationProps) {
    const rowHeight = 24;
    const totalDuration = transferHistory.total_duration_ticks;

    // Group entities by type
    const inserters = transferHistory.entities.filter(e => e.entity_type === 'inserter');
    const drills = transferHistory.entities.filter(e => e.entity_type === 'drill');

    // Build color map - assign each unique item a distinct color
    const colorMap = useMemo(() => itemChartStyles(transferHistory.entities.flatMap(e => e.transfers.map(t => t.item_name))), [transferHistory]);
    const allItems = Array.from(colorMap.keys());

    const timelineContent = (isFullscreen: boolean) => (
        <>
            <Box sx={{ mb: 1.5 }}>
            {/* Legend */}
            <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {allItems.map(item => (
                    <Box
                        key={item}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            px: 1,
                            py: 0.25,
                            borderRadius: 0,
                        }}
                    >
                        <ChartSwatch {...colorMap.get(item)!} />
                        <FactorioIcon name={item} size={14} alt="" />
                        <Typography variant="caption"><GameName id={item} /></Typography>
                    </Box>
                ))}
            </Box>
            </Box>

            </Box>

            <ScrollX label={SCROLL_REGION_NAMES.transferTimeline} minWidth={CHART_MIN_WIDTH} tickRoom>
            <Box sx={{ display: 'flex', mb: 1 }}>
                <Box sx={{ width: 220, flexShrink: 0 }} />
                <Box sx={{ flex: 1 }}><TimelineAxis duration={totalDuration} /></Box>
            </Box>

            {/* Inserters section */}
            {inserters.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                        Inserters ({inserters.length})
                    </Typography>
                    {inserters.map(entity => (
                        <EntityRow
                            key={entity.entity_id}
                            entity={entity}
                            totalDuration={totalDuration}
                            rowHeight={isFullscreen ? 32 : rowHeight}
                            colorMap={colorMap}
                        />
                    ))}
                </Box>
            )}

            {/* Drills section */}
            {drills.length > 0 && (
                <Box>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                        Mining Drills ({drills.length})
                    </Typography>
                    {drills.map(entity => (
                        <EntityRow
                            key={entity.entity_id}
                            entity={entity}
                            totalDuration={totalDuration}
                            rowHeight={isFullscreen ? 32 : rowHeight}
                            colorMap={colorMap}
                        />
                    ))}
                </Box>
            )}
            </ScrollX>
        </>
    );

    return <BeltChartFrame title="Item transfers" subtitle={`${totalDuration.toLocaleString()} ticks · ${(totalDuration / 60).toFixed(1)} s · ${allItems.length} items`}>
        {timelineContent(fullscreen)}
    </BeltChartFrame>;
}

export const TransferHistoryVisualization = memo(function TransferHistoryVisualization(props: TransferHistoryVisualizationProps) {
    return <TransferHistoryVisualizationComponent {...props} />;
});
