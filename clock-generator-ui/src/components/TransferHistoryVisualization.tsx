import { Close, Fullscreen } from '@mui/icons-material';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { useId, useState, memo, type ReactNode } from 'react';
import type { SerializableEntityTransferHistory, SerializableTransferEntry, SerializableTransferHistory } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import { BUTTON_NAMES, SCROLL_REGION_NAMES } from '../utils/a11yLabels';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { CHART_MIN_WIDTH, ScrollX } from './ScrollX';
import { ITEM_COLOR_COUNT } from './colors';
import { useChartColors } from '../hooks/useChartColors';
import { MIN_MARK_PX } from '../utils/timelineGeometry';

interface TransferHistoryVisualizationProps {
    transferHistory: SerializableTransferHistory;
    fullscreenActions?: ReactNode;
}

interface TransferBarProps {
    transfer: SerializableTransferEntry;
    totalDuration: number;
    rowHeight: number;
    colorMap: Map<string, string>;
}

function TransferBar({ transfer, totalDuration, rowHeight, colorMap }: TransferBarProps) {
    const startPercent = (transfer.start_tick / totalDuration) * 100;
    const widthPercent = ((transfer.end_tick - transfer.start_tick) / totalDuration) * 100;
    const color = colorMap.get(transfer.item_name) ?? 'currentColor'; // unreachable: the map is built from these same transfers

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
                    bgcolor: color,
                    borderRadius: 0.5,
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
    colorMap: Map<string, string>;
}

function EntityRow({ entity, totalDuration, rowHeight, colorMap }: EntityRowProps) {
    const { palette: COLOR_BLIND_PALETTE, track: TIMELINE_TRACK_COLOR } = useChartColors();
    const { nameIdsIn } = useGameNames();
    // Collect unique items transferred by this entity
    const transferredItems = Array.from(new Set(entity.transfers.map(t => t.item_name))).sort();

    // Calculate total amount transferred
    const totalAmount = entity.transfers.reduce((sum, t) => sum + t.amount, 0);

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
                                // a drill is not a warning: a fixed orange, not the theme's warning colour
                                color: entity.entity_type === 'drill' ? COLOR_BLIND_PALETTE.orange : 'text.primary',
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
                                borderRadius: 0.5,
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
                    bgcolor: TIMELINE_TRACK_COLOR,
                    borderRadius: 0.5,
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

function TransferHistoryVisualizationComponent({ transferHistory, fullscreenActions }: TransferHistoryVisualizationProps) {
    const { itemMap: itemColorMap, track: TIMELINE_TRACK_COLOR } = useChartColors();
    const fullscreenTitleId = useId();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const rowHeight = 24;
    const totalDuration = transferHistory.total_duration_ticks;

    // Group entities by type
    const inserters = transferHistory.entities.filter(e => e.entity_type === 'inserter');
    const drills = transferHistory.entities.filter(e => e.entity_type === 'drill');

    // Build color map - assign each unique item a distinct color
    const colorMap = itemColorMap(transferHistory.entities.flatMap(e => e.transfers.map(t => t.item_name)));
    const allItems = Array.from(colorMap.keys());

    // Calculate tick markers
    const tickMarkers: number[] = [];
    const markerInterval = Math.ceil(totalDuration / 10 / 100) * 100; // Round to nearest 100
    for (let tick = 0; tick <= totalDuration; tick += markerInterval) {
        tickMarkers.push(tick);
    }

    const timelineContent = (isFullscreen: boolean) => (
        <>
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
                            bgcolor: TIMELINE_TRACK_COLOR,
                            borderRadius: 1,
                        }}
                    >
                        <Box
                            sx={{
                                width: 12,
                                height: 12,
                                bgcolor: colorMap.get(item),
                                borderRadius: 0.25,
                            }}
                        />
                        <FactorioIcon name={item} size={14} alt="" />
                        <Typography variant="caption"><GameName id={item} /></Typography>
                    </Box>
                ))}
            </Box>
            {allItems.length > ITEM_COLOR_COUNT && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    Colours repeat after {ITEM_COLOR_COUNT} items; the icons name each item.
                </Typography>
            )}
            </Box>

            <ScrollX label={SCROLL_REGION_NAMES.transferTimeline} minWidth={CHART_MIN_WIDTH} tickRoom>
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

    return (
        <>
            <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6" component="h3">
                        Transfer Activity Timeline
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
                aria-labelledby={fullscreenTitleId}
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
                <DialogTitle id={`${fullscreenTitleId}-bar`} component="div" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                        <Typography id={fullscreenTitleId} variant="h5" component="h2" sx={{ display: 'inline' }}>
                            Transfer Activity Timeline
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }} component="span">
                            {totalDuration} ticks ({(totalDuration / 60).toFixed(1)} seconds)
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, flex: '0 1 440px', minWidth: 0, maxWidth: '100%', ml: 'auto' }}>
                        {fullscreenActions}
                        <IconButton onClick={() => setIsModalOpen(false)} edge="end" aria-label={BUTTON_NAMES.closeFullscreen} sx={{ flexShrink: 0 }}>
                            <Close />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <DialogContent sx={{ overflow: 'auto' }}>
                    {timelineContent(true)}
                </DialogContent>
            </Dialog>
        </>
    );
}

export const TransferHistoryVisualization = memo(TransferHistoryVisualizationComponent);
